import { describe, expect, it } from "vitest";
import { parseSceneStoryBibleAuditResult } from "./sceneStoryBibleAuditPromptPackage";

describe("parseSceneStoryBibleAuditResult", () => {
  it("normalizes scene discovery candidates", () => {
    const parsed = parseSceneStoryBibleAuditResult(JSON.stringify({
      version: 1,
      kind: "scene_story_bible_audit",
      summary: "Znaleziono nowe elementy.",
      candidates: [
        {
          kind: "character",
          title: "Strażniczka mostu",
          reason: "Scena sugeruje ważną osobę blokującą przejście.",
          evidence: "Bohater zatrzymuje się przed strażniczką.",
          suggestedType: "person"
        },
        {
          kind: "worldElement",
          title: "Most Solny",
          reason: "Miejsce ma własną funkcję fabularną.",
          evidence: "Przejście przez most wymaga zapłaty.",
          suggestedType: "location"
        }
      ],
      warnings: ["Sprawdź, czy most nie istnieje już w świecie."]
    }));

    expect(parsed.kind).toBe("scene_story_bible_audit");
    expect(parsed.textValue).toBe("Analiza zakończona");
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]).toMatchObject({
      kind: "character",
      title: "Strażniczka mostu",
      suggestedType: "person"
    });
    expect(parsed.warnings).toEqual(["Sprawdź, czy most nie istnieje już w świecie."]);
  });
});
