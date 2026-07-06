import type {
  AIAction,
  Book,
  BookPlan,
  BrainstormMessage,
  BrainstormSession,
  BrainstormSuggestion,
  BrainstormSuggestionKind,
  CharacterWorkspace,
  Project,
  WorldWorkspace
} from "../../shared/api/types";
import { parseModelJson } from "./modelJson";
import { renderCappedStoryBible } from "./promptContextLimits";
import type { ConceptFieldKey } from "./promptPackage";

export const BRAINSTORM_CHAT_FIELD = "__brainstorm_chat__";

// Tylko zwykłe pola tekstowe koncepcji — pola JSON (themesJson,
// alternativeTitlesJson) i liczbowe (targetWordCount) nie nadają się do
// prostego zastąp/dopisz.
export const BRAINSTORM_CONCEPT_FIELDS = [
  "title",
  "workingTitle",
  "premise",
  "protagonistSummary",
  "protagonistGoal",
  "expandedPremise",
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
  "unwantedThemes",
  "styleGuide"
] as const satisfies readonly ConceptFieldKey[];

export type BrainstormConceptField = (typeof BRAINSTORM_CONCEPT_FIELDS)[number];

export function isBrainstormConceptField(value: unknown): value is BrainstormConceptField {
  return (
    typeof value === "string" &&
    (BRAINSTORM_CONCEPT_FIELDS as readonly string[]).includes(value)
  );
}

export type NormalizedBrainstormChat = {
  kind: "brainstorm_chat";
  reply: string;
  suggestions: BrainstormSuggestion[];
  stateSummary: string;
};

/**
 * Czy projekt ma już materiał (koncepcję albo story bible), na którym AI ma
 * oprzeć rozmowę — zamiast proponować historie od zera.
 */
export function hasBrainstormMaterial({
  book,
  plan,
  characters,
  world
}: {
  book: Book;
  plan: BookPlan | null;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
}): boolean {
  return (
    BRAINSTORM_CONCEPT_FIELDS.some((field) => stringValue(book[field]).length > 0) ||
    characters.characters.length > 0 ||
    world.elements.length > 0 ||
    world.rules.length > 0 ||
    (plan?.threads.length ?? 0) > 0
  );
}

