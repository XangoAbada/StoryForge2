import { z } from "zod";
import { listConceptFields, type ConceptFieldKey } from "./promptPackage";
import { extractJsonCandidate } from "./titleSuggestions";

const conceptFieldKeySchema = z.enum([
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
  "targetWordCount",
  "themesJson",
  "unwantedThemes",
  "alternativeTitlesJson",
  "styleGuide"
]);

export const conceptFieldSuggestionResponseSchema = z.object({
  version: z.literal(1),
  kind: z.literal("concept_field_suggestion"),
  field: conceptFieldKeySchema,
  summary: z.string().trim().optional().default(""),
  // Model bywa nieprzewidywalny: pole `value` powinno być stringiem, ale
  // czasem zwraca tablicę stringów albo obiekt. Zamiast wywracać całą
  // propozycję błędem Zod (i chować zwrócony tekst przed autorem), sprowadzamy
  // to do stringa. Dzięki temu tekst zawsze trafia do pola akceptacji.
  value: z
    .preprocess((raw) => {
      if (raw === null || raw === undefined || typeof raw === "string") {
        return raw;
      }
      if (Array.isArray(raw)) {
        return raw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .join(", ");
      }
      if (typeof raw === "object") {
        return "";
      }
      return String(raw);
    }, z.string().trim().optional().nullable()),
  // Model bywa nieprzewidywalny w polu `values`:
  // - potrafi zwrócić pojedynczy string zamiast tablicy → opakowujemy go,
  // - potrafi zwrócić literał pustej kolekcji ("[]"/"{}") jako sygnał "brak
  //   dodatkowych wartości" → traktujemy to jako pustą tablicę (inaczej trafiał
  //   do propozycji jako dosłowne `[]` i chował prawdziwe `value`),
  // - potrafi zwrócić tablicę zakodowaną jako string JSON → rozpakowujemy ją.
  values: z
    .preprocess((raw) => {
      if (typeof raw !== "string") {
        return raw;
      }
      const trimmed = raw.trim();
      if (trimmed === "" || trimmed === "[]" || trimmed === "{}") {
        return [];
      }
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          // Nie był poprawnym JSON-em — potraktuj jak zwykły string.
        }
      }
      return [trimmed];
    }, z.array(z.string().trim().min(1)))
    .optional()
    .default([]),
  rationale: z.string().trim().optional().default(""),
  warnings: z.array(z.string()).optional().default([])
});

export type ConceptFieldSuggestionResponse = z.infer<
  typeof conceptFieldSuggestionResponseSchema
>;

export type NormalizedConceptFieldSuggestion =
  ConceptFieldSuggestionResponse & {
    textValue: string;
  };

export function parseConceptFieldSuggestion(
  rawOutput: string,
  expectedField?: ConceptFieldKey
): NormalizedConceptFieldSuggestion {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) {
    throw new Error("Nie znaleziono obiektu JSON w odpowiedzi AI.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Niepoprawny JSON w odpowiedzi pola: ${String(error)}`);
  }

  const response = conceptFieldSuggestionResponseSchema.parse(parsed);
  if (expectedField && response.field !== expectedField) {
    throw new Error(
      `Odpowiedź dotyczy pola ${response.field}, oczekiwano ${expectedField}.`
    );
  }

  const values = normalizeValues(response, expectedField);
  const scalarValue = response.value?.trim() ?? "";
  const isListField = expectedField
    ? listConceptFields.includes(expectedField)
    : response.values.length > 0;
  // Pola listowe (np. gatunek, tagi) budujemy z `values`; pola skalarne
  // (premise, tytuł, opisy) traktują `value` jako źródło prawdy — inaczej
  // przypadkowe `values` przesłaniałoby prawdziwą treść.
  const textValue = isListField
    ? values.length > 0
      ? values.join(", ")
      : scalarValue
    : scalarValue || (values.length > 0 ? values.join(", ") : "");

  if (!textValue) {
    throw new Error("Odpowiedź AI nie zawiera propozycji wartości.");
  }

  return {
    ...response,
    values,
    textValue
  };
}

function normalizeValues(
  response: ConceptFieldSuggestionResponse,
  expectedField?: ConceptFieldKey
): string[] {
  const listField = expectedField
    ? listConceptFields.includes(expectedField)
    : response.values.length > 0;
  const sourceValues =
    response.values.length > 0
      ? response.values
      : listField && response.value
        ? response.value.split(/[,;\n]/)
        : [];

  return [
    ...new Set(
      sourceValues
        .flatMap((value) => (listField ? value.split(/[,;\n]/) : [value]))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}
