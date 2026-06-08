import type {
  Beat,
  BookPlan,
  Chapter,
  SaveStoryStructureInput,
  UpsertActInput,
  UpsertBeatInput,
  UpsertChapterInput,
  UpsertPlotThreadInput
} from "../../shared/api/types";
import type { PlanFieldKey } from "./planPromptPackage";

const actColors = ["#3f8f6b", "#4f8fd9", "#8b5cf6", "#f59e42", "#d94f8f"];

export type ApplyPlanContext = {
  bookId: string;
  plan: BookPlan;
  saveStructure: (input: SaveStoryStructureInput) => Promise<unknown>;
  saveAct: (input: UpsertActInput) => Promise<unknown>;
  saveBeat: (input: UpsertBeatInput) => Promise<unknown>;
  saveThread: (input: UpsertPlotThreadInput) => Promise<unknown>;
  saveChapter: (input: UpsertChapterInput) => Promise<unknown>;
};

export async function applyPlanProposalPayload(
  payload: unknown,
  field: PlanFieldKey,
  packageContext: unknown,
  context: ApplyPlanContext
) {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const scopedPackageContext =
    packageContext && typeof packageContext === "object"
      ? (packageContext as Record<string, unknown>)
      : {};

  if (field === "storyStructure") {
    await applyStructure(record, context);
    return;
  }

  if (field === "acts") {
    await applyActs(record, context);
    return;
  }

  if (field === "plotThreads") {
    await applyThreads(record, context);
    return;
  }

  if (field === "beatSheet") {
    await applyBeats(record, context);
    return;
  }

  if (field === "chapterPlan") {
    await applyChapters(record, context);
    return;
  }

  if (typeof record.value === "string") {
    await applySingleField(record.value, scopedPackageContext, context);
  }
}

async function applyStructure(
  record: Record<string, unknown>,
  context: ApplyPlanContext
) {
  if (!record.structure || typeof record.structure !== "object") {
    return;
  }

  const structure = record.structure as Record<string, unknown>;
  await context.saveStructure({
    id: context.plan.structure?.id,
    bookId: context.bookId,
    structureType: textValue(structure.structureType) || "custom",
    description: context.plan.structure?.description ?? "",
    notes: context.plan.structure?.notes ?? "",
    status: "draft"
  });
}

async function applyActs(record: Record<string, unknown>, context: ApplyPlanContext) {
  if (!Array.isArray(record.acts)) {
    return;
  }

  for (const [index, item] of record.acts.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const act = item as Record<string, unknown>;
    await context.saveAct({
      bookId: context.bookId,
      name: textValue(act.name) || `Akt ${index + 1}`,
      purpose: textValue(act.purpose),
      summary: textValue(act.summary),
      startPercent: numberValue(act.startPercent, index * 25),
      endPercent: numberValue(act.endPercent, (index + 1) * 25),
      color: textValue(act.color) || actColors[index % actColors.length],
      orderIndex: context.plan.acts.length + index
    });
  }
}

async function applyThreads(
  record: Record<string, unknown>,
  context: ApplyPlanContext
) {
  if (!Array.isArray(record.threads)) {
    return;
  }

  for (const [index, item] of record.threads.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const thread = item as Record<string, unknown>;
    await context.saveThread({
      bookId: context.bookId,
      name: textValue(thread.name) || `Watek ${index + 1}`,
      description: textValue(thread.description),
      color: textValue(thread.color) || actColors[index % actColors.length],
      status: textValue(thread.status) || "planned",
      orderIndex: context.plan.threads.length + index
    });
  }
}

async function applyBeats(record: Record<string, unknown>, context: ApplyPlanContext) {
  if (!Array.isArray(record.beats)) {
    return;
  }

  for (const [index, item] of record.beats.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const beat = item as Record<string, unknown>;
    const actId = findByNameOrId(context.plan.acts, textValue(beat.actNameOrId))?.id ?? null;
    await context.saveBeat({
      bookId: context.bookId,
      actId,
      name: textValue(beat.name) || `Beat ${index + 1}`,
      description: textValue(beat.description),
      role: textValue(beat.role),
      threadIds: namesToIds(context.plan.threads, beat.threadNamesOrIds),
      orderIndex: context.plan.beats.length + index
    });
  }
}

