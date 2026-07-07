import type {
  AIAction,
  Book,
  CharacterWorkspace,
  Project,
  Scene,
  WorldWorkspace
} from "../../shared/api/types";
import { parseModelJson } from "./modelJson";
import { truncateStringsDeep } from "./promptContextLimits";
import type { ScenePromptContext } from "./scenePromptContext";

export const SCENE_STORY_BIBLE_AUDIT_FIELD = "__scene_story_bible_audit__";

export type SceneDiscoveryKind =
  | "character"
  | "characterMemory"
  | "worldElement"
  | "worldRule"
  | "characterRelation";

export type SceneStoryBibleAuditCandidate = {
  id?: string;
  kind: SceneDiscoveryKind;
  title: string;
  reason: string;
  evidence: string;
  targetExistingCharacterId?: string;
  relatedCharacterIds?: string[];
  suggestedType?: string;
};

export type SceneStoryBibleAuditSourceKind = "acceptedText" | "scenePlan";

export type ScenePlanAuditSnapshot = {
  title: string;
  summary: string;
  goal: string;
  conflict: string;
  outcome: string;
  targetWordCount: number | null;
  analysisText: string;
};

export type NormalizedSceneStoryBibleAudit = {
  kind: "scene_story_bible_audit";
  summary: string;
  textValue: string;
  candidates: SceneStoryBibleAuditCandidate[];
  warnings: string[];
};

export type SceneStoryBibleAuditPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: typeof SCENE_STORY_BIBLE_AUDIT_FIELD;
    targetEntityId: string;
    scene: Scene;
    acceptedText: string;
    scenePlan: ScenePlanAuditSnapshot | null;
    sourceKind: SceneStoryBibleAuditSourceKind;
    sceneContext: ScenePromptContext;
    storyBible: {
      characters: CharacterWorkspace["characters"];
      relations: CharacterWorkspace["relations"];
      memories: CharacterWorkspace["memories"];
      memoryLinks: CharacterWorkspace["memoryLinks"];
      worldElements: WorldWorkspace["elements"];
      worldRules: WorldWorkspace["rules"];
    };
  };
  outputContract: {
    kind: "scene_story_bible_audit";
    format: "json";
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

export function buildSceneStoryBibleAuditPromptPackage({
  project,
  book,
  scene,
  sceneContext,
  characters,
  world,
  acceptedText,
  scenePlan,
  sourceKind = acceptedText.trim() ? "acceptedText" : "scenePlan"
}: {
  project: Project;
  book: Book;
  scene: Scene;
  sceneContext: ScenePromptContext;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  acceptedText: string;
  scenePlan?: ScenePlanAuditSnapshot | null;
  sourceKind?: SceneStoryBibleAuditSourceKind;
}): SceneStoryBibleAuditPromptPackage {
  return {
    id: createPromptId("analyze_scene_story_bible_opportunities"),
    projectId: project.id,
    bookId: book.id,
    action: "analyze_scene_story_bible_opportunities",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      sourceKind === "acceptedText"
        ? "Przeanalizuj zaakceptowany fragment sceny i znajdź kandydatów do Story Bible: nowe postacie, wspomnienia postaci, elementy świata, reguły świata albo relacje."
        : "Przeanalizuj plan wygenerowanej sceny i znajdź kandydatów do Story Bible: nowe postacie, wspomnienia postaci, elementy świata, reguły świata albo relacje.",
    context: {
      targetField: SCENE_STORY_BIBLE_AUDIT_FIELD,
      targetEntityId: scene.id,
      scene,
      acceptedText,
      scenePlan: scenePlan ?? null,
      sourceKind,
      sceneContext,
      storyBible: {
        characters: characters.characters,
        relations: characters.relations,
        memories: characters.memories,
        memoryLinks: characters.memoryLinks,
        worldElements: world.elements,
        worldRules: world.rules
      }
    },
    outputContract: {
      kind: "scene_story_bible_audit",
      format: "json"
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderSceneStoryBibleAuditPromptPackage(
  promptPackage: SceneStoryBibleAuditPromptPackage
): string {
  const { context } = promptPackage;
  const sourceBlock =
    context.sourceKind === "acceptedText"
      ? `# Accepted Text
${context.acceptedText || "(brak zaakceptowanego tekstu)"}`
      : `# Scene Plan
${context.scenePlan?.analysisText || JSON.stringify(context.scenePlan ?? context.scene, null, 2)}`;

  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz Bowri.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj kanonu i nie twórz pełnych profili. Zwróć tylko kandydatów do ręcznej decyzji autora.
- Nie dubluj istniejących postaci, wspomnień, elementów świata ani reguł, jeśli istniejąca encja już pokrywa odkrycie.
- Wspomnienie postaci sugeruj tylko wtedy, gdy wynika z materiału sceny i da się wskazać istniejącą postać przez targetExistingCharacterId.
- Każdy kandydat musi mieć krótki powód i krótki cytat/parafrazę dowodu ze sceny albo planu sceny.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

# Scene Context
${renderAuditSceneContext(context.sceneContext)}

${sourceBlock}

# Existing Story Bible
${JSON.stringify(truncateStringsDeep(context.storyBible))}

# Output Contract
Zwróć JSON:
{
  "version": 1,
  "kind": "scene_story_bible_audit",
  "summary": "Krótki komunikat dla autora",
  "candidates": [
    {
      "kind": "character | characterMemory | worldElement | worldRule | characterRelation",
      "title": "Nazwa robocza",
      "reason": "Dlaczego warto to dodać",
      "evidence": "Krótki fragment albo opis miejsca w scenie",
      "targetExistingCharacterId": "opcjonalne id istniejącej postaci dla wspomnienia",
      "relatedCharacterIds": ["opcjonalne id postaci dla relacji"],
      "suggestedType": "opcjonalny typ: person, location, magic, wydarzenie, sekret itd."
    }
  ],
  "warnings": ["opcjonalne ostrzeżenia"]
}`;
}

export function parseSceneStoryBibleAuditResult(rawOutput: string): NormalizedSceneStoryBibleAudit {
  const parsed = parseModelJson(rawOutput, "Analiza Story Bible sceny");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  if (record.kind !== "scene_story_bible_audit") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ analizy sceny (kind: ${JSON.stringify(record.kind ?? null)}, oczekiwano "scene_story_bible_audit").`
    );
  }

  const rawCandidates = Array.isArray(record.candidates) ? record.candidates : [];
  const candidates = rawCandidates
    .map(normalizeCandidate)
    .filter((candidate): candidate is SceneStoryBibleAuditCandidate => Boolean(candidate));

  return {
    kind: "scene_story_bible_audit",
    summary: typeof record.summary === "string" ? record.summary : "Analiza zakończona",
    textValue: "Analiza zakończona",
    candidates,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

// Kompaktowy Scene Context bez pełnego manuskryptu — tekst sceny wchodzi
// osobno jako Accepted Text / Scene Plan.
function renderAuditSceneContext(sceneContext: ScenePromptContext): string {
  const { scene, ...rest } = sceneContext;
  const { manuscriptContent: _manuscript, ...sceneWithoutManuscript } = scene;
  return JSON.stringify(
    truncateStringsDeep({ ...rest, scene: sceneWithoutManuscript })
  );
}

function normalizeCandidate(value: unknown): SceneStoryBibleAuditCandidate | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const kind = normalizeKind(record.kind);
  const title = stringValue(record.title);
  if (!kind || !title) {
    return null;
  }

  return {
    id: stringValue(record.id) || undefined,
    kind,
    title,
    reason: stringValue(record.reason, "Wynika z materiału sceny."),
    evidence: stringValue(record.evidence, "Brak wskazanego fragmentu."),
    targetExistingCharacterId: stringValue(record.targetExistingCharacterId) || undefined,
    relatedCharacterIds: Array.isArray(record.relatedCharacterIds)
      ? record.relatedCharacterIds.filter((item): item is string => typeof item === "string")
      : undefined,
    suggestedType: stringValue(record.suggestedType) || undefined
  };
}

function normalizeKind(value: unknown): SceneDiscoveryKind | null {
  return value === "character" ||
    value === "characterMemory" ||
    value === "worldElement" ||
    value === "worldRule" ||
    value === "characterRelation"
    ? value
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }
  return `${action}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
