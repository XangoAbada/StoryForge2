import { describe, expect, it, vi } from "vitest";
import type { Beat, BookPlan, UpsertBeatInput } from "../../shared/api/types";
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
