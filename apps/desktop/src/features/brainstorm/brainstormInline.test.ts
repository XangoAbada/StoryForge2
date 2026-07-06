import { describe, expect, it } from "vitest";
import { chipKey, parseInlineSegments } from "./BrainstormPage";

describe("parseInlineSegments", () => {
  it("dzieli tekst na segmenty: tekst, chip, bold", () => {
    const segments = parseInlineSegments("Warto: [[Twarz stwórców]] oraz **cena mocy**.");
    expect(segments).toEqual([
      { type: "text", text: "Warto: " },
      { type: "chip", label: "Twarz stwórców" },
      { type: "text", text: " oraz " },
      { type: "bold", text: "cena mocy" },
      { type: "text", text: "." }
    ]);
  });

  it("przycina etykietę chipa, a pusty marker traktuje jako tekst", () => {
    expect(parseInlineSegments("[[  Reguła ceny  ]]")).toEqual([
      { type: "chip", label: "Reguła ceny" }
    ]);
    expect(parseInlineSegments("[[   ]]")).toEqual([{ type: "text", text: "[[   ]]" }]);
  });

  it("chipKey normalizuje do dedupu bez względu na wielkość liter i spacje", () => {
    expect(chipKey("  Twarz Stwórców ")).toBe(chipKey("twarz stwórców"));
  });
});
