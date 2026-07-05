import { describe, expect, it, vi } from "vitest";
import type { Beat, BookPlan, Scene, UpsertBeatInput, UpsertSceneInput } from "../../shared/api/types";
import { applyPlanProposalPayload } from "./planProposalApplication";
import {
  applyPlanDraftField,
  registerPlanDraftFieldTarget,
  unregisterPlanDraftFieldTarget
} from "./planDraftFieldTargets";

const beat: Beat = {
  id: "beat-1",
  bookId: "book-1",
  name: "Stara nazwa",
  role: "Stara rola",
  description: "Stary opis",
  orderIndex: 0,
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
  structure: null,
  acts: [],
  beats: [beat],
  threads: [],
  chapters: [],
  chapterThreads: [],
  chapterBeats: [],
  scenes: [],
  sceneCharacters: [],
  sceneThreads: [],
  sceneWorldElements: [],
  sceneWorldRules: []
};

describe("applyPlanProposalPayload", () => {
  it("updates only the targeted saved beat text field", async () => {
    const saveBeat = vi.fn(async (input: UpsertBeatInput) => ({
      ...beat,
      ...input
    }));

    await applyPlanProposalPayload(
      {
        version: 1,
        kind: "book_plan_suggestion",
        field: "beatRole",
        value: "Nowa rola"
      },
      "beatRole",
      {
        targetField: "beatRole",
        targetEntityId: "beat-1"
      },
      {
        bookId: "book-1",
        plan,
        saveStructure: vi.fn(),
        saveAct: vi.fn(),
        saveBeat,
        moveBeatToChapter: vi.fn(),
        saveThread: vi.fn(),
        saveChapter: vi.fn(),
        saveChapterThreadRelation: vi.fn()
      }
    );

    expect(saveBeat).toHaveBeenCalledWith({
      ...beat,
      role: "Nowa rola"
    });
  });

  it("persists a targeted scene text field to the database", async () => {
    const scene: Scene = {
      id: "scene-1",
      bookId: "book-1",
      planVersionId: "plan-version-1",
      chapterId: "chapter-1",
      orderIndex: 0,
      title: "Scena",
      summary: "",
      goal: "Stary cel",
      conflict: "",
      outcome: "",
      timeMarker: "",
      povCharacterId: null,
      locationId: null,
      targetWordCount: 1200,
      actualWordCount: 0,
      manuscriptContent: "",
      autoSummary: "",
      autoSummarySourceHash: "",
      isStyleReference: 0,
      status: "planned",
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z"
    };
    const saveScene = vi.fn(async (input: UpsertSceneInput) => ({ id: scene.id, ...input }));

    await applyPlanProposalPayload(
      {
        version: 1,
        kind: "book_plan_suggestion",
        field: "sceneGoal",
        value: "Nowy cel sceny"
      },
      "sceneGoal",
      {
        targetField: "sceneGoal",
        targetEntityId: "scene-1"
      },
      {
        bookId: "book-1",
        plan: { ...plan, scenes: [scene] },
        saveStructure: vi.fn(),
        saveAct: vi.fn(),
        saveBeat: vi.fn(),
        moveBeatToChapter: vi.fn(),
        saveThread: vi.fn(),
        saveChapter: vi.fn(),
        saveChapterThreadRelation: vi.fn(),
        saveScene
      }
    );

    expect(saveScene).toHaveBeenCalledWith(
      expect.objectContaining({ id: "scene-1", goal: "Nowy cel sceny", title: "Scena" })
    );
  });
});

describe("planDraftFieldTargets", () => {
  it("updates draft beat state without persistence", () => {
    const handler = vi.fn();
    registerPlanDraftFieldTarget("draft-beat-1", handler);

    const applied = applyPlanDraftField(
      "draft-beat-1",
      "beatDescription",
      "Nowy opis"
    );

    unregisterPlanDraftFieldTarget("draft-beat-1");

    expect(applied).toBe(true);
    expect(handler).toHaveBeenCalledWith("beatDescription", "Nowy opis");
  });
});
