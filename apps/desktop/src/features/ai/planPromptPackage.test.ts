import { describe, expect, it } from "vitest";
import type { Beat, Book, BookPlan, Chapter, PlotThread, Project } from "../../shared/api/types";
import {
  buildPlanPromptPackage,
  planPromptContextSource,
  planPromptContextSources,
  renderPlanPromptPackage
} from "./planPromptPackage";

const project: Project = {
  id: "project-1",
  name: "Cienie Drukarni",
  language: "pl",
  activeBookId: "book-1",
  settingsJson: "{}",
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const book: Book = {
  id: "book-1",
  projectId: "project-1",
  title: "",
  workingTitle: "Cienie Drukarni",
  premise: "Zecerka odkrywa, ze drukowane sny zmieniaja wspomnienia miasta.",
  protagonistSummary: "Zecerka pilnujaca miejskiego archiwum snow.",
  protagonistGoal: "Zatrzymac druk falszywych wspomnien.",
  expandedPremise: "Drukarnia przechowuje sny miasta.",
  centralConflict: "Prawda kontra wygodna pamiec miasta.",
  antagonistForce: "Cech drukarzy kontrolujacy pamiec.",
  stakes: "Miasto moze utracic wspolna tozsamosc.",
  settingSketch: "Deszczowe miasto drukarni i nocnych gazet.",
  endingDirection: "Bohaterka ujawnia prawde.",
  genre: "fantasy",
  subgenre: "urban fantasy",
  targetAudience: "adult",
  tone: "mroczny",
  styleGuide: "Krotkie zdania w scenach napiecia.",
  pointOfView: "trzecia osoba ograniczona",
  targetWordCount: 85000,
  themesJson: JSON.stringify(["pamiec", "tozsamosc"]),
  unwantedThemes: "Bez gore.",
  alternativeTitlesJson: "[]",
  coverImagePath: "",
  coverPrompt: "",
  coverNegativePrompt: "",
  coverGeneratedAt: null,
  status: "draft",
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const beat: Beat & { chapterId?: string | null } = {
  id: "beat-1",
  bookId: "book-1",
  name: "Pierwszy falszywy sen",
  role: "Inciting incident",
  description: "Bohaterka znajduje odbitke snu, ktorego nikt nie snil.",
  orderIndex: 0,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z",
  chapterId: "chapter-1"
};

const unrelatedBeat: Beat = {
  id: "beat-2",
  bookId: "book-1",
  name: "Maskarada archiwistow",
  role: "False victory",
  description: "Archiwisci ukrywaja maszyne do przepisywania snow.",
  orderIndex: 1,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const chapter: Chapter = {
  id: "chapter-1",
  bookId: "book-1",
  actId: "act-1",
  number: 1,
  workingTitle: "Drukowany sen",
  summary: "Pierwszy trop.",
  purpose: "Pokazac anomalie.",
  conflict: "Bohaterka ryzykuje prace.",
  turningPoint: "Odnajduje falszywa odbitke.",
  targetWordCount: 3000,
  orderIndex: 0,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const unrelatedChapter: Chapter = {
  id: "chapter-2",
  bookId: "book-1",
  actId: "act-1",
  number: 2,
  workingTitle: "Bal bez pamieci",
  summary: "Elity miasta celebruja falszywa wersje historii.",
  purpose: "Pokazac skale manipulacji.",
  conflict: "Bohaterka musi milczec przy dawnych sojusznikach.",
  turningPoint: "Ktos rozpoznaje jej prawdziwe wspomnienie.",
  targetWordCount: 3200,
  orderIndex: 1,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const thread: PlotThread = {
  id: "thread-1",
  bookId: "book-1",
  name: "Pamiec miasta",
  description: "Watek kontroli wspomnien.",
  color: "#3f8f6b",
  status: "planned",
  orderIndex: 0,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const unrelatedThread: PlotThread = {
  id: "thread-2",
  bookId: "book-1",
  name: "Rodzina introligatorow",
  description: "Poboczny watek lojalnosci rodzinnej.",
  color: "#4f8fd9",
  status: "planned",
  orderIndex: 1,
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z"
};

const plan: BookPlan = {
  planVersion: {
    id: "plan-version-1",
    bookId: "book-1",
    name: "Plan glowny",
    description: "",
    isActive: true,
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z"
  },
  planVersions: [
    {
      id: "plan-version-1",
      bookId: "book-1",
      name: "Plan glowny",
      description: "",
      isActive: true,
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z"
    }
  ],
  structure: {
    id: "structure-1",
    bookId: "book-1",
    structureType: "three_act",
    description: "Klasyczna struktura trzech aktow.",
    notes: "",
    status: "draft",
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z"
  },
  acts: [
    {
      id: "act-1",
      bookId: "book-1",
      name: "Poczatek",
      purpose: "Uruchomic sledztwo.",
      summary: "",
      startPercent: 0,
      endPercent: 25,
      color: "#3f8f6b",
      orderIndex: 0,
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z"
    }
  ],
  beats: [beat, unrelatedBeat],
  threads: [thread, unrelatedThread],
  chapters: [chapter, unrelatedChapter],
  chapterThreads: [{ chapterId: "chapter-1", threadId: "thread-1", description: "" }],
  chapterBeats: [{ chapterId: "chapter-1", beatId: "beat-1" }],
  scenes: [],
  sceneCharacters: [],
  sceneThreads: [],
  sceneWorldElements: [],
  sceneWorldRules: []
};

describe("buildPlanPromptPackage", () => {
  it("renders beat fields as single-field AI suggestions with beat and plan context", () => {
    for (const field of ["beatName", "beatRole", "beatDescription"] as const) {
      const promptPackage = buildPlanPromptPackage(project, book, plan, field, beat);
      const prompt = renderPlanPromptPackage(promptPackage);

      expect(promptPackage.action).toBe("generate_beat_field");
      expect(promptPackage.outputContract.format).toBe("json");
      expect(prompt).toContain(`Docelowe pole: ${field}`);
      expect(prompt).toContain('"kind": "book_plan_suggestion"');
      expect(prompt).toContain('"value": "string"');
      expect(prompt).toContain(beat.name);
      expect(prompt).toContain(beat.role);
      expect(prompt).toContain(beat.description);
      expect(prompt).toContain("Drukowany sen");
      expect(prompt).toContain("Pamiec miasta");
      expect(prompt).not.toContain("Maskarada archiwistow");
      expect(prompt).not.toContain("Bal bez pamieci");
      expect(prompt).not.toContain("Rodzina introligatorow");
    }
  });

  it("renders chapter fields with only the target chapter neighborhood and assigned relations by default", () => {
    const promptPackage = buildPlanPromptPackage(project, book, plan, "chapterSummary", chapter);
    const prompt = renderPlanPromptPackage(promptPackage);

    expect(prompt).toContain("Drukowany sen");
    expect(prompt).toContain("Bal bez pamieci");
    expect(prompt).toContain("Pierwszy falszywy sen");
    expect(prompt).toContain("Pamiec miasta");
    expect(prompt).not.toContain("Maskarada archiwistow");
    expect(prompt).not.toContain("Rodzina introligatorow");
  });

  it("keeps chapter pools for chapter planning and full pools for relation suggestions", () => {
    const chapterPlanPrompt = renderPlanPromptPackage(
      buildPlanPromptPackage(project, book, plan, "chapterPlan")
    );
    const threadSuggestionPrompt = renderPlanPromptPackage(
      buildPlanPromptPackage(project, book, plan, "chapterThreadSuggestions", chapter)
    );
    const beatSuggestionPrompt = renderPlanPromptPackage(
      buildPlanPromptPackage(project, book, plan, "chapterBeatSuggestions", chapter)
    );

    expect(chapterPlanPrompt).toContain("Bal bez pamieci");
    expect(chapterPlanPrompt).not.toContain("Maskarada archiwistow");
    expect(chapterPlanPrompt).not.toContain("Rodzina introligatorow");
    expect(threadSuggestionPrompt).toContain("Rodzina introligatorow");
    expect(beatSuggestionPrompt).toContain("Maskarada archiwistow");
  });

  it("renders manually added field context from the prompt context panel", () => {
    const defaultSources = planPromptContextSources("chapterSummary");
    const manualSource = planPromptContextSource("chapterPurpose", chapter);
    const promptPackage = buildPlanPromptPackage(project, book, plan, "chapterSummary", chapter, {
      includedContextKeys: [...defaultSources.map((source) => source.key), manualSource.key],
      authorPriorityComment: "",
      contextSources: [...defaultSources, manualSource]
    });
    const prompt = renderPlanPromptPackage(promptPackage);

    expect(prompt).toContain("Dodatkowe pola dodane przez autora");
    expect(prompt).toContain("chapterPurpose");
    expect(prompt).toContain("Pokazac anomalie.");
  });

  it("renders full plan context for plan gap audits", () => {
    const prompt = renderPlanPromptPackage(
      buildPlanPromptPackage(project, book, plan, "planGaps")
    );

    expect(prompt).toContain("Pełny plan");
    expect(prompt).toContain("Bal bez pamieci");
    expect(prompt).toContain("Maskarada archiwistow");
    expect(prompt).toContain("Rodzina introligatorow");
  });
});
