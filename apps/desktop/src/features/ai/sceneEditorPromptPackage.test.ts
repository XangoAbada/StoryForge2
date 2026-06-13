import { describe, expect, it } from "vitest";
import {
  buildSceneEditorPromptPackage,
  renderSceneEditorPromptPackage
} from "./sceneEditorPromptPackage";

describe("sceneEditorPromptPackage", () => {
  it("renders the target word count as an orienting scene goal", () => {
    const promptPackage = buildSceneEditorPromptPackage({
      project: { id: "project-1", language: "pl" },
      book: { id: "book-1" },
      scene: { id: "scene-1" },
      sceneContext: {
        book: {
          id: "book-1",
          title: "",
          workingTitle: "Powieść",
          premise: "",
          styleGuide: "",
          pointOfView: "",
          tone: ""
        },
        chapter: null,
        scene: {
          id: "scene-1",
          bookId: "book-1",
          planVersionId: "plan-1",
          chapterId: null,
          orderIndex: 0,
          title: "Nowa scena",
          summary: "",
          goal: "",
          conflict: "",
          outcome: "",
          povCharacterId: null,
          locationId: null,
          targetWordCount: 1250,
          actualWordCount: null,
          manuscriptContent: "",
          status: "planned",
          createdAt: "",
          updatedAt: ""
        },
        povCharacter: null,
        characters: [],
        threads: [],
        location: null,
        worldElements: [],
        relevantRules: []
      },
      characters: { characters: [], relations: [], memories: [], memoryLinks: [], visualAssets: [] },
      world: {
        elements: [],
        rules: [],
        elementCharacters: [],
        elementThreads: [],
        elementChapters: [],
        elementScenes: [],
        elementRules: [],
        ruleThreads: [],
        ruleChapters: [],
        ruleScenes: [],
        visualAssets: []
      },
      field: "continueScene",
      selectedText: "",
      currentText: "Początek sceny.",
      customInstruction: "",
      insertMode: "append_to_scene",
      targetWordCount: 1250
    } as unknown as Parameters<typeof buildSceneEditorPromptPackage>[0]);

    expect(renderSceneEditorPromptPackage(promptPackage)).toContain("Docelowa długość sceny: 1250 słów");
    expect(promptPackage.context.targetWordCount).toBe(1250);
  });
});
