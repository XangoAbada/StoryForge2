import { z } from "zod";

export const titleSuggestionSchema = z.object({
  title: z.string().trim().min(1),
  subtitle: z.string().trim().optional().nullable(),
  rationale: z.string().trim().optional().default(""),
  tone: z.string().trim().optional().default(""),
  risk: z.string().trim().optional().default("")
});

export const titleSuggestionsResponseSchema = z.object({
  version: z.literal(1),
  kind: z.literal("title_suggestions"),
  summary: z.string().trim().optional().default(""),
  items: z.array(titleSuggestionSchema).min(1),
  warnings: z.array(z.string()).optional().default([])
});

export type TitleSuggestion = z.infer<typeof titleSuggestionSchema>;
export type TitleSuggestionsResponse = z.infer<
  typeof titleSuggestionsResponseSchema
>;

export function parseTitleSuggestions(rawOutput: string): TitleSuggestionsResponse {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) {
    throw new Error("Nie znaleziono obiektu JSON w odpowiedzi AI.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Niepoprawny JSON w odpowiedzi tytułów: ${String(error)}`);
  }

  return titleSuggestionsResponseSchema.parse(parsed);
}

export function extractJsonCandidate(rawOutput: string): string | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return null;
}
