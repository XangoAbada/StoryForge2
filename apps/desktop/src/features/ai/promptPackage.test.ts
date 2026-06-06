import { describe, expect, it } from "vitest";
import {
  buildConceptFieldPromptPackage,
  buildNewProjectTitlePromptPackage,
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
  logline: "Zecerka musi zatrzymać druk wspomnień.",
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
    expect(prompt).toContain(book.logline);
    expect(prompt).toContain(book.centralConflict);
    expect(prompt).toContain(book.antagonistForce);
    expect(prompt).toContain(book.settingSketch);
    expect(prompt).toContain(book.endingDirection);
    expect(prompt).toContain(book.genre);
    expect(prompt).toContain(book.subgenre);
    expect(prompt).toContain(book.targetAudience);
    expect(prompt).toContain(book.styleGuide);
    expect(prompt).toContain("pamięć, tożsamość");
  });

  it("renders a per-field prompt for every phase 2 concept field", () => {
    const fields = [
      "title",
      "workingTitle",
      "premise",
      "protagonistSummary",
      "protagonistGoal",
      "expandedPremise",
      "logline",
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
    expect(promptPackage.coverPrompt).toContain(book.targetAudience);
    expect(promptPackage.coverPrompt).toContain(book.tone);
    expect(promptPackage.coverPrompt).toContain(book.styleGuide);
    expect(promptPackage.generationOptions.providerId).toBe("codex-cli-bridge");
    expect(promptPackage.generationOptions.feature).toBe("image_generation");
    expect(prompt).toContain("$imagegen");
    expect(prompt).toContain("Codex CLI image generation");
    expect(prompt).toContain("generated_images");
    expect(prompt).toContain("Include the book title as readable cover typography");
    expect(prompt).toContain(`"${book.workingTitle}"`);
    expect(prompt).not.toContain("no visible text");
    expect(prompt).toContain("D:\\covers\\cover.png");
    expect(prompt).toContain("book_cover_image");
  });

  it("renders a new-project title prompt without an existing project", () => {
    const promptPackage = buildNewProjectTitlePromptPackage("Tajemnica archiwum");
    const prompt = renderNewProjectTitlePromptPackage(promptPackage);

    expect(promptPackage.action).toBe("generate_working_title");
    expect(promptPackage.context.seedTitle).toBe("Tajemnica archiwum");
    expect(prompt).toContain("Tajemnica archiwum");
    expect(prompt).toContain("concept_field_suggestion");
    expect(prompt).toContain("workingTitle");
  });
});
