import i18n from "../../shared/i18n";
import type {
  AIAction,
  Book,
  CharacterWorkspace,
  Project,
  Scene,
  WorldWorkspace
} from "../../shared/api/types";
import {
  compactCharacter,
  compactMemory,
  compactRelation,
  optionalLine,
  prioritizeEntities,
  renderCappedStoryBible,
  truncateStringsDeep
} from "./promptContextLimits";
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
    // Tło Story Bible: kompakty encji NIEprzypisanych do sceny (te przypisane
    // są już w sceneContext), posortowane wg trafności przed limitem sekcji.
    storyBible: {
      characters: Array<NonNullable<ReturnType<typeof compactCharacter>>>;
      relations: Array<ReturnType<typeof compactRelation>>;
      memories: Array<ReturnType<typeof compactMemory>>;
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

export function sceneEditorFieldLabel(field: SceneEditorFieldKey): string {
  return i18n.t(`ai.sceneEditorField.${field}`);
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
  const sceneCharacterIds = new Set([
    ...sceneContext.characters.map((item) => item.id),
    ...(sceneContext.povCharacter ? [sceneContext.povCharacter.id] : [])
  ]);
  const sceneElementIds = new Set(sceneContext.worldElements.map((item) => item.id));
  const sceneRuleIds = new Set(sceneContext.relevantRules.map((item) => item.id));
  const relatedCharacterIds = new Set(
    characters.relations
      .filter(
        (relation) =>
          sceneCharacterIds.has(relation.fromCharacterId) ||
          sceneCharacterIds.has(relation.toCharacterId)
      )
      .flatMap((relation) => [relation.fromCharacterId, relation.toCharacterId])
  );

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
        characters: prioritizeEntities(
          characters.characters.filter((item) => !sceneCharacterIds.has(item.id)),
          (item) => relatedCharacterIds.has(item.id)
        )
          .map((item) => compactCharacter(item))
          .filter((item): item is NonNullable<typeof item> => item !== null),
        relations: prioritizeEntities(
          characters.relations,
          (item) =>
            sceneCharacterIds.has(item.fromCharacterId) ||
            sceneCharacterIds.has(item.toCharacterId)
        ).map(compactRelation),
        memories: prioritizeEntities(
          characters.memories,
          (item) => sceneCharacterIds.has(item.characterId),
          (item) => item.importance ?? 0
        ).map(compactMemory),
        worldElements: world.elements.filter((item) => !sceneElementIds.has(item.id)),
        worldRules: world.rules.filter((item) => !sceneRuleIds.has(item.id))
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
Jesteś asystentem pisarskim pracującym wewnątrz Bowri.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Formatuj wynik jako gotowy fragment manuskryptu: czytelny Markdown, akapity oddzielone pustą linią, bez list i nagłówków w treści prozy.
- Każdą wypowiedź dialogową zaczynaj od nowego akapitu i nie zlewaj dialogu z narracją.
- Stosuj naturalny polski zapis dialogów, w tym półpauzy dialogowe, jeśli pasują do stylu sceny.
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj kanonu i nie zmieniaj danych projektu bez decyzji autora.
- Zwróć wyłącznie tekst prozy w Markdown, bez JSON.
- Nie komentuj procesu poza krótką sekcją "## Notes", jeśli jest naprawdę potrzebna.
- Zachowaj ciągłość sceny, POV, wiedzę postaci, reguły świata i style guide.
- Oszczędzaj przymiotniki i przysłówki; emocje pokazuj przez działanie, gest i dialog, nie przez nazywanie ich wprost.
- Unikaj kliszowych otwarć (pogoda, budzenie się, opis świtu) — wchodź w scenę od konkretu: akcji, dialogu albo napięcia.
- Nie kończ moralizującym ani podsumowującym akapitem; scena ma się urwać na obrazie, geście albo napięciu.
- Nie powtarzaj informacji, które czytelnik już zna z wcześniejszych scen; nawiązuj do nich, zamiast je streszczać.
${renderUnwantedThemesRule(context.sceneContext.book.unwantedThemes)}- Docelową długość sceny traktuj jako orientacyjny cel, nie twardy limit.

${authorPriority ? `# Author Priority\n${authorPriority}\n` : ""}
${renderNarrativeContract(context.sceneContext)}

${renderStyleReferences(context.sceneContext)}

${renderStorySoFar(context.sceneContext)}

# Book Context
${JSON.stringify(truncateStringsDeep(context.sceneContext.book))}

# Scene Context
${renderSceneContextForPrompt(context.sceneContext)}

# Background Story Bible
${renderCappedStoryBible(context.storyBible)}

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
Gotowy tekst prozy do wstawienia albo zastąpienia. Nie dodawaj tutaj nagłówków, list ani komentarzy autora. Oddzielaj akapity pustą linią, a dialogi zapisuj jako osobne akapity.

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
    return `Napisz pierwszy szkic pełnej sceny z planu. Traktuj target word count jako przybliżenie, nie limit absolutny.${custom ? ` Uwzględnij instrukcję autora: ${custom}` : ""}`;
  }
  if (field === "continueScene") {
    return `Kontynuuj tekst sceny od ostatniego fragmentu lub po zaznaczeniu.${custom ? ` Uwzględnij instrukcję autora: ${custom}` : ""}`;
  }
  if (field === "expandSelection") {
    return `Rozwiń zaznaczony fragment, dodając konkretną akcję, emocje i sensoryczne szczegóły.${custom ? ` Uwzględnij instrukcję autora: ${custom}` : ""}`;
  }
  return `Przepisz wyłącznie zaznaczony fragment, zachowując jego sens i ciągłość sceny.${custom ? ` Tryb/instrukcja autora: ${custom}` : ""}`;
}

