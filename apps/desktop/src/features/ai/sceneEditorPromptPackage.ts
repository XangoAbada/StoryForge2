import type {
  AIAction,
  Book,
  CharacterWorkspace,
  Project,
  Scene,
  WorldWorkspace
} from "../../shared/api/types";
import type { PromptContextControl } from "./promptPackage";
import type { ScenePromptContext } from "./scenePromptContext";
import type { SceneEditorInsertMode } from "./sceneEditorProposalTargets";

export type SceneEditorFieldKey =
  | "draftScene"
  | "continueScene"
  | "rewriteSelection"
  | "expandSelection";

export type SceneEditorPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: SceneEditorFieldKey;
    targetEntityId: string;
    insertMode: SceneEditorInsertMode;
    targetWordCount: number | null;
    selectedText: string;
    currentTextWindow: string;
    customInstruction: string;
    sceneContext: ScenePromptContext;
    storyBible: {
      characters: CharacterWorkspace["characters"];
      relations: CharacterWorkspace["relations"];
      memories: CharacterWorkspace["memories"];
      worldElements: WorldWorkspace["elements"];
      worldRules: WorldWorkspace["rules"];
    };
    manualContextSnippets?: Array<{
      key: string;
      label: string;
      content: string;
    }>;
    contextControl?: PromptContextControl;
  };
  outputContract: {
    kind: "scene_editor_text";
    format: "markdown";
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

const actionByField: Record<SceneEditorFieldKey, AIAction> = {
  draftScene: "draft_scene",
  continueScene: "continue_scene",
  rewriteSelection: "rewrite_selection",
  expandSelection: "expand_selection"
};

const labelByField: Record<SceneEditorFieldKey, string> = {
  draftScene: "Szkic sceny",
  continueScene: "Kontynuacja sceny",
  rewriteSelection: "Przepisanie zaznaczenia",
  expandSelection: "Rozwinięcie zaznaczenia"
};

export function sceneEditorFieldLabel(field: SceneEditorFieldKey): string {
  return labelByField[field];
}

export function buildSceneEditorPromptPackage({
  project,
  book,
  sceneContext,
  characters,
  world,
  field,
  selectedText,
  currentText,
  customInstruction,
  insertMode,
  targetWordCount,
  manualContextSnippets = [],
  contextControl
}: {
  project: Project;
  book: Book;
  scene: Scene;
  sceneContext: ScenePromptContext;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  field: SceneEditorFieldKey;
  selectedText: string;
  currentText: string;
  customInstruction: string;
  insertMode: SceneEditorInsertMode;
  targetWordCount?: number | null;
  manualContextSnippets?: Array<{ key: string; label: string; content: string }>;
  contextControl?: PromptContextControl;
}): SceneEditorPromptPackage {
  return {
    id: createPromptId(actionByField[field]),
    projectId: project.id,
    bookId: book.id,
    action: actionByField[field],
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: instructionForField(field, customInstruction),
    context: {
      targetField: field,
      targetEntityId: sceneContext.scene.id,
      insertMode,
      targetWordCount: targetWordCount ?? null,
      selectedText,
      currentTextWindow: trimTextWindow(currentText),
      customInstruction: customInstruction.trim(),
      sceneContext,
      storyBible: {
        characters: characters.characters,
        relations: characters.relations,
        memories: characters.memories,
        worldElements: world.elements,
        worldRules: world.rules
      },
      manualContextSnippets,
      contextControl
    },
    outputContract: {
      kind: "scene_editor_text",
      format: "markdown"
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderSceneEditorPromptPackage(
  promptPackage: SceneEditorPromptPackage
): string {
  const { context } = promptPackage;
  const authorPriority = context.contextControl?.authorPriorityComment.trim();

  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj kanonu i nie zmieniaj danych projektu bez decyzji autora.
- Zwróć wyłącznie tekst prozy w Markdown, bez JSON.
- Nie komentuj procesu poza krótką sekcją "## Notes", jeśli jest naprawdę potrzebna.
- Zachowaj ciągłość sceny, POV, wiedzę postaci, reguły świata i style guide.

- Docelową długość sceny traktuj jako orientacyjny cel, nie twardy limit.

${authorPriority ? `# Author Priority\n${authorPriority}\n` : ""}
# Book Context
${JSON.stringify(context.sceneContext.book, null, 2)}

# Scene Context
${JSON.stringify(context.sceneContext, null, 2)}

# Relevant Story Bible
${JSON.stringify(context.storyBible, null, 2)}

${context.manualContextSnippets?.length ? `# Additional Author Context\n${context.manualContextSnippets.map((snippet) => `## ${snippet.label}\n${snippet.content}`).join("\n\n")}\n` : ""}
# Current Work
Wybrany tryb wstawienia: ${context.insertMode}
Docelowa długość sceny: ${context.targetWordCount ? `${context.targetWordCount} słów` : "brak"}
Zaznaczony tekst:
${context.selectedText || "(brak zaznaczenia)"}

Ostatni kontekst tekstu sceny:
${context.currentTextWindow || "(scena jest pusta)"}

# Output Contract
Zwróć Markdown:

## Result
Tekst do wstawienia albo zastąpienia.

## Notes
- Opcjonalnie: krótkie uwagi dla autora.`;
}

export function parseSceneEditorResult(rawOutput: string): string {
  const resultMatch = rawOutput.match(/##\s*Result\s*\n([\s\S]*?)(?:\n##\s*Notes\b|$)/i);
  return (resultMatch?.[1] ?? rawOutput).trim();
}

function instructionForField(field: SceneEditorFieldKey, customInstruction: string): string {
  const custom = customInstruction.trim();
  if (field === "draftScene") {
    return "Napisz pierwszy szkic pełnej sceny z planu. Traktuj target word count jako przybliżenie, nie limit absolutny.";
  }
  if (field === "continueScene") {
    return `Kontynuuj tekst sceny od ostatniego fragmentu lub po zaznaczeniu.${custom ? ` Uwzględnij instrukcję autora: ${custom}` : ""}`;
  }
  if (field === "expandSelection") {
    return `Rozwiń zaznaczony fragment, dodając konkretną akcję, emocje i sensoryczne szczegóły.${custom ? ` Uwzględnij instrukcję autora: ${custom}` : ""}`;
  }
  return `Przepisz wyłącznie zaznaczony fragment, zachowując jego sens i ciągłość sceny.${custom ? ` Tryb/instrukcja autora: ${custom}` : ""}`;
}

function trimTextWindow(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(Math.max(0, words.length - 1600)).join(" ");
}

function createPromptId(action: AIAction): string {
  if ("randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
