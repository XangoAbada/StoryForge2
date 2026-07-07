import type {
  AIAction,
  Book,
  Chapter,
  Project,
  Scene
} from "../../shared/api/types";
import { parseModelJson } from "./modelJson";
import { optionalLine } from "./promptContextLimits";

// Pakiety promptów dla streszczeń kroczących: scena -> rozdział -> "story so
// far". Wzorzec jak w sceneStoryBibleAuditPromptPackage: kontrakt JSON,
// parsowanie z normalizacją, brak zapisu kanonu przez model.

export type SceneSummaryPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: Extract<AIAction, "summarize_scene">;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetEntityId: string;
    scene: Pick<Scene, "id" | "title" | "summary" | "goal" | "outcome" | "timeMarker">;
    chapterTitle: string;
    povCharacterName: string;
    bookCore: Pick<Book, "workingTitle" | "premise" | "pointOfView">;
    sceneText: string;
  };
  outputContract: { kind: "scene_auto_summary"; format: "json" };
  generationOptions: { providerId: "codex-cli-bridge" };
};

export type ChapterSummaryPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: Extract<AIAction, "summarize_chapter">;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetEntityId: string;
    chapter: Pick<Chapter, "id" | "number" | "workingTitle" | "summary" | "purpose">;
    bookCore: Pick<Book, "workingTitle" | "premise">;
    sceneSummaries: Array<{ title: string; timeMarker: string; summary: string }>;
  };
  outputContract: { kind: "chapter_auto_summary"; format: "json" };
  generationOptions: { providerId: "codex-cli-bridge" };
};

export type StorySoFarPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: Extract<AIAction, "summarize_story_so_far">;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetEntityId: string;
    bookCore: Pick<Book, "workingTitle" | "premise" | "endingDirection">;
    chapterSummaries: Array<{ number: number; workingTitle: string; summary: string }>;
  };
  outputContract: { kind: "story_so_far"; format: "json" };
  generationOptions: { providerId: "codex-cli-bridge" };
};

export type NormalizedSceneSummary = {
  summary: string;
  events: string[];
  stateChanges: string[];
  openHooks: string[];
  timeMarker: string;
  /** Gotowy tekst do zapisania w scenes.auto_summary (proza + fakty). */
  composedText: string;
};

export function buildSceneSummaryPromptPackage({
  project,
  book,
  scene,
  chapterTitle,
  povCharacterName,
  sceneText
}: {
  project: Project;
  book: Book;
  scene: Scene;
  chapterTitle: string;
  povCharacterName: string;
  sceneText: string;
}): SceneSummaryPromptPackage {
  return {
    id: createPromptId("summarize_scene"),
    projectId: project.id,
    bookId: book.id,
    action: "summarize_scene",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Streść napisaną scenę powieści na potrzeby ciągłości dalszego pisania: zwięzła proza plus twarde fakty (wydarzenia, zmiany stanu wiedzy i relacji, otwarte haki).",
    context: {
      targetEntityId: scene.id,
      scene: {
        id: scene.id,
        title: scene.title,
        summary: scene.summary,
        goal: scene.goal,
        outcome: scene.outcome,
        timeMarker: scene.timeMarker
      },
      chapterTitle,
      povCharacterName,
      bookCore: {
        workingTitle: book.workingTitle,
        premise: book.premise,
        pointOfView: book.pointOfView
      },
      sceneText: trimWords(sceneText, 6000)
    },
    outputContract: { kind: "scene_auto_summary", format: "json" },
    generationOptions: { providerId: "codex-cli-bridge" }
  };
}

