import type { AIAction, Book, Project } from "../../shared/api/types";

export type ConceptFieldKey =
  | "title"
  | "workingTitle"
  | "premise"
  | "protagonistSummary"
  | "protagonistGoal"
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
  | "unwantedThemes"
  | "alternativeTitlesJson"
  | "styleGuide";

export type AIProviderId = "codex-cli-bridge";
export type PromptGenerationMode = "generate" | "expand";

export type PromptContextSource = {
  key: string;
  label: string;
  required: boolean;
};

export type PromptContextControl = {
  includedContextKeys: string[];
  authorPriorityComment: string;
  contextSources: PromptContextSource[];
};

export type BookConceptPromptContext = Pick<
  Book,
  | "title"
  | "workingTitle"
  | "premise"
  | "protagonistSummary"
  | "protagonistGoal"
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
  | "styleGuide"
  | "pointOfView"
  | "targetWordCount"
  | "themesJson"
  | "unwantedThemes"
  | "alternativeTitlesJson"
>;

export type PromptPackage = {
  id: string;
  projectId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: ConceptFieldKey;
    generationMode: PromptGenerationMode;
    targetFieldCurrentValue: string;
    maxResponseCharacters: number | null;
    book: BookConceptPromptContext;
    contextControl?: PromptContextControl;
  };
  outputContract: {
    kind: "concept_field_suggestion" | "premise_development";
    format: "json";
    schema: unknown;
  };
  generationOptions: {
    providerId: AIProviderId;
  };
};

export type NewProjectTitlePromptPackage = {
  id: string;
  action: Extract<AIAction, "generate_working_title">;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    seedTitle: string;
    maxResponseCharacters: number;
    contextControl?: PromptContextControl;
  };
  outputContract: {
    kind: "concept_field_suggestion";
    format: "json";
    schema: unknown;
  };
  generationOptions: {
    providerId: AIProviderId;
  };
};

export type ConceptFieldConfig = {
  key: ConceptFieldKey;
  label: string;
  action: AIAction;
  userInstruction: string;
  currentWork: string;
  acceptsValues: boolean;
};

export const listConceptFields: ConceptFieldKey[] = [
  "genre",
  "subgenre",
  "targetAudience",
  "tone",
  "pointOfView",
  "themesJson",
  "alternativeTitlesJson"
];

export const longConceptFields: ConceptFieldKey[] = [
  "premise",
  "protagonistSummary",
  "protagonistGoal",
  "expandedPremise",
  "centralConflict",
  "antagonistForce",
  "stakes",
  "settingSketch",
  "endingDirection",
  "unwantedThemes",
  "styleGuide"
];

export const conceptPromptContextFieldKeys: ConceptFieldKey[] = [
  "title",
  "workingTitle",
  "premise",
  "protagonistSummary",
  "protagonistGoal",
  "expandedPremise",
  "logline",
  "centralConflict",
  "antagonistForce",
  "stakes",
  "settingSketch",
  "endingDirection",
  "genre",
  "subgenre",
  "targetAudience",
  "tone",
  "pointOfView",
  "targetWordCount",
  "themesJson",
  "unwantedThemes",
  "alternativeTitlesJson",
  "styleGuide"
];

const titlePromptContextKeys: ConceptFieldKey[] = [
  "workingTitle",
  "premise",
  "genre",
  "subgenre",
  "tone",
  "styleGuide"
];

const storyCorePromptContextKeys: ConceptFieldKey[] = [
  "workingTitle",
  "premise",
  "protagonistSummary",
  "protagonistGoal",
  "centralConflict",
  "antagonistForce",
  "stakes",
  "settingSketch",
  "genre",
  "tone"
];

const readerFormPromptContextKeys: ConceptFieldKey[] = [
  "workingTitle",
  "premise",
  "genre",
  "subgenre",
  "targetAudience",
  "tone",
  "pointOfView",
  "styleGuide"
];

const conceptPromptContextDefaultKeys: Record<
  ConceptFieldKey,
  ConceptFieldKey[]
