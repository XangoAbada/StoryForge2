import { describe, expect, it } from "vitest";
import { parseConceptFieldSuggestion } from "./conceptFieldSuggestion";

describe("parseConceptFieldSuggestion", () => {
  it("parses a text value", () => {
    const parsed = parseConceptFieldSuggestion(
      JSON.stringify({
        version: 1,
        kind: "concept_field_suggestion",
        field: "premise",
        summary: "Premisa",
        value: "Archiwistka odkrywa klamstwo miasta.",
        warnings: []
      }),
      "premise"
    );

    expect(parsed.textValue).toBe("Archiwistka odkrywa klamstwo miasta.");
  });

  it("normalizes multiple values", () => {
    const parsed = parseConceptFieldSuggestion(
      JSON.stringify({
        version: 1,
        kind: "concept_field_suggestion",
        field: "tone",
        values: ["mroczny", "liryczny"],
        warnings: ["Sprawdź, czy ton nie będzie zbyt ciężki."]
      }),
      "tone"
    );

    expect(parsed.textValue).toBe("mroczny, liryczny");
    expect(parsed.warnings).toHaveLength(1);
  });

  it("splits fallback value for multi-choice fields", () => {
    const parsed = parseConceptFieldSuggestion(
      JSON.stringify({
        version: 1,
        kind: "concept_field_suggestion",
        field: "pointOfView",
        value: "trzecia osoba ograniczona, czas przeszły, bliska perspektywa",
        values: [],
        warnings: []
      }),
      "pointOfView"
    );

    expect(parsed.values).toEqual([
      "trzecia osoba ograniczona",
      "czas przeszły",
      "bliska perspektywa"
    ]);
    expect(parsed.textValue).toBe(
      "trzecia osoba ograniczona, czas przeszły, bliska perspektywa"
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseConceptFieldSuggestion("{ bad }", "genre")).toThrow(
      /Niepoprawny JSON/
    );
  });

  it("rejects a different field", () => {
    expect(() =>
      parseConceptFieldSuggestion(
        JSON.stringify({
          version: 1,
          kind: "concept_field_suggestion",
          field: "tone",
          value: "ciepły"
        }),
        "genre"
      )
    ).toThrow(/oczekiwano genre/);
  });
  it("coerces a single string in values into a one-element array", () => {
    const raw = JSON.stringify({
      version: 1,
      kind: "concept_field_suggestion",
      field: "workingTitle",
      values: "Samotny tytul"
    });
    const parsed = parseConceptFieldSuggestion(raw, "workingTitle");
    expect(parsed.values).toEqual(["Samotny tytul"]);
    expect(parsed.textValue).toBe("Samotny tytul");
  });

});