export type BrainstormChatPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: typeof BRAINSTORM_CHAT_FIELD;
    targetEntityId: string;
    sessionName: string;
    stateSummary: string;
    hasExistingMaterial: boolean;
    conceptFields: Record<BrainstormConceptField, string>;
    storyBible: {
      characters: CharacterWorkspace["characters"];
      relations: CharacterWorkspace["relations"];
      worldElements: WorldWorkspace["elements"];
      worldRules: WorldWorkspace["rules"];
      plotThreads: BookPlan["threads"];
    };
    conversation: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    existingNames: string[];
  };
  outputContract: {
    kind: "brainstorm_chat";
    format: "json";
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

const HISTORY_MESSAGE_LIMIT = 24;
const HISTORY_MESSAGE_MAX_CHARS = 1200;

export function buildBrainstormChatPromptPackage({
  project,
  book,
  plan,
  characters,
  world,
  session,
  messages,
  userMessage,
  existingSuggestionTitles
}: {
  project: Project;
  book: Book;
  plan: BookPlan | null;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  session: BrainstormSession;
  messages: BrainstormMessage[];
  userMessage: string;
  existingSuggestionTitles: string[];
}): BrainstormChatPromptPackage {
  const conceptFields = Object.fromEntries(
    BRAINSTORM_CONCEPT_FIELDS.map((field) => [field, stringValue(book[field])])
  ) as Record<BrainstormConceptField, string>;

  const existingNames = [
    ...characters.characters.map((item) => item.name),
    ...world.elements.map((item) => item.name),
    ...world.rules.map((item) => item.name),
    ...(plan?.threads ?? []).map((item) => item.name),
    ...existingSuggestionTitles
  ].filter((name) => name.trim().length > 0);

  const hasExistingMaterial = hasBrainstormMaterial({ book, plan, characters, world });

  return {
    id: createPromptId("brainstorm_chat"),
    projectId: project.id,
    bookId: book.id,
    action: "brainstorm_chat",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Prowadź proaktywną burzę mózgów nad pomysłem na tę powieść i zbieraj konkretne sugestie do story bible.",
    context: {
      targetField: BRAINSTORM_CHAT_FIELD,
      targetEntityId: session.id,
      sessionName: session.name,
      stateSummary: session.stateSummary,
      hasExistingMaterial,
      conceptFields,
      storyBible: {
        characters: characters.characters,
        relations: characters.relations,
        worldElements: world.elements,
        worldRules: world.rules,
        plotThreads: plan?.threads ?? []
      },
      conversation: messages.slice(-HISTORY_MESSAGE_LIMIT).map((message) => ({
        role: message.role,
        content:
          message.content.length > HISTORY_MESSAGE_MAX_CHARS
            ? `${message.content.slice(0, HISTORY_MESSAGE_MAX_CHARS)}…`
            : message.content
      })),
      userMessage,
      existingNames
    },
    outputContract: {
      kind: "brainstorm_chat",
      format: "json"
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderBrainstormChatPromptPackage(
  promptPackage: BrainstormChatPromptPackage
): string {
  const { context } = promptPackage;
  const conversationBlock = context.conversation.length
    ? context.conversation
        .map((message) => `${message.role === "user" ? "Autor" : "AI"}: ${message.content}`)
        .join("\n\n")
    : "(początek rozmowy)";

  const materialStance = context.hasExistingMaterial
    ? `# Stan projektu
Projekt ma już materiał (wypełnione pola koncepcji lub wpisy w story bible poniżej). To jest JEDNA obowiązująca historia, nad którą pracujecie. Zacznij od tego, co już istnieje: odwołuj się do konkretów z koncepcji i story bible, pogłębiaj je i rozwijaj. Nie proponuj nowych, niezwiązanych historii, chyba że autor wprost poprosi o start od zera.`
    : `# Stan projektu
Projekt jest pusty — autor zaczyna od zera. Pomóż znaleźć pomysł: proponuj zalążki i prowadź od pierwszej iskry do zarysu historii.`;

  const starterTechnique = context.hasExistingMaterial
    ? "- Kierunki rozwoju: gdy autor utknął, zaproponuj 3-4 wyraźnie różne kierunki pogłębienia ISTNIEJĄCEJ historii (np. nowy wymiar konfliktu, druga strona antagonisty, koszt stawki, luka w świecie) — zawsze zakotwiczone w materiale projektu."
    : "- Startery od zera: gdy autor nie ma pomysłu albo utknął, zaproponuj 3-4 wyraźnie różne zalążki do wyboru (np. gatunek + konflikt + obraz + postać) i poproś o wybór lub modyfikację.";

  return `# Rola
Jesteś kreatywnym facylitatorem burzy mózgów nad pomysłem na powieść, pracującym wewnątrz StoryForge2. Twoim zadaniem jest wyciągnąć z autora jak najwięcej: doszlifować istniejący pomysł albo pomóc znaleźć go od zera. Prowadzisz rozmowę aktywnie — nie czekasz na polecenia.

${materialStance}

# Techniki
- Pytania pogłębiające: każdą odpowiedź kończ 1-2 konkretnymi pytaniami, które drążą temat (konsekwencje, motywacje, dziury logiczne, scenariusze "co jeśli").
${starterTechnique}
- Techniki kreatywne: stosuj jawnie odwrócenie założeń, łączenie odległych elementów, eskalację stawek — nazwij technikę, gdy jej używasz.
- Podsumowanie stanu: mniej więcej co 5 tur (albo po ważnym przełomie) zwróć w polu stateSummary zwięzłe podsumowanie ustaleń i wskaż w odpowiedzi białe plamy historii (np. brak antagonisty, niejasne stawki, pusty świat, brak wątków).

# Twarde reguły
- Pisz po polsku, chyba że projekt ma inny język. Dla locale "pl" używaj poprawnych polskich znaków.
- Gdy projekt ma już materiał, każda odpowiedź i każda sugestia musi być spójna z istniejącą koncepcją i story bible — rozwijasz tę historię, nie wymyślasz innej.
- Formatuj pole reply w Markdown dla czytelności: krótkie akapity oddzielone pustą linią, **pogrubienia** dla kluczowych pojęć oraz listy numerowane lub punktowane zamiast długich wyliczeń w jednym akapicie. Unikaj ścian tekstu; obsługiwane elementy to akapity, pogrubienia i listy (bez nagłówków, tabel i bloków kodu).
- Wybieralne opcje w treści reply (kierunki pogłębienia, warianty do rozważenia, tematy do wyboru) owijaj w podwójne nawiasy kwadratowe: [[Twarz stwórców]]. Renderują się jako klikalny przycisk, który autor przypina do swojej odpowiedzi. Etykieta ma być krótka (2-6 słów) i samowystarczalna, bo trafia dosłownie do wiadomości autora. Owijaj wyłącznie realne opcje wyboru — nie przypadkowe słowa czy całe zdania. Nie zagnieżdżaj [[…]] i nie łącz z **…**; etykieta nie może zawierać znaków ] ani |.
- Rozróżniaj [[…]] od suggestions: [[…]] to szybki wybór sterujący następną turą rozmowy, a suggestions to konkretny wpis do zapisania w story bible. Ta sama rzecz nie powinna być jednocześnie chipem i sugestią.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas, zgodnym z kontraktem wyjścia.
- Sugestie mogą mieć wyłącznie rodzaje: conceptField, character, worldElement, worldRule, plotThread.
- Wątki fabularne (plotThread) to jedyna encja planu, którą wolno sugerować — nigdy nie sugeruj rozdziałów, scen, aktów ani beatów.
- Dla kind=conceptField pole conceptField musi być jednym z: ${BRAINSTORM_CONCEPT_FIELDS.join(", ")}.
- Sugestię dodawaj tylko, gdy w rozmowie padło konkretne ustalenie lub mocny pomysł — nie zaśmiecaj panelu luźnymi wariacjami.
- Nie duplikuj encji ani sugestii wymienionych w sekcji "Istniejące nazwy".
- Pole value sugestii to gotowa, zwięzła treść do wstawienia (nie meta-opis).

# Pola koncepcji (obecne wartości — puste pola to białe plamy)
${JSON.stringify(context.conceptFields)}

# Story bible
${renderCappedStoryBible(context.storyBible)}

# Podsumowanie dotychczasowej rozmowy
${context.stateSummary || "(brak — świeża sesja)"}

# Rozmowa (ostatnie wiadomości)
${conversationBlock}

# Nowa wiadomość autora
${context.userMessage}

# Istniejące nazwy (nie duplikuj)
${context.existingNames.length ? JSON.stringify(context.existingNames) : "(brak)"}

# Kontrakt wyjścia
Zwróć JSON:
{
  "version": 1,
  "kind": "brainstorm_chat",
  "reply": "konwersacyjna odpowiedź dla autora, zakończona 1-2 pytaniami pogłębiającymi; wybieralne opcje owijaj w [[etykieta]]",
  "suggestions": [
    {
      "kind": "conceptField | character | worldElement | worldRule | plotThread",
      "conceptField": "tylko dla kind=conceptField, np. premise",
      "title": "nazwa robocza sugestii",
      "value": "gotowa proponowana treść",
      "reason": "dlaczego warto (1-2 zdania)"
    }
  ],
  "stateSummary": "opcjonalne aktualne podsumowanie stanu pomysłu (pomiń albo pusty string, gdy bez zmian)"
}`;
}

export function parseBrainstormChatResult(rawOutput: string): NormalizedBrainstormChat {
  const parsed = parseModelJson(rawOutput, "Brainstorming");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  if (record.kind !== "brainstorm_chat") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ odpowiedzi brainstormingu (kind: ${JSON.stringify(record.kind ?? null)}, oczekiwano "brainstorm_chat").`
    );
  }

  const reply = stringValue(record.reply);
  if (!reply) {
    throw new Error("AI zwróciło pustą odpowiedź brainstormingu.");
  }

  const rawSuggestions = Array.isArray(record.suggestions) ? record.suggestions : [];
  const suggestions = rawSuggestions
    .map(normalizeSuggestion)
    .filter((suggestion): suggestion is BrainstormSuggestion => Boolean(suggestion));

  return {
    kind: "brainstorm_chat",
    reply,
    suggestions,
    stateSummary: stringValue(record.stateSummary)
  };
}

/**
 * Odrzuca sugestie, których tytuł pokrywa się z istniejącą encją lub
 * wcześniejszą sugestią sesji — pas bezpieczeństwa obok reguły w prompcie.
 */
export function dedupeBrainstormSuggestions(
  suggestions: BrainstormSuggestion[],
  existingTitles: Iterable<string>
): BrainstormSuggestion[] {
  const seen = new Set<string>();
  for (const title of existingTitles) {
    seen.add(title.trim().toLowerCase());
  }
  const result: BrainstormSuggestion[] = [];
  for (const suggestion of suggestions) {
    // Pola koncepcji dedupikujemy po polu, nie po tytule — dwie propozycje
    // na to samo pole w jednej turze i tak są redundantne.
    const key =
      suggestion.kind === "conceptField"
        ? `conceptField:${suggestion.conceptField}`
        : suggestion.title.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}

function normalizeSuggestion(value: unknown): BrainstormSuggestion | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const kind = normalizeKind(record.kind);
  const title = stringValue(record.title);
  const suggestionValue = stringValue(record.value);
  if (!kind || !title || !suggestionValue) {
    return null;
  }

  const conceptField = stringValue(record.conceptField);
  if (kind === "conceptField" && !isBrainstormConceptField(conceptField)) {
    return null;
  }

  return {
    id: createSuggestionId(),
    kind,
    conceptField: kind === "conceptField" ? conceptField : undefined,
    title,
    value: suggestionValue,
    reason: stringValue(record.reason, "Wynika z rozmowy."),
    status: "pending"
  };
}

function normalizeKind(value: unknown): BrainstormSuggestionKind | null {
  return value === "conceptField" ||
    value === "character" ||
    value === "worldElement" ||
    value === "worldRule" ||
    value === "plotThread"
    ? value
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function createSuggestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }
  return `${action}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