async function applyChapters(
  record: Record<string, unknown>,
  context: ApplyPlanContext
) {
  if (!Array.isArray(record.chapters)) {
    return;
  }

  for (const [index, item] of record.chapters.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const chapter = item as Record<string, unknown>;
    const actId = findByNameOrId(context.plan.acts, textValue(chapter.actNameOrId))?.id ?? null;
    await context.saveChapter({
      bookId: context.bookId,
      actId,
      number: numberValue(chapter.number, context.plan.chapters.length + index + 1),
      workingTitle: textValue(chapter.workingTitle) || `Rozdzial ${index + 1}`,
      summary: textValue(chapter.summary),
      purpose: textValue(chapter.purpose),
      conflict: textValue(chapter.conflict),
      turningPoint: textValue(chapter.turningPoint),
      targetWordCount: numberValue(chapter.targetWordCount, 0) || null,
      threadIds: namesToIds(context.plan.threads, chapter.threadNamesOrIds),
      beatIds: namesToIds(context.plan.beats, chapter.beatNamesOrIds),
      orderIndex: context.plan.chapters.length + index
    });
  }
}

async function applySingleField(
  value: string,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
) {
  const targetField = textValue(packageContext.targetField) as PlanFieldKey;
  if (
    targetField === "storyStructureDescription" ||
    targetField === "storyStructureNotes"
  ) {
    await context.saveStructure({
      id: context.plan.structure?.id,
      bookId: context.bookId,
      structureType: context.plan.structure?.structureType ?? "custom",
      description:
        targetField === "storyStructureDescription"
          ? value
          : context.plan.structure?.description ?? "",
      notes:
        targetField === "storyStructureNotes"
          ? value
          : context.plan.structure?.notes ?? "",
      status: context.plan.structure?.status ?? "draft"
    });
    return;
  }

  const targetEntityId = textValue(packageContext.targetEntityId);
  if (!targetEntityId) {
    return;
  }

  const act = context.plan.acts.find((item) => item.id === targetEntityId);
  if (act && (targetField === "actPurpose" || targetField === "actSummary")) {
    await context.saveAct({
      ...act,
      purpose: targetField === "actPurpose" ? value : act.purpose,
      summary: targetField === "actSummary" ? value : act.summary
    });
  }

  const chapter = context.plan.chapters.find((item) => item.id === targetEntityId);
  if (
    chapter &&
    ["chapterSummary", "chapterPurpose", "chapterConflict", "chapterTurningPoint"].includes(
      targetField
    )
  ) {
    await context.saveChapter({
      ...chapter,
      summary: targetField === "chapterSummary" ? value : chapter.summary,
      purpose: targetField === "chapterPurpose" ? value : chapter.purpose,
      conflict: targetField === "chapterConflict" ? value : chapter.conflict,
      turningPoint:
        targetField === "chapterTurningPoint" ? value : chapter.turningPoint,
      threadIds: context.plan.chapterThreads
        .filter((item) => item.chapterId === chapter.id)
        .map((item) => item.threadId),
      beatIds: context.plan.chapterBeats
        .filter((item) => item.chapterId === chapter.id)
        .map((item) => item.beatId)
    });
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function namesToIds<T extends { id: string; name?: string; workingTitle?: string }>(
  items: T[],
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => findByNameOrId(items, textValue(item))?.id)
    .filter((id): id is string => Boolean(id));
}

function findByNameOrId<T extends { id: string; name?: string; workingTitle?: string }>(
  items: T[],
  value: string
): T | undefined {
  const normalized = value.toLowerCase();
  return items.find((item) => {
    const label = (item.name ?? item.workingTitle ?? "").toLowerCase();
    return item.id === value || label === normalized;
  });
}