> = {
  title: [...titlePromptContextKeys, "alternativeTitlesJson"],
  workingTitle: titlePromptContextKeys,
  premise: storyCorePromptContextKeys,
  protagonistSummary: [
    "workingTitle",
    "premise",
    "protagonistGoal",
    "centralConflict",
    "settingSketch",
    "genre",
    "tone"
  ],
  protagonistGoal: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "centralConflict",
    "stakes",
    "genre",
    "tone"
  ],
  expandedPremise: [
    ...storyCorePromptContextKeys,
    "logline",
    "endingDirection",
    "targetAudience"
  ],
  logline: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "protagonistGoal",
    "centralConflict",
    "antagonistForce",
    "stakes",
    "genre",
    "tone"
  ],
  centralConflict: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "protagonistGoal",
    "antagonistForce",
    "stakes",
    "genre",
    "tone"
  ],
  antagonistForce: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "protagonistGoal",
    "centralConflict",
    "stakes",
    "settingSketch",
    "genre",
    "tone"
  ],
  stakes: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "protagonistGoal",
    "centralConflict",
    "antagonistForce",
    "endingDirection",
    "genre",
    "tone"
  ],
  settingSketch: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "centralConflict",
    "antagonistForce",
    "genre",
    "tone",
    "styleGuide"
  ],
  endingDirection: [
    "workingTitle",
    "premise",
    "expandedPremise",
    "protagonistSummary",
    "protagonistGoal",
    "centralConflict",
    "antagonistForce",
    "stakes",
    "genre",
    "tone"
  ],
  genre: readerFormPromptContextKeys,
  subgenre: readerFormPromptContextKeys,
  targetAudience: readerFormPromptContextKeys,
  tone: readerFormPromptContextKeys,
  pointOfView: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "genre",
    "subgenre",
    "targetAudience",
    "tone",
    "styleGuide"
  ],
  targetWordCount: [
    "workingTitle",
    "premise",
    "genre",
    "subgenre",
    "targetAudience",
    "tone"
  ],
  themesJson: [
    "workingTitle",
    "premise",
    "protagonistSummary",
    "centralConflict",
    "antagonistForce",
    "stakes",
    "genre",
    "tone",
    "unwantedThemes"
  ],
  unwantedThemes: [
    "workingTitle",
    "premise",
    "genre",
    "targetAudience",
    "tone",
    "themesJson",
    "styleGuide"
  ],
  alternativeTitlesJson: [
    "workingTitle",
    "title",
    "premise",
    "genre",
    "subgenre",
    "targetAudience",
    "tone",
    "styleGuide"
  ],
  styleGuide: [
    "workingTitle",
    "premise",
    "genre",
    "subgenre",
    "targetAudience",
    "tone",
    "pointOfView",
    "themesJson",
    "unwantedThemes"
  ]
};

export const conceptFieldMaxResponseCharacters: Record<ConceptFieldKey, number> = {
  title: 90,
  workingTitle: 90,
  premise: 1200,
  protagonistSummary: 900,
  protagonistGoal: 500,
  expandedPremise: 2200,
  logline: 700,
  centralConflict: 800,
  antagonistForce: 900,
  stakes: 800,
  settingSketch: 900,
  endingDirection: 800,
  genre: 260,
  subgenre: 320,
  targetAudience: 420,
  tone: 320,
  pointOfView: 520,
  targetWordCount: 20,
  themesJson: 420,
  unwantedThemes: 900,
  alternativeTitlesJson: 600,
  styleGuide: 1800
};

