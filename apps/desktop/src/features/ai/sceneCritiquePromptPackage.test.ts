import { describe, expect, it } from "vitest";
import { parseSceneCritiqueResult } from "./sceneCritiquePromptPackage";

describe("parseSceneCritiqueResult", () => {
  it("normalizes critique findings", () => {
    const parsed = parseSceneCritiqueResult(JSON.stringify({
      version: 1,
      kind: "scene_critique",
      summary: "Scena ma dobre dialogi, ale kuleje tempo.",
      findings: [
        {
          category: "pacing",
          severity: "high",
          title: "Rozwleczony środek sceny",
          description: "Trzy akapity opisu spowalniają konfrontację.",
          quote: "Wiatr niósł zapach soli i starych lin.",
          suggestion: "Skróć opis do jednego zdania i wróć do dialogu."
        },
        {
          category: "povLeak",
          severity: "medium",
          title: "Narrator zna myśli strażniczki",
          description: "POV należy do Marka, a narrator relacjonuje emocje strażniczki.",
          quote: "Strażniczka poczuła ukłucie zazdrości.",
          suggestion: "Pokaż emocję przez gest widoczny dla Marka."
        }
      ],
      warnings: ["Scena nie ma jeszcze zakończenia."]
    }));

    expect(parsed.kind).toBe("scene_critique");
    expect(parsed.textValue).toBe("Krytyka zakończona");
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]).toMatchObject({
      category: "pacing",
      severity: "high",
      quote: "Wiatr niósł zapach soli i starych lin."
    });
    expect(parsed.warnings).toEqual(["Scena nie ma jeszcze zakończenia."]);
  });

  it("falls back to defaults for unknown category and severity", () => {
    const parsed = parseSceneCritiqueResult(JSON.stringify({
      version: 1,
      kind: "scene_critique",
      summary: "OK",
      findings: [
        {
          category: "styl",
          severity: "krytyczne",
          title: "Uwaga",
          description: "Opis problemu",
          quote: "",
          suggestion: "Popraw"
        },
        { title: "", description: "" }
      ]
    }));

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].category).toBe("pacing");
    expect(parsed.findings[0].severity).toBe("medium");
  });

  it("rejects wrong kind", () => {
    expect(() =>
      parseSceneCritiqueResult(JSON.stringify({ kind: "scene_story_bible_audit" }))
    ).toThrow(/nieprawidłowy typ krytyki/);
  });
});
