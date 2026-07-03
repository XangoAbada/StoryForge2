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
  value: z.string().trim().optional().nullable(),
  // Model czasem zwraca pojedynczy string zamiast tablicy — tolerujemy to,
  // opakowując go w jednoelementową listę zamiast wywracać całą propozycję.
  values: z
    .preprocess(
      (raw) => (typeof raw === "string" ? [raw] : raw),
      z.array(z.string().trim().min(1))
    )
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
    throw new Error("Nie znaleziono obiektu JSON w odpowiedzi Codex CLI.");
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
  const textValue =
    values.length > 0 ? values.join(", ") : response.value?.trim() ?? "";

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