export const conceptFieldConfigs: Record<ConceptFieldKey, ConceptFieldConfig> = {
  title: {
    key: "title",
    label: "Tytuł finalny",
    action: "generate_title",
    userInstruction: "Wygeneruj jeden dopracowany tytuł finalny dla tej książki.",
    currentWork:
      "Autor chce tytuł, który może zastąpić roboczą nazwę i pasuje do obietnicy czytelniczej.",
    acceptsValues: false
  },
  workingTitle: {
    key: "workingTitle",
    label: "Tytuł roboczy",
    action: "generate_working_title",
    userInstruction:
      "Wygeneruj jedną mocną propozycję tytułu roboczego dla tej książki.",
    currentWork:
      "Autor chce tytuł roboczy, który od razu niesie gatunek, ton i obietnicę historii.",
    acceptsValues: false
  },
  premise: {
    key: "premise",
    label: "Premise",
    action: "generate_premise",
    userInstruction:
      "Wygeneruj krótką premise tej książki: kto, czego chce, co mu przeszkadza i dlaczego to ważne.",
    currentWork:
      "Autor chce uzupełnić wyłącznie pole Premise, korzystając z pozostałych pól jako kontekstu.",
    acceptsValues: false
  },
  protagonistSummary: {
    key: "protagonistSummary",
    label: "Bohater / bohaterka",
    action: "generate_protagonist_summary",
    userInstruction:
      "Wygeneruj zwięzły opis głównego bohatera lub bohaterki tej książki.",
    currentWork:
      "Autor chce wiedzieć, kto prowadzi historię, z jakiego miejsca startuje i dlaczego właśnie ta postać niesie książkę.",
    acceptsValues: false
  },
  protagonistGoal: {
    key: "protagonistGoal",
    label: "Cel bohatera",
    action: "generate_protagonist_goal",
    userInstruction:
      "Wygeneruj konkretny zewnętrzny cel bohatera, który będzie napędzał fabułę.",
    currentWork:
      "Autor chce jasne dążenie, które można później przekładać na konflikty, sceny i decyzje bohatera.",
    acceptsValues: false
  },
  expandedPremise: {
    key: "expandedPremise",
    label: "Rozszerzona premisa",
    action: "generate_expanded_premise",
    userInstruction:
      "Wygeneruj rozszerzoną premise tej książki w jednym zwartym akapicie.",
    currentWork:
      "Autor chce szerszy opis rdzenia historii bez przechodzenia jeszcze do planu rozdziałów.",
    acceptsValues: false
  },
  logline: {
    key: "logline",
    label: "Logline",
    action: "generate_logline",
    userInstruction:
      "Wygeneruj zwięzły logline tej książki: bohater, cel, przeszkoda i stawka.",
    currentWork:
      "Autor chce jednozdaniowy logline, który klarownie komunikuje obietnicę historii.",
    acceptsValues: false
  },
  centralConflict: {
    key: "centralConflict",
    label: "Konflikt centralny",
    action: "generate_central_conflict",
    userInstruction: "Wygeneruj klarowny konflikt centralny tej książki.",
    currentWork:
      "Autor chce rdzeń napięcia fabularnego, który będzie napędzał decyzje bohatera.",
    acceptsValues: false
  },
  antagonistForce: {
    key: "antagonistForce",
    label: "Siła przeciwna",
    action: "generate_antagonist_force",
    userInstruction:
      "Wygeneruj siłę przeciwną dla tej książki: antagonistę, system, tajemnicę, problem albo blokadę.",
    currentWork:
      "Autor chce określić, co realnie stoi na drodze bohatera i jak wywiera presję na konflikt centralny.",
    acceptsValues: false
  },
  stakes: {
    key: "stakes",
    label: "Stawki",
    action: "generate_stakes",
    userInstruction: "Wygeneruj stawki osobiste i fabularne tej książki.",
    currentWork:
      "Autor chce wiedzieć, co bohater i świat tracą, jeśli historia pójdzie źle.",
    acceptsValues: false
  },
  settingSketch: {
    key: "settingSketch",
    label: "Setting",
    action: "generate_setting_sketch",
    userInstruction:
      "Wygeneruj szkic settingu: miejsce, czas i warunki świata wpływające na konflikt.",
    currentWork:
      "Autor chce użyteczny opis świata, który wspiera fabułę zamiast tworzyć osobną encyklopedię.",
    acceptsValues: false
  },
  endingDirection: {
    key: "endingDirection",
    label: "Kierunek zakończenia",
    action: "generate_ending_direction",
    userInstruction:
      "Wygeneruj roboczy kierunek zakończenia tej książki, fabularny lub emocjonalny.",
    currentWork:
      "Autor chce wiedzieć, dokąd historia zmierza, bez konieczności zamykania wszystkich szczegółów finału.",
    acceptsValues: false
  },
  genre: {
    key: "genre",
    label: "Gatunek",
    action: "suggest_genre",
    userInstruction:
      "Zaproponuj najtrafniejszy zestaw gatunków lub podgatunków dla tej książki.",
    currentWork:
      "Autor chce kilka etykiet gatunkowych, które pomogą późniejszym promptom trzymać konwencję.",
    acceptsValues: true
  },
  subgenre: {
    key: "subgenre",
    label: "Podgatunek",
    action: "suggest_subgenre",
    userInstruction:
      "Zaproponuj podgatunek lub mieszankę podgatunków dla tej książki.",
    currentWork:
      "Autor chce doprecyzować konwencję bez ograniczania głównego gatunku.",
    acceptsValues: true
  },
  targetAudience: {
    key: "targetAudience",
    label: "Odbiorcy",
    action: "suggest_target_audience",
    userInstruction:
      "Zaproponuj docelowych odbiorców tej książki jako krótkie etykiety.",
    currentWork:
      "Autor chce etykiety czytelników, które pomogą dopasować język, poziom mroku i tempo.",
    acceptsValues: true
  },
  tone: {
    key: "tone",
    label: "Ton",
    action: "suggest_tone",
    userInstruction:
      "Zaproponuj zestaw tonów narracyjnych pasujących do tej książki.",
    currentWork:
      "Autor chce etykiety tonu, które będą sterować nastrojem i stylem późniejszych generacji.",
    acceptsValues: true
  },
  pointOfView: {
    key: "pointOfView",
    label: "Punkt widzenia",
    action: "suggest_point_of_view",
    userInstruction:
      "Zaproponuj najlepszy punkt widzenia i tryb narracji dla tej książki.",
    currentWork:
      "Autor chce decyzję narracyjną, która będzie zasilać późniejsze prompty scen.",
    acceptsValues: true
  },
  targetWordCount: {
    key: "targetWordCount",
    label: "Docelowa liczba słów",
    action: "suggest_target_word_count",
    userInstruction:
      "Zaproponuj docelową liczbę słów dla tej książki jako jedną liczbę.",
    currentWork:
      "Autor chce realistyczną długość dopasowaną do gatunku i odbiorców.",
    acceptsValues: false
  },
  themesJson: {
    key: "themesJson",
    label: "Tematy",
    action: "suggest_themes",
    userInstruction: "Zaproponuj główne tematy tej książki jako krótkie etykiety.",
    currentWork:
      "Autor chce tematy, które będą wracać w planie, postaciach i scenach.",
    acceptsValues: true
  },
  unwantedThemes: {
    key: "unwantedThemes",
    label: "Granice i tematy niechciane",
    action: "suggest_unwanted_themes",
    userInstruction:
      "Zaproponuj granice treści i tematy, których ta książka powinna unikać.",
    currentWork: "Autor chce jasne ograniczenia dla późniejszych promptów AI.",
    acceptsValues: false
  },
  alternativeTitlesJson: {
    key: "alternativeTitlesJson",
    label: "Alternatywne tytuły",
    action: "generate_alternative_titles",
    userInstruction: "Wygeneruj listę alternatywnych tytułów dla tej książki.",
    currentWork:
      "Autor chce warianty tytułu, które może porównać z tytułem roboczym i finalnym.",
    acceptsValues: true
  },
  styleGuide: {
    key: "styleGuide",
    label: "Style guide",
    action: "generate_style_guide",
    userInstruction:
      "Wygeneruj praktyczny style guide dla tej książki: język, rytm, tempo, zakazy i preferencje.",
    currentWork:
      "Autor chce użyteczne notatki stylu do wielokrotnego użycia w promptach scen i redakcji.",
    acceptsValues: false
  }
};