// Scene Context bez dubli: book, kontrakt narracyjny i warstwy ciągłości są
// drukowane osobno jako czytelne sekcje, a pełny tekst sceny wchodzi wyłącznie
// jako currentTextWindow. Długie pola przycięte do limitu.
function renderSceneContextForPrompt(sceneContext: ScenePromptContext): string {
  const {
    book: _book,
    scene,
    storySoFar: _storySoFar,
    previousChapters: _previousChapters,
    previousScene: _previousScene,
    chapterSoFar: _chapterSoFar,
    styleReferences: _styleReferences,
    ...rest
  } = sceneContext;
  const {
    manuscriptContent: _manuscript,
    autoSummary: _autoSummary,
    autoSummarySourceHash: _autoSummaryHash,
    ...sceneWithoutManuscript
  } = scene;
  return JSON.stringify(
    truncateStringsDeep({ ...rest, scene: sceneWithoutManuscript })
  );
}

// Krytyczne dla spójności pola renderowane jako czytelny Markdown zamiast
// surowego JSON — model traktuje je z większą wagą.
function renderNarrativeContract(sceneContext: ScenePromptContext): string {
  const pov = sceneContext.povCharacter;
  const lines = [
    optionalLine("Typ narracji", sceneContext.book.pointOfView, "- "),
    optionalLine("Ton książki", sceneContext.book.tone, "- "),
    pov ? `- Postać POV: ${pov.name}` : "",
    pov ? optionalLine("Głos POV", pov.voiceNotes, "- ") : "",
    pov
      ? optionalLine(
          "Wiedza POV (narracja nie może wyjść poza nią)",
          pov.knowledgeNotes,
          "- "
        )
      : "",
    optionalLine("Znacznik czasu sceny", sceneContext.scene.timeMarker, "- ")
  ].filter(Boolean);

  return lines.length
    ? `# Kontrakt narracyjny\nTe ustalenia są nadrzędne wobec reszty kontekstu:\n${lines.join("\n")}`
    : "";
}

// Few-shot stylu: fragmenty scen oznaczonych przez autora jako wzorcowe.
// Defensywnie wobec pakietów sprzed tej funkcji (brak pola styleReferences).
function renderStyleReferences(sceneContext: ScenePromptContext): string {
  const references = (sceneContext.styleReferences ?? []).filter((item) => item.excerpt.trim());
  if (!references.length) {
    return "";
  }
  const fragments = references
    .map((item) => `## ${item.sceneTitle || "Scena wzorcowa"}\n${item.excerpt}`)
    .join("\n\n");
  return `# Style Reference
Poniższe fragmenty pochodzą z zaakceptowanych scen tej książki i definiują docelowy styl prozy.
Naśladuj ich rytm zdań, gęstość opisu i sposób prowadzenia dialogów. NIE kopiuj z nich treści, wydarzeń ani sformułowań.

${fragments}`;
}

// Warstwowa "piramida kontekstu": story-so-far książki -> streszczenia
// poprzednich rozdziałów -> streszczenia scen bieżącego rozdziału -> pełny
// ogon poprzedniej sceny. Puste warstwy są pomijane.
function renderStorySoFar(sceneContext: ScenePromptContext): string {
  const sections: string[] = [];
  const storySoFar = (sceneContext.storySoFar ?? "").trim();
  const previousChapters = sceneContext.previousChapters ?? [];
  const chapterSoFar = sceneContext.chapterSoFar ?? [];

  if (storySoFar) {
    sections.push(`## Streszczenie książki do tej pory\n${storySoFar}`);
  }

  if (previousChapters.length) {
    const chapters = previousChapters
      .map((chapter) => `- Rozdział ${chapter.number}${chapter.workingTitle ? ` (${chapter.workingTitle})` : ""}: ${chapter.summary}`)
      .join("\n");
    sections.push(`## Poprzednie rozdziały\n${chapters}`);
  }

  const chapterEntries = chapterSoFar
    .map((entry) => {
      const summary =
        (entry.autoSummary ?? "").trim() || [entry.summary, entry.outcome].filter(Boolean).join(" ");
      return summary ? `- ${entry.title}${entry.timeMarker ? ` [${entry.timeMarker}]` : ""}: ${summary}` : "";
    })
    .filter(Boolean);
  if (chapterEntries.length) {
    sections.push(`## Wcześniejsze sceny bieżącego rozdziału\n${chapterEntries.join("\n")}`);
  }

  if (sceneContext.previousScene) {
    const previous = sceneContext.previousScene;
    const meta = (previous.autoSummary ?? "").trim() || previous.summary;
    const parts = [
      meta ? `Streszczenie: ${meta}` : "",
      previous.textTail
        ? `Ostatnie akapity (zszyj ton i rytm z tym fragmentem):\n${previous.textTail}`
        : ""
    ].filter(Boolean);
    if (parts.length) {
      sections.push(`## Poprzednia scena: ${previous.title}\n${parts.join("\n\n")}`);
    }
  }

  return sections.length ? `# Story So Far\n${sections.join("\n\n")}` : "";
}

// Defensywnie wobec pakietów sprzed pipeline'u ciągłości (persystowane
// propozycje mogą nie mieć nowych pól kontekstu).
function renderUnwantedThemesRule(unwantedThemes: string | undefined): string {
  const themes = (unwantedThemes ?? "").trim();
  return themes
    ? `- Tematy zakazane przez autora — nie wprowadzaj ich do treści: ${themes}\n`
    : "";
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
