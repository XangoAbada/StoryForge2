import type {
  AIAction,
  Act,
  Beat,
  Book,
  BookPlan,
  Chapter,
  PlotThread,
  Project
} from "../../shared/api/types";
import type { PromptContextControl, PromptContextSource } from "./promptPackage";

export type PlanFieldKey =
  | "storyStructure"
  | "storyStructureDescription"
  | "storyStructureNotes"
  | "acts"
  | "actPurpose"
  | "actSummary"
  | "beatSheet"
  | "plotThreads"
  | "chapterPlan"
  | "chapterSummary"
  | "chapterPurpose"
  | "chapterConflict"
  | "chapterTurningPoint"
  | "chapterThreadSuggestions"
  | "chapterBeatSuggestions"
  | "planGaps";

export type PlanFieldConfig = {
  key: PlanFieldKey;
  label: string;
  action: AIAction;
  targetKind: "structure" | "act" | "beat" | "thread" | "chapter" | "audit";
  userInstruction: string;
};

export type PlanPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: PlanFieldKey;
    targetEntityId?: string;
    targetEntityLabel?: string;
    book: Pick<
      Book,
      | "workingTitle"
      | "premise"
      | "expandedPremise"
      | "logline"
      | "centralConflict"
      | "antagonistForce"
      | "stakes"
      | "settingSketch"
      | "endingDirection"
      | "genre"
      | "subgenre"
      | "targetAudience"
      | "tone"
      | "pointOfView"
      | "targetWordCount"
      | "themesJson"
      | "styleGuide"
    >;
    plan: {
      structureType: string;
      structureDescription: string;
      structureNotes: string;
      acts: Act[];
      beats: Beat[];
      threads: PlotThread[];
      chapters: Chapter[];
      chapterThreads: BookPlan["chapterThreads"];
      beatThreads: BookPlan["beatThreads"];
      chapterBeats: BookPlan["chapterBeats"];
    };
    generationMode: "generate" | "expand";
    targetFieldCurrentValue: string;
    contextControl?: PromptContextControl;
  };
  outputContract: {
    kind: "book_plan_suggestion";
    format: "json";
    schema: unknown;
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

export const planFieldConfigs: Record<PlanFieldKey, PlanFieldConfig> = {
  storyStructure: {
    key: "storyStructure",
    label: "Struktura fabuly",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Zaproponuj tylko typ struktury fabularnej dla ksiazki. Nie generuj ani nie edytuj opisu, notatek, aktow, beatow, watkow ani rozdzialow."
  },
  storyStructureDescription: {
    key: "storyStructureDescription",
    label: "Opis struktury",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Wygeneruj tylko wartosc pola opisu struktury. Jesli pole ma juz tresc, rozwin ja w kompletna docelowa wersje bez zmiany typu struktury, notatek ani encji planu."
  },
  storyStructureNotes: {
    key: "storyStructureNotes",
    label: "Notatki do planu",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Wygeneruj tylko wartosc pola notatek do planu. Jesli pole ma juz tresc, rozwin ja w kompletna docelowa wersje bez zmiany typu struktury, opisu ani encji planu."
  },
  acts: {
    key: "acts",
    label: "Akty",
    action: "generate_acts",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko akty z zakresem fabuly, celem i zwiezlym streszczeniem. Nie generuj beatow, watkow ani rozdzialow."
  },
  actPurpose: {
    key: "actPurpose",
    label: "Cel aktu",
    action: "generate_act_field",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko wartosc pola celu wybranego aktu, korzystajac z planu jako kontekstu. Nie zmieniaj innych pol ani encji."
  },
  actSummary: {
    key: "actSummary",
    label: "Streszczenie aktu",
    action: "generate_act_field",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko wartosc pola streszczenia wybranego aktu. Nie zmieniaj innych pol ani encji."
  },
  beatSheet: {
    key: "beatSheet",
    label: "Beat sheet",
    action: "generate_beat_sheet",
    targetKind: "beat",
    userInstruction:
      "Wygeneruj tylko beat sheet przypisany do aktow i watkow. Nie generuj struktury, aktow, watkow ani rozdzialow."
  },
  plotThreads: {
    key: "plotThreads",
    label: "Watki",
    action: "generate_plot_threads",
    targetKind: "thread",
    userInstruction:
      "Zaproponuj tylko watki fabularne wraz z rola i kolorem do mapy planu. Nie generuj struktury, aktow, beatow ani rozdzialow."
  },
  chapterPlan: {
    key: "chapterPlan",
    label: "Plan rozdzialow",
    action: "generate_chapter_plan",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko plan rozdzialow z celami, konfliktami, punktami zwrotnymi oraz przypisaniami do istniejacych aktow, beatow i watkow."
  },
  chapterSummary: {
    key: "chapterSummary",
    label: "Streszczenie rozdzialu",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartosc pola streszczenia wybranego rozdzialu. Nie zmieniaj innych pol ani encji."
  },
  chapterPurpose: {
    key: "chapterPurpose",
    label: "Cel rozdzialu",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartosc pola celu fabularnego wybranego rozdzialu. Nie zmieniaj innych pol ani encji."
  },
  chapterConflict: {
    key: "chapterConflict",
    label: "Konflikt rozdzialu",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartosc pola konfliktu wybranego rozdzialu. Nie zmieniaj innych pol ani encji."
  },
  chapterTurningPoint: {
    key: "chapterTurningPoint",
    label: "Punkt zwrotny",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartosc pola punktu zwrotnego wybranego rozdzialu. Nie zmieniaj innych pol ani encji."
  },
  chapterThreadSuggestions: {
    key: "chapterThreadSuggestions",
    label: "Powiazane watki",
    action: "suggest_chapter_relations",
    targetKind: "chapter",
    userInstruction:
      "Zasugeruj tylko istniejace watki fabularne, ktore warto dopiac do wybranego rozdzialu. AI moze nie sugerowac zadnego watku, jesli nie ma to zastosowania w tym rozdziale. Nie tworz nowych watkow, nie sugeruj watkow spoza Current Plan i wyklucz watki juz przypisane do rozdzialu."
  },
  chapterBeatSuggestions: {
    key: "chapterBeatSuggestions",
    label: "Powiazane beaty",
    action: "suggest_chapter_relations",
    targetKind: "chapter",
    userInstruction:
      "Zasugeruj tylko istniejace beaty, ktore warto dopiac do wybranego rozdzialu. AI moze nie sugerowac zadnego beatu, jesli nie ma to zastosowania w tym rozdziale. Nie tworz nowych beatow, nie sugeruj beatow spoza Current Plan i wyklucz beaty juz przypisane do rozdzialu."
  },
  planGaps: {
    key: "planGaps",
    label: "Luki planu",
    action: "find_plan_gaps",
    targetKind: "audit",
    userInstruction:
      "Znajdz luki, slabe napiecie, watki bez payoffu i rozdzialy bez celu."
  }
};

export function buildPlanPromptPackage(
  project: Project,
  book: Book,
  plan: BookPlan,
  field: PlanFieldKey,
  targetEntity?: Act | Beat | PlotThread | Chapter,
  contextControl?: PromptContextControl
): PlanPromptPackage {
  const config = planFieldConfigs[field];
  const targetFieldCurrentValue = currentPlanFieldValue(plan, field, targetEntity);
  const generationMode = targetFieldCurrentValue.trim() ? "expand" : "generate";

  return {
    id: createPromptId(config.action),
    projectId: project.id,
    bookId: book.id,
    action: config.action,
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: config.userInstruction,
    context: {
      targetField: field,
      targetEntityId: targetEntity?.id,
      targetEntityLabel: targetEntity
        ? "workingTitle" in targetEntity
          ? targetEntity.workingTitle
          : targetEntity.name
        : undefined,
      book: bookPlanContext(book),
      plan: {
        structureType: plan.structure?.structureType ?? "",
        structureDescription: plan.structure?.description ?? "",
        structureNotes: plan.structure?.notes ?? "",
        acts: plan.acts,
        beats: plan.beats,
        threads: plan.threads,
        chapters: plan.chapters,
        chapterThreads: plan.chapterThreads,
        beatThreads: plan.beatThreads,
        chapterBeats: plan.chapterBeats
      },
      generationMode,
      targetFieldCurrentValue,
      ...(contextControl ? { contextControl } : {})
    },
    outputContract: {
      kind: "book_plan_suggestion",
      format: "json",
      schema: planSuggestionSchema(field)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderPlanPromptPackage(promptPackage: PlanPromptPackage): string {
  const config = planFieldConfigs[promptPackage.context.targetField];
  const authorPriority = renderAuthorPriority(
    promptPackage.context.contextControl
  );
  const modeInstruction =
    promptPackage.context.generationMode === "expand"
      ? `Tryb pracy: expand.
Obecna zawartosc pola "${config.label}" jest materialem wyjsciowym:
${emptyFallback(promptPackage.context.targetFieldCurrentValue)}

Uwzglednij te tresc i rozwin ja w lepsza, pelniejsza propozycje. Mozesz przebudowac, doprecyzowac i przepisac istniejaca tresc, jesli dzieki temu wynik bedzie spojniejszy. Zwroc kompletna docelowa wartosc pola, nie sam dopisek.`
      : `Tryb pracy: generate.
Pole "${config.label}" jest puste albo wymaga nowej propozycji. Wygeneruj kompletna docelowa wartosc pola.`;

  return `# Role
Jestes asystentem pisarskim pracujacym wewnatrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba ze projekt ma inny jezyk.
- Dla locale "pl" uzywaj poprawnych polskich znakow.
- Nie zapisuj danych. Zwroc tylko propozycje jako JSON.
- Nie kasuj istniejacych aktow, beatow, watkow ani rozdzialow; proponuj zmiany i dodatki.
- Elementy planu, ktore odwolujesz, identyfikuj po id albo dokladnej nazwie.
- Zwroc tylko sekcje przewidziane w Output Contract dla docelowego pola. Nie dopisuj pozostalych czesci planu.
- Odpowiedz wylacznie poprawnym JSON bez trailing commas.

${authorPriority}

# Book Context
${renderBookContext(promptPackage.context.book, promptPackage.context.contextControl)}

# Current Plan
${renderPlanContext(promptPackage.context.plan, promptPackage.context.contextControl)}

# Current Work
Docelowe pole: ${promptPackage.context.targetField} (${config.label}).
Docelowy element: ${promptPackage.context.targetEntityLabel ?? "(brak)"}
${modeInstruction}

# Output Contract
Zwroc JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function planPromptContextSources(field: PlanFieldKey): PromptContextSource[] {
  const required: PromptContextSource = {
    key: field,
    label: planFieldConfigs[field].label,
    required: true
  };

  return [
    required,
    { key: "bookCore", label: "Rdzen koncepcji", required: false },
    { key: "styleGuide", label: "Style guide", required: false },
    { key: "storyStructure", label: "Struktura planu", required: false },
    { key: "acts", label: "Akty", required: false },
    { key: "beats", label: "Beaty", required: false },
    { key: "plotThreads", label: "Watki", required: false },
    { key: "chapters", label: "Rozdzialy", required: false }
  ];
}

export function planPromptContextSource(field: PlanFieldKey): PromptContextSource {
  return {
    key: field,
    label: planFieldConfigs[field].label,
    required: false
  };
}

function bookPlanContext(book: Book): PlanPromptPackage["context"]["book"] {
  return {
    workingTitle: book.workingTitle ?? "",
    premise: book.premise ?? "",
    expandedPremise: book.expandedPremise ?? "",
    logline: book.logline ?? "",
    centralConflict: book.centralConflict ?? "",
    antagonistForce: book.antagonistForce ?? "",
    stakes: book.stakes ?? "",
    settingSketch: book.settingSketch ?? "",
    endingDirection: book.endingDirection ?? "",
    genre: book.genre ?? "",
    subgenre: book.subgenre ?? "",
    targetAudience: book.targetAudience ?? "",
    tone: book.tone ?? "",
    pointOfView: book.pointOfView ?? "",
    targetWordCount: book.targetWordCount ?? null,
    themesJson: book.themesJson ?? "[]",
    styleGuide: book.styleGuide ?? ""
  };
}

function renderBookContext(
  book: PlanPromptPackage["context"]["book"],
  contextControl?: PromptContextControl
): string {
  if (contextControl && !isContextKeyIncluded("bookCore", contextControl)) {
    return "(pominieto przez autora)";
  }

  return [
    `- Tytul roboczy: ${emptyFallback(book.workingTitle)}`,
    `- Premise: ${emptyFallback(book.premise)}`,
    `- Rozszerzona premisa: ${emptyFallback(book.expandedPremise)}`,
    `- Logline: ${emptyFallback(book.logline)}`,
    `- Konflikt centralny: ${emptyFallback(book.centralConflict)}`,
    `- Sila przeciwna: ${emptyFallback(book.antagonistForce)}`,
    `- Stawki: ${emptyFallback(book.stakes)}`,
    `- Setting: ${emptyFallback(book.settingSketch)}`,
    `- Kierunek zakonczenia: ${emptyFallback(book.endingDirection)}`,
    `- Gatunek: ${emptyFallback([book.genre, book.subgenre].filter(Boolean).join(", "))}`,
    `- Odbiorcy: ${emptyFallback(book.targetAudience)}`,
    `- Ton: ${emptyFallback(book.tone)}`,
    `- POV: ${emptyFallback(book.pointOfView)}`,
    `- Docelowa liczba slow: ${book.targetWordCount ?? "(brak)"}`,
    `- Tematy: ${emptyFallback(renderJsonList(book.themesJson))}`,
    `- Style guide: ${
      !contextControl || isContextKeyIncluded("styleGuide", contextControl)
        ? emptyFallback(book.styleGuide)
        : "(pominieto przez autora)"
    }`
  ].join("\n");
}

function renderPlanContext(
  plan: PlanPromptPackage["context"]["plan"],
  contextControl?: PromptContextControl
): string {
  const sections = [
    !contextControl || isContextKeyIncluded("storyStructure", contextControl)
      ? `Struktura: ${emptyFallback(plan.structureType)}; ${emptyFallback(plan.structureDescription)}`
      : "",
    !contextControl || isContextKeyIncluded("acts", contextControl)
      ? `Akty: ${JSON.stringify(plan.acts)}`
      : "",
    !contextControl || isContextKeyIncluded("beats", contextControl)
      ? `Beaty: ${JSON.stringify(plan.beats)}`
      : "",
    !contextControl || isContextKeyIncluded("plotThreads", contextControl)
      ? `Watki: ${JSON.stringify(plan.threads)}`
      : "",
    !contextControl || isContextKeyIncluded("chapters", contextControl)
      ? `Rozdzialy: ${JSON.stringify(plan.chapters)}`
      : "",
    !contextControl || isContextKeyIncluded("chapters", contextControl)
      ? `Relacje rozdzialow z watkami: ${JSON.stringify(plan.chapterThreads)}`
      : "",
    !contextControl || isContextKeyIncluded("beats", contextControl)
      ? `Relacje beatow z watkami: ${JSON.stringify(plan.beatThreads)}`
      : "",
    !contextControl || isContextKeyIncluded("chapters", contextControl)
      ? `Relacje rozdzialow z beatami: ${JSON.stringify(plan.chapterBeats)}`
      : ""
  ].filter(Boolean);

  return sections.length ? sections.join("\n") : "(brak wybranego kontekstu planu)";
}

function currentPlanFieldValue(
  plan: BookPlan,
  field: PlanFieldKey,
  targetEntity?: Act | Beat | PlotThread | Chapter
): string {
  if (field === "storyStructure") {
    return plan.structure?.structureType ?? "";
  }
  if (field === "storyStructureDescription") {
    return plan.structure?.description ?? "";
  }
  if (field === "storyStructureNotes") {
    return plan.structure?.notes ?? "";
  }
  if (targetEntity && "purpose" in targetEntity && field === "actPurpose") {
    return targetEntity.purpose ?? "";
  }
  if (targetEntity && "summary" in targetEntity && field === "actSummary") {
    return targetEntity.summary ?? "";
  }
  if (targetEntity && "summary" in targetEntity && field === "chapterSummary") {
    return targetEntity.summary ?? "";
  }
  if (targetEntity && "purpose" in targetEntity && field === "chapterPurpose") {
    return targetEntity.purpose ?? "";
  }
  if (targetEntity && "conflict" in targetEntity && field === "chapterConflict") {
    return targetEntity.conflict ?? "";
  }
  if (
    targetEntity &&
    "turningPoint" in targetEntity &&
    field === "chapterTurningPoint"
  ) {
    return targetEntity.turningPoint ?? "";
  }
  if (targetEntity && "workingTitle" in targetEntity && field === "chapterThreadSuggestions") {
    const assignedThreadIds = new Set(
      plan.chapterThreads
        .filter((relation) => relation.chapterId === targetEntity.id)
        .map((relation) => relation.threadId)
    );
    const assignedThreads = plan.threads
      .filter((thread) => assignedThreadIds.has(thread.id))
      .map((thread) => ({ id: thread.id, name: thread.name }));
    return assignedThreads.length ? JSON.stringify(assignedThreads) : "";
  }
  if (targetEntity && "workingTitle" in targetEntity && field === "chapterBeatSuggestions") {
    const assignedBeatIds = new Set(
      plan.chapterBeats
        .filter((relation) => relation.chapterId === targetEntity.id)
        .map((relation) => relation.beatId)
    );
    const assignedBeats = plan.beats
      .filter((beat) => assignedBeatIds.has(beat.id))
      .map((beat) => ({ id: beat.id, name: beat.name }));
    return assignedBeats.length ? JSON.stringify(assignedBeats) : "";
  }

  return "";
}

function planSuggestionSchema(field: PlanFieldKey): unknown {
  const base = {
    version: 1,
    kind: "book_plan_suggestion",
    field,
    summary: "string",
    warnings: ["string"]
  };

  if (field === "storyStructure") {
    return {
      ...base,
      structure: {
        structureType: "three_act | save_the_cat | heros_journey | mystery_outline | custom"
      }
    };
  }

  if (field === "storyStructureDescription" || field === "storyStructureNotes") {
    return {
      ...base,
      value: "string"
    };
  }

  if (field === "acts") {
    return {
      ...base,
      acts: [
        {
          name: "string",
          purpose: "string",
          summary: "string",
          startPercent: 0,
          endPercent: 25,
          color: "#3f8f6b"
        }
      ]
    };
  }

  if (field === "beatSheet") {
    return {
      ...base,
      beats: [
        {
          name: "string",
          description: "string",
          role: "string",
          actNameOrId: "string",
          threadNamesOrIds: ["string"]
        }
      ]
    };
  }

  if (field === "plotThreads") {
    return {
      ...base,
      threads: [
        {
          name: "string",
          description: "string",
          color: "#3f8f6b",
          status: "planned"
        }
      ]
    };
  }

  if (field === "chapterPlan") {
    return {
      ...base,
      chapters: [
        {
          number: 1,
          workingTitle: "string",
          summary: "string",
          purpose: "string",
          conflict: "string",
          turningPoint: "string",
          actNameOrId: "string",
          beatNamesOrIds: ["string"],
          threadNamesOrIds: ["string"],
          targetWordCount: 2500
        }
      ]
    };
  }

  if (field === "chapterThreadSuggestions") {
    return {
      ...base,
      threadNamesOrIds: ["existing thread id or exact thread name"]
    };
  }

  if (field === "chapterBeatSuggestions") {
    return {
      ...base,
      beatNamesOrIds: ["existing beat id or exact beat name"]
    };
  }

  if (field === "planGaps") {
    return {
      ...base,
      value: [
        {
          problem: "string",
          whyItMatters: "string",
          suggestedFix: "string"
        }
      ]
    };
  }

  return {
    ...base,
    value: "string"
  };
}

function renderAuthorPriority(contextControl?: PromptContextControl): string {
  const comment = contextControl?.authorPriorityComment.trim();
  return comment
    ? `# Author Priority\nKomentarz autora ma najwyzszy priorytet:\n${comment}`
    : "";
}

function isContextKeyIncluded(
  key: string,
  contextControl?: PromptContextControl
): boolean {
  if (!contextControl) {
    return true;
  }

  const requiredKeys = new Set(
    contextControl.contextSources
      .filter((source) => source.required)
      .map((source) => source.key)
  );

  return requiredKeys.has(key) || contextControl.includedContextKeys.includes(key);
}

function renderJsonList(value: string | undefined | null): string {
  if (!value) {
    return "";
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .join(", ");
    }
  } catch {
    return value;
  }

  return value;
}

function emptyFallback(value: string | undefined | null): string {
  return value?.trim() ? value : "(brak)";
}

function createPromptId(action: AIAction): string {
  if ("randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
