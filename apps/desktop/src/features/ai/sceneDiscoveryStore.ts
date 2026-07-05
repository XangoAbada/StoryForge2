import { create } from "zustand";
import type { SceneStoryBibleAuditCandidate } from "./sceneStoryBibleAuditPromptPackage";

export type SceneDiscovery = SceneStoryBibleAuditCandidate & {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  sceneTitle?: string;
  createdAt: string;
};

export type SceneAuditSourceKind = "acceptedText" | "scenePlan";

export type PendingSceneAuditPrompt = {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  sceneTitle: string;
  analysisText: string;
  sourceKind: SceneAuditSourceKind;
  createdAt: string;
};

export type PendingSceneAssignmentKind =
  | "character"
  | "characterMemory"
  | "characterRelation"
  | "worldElement"
  | "worldRule";

export type PendingSceneAssignment = {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  sceneTitle: string;
  kind: PendingSceneAssignmentKind;
  entityId: string;
  entityTitle: string;
  characterIds?: string[];
  createdAt: string;
};

type SceneDiscoveryState = {
  discoveries: SceneDiscovery[];
  pendingAuditPrompts: PendingSceneAuditPrompt[];
  pendingAssignments: PendingSceneAssignment[];
  addCandidates: (input: {
    projectId: string;
    bookId: string;
    sceneId: string;
    sceneTitle?: string;
    candidates: SceneStoryBibleAuditCandidate[];
  }) => void;
  removeDiscovery: (id: string) => void;
  addAuditPrompt: (input: Omit<PendingSceneAuditPrompt, "id" | "createdAt">) => void;
  removeAuditPrompt: (id: string) => void;
  addAssignment: (input: Omit<PendingSceneAssignment, "id" | "createdAt">) => void;
  removeAssignment: (id: string) => void;
};

export const useSceneDiscoveryStore = create<SceneDiscoveryState>((set) => ({
  discoveries: [],
  pendingAuditPrompts: [],
  pendingAssignments: [],
  addCandidates: ({ projectId, bookId, sceneId, sceneTitle, candidates }) =>
    set((state) => {
      const now = new Date().toISOString();
      const next = candidates.map((candidate) => ({
        ...candidate,
        id: candidate.id ?? createDiscoveryId(candidate),
        projectId,
        bookId,
        sceneId,
        sceneTitle,
        createdAt: now
      }));
      const existingKeys = new Set(state.discoveries.map(discoveryKey));
      const uniqueNext = next.filter((candidate) => !existingKeys.has(discoveryKey(candidate)));

      return {
        discoveries: [...uniqueNext, ...state.discoveries].slice(0, 40)
      };
    }),
  removeDiscovery: (id) =>
    set((state) => ({
      discoveries: state.discoveries.filter((discovery) => discovery.id !== id)
    })),
  addAuditPrompt: (input) =>
    set((state) => {
      // Jedna propozycja analizy na scenę: kolejna edycja aktualizuje istniejący
      // wpis (najświeższy tekst), zamiast dokładać nowy przy każdej zmianie.
      const rest = state.pendingAuditPrompts.filter(
        (prompt) => prompt.sceneId !== input.sceneId
      );

      return {
        pendingAuditPrompts: [
          {
            ...input,
            id: createAuditPromptId(input.sceneId),
            createdAt: new Date().toISOString()
          },
          ...rest
        ].slice(0, 12)
      };
    }),
  removeAuditPrompt: (id) =>
    set((state) => ({
      pendingAuditPrompts: state.pendingAuditPrompts.filter((prompt) => prompt.id !== id)
    })),
  addAssignment: (input) =>
    set((state) => {
      const existing = state.pendingAssignments.find(
        (assignment) =>
          assignment.sceneId === input.sceneId &&
          assignment.kind === input.kind &&
          assignment.entityId === input.entityId
      );
      if (existing) {
        return state;
      }

      return {
        pendingAssignments: [
          {
            ...input,
            id: createAssignmentId(input.sceneId),
            createdAt: new Date().toISOString()
          },
          ...state.pendingAssignments
        ].slice(0, 24)
      };
    }),
  removeAssignment: (id) =>
    set((state) => ({
      pendingAssignments: state.pendingAssignments.filter((assignment) => assignment.id !== id)
    }))
}));

function discoveryKey(discovery: Pick<SceneDiscovery, "sceneId" | "kind" | "title">): string {
  return `${discovery.sceneId}:${discovery.kind}:${discovery.title.toLocaleLowerCase("pl-PL")}`;
}

function createDiscoveryId(candidate: SceneStoryBibleAuditCandidate): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-discovery:${crypto.randomUUID()}`;
  }

  return `scene-discovery:${candidate.kind}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createAuditPromptId(sceneId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-audit-prompt:${crypto.randomUUID()}`;
  }

  return `scene-audit-prompt:${sceneId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createAssignmentId(sceneId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-assignment:${crypto.randomUUID()}`;
  }

  return `scene-assignment:${sceneId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