export function renderSceneSummaryPromptPackage(
  promptPackage: SceneSummaryPromptPackage
): string {
  const { context } = promptPackage;
  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz Bowri.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Streszczaj wyłącznie to, co faktycznie jest w tekście sceny; nie dopowiadaj wydarzeń.
- summary: 80-150 słów zwięzłej prozy w czasie teraźniejszym, bez ocen i interpretacji stylu.
- events: konkretne wydarzenia fabularne w kolejności (krótkie zdania).
- stateChanges: kto się czego dowiedział, co zmieniło się w relacjach, kto co zyskał/stracił.
- openHooks: otwarte pytania, niedokończone wątki, zapowiedzi.
- timeMarker: kiedy scena się dzieje względem poprzednich, jeśli tekst na to wskazuje.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

# Book Context
${[
    optionalLine("Tytuł roboczy", context.bookCore.workingTitle, "- "),
    optionalLine("Premise", context.bookCore.premise, "- "),
    optionalLine("POV", context.bookCore.pointOfView, "- ")
  ]
    .filter(Boolean)
    .join("\n")}

# Scene Metadata
${[
    optionalLine("Tytuł sceny", context.scene.title, "- "),
    optionalLine("Rozdział", context.chapterTitle, "- "),
    optionalLine("Postać POV", context.povCharacterName, "- "),
    optionalLine("Plan sceny", context.scene.summary, "- "),
    optionalLine("Zaplanowany wynik", context.scene.outcome, "- "),
    optionalLine("Znacznik czasu z planu", context.scene.timeMarker, "- ")
  ]
    .filter(Boolean)
    .join("\n")}

# Scene Text
${context.sceneText || "(scena jest pusta)"}

# Output Contract
Zwróć JSON:
{
  "version": 1,
  "kind": "scene_auto_summary",
  "summary": "80-150 słów prozy streszczenia",
  "events": ["wydarzenie 1", "wydarzenie 2"],
  "stateChanges": ["kto się czego dowiedział / co się zmieniło"],
  "openHooks": ["otwarty wątek albo pytanie"],
  "timeMarker": "np. następnego ranka"
}`;
}

export function parseSceneSummaryResult(rawOutput: string): NormalizedSceneSummary {
  const parsed = parseModelJson(rawOutput, "Streszczenie sceny");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (record.kind !== "scene_auto_summary") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ streszczenia sceny (kind: ${JSON.stringify(record.kind ?? null)}).`
    );
  }

  const summary = stringValue(record.summary);
  if (!summary) {
    throw new Error("AI zwróciło puste streszczenie sceny.");
  }
  const events = stringList(record.events);
  const stateChanges = stringList(record.stateChanges);
  const openHooks = stringList(record.openHooks);
  const timeMarker = stringValue(record.timeMarker);

  const factLines = [
    events.length ? `Wydarzenia: ${events.join("; ")}` : "",
    stateChanges.length ? `Zmiany stanu: ${stateChanges.join("; ")}` : "",
    openHooks.length ? `Otwarte haki: ${openHooks.join("; ")}` : "",
    timeMarker ? `Czas: ${timeMarker}` : ""
  ].filter(Boolean);

  return {
    summary,
    events,
    stateChanges,
    openHooks,
    timeMarker,
    composedText: factLines.length ? `${summary}\n${factLines.join("\n")}` : summary
  };
}

export function buildChapterSummaryPromptPackage({
  project,
  book,
  chapter,
  sceneSummaries
}: {
  project: Project;
  book: Book;
  chapter: Chapter;
  sceneSummaries: Array<{ title: string; timeMarker: string; summary: string }>;
}): ChapterSummaryPromptPackage {
  return {
    id: createPromptId("summarize_chapter"),
    projectId: project.id,
    bookId: book.id,
    action: "summarize_chapter",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Skondensuj streszczenia scen rozdziału w jedno spójne streszczenie rozdziału (120-200 słów) na potrzeby ciągłości dalszego pisania.",
    context: {
      targetEntityId: chapter.id,
      chapter: {
        id: chapter.id,
        number: chapter.number,
        workingTitle: chapter.workingTitle,
        summary: chapter.summary,
        purpose: chapter.purpose
      },
      bookCore: { workingTitle: book.workingTitle, premise: book.premise },
      sceneSummaries
    },
    outputContract: { kind: "chapter_auto_summary", format: "json" },
    generationOptions: { providerId: "codex-cli-bridge" }
  };
}