export function buildConceptFieldPromptPackage(
  project: Project,
  book: Book,
  field: ConceptFieldKey,
  contextControl?: PromptContextControl
): PromptPackage {
  const config = conceptFieldConfigs[field];
  const isPremiseDevelopment = config.action === "expand_premise";
  const bookContext = bookConceptContext(book);
  const targetFieldCurrentValue = currentFieldValue(bookContext, field);
  const generationMode: PromptGenerationMode = targetFieldCurrentValue.trim()
    ? "expand"
    : "generate";

  return {
    id: createPromptId(config.action),
    projectId: project.id,
    action: config.action,
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: config.userInstruction,
    context: {
      targetField: field,
      generationMode,
      targetFieldCurrentValue,
      maxResponseCharacters: conceptFieldMaxResponseCharacters[field] ?? null,
      book: bookContext,
      ...(contextControl ? { contextControl } : {})
    },
    outputContract: {
      kind: isPremiseDevelopment
        ? "premise_development"
        : "concept_field_suggestion",
      format: "json",
      schema: isPremiseDevelopment
        ? premiseDevelopmentSchema()
        : conceptFieldSuggestionSchema(field, config.acceptsValues)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderPromptPackage(promptPackage: PromptPackage): string {
  const {
    book,
    targetField,
    generationMode,
    targetFieldCurrentValue,
    maxResponseCharacters,
    contextControl
  } = promptPackage.context;
  const config = conceptFieldConfigs[targetField];
  const listRules = config.acceptsValues
    ? `
# Multi-Choice Field Rules
- To pole przyjmuje wiele krótkich etykiet.
- Zwróć konkretne elementy w values jako osobne stringi.
- Każdy element values ma być krótką etykietą bez przecinków i bez pełnego zdania.
- Pole value może zawierać te same elementy połączone przecinkami.
- Nie zwracaj szerokiego opisu narracyjnego jako jednego elementu listy.`
    : "";
  const modeInstruction =
    generationMode === "expand"
      ? `Tryb pracy: expand.
Obecna zawartość pola "${config.label}" jest materiałem wyjściowym:
${emptyFallback(targetFieldCurrentValue)}

Uwzględnij tę treść i rozwiń ją w lepszą, pełniejszą propozycję. Możesz przebudować, doprecyzować i przepisać istniejącą treść, jeśli dzięki temu wynik będzie spójniejszy. Zwróć kompletną docelową wartość pola, nie sam dopisek.`
      : `Tryb pracy: generate.
Pole "${config.label}" jest puste albo wymaga nowej propozycji. Wygeneruj kompletną docelową wartość pola.`;
  const responseLengthRules = renderResponseLengthRules(
    config,
    maxResponseCharacters
  );
  const authorPriority = renderAuthorPriority(contextControl);
  const bookContext = renderBookContext(book, contextControl);

  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj ani nie zmieniaj kanonu; zwróć tylko propozycję.
- Uwzględnij wszystkie pola z Book Context, nawet jeśli docelowe pole jest puste.
- Nie dodawaj komentarzy poza wymaganym JSON.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

${listRules}

${responseLengthRules}

${authorPriority}

# Book Context
${bookContext}

# Current Work
Docelowe pole: ${targetField} (${config.label}).
${config.currentWork}

# Generation Mode
${modeInstruction}

# Output Contract
Zwróć JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function buildNewProjectTitlePromptPackage(
  seedTitle: string,
  locale: "pl" | "en" = "pl",
  contextControl?: PromptContextControl
): NewProjectTitlePromptPackage {
  const field: ConceptFieldKey = "workingTitle";

  return {
    id: createPromptId("generate_working_title"),
    action: "generate_working_title",
    locale,
    userInstruction:
      "Wygeneruj jedną mocną propozycję tytułu roboczego dla nowego projektu książki.",
    context: {
      seedTitle,
      maxResponseCharacters: conceptFieldMaxResponseCharacters[field],
      ...(contextControl ? { contextControl } : {})
    },
    outputContract: {
      kind: "concept_field_suggestion",
      format: "json",
      schema: conceptFieldSuggestionSchema(field, false)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderNewProjectTitlePromptPackage(
  promptPackage: NewProjectTitlePromptPackage
): string {
  const authorPriority = renderAuthorPriority(
    promptPackage.context.contextControl
  );

  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Zwróć jedną propozycję, która może od razu stać się nazwą nowego projektu.
- Jeśli autor wpisał szkic tytułu, potraktuj go jako inspirację, a nie polecenie przepisania.
- Nie dodawaj komentarzy poza wymaganym JSON.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

${authorPriority}

# New Project Seed
- Wpis autora: ${emptyFallback(promptPackage.context.seedTitle)}

# Current Work
Docelowe pole: workingTitle (Tytuł roboczy).
Autor jest na dashboardzie i chce szybko nazwać nowy projekt książki przed jego utworzeniem.

# Response Length
- Maksymalna długość tytułu roboczego w polu value: ${promptPackage.context.maxResponseCharacters} znaków.
- summary, rationale i warnings mają być krótkie.

# Output Contract
Zwróć JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function conceptPromptContextSources(
  targetField: ConceptFieldKey
): PromptContextSource[] {
  return uniqueConceptFieldKeys([
    targetField,
    ...(conceptPromptContextDefaultKeys[targetField] ?? [])
  ]).map((field) => conceptPromptContextSource(field, field === targetField));
}

export function allConceptPromptContextSources(
  targetField?: ConceptFieldKey
): PromptContextSource[] {
  return conceptPromptContextFieldKeys.map((field) =>
    conceptPromptContextSource(field, field === targetField)
  );
}

export function conceptPromptContextSource(
  field: ConceptFieldKey,
  required = false
): PromptContextSource {
  return {
    key: field,
    label: conceptFieldConfigs[field].label,
    required
  };
}

const bookContextRows: Array<{
  key: ConceptFieldKey;
  label: string;
  value: (book: BookConceptPromptContext) => string;
}> = [
  { key: "title", label: "Tytuł finalny", value: (book) => book.title },
  {
    key: "workingTitle",
    label: "Roboczy tytuł",
    value: (book) => book.workingTitle
  },
  { key: "premise", label: "Premise", value: (book) => book.premise },
  {
    key: "protagonistSummary",
    label: "Bohater / bohaterka",
    value: (book) => book.protagonistSummary
  },
  {
    key: "protagonistGoal",
    label: "Cel bohatera",
    value: (book) => book.protagonistGoal
  },
  {
    key: "expandedPremise",
    label: "Rozszerzona premisa",
    value: (book) => book.expandedPremise
  },
  { key: "logline", label: "Logline", value: (book) => book.logline },
  {
    key: "centralConflict",
    label: "Konflikt centralny",
    value: (book) => book.centralConflict
  },
  {
    key: "antagonistForce",
    label: "Siła przeciwna",
    value: (book) => book.antagonistForce
  },
  { key: "stakes", label: "Stawki", value: (book) => book.stakes },
  { key: "settingSketch", label: "Setting", value: (book) => book.settingSketch },
  {
    key: "endingDirection",
    label: "Kierunek zakończenia",
    value: (book) => book.endingDirection
  },
  { key: "genre", label: "Gatunek", value: (book) => book.genre },
  { key: "subgenre", label: "Podgatunek", value: (book) => book.subgenre },
  { key: "tone", label: "Ton", value: (book) => book.tone },
  {
    key: "targetAudience",
    label: "Odbiorcy",
    value: (book) => book.targetAudience
  },
  {
    key: "pointOfView",
    label: "Punkt widzenia",
    value: (book) => book.pointOfView
  },
  {
    key: "targetWordCount",
    label: "Docelowa liczba słów",
    value: (book) => (book.targetWordCount === null ? "" : String(book.targetWordCount))
  },
  {
    key: "themesJson",
    label: "Tematy",
    value: (book) => renderJsonList(book.themesJson)
  },
  {
    key: "unwantedThemes",
    label: "Granice i tematy niechciane",
    value: (book) => book.unwantedThemes
  },
  {
    key: "alternativeTitlesJson",
    label: "Alternatywne tytuły",
    value: (book) => renderJsonList(book.alternativeTitlesJson)
  },
  { key: "styleGuide", label: "Style guide", value: (book) => book.styleGuide }
];

function renderBookContext(
  book: BookConceptPromptContext,
  contextControl?: PromptContextControl
): string {
  const rows = bookContextRows.filter((row) =>
    isContextKeyIncluded(row.key, contextControl)
  );

  if (rows.length === 0) {
    return "(brak wybranych pól kontekstu)";
  }

  return rows
    .map((row) => `- ${row.label}: ${emptyFallback(row.value(book))}`)
    .join("\n");
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

function uniqueConceptFieldKeys(fields: ConceptFieldKey[]): ConceptFieldKey[] {
  return fields.filter((field, index) => fields.indexOf(field) === index);
}

function renderAuthorPriority(
  contextControl?: PromptContextControl
): string {
  const comment = contextControl?.authorPriorityComment.trim();
  if (!comment) {
    return "";
  }

  return `# Author Priority
Komentarz autora ma najwyższy priorytet merytoryczny po Hard Rules i Output Contract:
${comment}`;
}

function bookConceptContext(book: Book): BookConceptPromptContext {
  return {
    title: book.title ?? "",
    workingTitle: book.workingTitle ?? "",
    premise: book.premise ?? "",
    protagonistSummary: book.protagonistSummary ?? "",
    protagonistGoal: book.protagonistGoal ?? "",
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
    styleGuide: book.styleGuide ?? "",
    pointOfView: book.pointOfView ?? "",
    targetWordCount: book.targetWordCount ?? null,
    themesJson: book.themesJson ?? "[]",
    unwantedThemes: book.unwantedThemes ?? "",
    alternativeTitlesJson: book.alternativeTitlesJson ?? "[]"
  };
}

function conceptFieldSuggestionSchema(
  field: ConceptFieldKey,
  acceptsValues: boolean
): unknown {
  return {
    version: 1,
    kind: "concept_field_suggestion",
    field,
    summary: "string",
    value: acceptsValues
      ? "comma-separated short labels matching values, or null"
      : "string",
    values: acceptsValues
      ? ["short concrete label without commas or full sentences"]
      : "[]",
    rationale: "string",
    warnings: ["string"]
  };
}

function renderResponseLengthRules(
  config: ConceptFieldConfig,
  maxResponseCharacters: number | null
): string {
  if (!maxResponseCharacters) {
    return "";
  }

  const targetRule = config.acceptsValues
    ? `- Maksymalna długość pola value po połączeniu elementów values: ${maxResponseCharacters} znaków.`
    : `- Maksymalna długość docelowej wartości pola value: ${maxResponseCharacters} znaków.`;

  return `# Response Length
${targetRule}
- Zmieść najważniejszy sens w limicie; jeśli materiału jest za dużo, kondensuj zamiast przekraczać limit.
- summary, rationale i warnings mają być krótkie i pomocnicze.`;
}

function currentFieldValue(
  book: BookConceptPromptContext,
  field: ConceptFieldKey
): string {
  const value = book[field];
  if (field === "targetWordCount") {
    return typeof value === "number" ? value.toString() : "";
  }

  if (field === "themesJson" || field === "alternativeTitlesJson") {
    return renderJsonList(typeof value === "string" ? value : "");
  }

  return typeof value === "string" ? value : "";
}

function premiseDevelopmentSchema(): unknown {
  return {
    version: 1,
    kind: "premise_development",
    summary: "concise premise sentence",
    protagonistSummary: "string",
    protagonistGoal: "string",
    logline: "string",
    expandedPremise: "string",
    centralConflict: "string",
    antagonistForce: "string",
    stakes: "string",
    settingSketch: "string",
    endingDirection: "string",
    themes: ["string"],
    risks: ["string"],
    questionsForAuthor: ["string"]
  };
}

function createPromptId(action: AIAction): string {
  if ("randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function emptyFallback(value: string | undefined | null): string {
  return value?.trim().length ? value : "(brak)";
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
