import type { AIAction, Book, Project, Scene } from "../../shared/api/types";
import { fnv1aHash, htmlToPlainText } from "../../shared/text/plainText";
import { parseModelJson } from "./modelJson";
import { truncateStringsDeep } from "./promptContextLimits";
import type { ScenePromptContext } from "./scenePromptContext";

export const SCENE_CRITIQUE_FIELD = "__scene_critique__";

export type SceneCritiqueCategory =
  | "pacing"
  | "dialogue"
  | "povLeak"
  | "tellingNotShowing"
  | "repetition"
  | "continuity";

export type SceneCritiqueSeverity = "low" | "medium" | "high";

export type SceneCritiqueFinding = {
  id?: string;
  category: SceneCritiqueCategory;
  severity: SceneCritiqueSeverity;
  title: string;
  description: string;
  quote: string;
  suggestion: string;
};

export type NormalizedSceneCritique = {
  kind: "scene_critique";
  summary: string;
  textValue: string;
  findings: SceneCritiqueFinding[];
  warnings: string[];
};

export type SceneCritiquePromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: typeof SCENE_CRITIQUE_FIELD;
    targetEntityId: string;
    scene: Scene;
    sceneText: string;
    /** Hash treści sceny w momencie krytyki — wskaźnik nieaktualności raportu. */
    sourceHash: string;
    sceneContext: ScenePromptContext;
  };
  outputContract: {
    kind: "scene_critique";
    format: "json";
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

export const SCENE_CRITIQUE_CATEGORY_LABELS: Record<SceneCritiqueCategory, string> = {
  pacing: "Tempo",
  dialogue: "Dialogi",
  povLeak: "Przeciek POV",
  tellingNotShowing: "Telling",
  repetition: "Powtórzenia",
  continuity: "Ciągłość"
};

export const SCENE_CRITIQUE_SEVERITY_LABELS: Record<SceneCritiqueSeverity, string> = {
  low: "Drobne",
  medium: "Istotne",
  high: "Poważne"
};

export function buildSceneCritiquePromptPackage({
  project,
  book,
  scene,
  sceneContext,
  sceneText
}: {
  project: Project;
  book: Book;
  scene: Scene;
  sceneContext: ScenePromptContext;
  sceneText: string;
}): SceneCritiquePromptPackage {
  return {
    id: createPromptId("critique_scene"),
    projectId: project.id,
    bookId: book.id,
    action: "critique_scene",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Skrytykuj scenę jak doświadczony redaktor prozy: tempo, dialogi, przecieki POV, telling zamiast showing, powtórzenia i błędy ciągłości.",
    context: {
      targetField: SCENE_CRITIQUE_FIELD,
      targetEntityId: scene.id,
      scene,
      sceneText,
      sourceHash: fnv1aHash(htmlToPlainText(scene.manuscriptContent ?? "")),
      sceneContext
    },
    outputContract: {
      kind: "scene_critique",
      format: "json"
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderSceneCritiquePromptPackage(
  promptPackage: SceneCritiquePromptPackage
): string {
  const { context } = promptPackage;
  return `# Role
Jesteś doświadczonym redaktorem prozy pracującym wewnątrz StoryForge2. Autor pisze w trybie "AI pisze szkic, autor redaguje" — Twoja krytyka jest podstawą jego pracy redakcyjnej.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Zwróć maksymalnie 10 najważniejszych uwag (findings). Mniej ważne pomiń.
- Każda uwaga musi mieć kategorię: pacing (tempo), dialogue (dialogi), povLeak (przeciek POV — narrator zdradza wiedzę spoza perspektywy POV z kontraktu narracyjnego), tellingNotShowing (relacjonowanie emocji/cech zamiast pokazania), repetition (powtórzone słowa, frazy, konstrukcje), continuity (sprzeczność ze Story So Far, poprzednimi scenami lub wiedzą postaci).
- Pole "quote" MUSI być DOSŁOWNYM, ciągłym cytatem z tekstu sceny (sekcja Scene Text) — bez parafraz, bez skrótów, bez wielokropków. 1-3 zdania, dokładnie tak, jak stoją w tekście. Uwagi bez możliwego cytatu (np. ogólne tempo całej sceny) oznacz quote jako pusty string "".
- Pole "suggestion" to konkretna instrukcja przepisania cytowanego fragmentu — tak, by można ją było przekazać wprost do przepisania zaznaczenia.
- Nie chwal. Nie proponuj zmian fabuły ani nowych wydarzeń — tylko jakość prozy i spójność.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

# Scene Context
${renderCritiqueSceneContext(context.sceneContext)}

# Scene Text
${context.sceneText || "(scena nie ma jeszcze tekstu)"}

# Output Contract
Zwróć JSON:
{
  "version": 1,
  "kind": "scene_critique",
  "summary": "Krótka ogólna ocena sceny dla autora (2-3 zdania)",
  "findings": [
    {
      "category": "pacing | dialogue | povLeak | tellingNotShowing | repetition | continuity",
      "severity": "low | medium | high",
      "title": "Krótki tytuł uwagi",
      "description": "Na czym polega problem",
      "quote": "Dosłowny cytat z tekstu sceny albo pusty string",
      "suggestion": "Konkretna instrukcja przepisania fragmentu"
    }
  ],
  "warnings": ["opcjonalne ostrzeżenia, np. brak tekstu do analizy"]
}`;
}

export function parseSceneCritiqueResult(rawOutput: string): NormalizedSceneCritique {
  const parsed = parseModelJson(rawOutput, "Krytyka sceny");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  if (record.kind !== "scene_critique") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ krytyki sceny (kind: ${JSON.stringify(record.kind ?? null)}, oczekiwano "scene_critique").`
    );
  }

  const rawFindings = Array.isArray(record.findings) ? record.findings : [];
  const findings = rawFindings
    .map(normalizeFinding)
    .filter((finding): finding is SceneCritiqueFinding => Boolean(finding));

  return {
    kind: "scene_critique",
    summary: typeof record.summary === "string" ? record.summary : "Krytyka zakończona",
    textValue: "Krytyka zakończona",
    findings,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

// Kompaktowy Scene Context bez pełnego manuskryptu — tekst sceny wchodzi
// osobno jako Scene Text.
function renderCritiqueSceneContext(sceneContext: ScenePromptContext): string {
  const { scene, styleReferences: _styleReferences, ...rest } = sceneContext;
  const { manuscriptContent: _manuscript, ...sceneWithoutManuscript } = scene;
  return JSON.stringify(truncateStringsDeep({ ...rest, scene: sceneWithoutManuscript }));
}

function normalizeFinding(value: unknown): SceneCritiqueFinding | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const title = stringValue(record.title);
  const description = stringValue(record.description);
  if (!title && !description) {
    return null;
  }

  return {
    id: stringValue(record.id) || undefined,
    category: normalizeCategory(record.category),
    severity: normalizeSeverity(record.severity),
    title: title || description.slice(0, 80),
    description: description || title,
    quote: stringValue(record.quote),
    suggestion: stringValue(record.suggestion)
  };
}

function normalizeCategory(value: unknown): SceneCritiqueCategory {
  return value === "pacing" ||
    value === "dialogue" ||
    value === "povLeak" ||
    value === "tellingNotShowing" ||
    value === "repetition" ||
    value === "continuity"
    ? value
    : "pacing";
}

function normalizeSeverity(value: unknown): SceneCritiqueSeverity {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
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
