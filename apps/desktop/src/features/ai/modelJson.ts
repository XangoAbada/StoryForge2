import { extractJsonCandidate } from "./titleSuggestions";

function preview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "(pusta odpowiedź)";
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * Parsuje JSON z surowej odpowiedzi modelu: obsługuje bloki ```json``` i
 * tekst wokół obiektu, a przy błędzie zwraca czytelny polski komunikat
 * z początkiem odpowiedzi (zamiast kryptycznego "Unexpected token").
 */
export function parseModelJson(rawOutput: string, label: string): unknown {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) {
    throw new Error(
      `${label}: model nie zwrócił obiektu JSON. Początek odpowiedzi: ${preview(rawOutput)}`
    );
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `${label}: niepoprawny JSON (${String(error)}). Początek odpowiedzi: ${preview(candidate)}`
    );
  }
}
