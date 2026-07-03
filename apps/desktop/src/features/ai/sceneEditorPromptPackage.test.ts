import { describe, expect, it } from "vitest";
import {
  buildSceneEditorPromptPackage,
  renderSceneEditorPromptPackage
} from "./sceneEditorPromptPackage";

function buildPromptPackage() {
  return buildSceneEditorPromptPackage({
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
        manuscriptContent: "SEKRETNY_PELNY_MANUSKRYPT_SCENY",
        status: "planned",
        createdAt: "",
        updatedAt: ""
      },
      previousScene: {
        title: "Scena poprzednia",
        summary: "Bohater znalazł list.",
        outcome: "Postanowił wyjechać.",
        textTail: "Zamknął drzwi i ruszył w stronę dworca."
      },
      chapterSoFar: [
        { title: "Scena poprzednia", summary: "Bohater znalazł list.", outcome: "Postanowił wyjechać." }
      ],
      povCharacter: { id: "char-1", name: "Jan", voiceNotes: "", knowledgeNotes: "" },
      characters: [{ id: "char-1", name: "Jan", role: "protagonista", voiceNotes: "", knowledgeNotes: "" }],
      threads: [],
      location: null,
      worldElements: [],
      relevantRules: []
    },
    characters: {
      characters: [
        {
          id: "char-1",
          characterType: "person",
          name: "Jan",
          role: "protagonista",
          shortDescription: "",
          externalGoal: "",
          internalNeed: "",
          voiceNotes: "",
          arcSummary: "",
          status: "draft"
        },
        {
          id: "char-2",
          characterType: "person",
          name: "Tło Postać",
          role: "statysta",
          shortDescription: "",
          externalGoal: "",
          internalNeed: "",
          voiceNotes: "",
          arcSummary: "",
          status: "draft"
        }
      ],
      relations: [],
      memories: [],
      memoryLinks: [],
      visualAssets: []
    },
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
}

describe("sceneEditorPromptPackage", () => {
  it("renders the target word count as an orienting scene goal", () => {
    const promptPackage = buildPromptPackage();

    expect(renderSceneEditorPromptPackage(promptPackage)).toContain("Docelowa długość sceny: 1250 słów");
    expect(promptPackage.context.targetWordCount).toBe(1250);
  });

  it("instructs scene text generation to preserve paragraph and dialogue formatting", () => {
    const prompt = renderSceneEditorPromptPackage(buildPromptPackage());

    expect(prompt).toContain("akapity oddzielone pustą linią");
    expect(prompt).toContain("wypowiedź dialogową zaczynaj od nowego akapitu");
    expect(prompt).toContain("dialogi zapisuj jako osobne akapity");
  });

  it("does not duplicate the scene manuscript in the rendered prompt", () => {
    const prompt = renderSceneEditorPromptPackage(buildPromptPackage());

    expect(prompt).not.toContain("SEKRETNY_PELNY_MANUSKRYPT_SCENY");
  });

  it("renders the book context exactly once", () => {
    const prompt = renderSceneEditorPromptPackage(buildPromptPackage());

    expect(prompt.match(/"workingTitle":\s*"Powieść"/g)).toHaveLength(1);
  });

  it("includes previous scene continuity in the scene context", () => {
    const prompt = renderSceneEditorPromptPackage(buildPromptPackage());

    expect(prompt).toContain("Postanowił wyjechać.");
    expect(prompt).toContain("Zamknął drzwi i ruszył w stronę dworca.");
  });

  it("keeps only background characters in the story bible section", () => {
    const promptPackage = buildPromptPackage();

    const storyBibleIds = promptPackage.context.storyBible.characters.map((item) => item.id);
    expect(storyBibleIds).toEqual(["char-2"]);
  });
});
