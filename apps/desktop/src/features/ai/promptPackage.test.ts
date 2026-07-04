import { describe, expect, it } from "vitest";
import {
  buildConceptFieldPromptPackage,
  buildNewProjectTitlePromptPackage,
  conceptPromptContextSources,
  renderNewProjectTitlePromptPackage,
  renderPromptPackage
} from "./promptPackage";
import {
  buildBookCoverPromptPackage,
  renderBookCoverPromptPackage
} from "./coverPromptPackage";
import type { Book, Project } from "../../shared/api/types";

const project: Project = {
  id: "project-1",
  name: "Cienie Drukarni",
  language: "pl",
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z",
  activeBookId: "book-1",
  settingsJson: "{}"
};

const book: Book = {
  id: "book-1",
  projectId: "project-1",
  title: "",
  workingTitle: "Cienie Drukarni",
  premise: "Zecerka odkrywa, że drukowane sny zmieniają wspomnienia miasta.",
  protagonistSummary: "Zecerka, która pilnuje miejskiego archiwum snów.",
  protagonistGoal: "Zatrzymać druk fałszywych wspomnień przed świętem miasta.",
  expandedPremise: "Drukarnia przechowuje sny miasta.",
  centralConflict: "Prawda kontra wygodna pamięć miasta.",
  antagonistForce: "Cech drukarzy zarabiający na kontrolowaniu pamięci.",
  stakes: "Miasto może utracić wspólną tożsamość.",
  settingSketch: "Deszczowe miasto drukarni, kanałów i nocnych gazet.",
  endingDirection: "Bohaterka ujawnia prawdę, ale traci własne najważniejsze wspomnienie.",
  genre: "fantasy",
  subgenre: "urban fantasy",
  targetAudience: "adult",
  tone: "mroczny, liryczny",
  styleGuide: "Krótkie zdania w scenach napięcia.",
  pointOfView: "trzecia osoba ograniczona",
  targetWordCount: 85000,
  themesJson: JSON.stringify(["pamięć", "tożsamość"]),
  unwantedThemes: "Bez gore.",
  alternativeTitlesJson: JSON.stringify(["Ostatni atrament"]),
  coverImagePath: "",
  coverPrompt: "",
  coverNegativePrompt: "",
  coverGeneratedAt: null,
  storySoFar: "",
  storySoFarStale: 0,
  status: "draft",
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

describe("renderPromptPackage", () => {
  it("renders premise as a single-field suggestion with full concept context", () => {
    const promptPackage = buildConceptFieldPromptPackage(
      project,
      book,
      "premise"
    );
    const prompt = renderPromptPackage(promptPackage);

    expect(promptPackage.action).toBe("generate_premise");
    expect(prompt).toContain("# Role");
    expect(prompt).toContain("# Output Contract");
    expect(prompt).toContain("concept_field_suggestion");
    expect(prompt).toContain('"field": "premise"');
    expect(prompt).toContain("Docelowe pole: premise");
    expect(prompt).toContain(book.premise);
    expect(prompt).toContain(book.protagonistSummary);
    expect(prompt).toContain(book.protagonistGoal);
    expect(prompt).toContain(book.expandedPremise);
    expect(prompt).toContain(book.centralConflict);
    expect(prompt).toContain(book.antagonistForce);
    expect(prompt).toContain(book.settingSketch);
    expect(prompt).toContain(book.endingDirection);
    expect(prompt).toContain(book.genre);
    expect(prompt).toContain(book.subgenre);
    expect(prompt).toContain(book.targetAudience);
    expect(prompt).toContain(book.styleGuide);
    expect(prompt).toContain("pamięć, tożsamość");
    expect(prompt).toContain("# Response Length");
    expect(prompt).toContain("1200 znaków");
    expect(prompt).toContain("Maksymalna długość docelowej wartości pola value");
  });

  it("marks non-empty fields as expand mode and allows rewriting the existing value", () => {
    const promptPackage = buildConceptFieldPromptPackage(project, book, "premise");
    const prompt = renderPromptPackage(promptPackage);

    expect(promptPackage.context.generationMode).toBe("expand");
    expect(promptPackage.context.targetFieldCurrentValue).toBe(book.premise);
    expect(prompt).toContain("Tryb pracy: expand");
    expect(prompt).toContain("Możesz przebudować");
    expect(prompt).toContain("Zwróć kompletną docelową wartość pola");
  });

  it("marks empty fields as generate mode", () => {
    const promptPackage = buildConceptFieldPromptPackage(project, book, "title");
    const prompt = renderPromptPackage(promptPackage);

    expect(promptPackage.context.generationMode).toBe("generate");
    expect(promptPackage.context.targetFieldCurrentValue).toBe("");
    expect(prompt).toContain("Tryb pracy: generate");
  });

  it("adds strict label rules for multi-choice fields", () => {
    const promptPackage = buildConceptFieldPromptPackage(project, book, "pointOfView");
    const prompt = renderPromptPackage(promptPackage);

    expect(prompt).toContain("# Multi-Choice Field Rules");
    expect(prompt).toContain("bez przecinków");
    expect(prompt).toContain("bez pełnego zdania");
  });

  it("filters concept context through context control", () => {
    const promptPackage = buildConceptFieldPromptPackage(
      project,
      book,
      "premise",
      {
        includedContextKeys: ["premise", "genre", "tone"],
        authorPriorityComment: "",
        contextSources: conceptPromptContextSources("premise")
      }
    );
    const prompt = renderPromptPackage(promptPackage);

    expect(prompt).toContain(book.premise);
    expect(prompt).toContain(book.genre);
    expect(prompt).toContain(book.tone);
    expect(prompt).not.toContain(book.protagonistSummary);
    expect(prompt).not.toContain(book.targetAudience);
  });

  it("keeps required active field context even when optional keys are empty", () => {
    const promptPackage = buildConceptFieldPromptPackage(
      project,
      book,
      "premise",
      {
        includedContextKeys: [],
        authorPriorityComment: "",
        contextSources: conceptPromptContextSources("premise")
      }
    );
    const prompt = renderPromptPackage(promptPackage);

    expect(prompt).toContain(book.premise);
    expect(promptPackage.context.targetFieldCurrentValue).toBe(book.premise);
    expect(prompt).not.toContain(book.genre);
  });

  it("renders author priority above concept context", () => {
    const promptPackage = buildConceptFieldPromptPackage(
      project,
      book,
      "premise",
      {
        includedContextKeys: ["premise"],
        authorPriorityComment: "Utrzymaj melancholijny ton finału.",
        contextSources: conceptPromptContextSources("premise")
      }
    );
    const prompt = renderPromptPackage(promptPackage);

    expect(prompt).toContain("# Author Priority");
    expect(prompt).toContain("Utrzymaj melancholijny ton finału.");
    expect(prompt.indexOf("# Author Priority")).toBeLessThan(
      prompt.indexOf("# Book Context")
    );
  });

  it("renders a per-field prompt for every phase 2 concept field", () => {
    const fields = [
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
    ] as const;

    for (const field of fields) {
      const promptPackage = buildConceptFieldPromptPackage(project, book, field);
      const prompt = renderPromptPackage(promptPackage);

      expect(prompt).toContain(`Docelowe pole: ${field}`);
      expect(prompt).toContain("# Response Length");
      expect(prompt).toContain("Maksymalna długość");
      expect(promptPackage.outputContract.format).toBe("json");
    }
  });

  it("renders a cover image prompt from current concept context", () => {
    const promptPackage = buildBookCoverPromptPackage(project, book);
    const prompt = renderBookCoverPromptPackage(
      promptPackage,
      "D:\\covers\\cover.png"
    );

    expect(promptPackage.action).toBe("generate_cover_image");
    expect(promptPackage.coverPrompt).toContain(book.workingTitle);
    expect(promptPackage.coverPrompt).toContain(book.premise);
    expect(promptPackage.coverPrompt).toContain(book.protagonistSummary);
    expect(promptPackage.coverPrompt).toContain(book.antagonistForce);
    expect(promptPackage.coverPrompt).toContain(book.settingSketch);
    expect(promptPackage.coverPrompt).toContain(book.genre);
    expect(promptPackage.coverPrompt).toContain(book.tone);
    expect(promptPackage.coverPrompt).toContain(book.styleGuide);
    expect(promptPackage.coverPrompt).not.toContain(book.targetAudience);
    expect(promptPackage.coverPrompt).not.toContain("(missing)");
    expect(promptPackage.generationOptions.providerId).toBe("codex-cli-bridge");
    expect(promptPackage.generationOptions.feature).toBe("image_generation");
    expect(promptPackage.generationOptions.mode).toBe("fresh");
    expect(prompt).toContain("$imagegen");
    expect(prompt).toContain("Create it from scratch as a fresh image generation.");
    expect(prompt).toContain("Do not edit, extend");
    expect(prompt).toContain("Image brief:");
    expect(prompt).toContain("Return only compact JSON");
    expect(prompt).toContain(`"${book.workingTitle}"`);
    expect(prompt).not.toContain("no visible text");
    expect(prompt).not.toContain("# Output Contract");
    expect(prompt).not.toContain("generated_images");
    expect(prompt).toContain("D:\\covers\\cover.png");
    expect(prompt).not.toContain("book_cover_image");
  });

  it("omits empty cover prompt cues instead of rendering placeholders", () => {
    const sparseBook = {
      ...book,
      premise: "",
      protagonistSummary: "",
      centralConflict: "",
      antagonistForce: "",
      settingSketch: "",
      genre: "",
      subgenre: "",
      targetAudience: "",
      tone: "",
      styleGuide: ""
    };

    const promptPackage = buildBookCoverPromptPackage(project, sparseBook);

    expect(promptPackage.coverPrompt).toContain(`"${book.workingTitle}"`);
    expect(promptPackage.coverPrompt).not.toContain("(missing)");
    expect(promptPackage.coverPrompt).not.toContain("Story image:");
    expect(promptPackage.coverPrompt).not.toContain("Character cue:");
    expect(promptPackage.coverPrompt).not.toContain("Threat or tension:");
    expect(promptPackage.coverPrompt).not.toContain("World cue:");
  });

  it("renders a new-project title prompt without an existing project", () => {
    const promptPackage = buildNewProjectTitlePromptPackage("Tajemnica archiwum");
    const prompt = renderNewProjectTitlePromptPackage(promptPackage);

    expect(promptPackage.action).toBe("generate_working_title");
    expect(promptPackage.context.seedTitle).toBe("Tajemnica archiwum");
    expect(prompt).toContain("Tajemnica archiwum");
    expect(prompt).toContain("concept_field_suggestion");
    expect(prompt).toContain("workingTitle");
    expect(prompt).toContain("# Response Length");
    expect(prompt).toContain("90 znaków");
  });

  it("renders author priority in a new-project title prompt", () => {
    const promptPackage = buildNewProjectTitlePromptPackage(
      "Tajemnica archiwum",
      "pl",
      {
        includedContextKeys: ["seedTitle"],
        authorPriorityComment: "Tytuł ma być krótki i zimny.",
        contextSources: [
          {
            key: "seedTitle",
            label: "Wpis autora",
            required: true
          }
        ]
      }
    );
    const prompt = renderNewProjectTitlePromptPackage(promptPackage);

    expect(prompt).toContain("# Author Priority");
    expect(prompt).toContain("Tytuł ma być krótki i zimny.");
    expect(promptPackage.context.contextControl?.includedContextKeys).toContain(
      "seedTitle"
    );
  });
});
