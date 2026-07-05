import { create } from "zustand";
import type { SceneCritiqueRecord } from "../../shared/api/types";
import type { SceneCritiqueFinding } from "./sceneCritiquePromptPackage";

export type SceneCritiqueFindingStatus = "open" | "applied" | "dismissed";

export type SceneCritiqueReportFinding = SceneCritiqueFinding & {
  id: string;
  status: SceneCritiqueFindingStatus;
};

export type SceneCritiqueReport = {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  sceneTitle?: string;
  summary: string;
  findings: SceneCritiqueReportFinding[];
  sourceHash: string;
  createdAt: string;
};

type SceneCritiqueState = {
  critiques: SceneCritiqueReport[];
  setCritique: (input: {
    projectId: string;
    bookId: string;
    sceneId: string;
    sceneTitle?: string;
    summary: string;
    findings: SceneCritiqueFinding[];
    sourceHash: string;
  }) => SceneCritiqueReport;
  hydrate: (records: SceneCritiqueRecord[]) => void;
  setFindingStatus: (
    sceneId: string,
    findingId: string,
    status: SceneCritiqueFindingStatus
  ) => void;
  removeCritique: (sceneId: string) => void;
};

export const useSceneCritiqueStore = create<SceneCritiqueState>((set) => ({
  critiques: [],
  setCritique: (input) => {
    const report: SceneCritiqueReport = {
      id: createCritiqueId(input.sceneId),
      projectId: input.projectId,
      bookId: input.bookId,
      sceneId: input.sceneId,
      sceneTitle: input.sceneTitle,
      summary: input.summary,
      findings: input.findings.map((finding) => ({
        ...finding,
        id: finding.id ?? createFindingId(input.sceneId),
        status: "open" as const
      })),
      sourceHash: input.sourceHash,
      createdAt: new Date().toISOString()
    };
    set((state) => ({
      critiques: [
        report,
        ...state.critiques.filter((critique) => critique.sceneId !== input.sceneId)
      ]
    }));
    return report;
  },
  hydrate: (records) =>
    set((state) => {
      const existingScenes = new Set(state.critiques.map((critique) => critique.sceneId));
      const hydrated = records
        .filter((record) => !existingScenes.has(record.sceneId))
        .map(reportFromRecord)
        .filter((report): report is SceneCritiqueReport => Boolean(report));
      if (!hydrated.length) {
        return state;
      }
      return { critiques: [...state.critiques, ...hydrated] };
    }),
  setFindingStatus: (sceneId, findingId, status) =>
    set((state) => ({
      critiques: state.critiques.map((critique) =>
        critique.sceneId === sceneId
          ? {
              ...critique,
              findings: critique.findings.map((finding) =>
                finding.id === findingId ? { ...finding, status } : finding
              )
            }
          : critique
      )
    })),
  removeCritique: (sceneId) =>
    set((state) => ({
      critiques: state.critiques.filter((critique) => critique.sceneId !== sceneId)
    }))
}));

export function serializeCritiqueFindings(findings: SceneCritiqueReportFinding[]): string {
  return JSON.stringify(findings);
}

function reportFromRecord(record: SceneCritiqueRecord): SceneCritiqueReport | null {
  let findings: SceneCritiqueReportFinding[] = [];
  try {
    const parsed = JSON.parse(record.findingsJson || "[]");
    if (Array.isArray(parsed)) {
      findings = parsed
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .map((item, index) => ({
          id: typeof item.id === "string" ? item.id : `${record.id}:${index}`,
          category: (item.category ?? "pacing") as SceneCritiqueReportFinding["category"],
          severity: (item.severity ?? "medium") as SceneCritiqueReportFinding["severity"],
          title: typeof item.title === "string" ? item.title : "",
          description: typeof item.description === "string" ? item.description : "",
          quote: typeof item.quote === "string" ? item.quote : "",
          suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
          status:
            item.status === "applied" || item.status === "dismissed" ? item.status : "open"
        }));
    }
  } catch {
    return null;
  }

  return {
    id: record.id,
    projectId: record.projectId,
    bookId: record.bookId,
    sceneId: record.sceneId,
    summary: record.summary,
    findings,
    sourceHash: record.sourceHash,
    createdAt: record.createdAt
  };
}

// --- Rejestr celów "Zastosuj": edytor sceny rejestruje handler dla otwartej sceny ---

/** Zwraca false, gdy uwagi nie dało się zastosować (np. cytat nie istnieje w tekście). */
type SceneCritiqueApplyHandler = (
  finding: SceneCritiqueReportFinding
) => boolean | Promise<boolean>;

const critiqueApplyTargets = new Map<string, SceneCritiqueApplyHandler>();
const critiqueApplyListeners = new Set<() => void>();

export function registerCritiqueApplyTarget(
  sceneId: string,
  handler: SceneCritiqueApplyHandler
) {
  const isNew = !critiqueApplyTargets.has(sceneId);
  critiqueApplyTargets.set(sceneId, handler);
  // Edytor re-rejestruje handler przy każdym renderze — powiadamiaj tylko,
  // gdy scena faktycznie pojawia się lub znika z rejestru.
  if (isNew) {
    critiqueApplyListeners.forEach((listener) => listener());
  }
}

export function unregisterCritiqueApplyTarget(sceneId: string) {
  const existed = critiqueApplyTargets.delete(sceneId);
  if (existed) {
    critiqueApplyListeners.forEach((listener) => listener());
  }
}

export function hasCritiqueApplyTarget(sceneId: string): boolean {
  return critiqueApplyTargets.has(sceneId);
}

export function subscribeCritiqueApplyTargets(listener: () => void): () => void {
  critiqueApplyListeners.add(listener);
  return () => critiqueApplyListeners.delete(listener);
}

export async function applyCritiqueFinding(
  sceneId: string,
  finding: SceneCritiqueReportFinding
): Promise<boolean> {
  const handler = critiqueApplyTargets.get(sceneId);
  if (!handler) {
    return false;
  }
  return await handler(finding);
}

function createCritiqueId(sceneId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-critique:${crypto.randomUUID()}`;
  }
  return `scene-critique:${sceneId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createFindingId(sceneId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `critique-finding:${crypto.randomUUID()}`;
  }
  return `critique-finding:${sceneId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