export function renderChapterSummaryPromptPackage(
  promptPackage: ChapterSummaryPromptPackage
): string {
  const { context } = promptPackage;
  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz Bowri.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Opieraj się wyłącznie na podanych streszczeniach scen; nie dopowiadaj wydarzeń.
- Zachowaj chronologię i kluczowe zmiany stanu (wiedza postaci, relacje, straty i zyski).
- Wymień otwarte haki na końcu streszczenia, jeśli istnieją.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

# Book Context
${[
    optionalLine("Tytuł roboczy", context.bookCore.workingTitle, "- "),
    optionalLine("Premise", context.bookCore.premise, "- ")
  ]
    .filter(Boolean)
    .join("\n")}

# Chapter Metadata
${[
    optionalLine("Numer", context.chapter.number, "- "),
    optionalLine("Tytuł roboczy", context.chapter.workingTitle, "- "),
    optionalLine("Plan rozdziału", context.chapter.summary, "- "),
    optionalLine("Cel rozdziału", context.chapter.purpose, "- ")
  ]
    .filter(Boolean)
    .join("\n")}

# Scene Summaries
${
    context.sceneSummaries.length
      ? context.sceneSummaries
          .map(
            (scene) =>
              `- ${scene.title}${scene.timeMarker ? ` [${scene.timeMarker}]` : ""}: ${scene.summary}`
          )
          .join("\n")
      : "(brak streszczeń scen)"
  }

# Output Contract
Zwróć JSON:
{
  "version": 1,
  "kind": "chapter_auto_summary",
  "summary": "120-200 słów streszczenia rozdziału"
}`;
}

export function parseChapterSummaryResult(rawOutput: string): string {
  const parsed = parseModelJson(rawOutput, "Streszczenie rozdziału");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (record.kind !== "chapter_auto_summary") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ streszczenia rozdziału (kind: ${JSON.stringify(record.kind ?? null)}).`
    );
  }
  const summary = stringValue(record.summary);
  if (!summary) {
    throw new Error("AI zwróciło puste streszczenie rozdziału.");
  }
  return summary;
}

export function buildStorySoFarPromptPackage({
  project,
  book,
  chapterSummaries
}: {
  project: Project;
  book: Book;
  chapterSummaries: Array<{ number: number; workingTitle: string; summary: string }>;
}): StorySoFarPromptPackage {
  return {
    id: createPromptId("summarize_story_so_far"),
    projectId: project.id,
    bookId: book.id,
    action: "summarize_story_so_far",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Skondensuj streszczenia rozdziałów w jedno 'story so far' całej książki (300-500 słów) na potrzeby ciągłości dalszego pisania.",
    context: {
      targetEntityId: book.id,
      bookCore: {
        workingTitle: book.workingTitle,
        premise: book.premise,
        endingDirection: book.endingDirection
      },
      chapterSummaries
    },
    outputContract: { kind: "story_so_far", format: "json" },
    generationOptions: { providerId: "codex-cli-bridge" }
  };
}

export function renderStorySoFarPromptPackage(
  promptPackage: StorySoFarPromptPackage
): string {
  const { context } = promptPackage;
  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz Bowri.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Opieraj się wyłącznie na podanych streszczeniach rozdziałów; nie dopowiadaj wydarzeń.
- Zachowaj chronologię, kluczowe zwroty akcji i aktualny stan wiedzy oraz relacji postaci.
- Zakończ akapitem "Stan na teraz" opisującym, gdzie fabuła stoi w tej chwili i jakie wątki są otwarte.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

# Book Context
${[
    optionalLine("Tytuł roboczy", context.bookCore.workingTitle, "- "),
    optionalLine("Premise", context.bookCore.premise, "- "),
    optionalLine("Kierunek zakończenia", context.bookCore.endingDirection, "- ")
  ]
    .filter(Boolean)
    .join("\n")}

# Chapter Summaries
${
    context.chapterSummaries.length
      ? context.chapterSummaries
          .map(
            (chapter) =>
              `- Rozdział ${chapter.number}${chapter.workingTitle ? ` (${chapter.workingTitle})` : ""}: ${chapter.summary}`
          )
          .join("\n")
      : "(brak streszczeń rozdziałów)"
  }

# Output Contract
Zwróć JSON:
{
  "version": 1,
  "kind": "story_so_far",
  "summary": "300-500 słów streszczenia całej książki do tej pory"
}`;
}

export function parseStorySoFarResult(rawOutput: string): string {
  const parsed = parseModelJson(rawOutput, "Story so far");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (record.kind !== "story_so_far") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ story so far (kind: ${JSON.stringify(record.kind ?? null)}).`
    );
  }
  const summary = stringValue(record.summary);
  if (!summary) {
    throw new Error("AI zwróciło puste story so far.");
  }
  return summary;
}

function trimWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords
    ? `(początek sceny pominięto) …${words.slice(words.length - maxWords).join(" ")}`
    : words.join(" ");
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }
  return `${action}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
