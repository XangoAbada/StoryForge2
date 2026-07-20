import type {
  Beat,
  BookPlan,
  Chapter,
  CharacterWorkspace,
  MoveBeatToChapterInput,
  SaveStoryStructureInput,
  SetSceneRelationsInput,
  UpsertActInput,
  UpsertBeatInput,
  UpsertChapterInput,
  UpsertChapterThreadInput,
  UpsertPlotThreadInput,
  UpsertSceneInput,
  WorldWorkspace
} from "../../shared/api/types";
import type { PlanFieldKey } from "./planPromptPackage";

const actColors = ["#3f8f6b", "#4f8fd9", "#8b5cf6", "#f59e42", "#d94f8f"];

export type CreatedSceneForAudit = {
  id: string;
  title: string;
  chapterId: string | null;
  analysisText: string;
};

export type ApplyPlanProposalResult = {
  createdScenes: CreatedSceneForAudit[];
};

export type ApplyPlanContext = {
  bookId: string;
  plan: BookPlan;
  saveStructure: (input: SaveStoryStructureInput) => Promise<unknown>;
  saveAct: (input: UpsertActInput) => Promise<unknown>;
  saveBeat: (input: UpsertBeatInput) => Promise<Beat>;
  moveBeatToChapter: (input: MoveBeatToChapterInput) => Promise<unknown>;
  saveThread: (input: UpsertPlotThreadInput) => Promise<unknown>;
  saveChapter: (input: UpsertChapterInput) => Promise<unknown>;
  saveChapterThreadRelation: (input: UpsertChapterThreadInput) => Promise<unknown>;
  saveScene?: (input: UpsertSceneInput) => Promise<{ id: string }>;
  setSceneRelations?: (input: SetSceneRelationsInput) => Promise<unknown>;
  characters?: CharacterWorkspace;
  world?: WorldWorkspace;
};

export async function applyPlanProposalPayload(
  payload: unknown,
  field: PlanFieldKey,
  packageContext: unknown,
  context: ApplyPlanContext
): Promise<ApplyPlanProposalResult> {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const scopedPackageContext =
    packageContext && typeof packageContext === "object"
      ? (packageContext as Record<string, unknown>)
      : {};

  if (field === "storyStructure") {
    await applyStructure(record, context);
    return emptyApplyResult();
  }

  if (field === "acts") {
    await applyActs(record, context);
    return emptyApplyResult();
  }

  if (field === "plotThreads") {
    await applyThreads(record, context);
    return emptyApplyResult();
  }

  if (field === "beatSheet") {
    await applyBeats(record, context);
    return emptyApplyResult();
  }

  if (field === "chapterPlan") {
    await applyChapters(record, context);
    return emptyApplyResult();
  }

  if (field === "chapterDraft") {
    await applyChapterDraft(record, scopedPackageContext, context);
    return emptyApplyResult();
  }

  if (field === "actDraft") {
    await applyActDraft(record, scopedPackageContext, context);
    return emptyApplyResult();
  }

  if (field === "threadDraft") {
    await applyThreadDraft(record, scopedPackageContext, context);
    return emptyApplyResult();
  }

  if (field === "beatDraft") {
    await applyBeatDraft(record, scopedPackageContext, context);
    return emptyApplyResult();
  }

  if (field === "sceneDraft") {
    return applySceneDraft(record, scopedPackageContext, context);
  }

  if (field === "chapterSceneBreakdown") {
    return applyChapterSceneBreakdown(record, scopedPackageContext, context);
  }

  if (field === "allChapterSceneDrafts") {
    return applyAllChapterSceneDrafts(record, context);
  }

  if (field === "prepareChapterForScenes") {
    return emptyApplyResult();
  }

  if (field === "chapterThreadSuggestions") {
    await applyChapterRelationSuggestions(record, scopedPackageContext, context, "threads");
    return emptyApplyResult();
  }

  if (field === "allChapterThreadSuggestions") {
    await applyAllChapterThreadSuggestions(record, context);
    return emptyApplyResult();
  }

  if (field === "chapterBeatSuggestions") {
    await applyChapterRelationSuggestions(record, scopedPackageContext, context, "beats");
    return emptyApplyResult();
  }

  if (field === "sceneRelationSuggestions") {
    await applySceneRelationSuggestions(record, scopedPackageContext, context);
    return emptyApplyResult();
  }

  if (typeof record.value === "string") {
    await applySingleField(record.value, scopedPackageContext, context);
  }

  return emptyApplyResult();
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
      resolution: textValue(thread.resolution),
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
    const savedBeat = await context.saveBeat({
      bookId: context.bookId,
      name: textValue(beat.name) || `Beat ${index + 1}`,
      description: textValue(beat.description),
      role: textValue(beat.role),
      orderIndex: context.plan.beats.length + index
    });
    const chapterId =
      findByNameOrId(context.plan.chapters, textValue(beat.chapterNameOrId))?.id ??
      namesToIds(context.plan.chapters, beat.chapterNamesOrIds)[0] ??
      null;

    if (chapterId) {
      await context.moveBeatToChapter({
        bookId: context.bookId,
        beatId: savedBeat.id,
        chapterId,
        orderIndex: savedBeat.orderIndex
      });
    }
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

async function applyChapterRelationSuggestions(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext,
  relationKind: "threads" | "beats"
) {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const chapter = context.plan.chapters.find((item) => item.id === targetEntityId);
  if (!chapter) {
    return;
  }

  const currentThreadIds = context.plan.chapterThreads
    .filter((item) => item.chapterId === chapter.id)
    .map((item) => item.threadId);
  const currentBeatIds = context.plan.chapterBeats
    .filter((item) => item.chapterId === chapter.id)
    .map((item) => item.beatId);

  const suggestedIds =
    relationKind === "threads"
      ? namesToIds(context.plan.threads, record.threadNamesOrIds)
      : namesToIds(context.plan.beats, record.beatNamesOrIds);
  const existingIds = relationKind === "threads" ? currentThreadIds : currentBeatIds;
  const additions = suggestedIds.filter((id) => !existingIds.includes(id));

  if (additions.length === 0) {
    return;
  }

  await context.saveChapter({
    ...chapter,
    threadIds:
      relationKind === "threads"
        ? uniqueOrderedIds([...currentThreadIds, ...additions])
        : currentThreadIds,
    beatIds:
      relationKind === "beats"
        ? uniqueOrderedIds([...currentBeatIds, ...additions])
        : currentBeatIds
  });
}

async function applySceneDraft(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<ApplyPlanProposalResult> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const chapter = context.plan.chapters.find((item) => item.id === targetEntityId);
  if (!chapter || !record.scene || typeof record.scene !== "object") {
    return emptyApplyResult();
  }
  if (!context.saveScene || !context.setSceneRelations) {
    throw new Error("Brak obsługi zapisu sceny dla propozycji AI.");
  }

  const sceneRecord = record.scene as Record<string, unknown>;
  const sceneInput: UpsertSceneInput = {
    bookId: context.bookId,
    chapterId: chapter.id,
    orderIndex: context.plan.scenes.filter((scene) => scene.chapterId === chapter.id).length,
    title: textValue(sceneRecord.title) || "Nowa scena",
    summary: textValue(sceneRecord.summary),
    goal: textValue(sceneRecord.goal),
    conflict: textValue(sceneRecord.conflict),
    outcome: textValue(sceneRecord.outcome),
    povCharacterId: null,
    locationId: null,
    targetWordCount: numberValue(sceneRecord.targetWordCount, 0) || null,
    actualWordCount: null,
    manuscriptContent: "",
    status: "planned"
  };
  const savedScene = await context.saveScene(sceneInput);

  const relationHints =
    record.relationHints && typeof record.relationHints === "object"
      ? (record.relationHints as Record<string, unknown>)
      : {};

  await context.setSceneRelations({
    bookId: context.bookId,
    sceneId: savedScene.id,
    characterIds: [],
    threadIds: namesToIds(context.plan.threads, relationHints.threadNamesOrIds),
    elementIds: [],
    ruleIds: []
  });

  return {
    createdScenes: [
      createdSceneForAudit(savedScene.id, sceneInput, chapter, {
        handledBeatOrDuty: textValue(sceneRecord.handledBeatOrDuty),
        storyBibleNeeds: sceneRecord.storyBibleNeeds
      })
    ]
  };
}

async function applyChapterSceneBreakdown(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<ApplyPlanProposalResult> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const chapter = context.plan.chapters.find((item) => item.id === targetEntityId);
  if (!chapter || !Array.isArray(record.scenes)) {
    return emptyApplyResult();
  }
  if (!context.saveScene || !context.setSceneRelations) {
    throw new Error("Brak obsługi zapisu sceny dla propozycji AI.");
  }

  const sceneRecords = record.scenes.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
  );
  const targetWordCounts = chapterBreakdownTargetWordCounts(
    chapter,
    sceneRecords,
    context.plan.scenes.filter((scene) => scene.chapterId === chapter.id)
  );
  const createdScenes: CreatedSceneForAudit[] = [];

  for (const [index, sceneRecord] of sceneRecords.entries()) {
    const relationHints =
      sceneRecord.relationHints && typeof sceneRecord.relationHints === "object"
        ? (sceneRecord.relationHints as Record<string, unknown>)
        : {};
    const sceneInput: UpsertSceneInput = {
      bookId: context.bookId,
      chapterId: chapter.id,
      orderIndex:
        context.plan.scenes.filter((scene) => scene.chapterId === chapter.id).length + index,
      title: textValue(sceneRecord.title) || `Scena ${index + 1}`,
      summary: textValue(sceneRecord.summary),
      goal: textValue(sceneRecord.goal),
      conflict: textValue(sceneRecord.conflict),
      outcome: textValue(sceneRecord.outcome),
      povCharacterId: namesToIds(context.characters?.characters ?? [], [
        relationHints.povCharacterNameOrId
      ])[0] ?? null,
      locationId: namesToIds(context.world?.elements ?? [], [
        relationHints.locationNameOrId
      ])[0] ?? null,
      targetWordCount: targetWordCounts[index] ?? null,
      actualWordCount: null,
      manuscriptContent: "",
      status: "planned"
    };
    const savedScene = await context.saveScene(sceneInput);

    await context.setSceneRelations({
      bookId: context.bookId,
      sceneId: savedScene.id,
      characterIds: namesToIds(context.characters?.characters ?? [], relationHints.characterNamesOrIds),
      threadIds: namesToIds(context.plan.threads, relationHints.threadNamesOrIds),
      elementIds: namesToIds(context.world?.elements ?? [], relationHints.elementNamesOrIds),
      ruleIds: namesToIds(context.world?.rules ?? [], relationHints.ruleNamesOrIds)
    });

    createdScenes.push(
      createdSceneForAudit(savedScene.id, sceneInput, chapter, {
        handledBeatOrDuty: textValue(sceneRecord.handledBeatOrDuty),
        storyBibleNeeds: sceneRecord.storyBibleNeeds
      })
    );
  }

  return { createdScenes };
}

async function applyAllChapterSceneDrafts(
  record: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<ApplyPlanProposalResult> {
  if (!Array.isArray(record.scenes)) {
    return emptyApplyResult();
  }
  if (!context.saveScene || !context.setSceneRelations) {
    throw new Error("Brak obsługi zapisu sceny dla propozycji AI.");
  }

  const createdByChapter = new Map<string, number>();
  const createdScenes: CreatedSceneForAudit[] = [];

  for (const item of record.scenes) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const sceneRecord = item as Record<string, unknown>;
    const chapter = findByNameOrId(
      context.plan.chapters,
      textValue(sceneRecord.chapterNameOrId)
    );
    if (!chapter) {
      continue;
    }

    const createdCount = createdByChapter.get(chapter.id) ?? 0;
    createdByChapter.set(chapter.id, createdCount + 1);

    const sceneInput: UpsertSceneInput = {
      bookId: context.bookId,
      chapterId: chapter.id,
      orderIndex:
        context.plan.scenes.filter((scene) => scene.chapterId === chapter.id).length +
        createdCount,
      title: textValue(sceneRecord.title) || "Nowa scena",
      summary: textValue(sceneRecord.summary),
      goal: textValue(sceneRecord.goal),
      conflict: textValue(sceneRecord.conflict),
      outcome: textValue(sceneRecord.outcome),
      povCharacterId: null,
      locationId: null,
      targetWordCount: numberValue(sceneRecord.targetWordCount, 0) || null,
      actualWordCount: null,
      manuscriptContent: "",
      status: "planned"
    };
    const savedScene = await context.saveScene(sceneInput);

    const relationHints =
      sceneRecord.relationHints && typeof sceneRecord.relationHints === "object"
        ? (sceneRecord.relationHints as Record<string, unknown>)
        : {};

    await context.setSceneRelations({
      bookId: context.bookId,
      sceneId: savedScene.id,
      characterIds: [],
      threadIds: namesToIds(context.plan.threads, relationHints.threadNamesOrIds),
      elementIds: [],
      ruleIds: []
    });

    createdScenes.push(
      createdSceneForAudit(savedScene.id, sceneInput, chapter, {
        handledBeatOrDuty: textValue(sceneRecord.handledBeatOrDuty),
        storyBibleNeeds: sceneRecord.storyBibleNeeds
      })
    );
  }

  return { createdScenes };
}

async function applySceneRelationSuggestions(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
) {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const scene = context.plan.scenes.find((item) => item.id === targetEntityId);
  if (!scene || !context.setSceneRelations) {
    return;
  }

  const relationHints =
    record.relationHints && typeof record.relationHints === "object"
      ? (record.relationHints as Record<string, unknown>)
      : record;
  const currentCharacterIds = context.plan.sceneCharacters
    .filter((item) => item.sceneId === scene.id)
    .map((item) => item.characterId);
  const currentThreadIds = context.plan.sceneThreads
    .filter((item) => item.sceneId === scene.id)
    .map((item) => item.threadId);
  const currentElementIds = context.plan.sceneWorldElements
    .filter((item) => item.sceneId === scene.id)
    .map((item) => item.elementId);
  const currentRuleIds = context.plan.sceneWorldRules
    .filter((item) => item.sceneId === scene.id)
    .map((item) => item.ruleId);
  const povCharacterId = namesToIds(context.characters?.characters ?? [], [
    relationHints.povCharacterNameOrId
  ])[0] ?? scene.povCharacterId;
  const locationId = namesToIds(context.world?.elements ?? [], [
    relationHints.locationNameOrId
  ])[0] ?? scene.locationId;

  if (povCharacterId !== scene.povCharacterId || locationId !== scene.locationId) {
    await context.saveScene?.({
      ...scene,
      povCharacterId,
      locationId,
      actualWordCount: scene.actualWordCount,
      manuscriptContent: scene.manuscriptContent
    });
  }

  await context.setSceneRelations({
    bookId: context.bookId,
    sceneId: scene.id,
    characterIds: uniqueOrderedIds([
      ...currentCharacterIds,
      ...namesToIds(context.characters?.characters ?? [], relationHints.characterNamesOrIds)
    ]),
    threadIds: uniqueOrderedIds([
      ...currentThreadIds,
      ...namesToIds(context.plan.threads, relationHints.threadNamesOrIds)
    ]),
    elementIds: uniqueOrderedIds([
      ...currentElementIds,
      ...namesToIds(context.world?.elements ?? [], relationHints.elementNamesOrIds)
    ]),
    ruleIds: uniqueOrderedIds([
      ...currentRuleIds,
      ...namesToIds(context.world?.rules ?? [], relationHints.ruleNamesOrIds)
    ])
  });
}

async function applyAllChapterThreadSuggestions(
  record: Record<string, unknown>,
  context: ApplyPlanContext
) {
  if (!Array.isArray(record.chapterThreads)) {
    return;
  }

  for (const item of record.chapterThreads) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const suggestion = item as Record<string, unknown>;
    const chapter = findByNameOrId(
      context.plan.chapters,
      textValue(suggestion.chapterNameOrId)
    );
    if (!chapter) {
      continue;
    }

    const currentThreadIds = context.plan.chapterThreads
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.threadId);
    const currentBeatIds = context.plan.chapterBeats
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.beatId);
    const suggestedThreadIds = namesToIds(
      context.plan.threads,
      suggestion.threadNamesOrIds
    );
    const nextThreadIds = uniqueOrderedIds([
      ...currentThreadIds,
      ...suggestedThreadIds
    ]);

    if (nextThreadIds.length === currentThreadIds.length) {
      continue;
    }

    await context.saveChapter({
      ...chapter,
      threadIds: nextThreadIds,
      beatIds: currentBeatIds
    });
  }
}

// Generatory całej encji ("Cały rozdział/akt/wątek/beat"): jeden pakiet AI
// zwraca obiekt ze wszystkimi polami tekstowymi encji, zapisywany od razu do
// bazy (jak sceneDraft). Nadpisujemy tylko pola, które AI faktycznie zwróciło;
// pola nietekstowe (kolor, percenty, status, przypięcia) zostają nietknięte.
async function applyChapterDraft(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<void> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const chapter = context.plan.chapters.find((item) => item.id === targetEntityId);
  if (!chapter || !record.chapter || typeof record.chapter !== "object") {
    return;
  }
  const r = record.chapter as Record<string, unknown>;
  await context.saveChapter({
    ...chapter,
    workingTitle: textValue(r.workingTitle) || chapter.workingTitle,
    summary: textValue(r.summary) || chapter.summary,
    purpose: textValue(r.purpose) || chapter.purpose,
    conflict: textValue(r.conflict) || chapter.conflict,
    turningPoint: textValue(r.turningPoint) || chapter.turningPoint,
    threadIds: context.plan.chapterThreads
      .filter((item) => item.chapterId === chapter.id)
      .map((item) => item.threadId),
    beatIds: context.plan.chapterBeats
      .filter((item) => item.chapterId === chapter.id)
      .map((item) => item.beatId)
  });
}

async function applyActDraft(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<void> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const act = context.plan.acts.find((item) => item.id === targetEntityId);
  if (!act || !record.act || typeof record.act !== "object") {
    return;
  }
  const r = record.act as Record<string, unknown>;
  await context.saveAct({
    ...act,
    name: textValue(r.name) || act.name,
    purpose: textValue(r.purpose) || act.purpose,
    summary: textValue(r.summary) || act.summary
  });
}

async function applyThreadDraft(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<void> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const thread = context.plan.threads.find((item) => item.id === targetEntityId);
  if (!thread || !record.thread || typeof record.thread !== "object") {
    return;
  }
  const r = record.thread as Record<string, unknown>;
  await context.saveThread({
    ...thread,
    name: textValue(r.name) || thread.name,
    description: textValue(r.description) || thread.description,
    resolution: textValue(r.resolution) || thread.resolution
  });
}

async function applyBeatDraft(
  record: Record<string, unknown>,
  packageContext: Record<string, unknown>,
  context: ApplyPlanContext
): Promise<void> {
  const targetEntityId = textValue(packageContext.targetEntityId);
  const beat = context.plan.beats.find((item) => item.id === targetEntityId);
  if (!beat || !record.beat || typeof record.beat !== "object") {
    return;
  }
  const r = record.beat as Record<string, unknown>;
  await context.saveBeat({
    ...beat,
    name: textValue(r.name) || beat.name,
    role: textValue(r.role) || beat.role,
    description: textValue(r.description) || beat.description
  });
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

  const beat = context.plan.beats.find((item) => item.id === targetEntityId);
  if (
    beat &&
    ["beatName", "beatRole", "beatDescription"].includes(targetField)
  ) {
    await context.saveBeat({
      ...beat,
      name: targetField === "beatName" ? value : beat.name,
      role: targetField === "beatRole" ? value : beat.role,
      description: targetField === "beatDescription" ? value : beat.description
    });
  }

  const thread = context.plan.threads.find((item) => item.id === targetEntityId);
  if (
    thread &&
    (targetField === "threadDescription" || targetField === "threadResolution")
  ) {
    await context.saveThread({
      ...thread,
      description: targetField === "threadDescription" ? value : thread.description,
      resolution: targetField === "threadResolution" ? value : thread.resolution
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

  const scene = context.plan.scenes.find((item) => item.id === targetEntityId);
  if (
    scene &&
    context.saveScene &&
    ["sceneTitle", "sceneSummary", "sceneGoal", "sceneConflict", "sceneOutcome"].includes(
      targetField
    )
  ) {
    await context.saveScene({
      id: scene.id,
      bookId: scene.bookId,
      chapterId: scene.chapterId,
      orderIndex: scene.orderIndex,
      title: targetField === "sceneTitle" ? value : scene.title,
      summary: targetField === "sceneSummary" ? value : scene.summary,
      goal: targetField === "sceneGoal" ? value : scene.goal,
      conflict: targetField === "sceneConflict" ? value : scene.conflict,
      outcome: targetField === "sceneOutcome" ? value : scene.outcome,
      timeMarker: scene.timeMarker,
      povCharacterId: scene.povCharacterId,
      locationId: scene.locationId,
      targetWordCount: scene.targetWordCount,
      actualWordCount: scene.actualWordCount,
      manuscriptContent: scene.manuscriptContent,
      status: scene.status
    });
  }

  if (targetField === "threadChapterDescription") {
    const [threadId, chapterId] = targetEntityId.split(":");
    if (!threadId || !chapterId) {
      return;
    }

    await context.saveChapterThreadRelation({
      bookId: context.bookId,
      threadId,
      chapterId,
      description: value
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

function positiveIntegerValue(value: unknown): number | null {
  const parsed = numberValue(value, 0);
  return parsed > 0 ? Math.round(parsed) : null;
}

function chapterBreakdownTargetWordCounts(
  chapter: Chapter,
  sceneRecords: Record<string, unknown>[],
  existingScenes: Array<{ targetWordCount: number | null }>
): Array<number | null> {
  const proposedCounts = sceneRecords.map((scene) =>
    positiveIntegerValue(scene.targetWordCount)
  );
  const chapterTarget = positiveIntegerValue(chapter.targetWordCount);
  if (!chapterTarget || sceneRecords.length === 0) {
    return proposedCounts;
  }

  const existingTargetTotal = existingScenes.reduce(
    (sum, scene) => sum + (positiveIntegerValue(scene.targetWordCount) ?? 0),
    0
  );
  const availableTarget = Math.max(0, chapterTarget - existingTargetTotal);
  if (availableTarget <= 0) {
    return proposedCounts;
  }

  const knownCounts = proposedCounts.filter((count): count is number => count !== null);
  const fallbackWeight = knownCounts.length
    ? knownCounts.reduce((sum, count) => sum + count, 0) / knownCounts.length
    : 1;
  const weights = proposedCounts.map((count) => count ?? fallbackWeight);

  return distributeWordCount(availableTarget, weights).map((count) =>
    count > 0 ? count : null
  );
}

function distributeWordCount(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) {
    return [];
  }

  const safeWeights = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 1
  );
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const rawCounts = safeWeights.map((weight) => (total * weight) / totalWeight);
  const counts = rawCounts.map((count) => Math.floor(count));
  let remainder = total - counts.reduce((sum, count) => sum + count, 0);
  const indexesByRemainder = rawCounts
    .map((count, index) => ({ index, remainder: count - Math.floor(count) }))
    .sort((left, right) => right.remainder - left.remainder);

  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    counts[indexesByRemainder[index % indexesByRemainder.length].index] += 1;
  }

  return counts;
}

function namesToIds<T extends { id: string; name?: string; workingTitle?: string }>(
  items: T[],
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => textValue(item))
    .filter(Boolean)
    .map((item) => findByNameOrId(items, item)?.id)
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

function uniqueOrderedIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function emptyApplyResult(): ApplyPlanProposalResult {
  return { createdScenes: [] };
}

function createdSceneForAudit(
  sceneId: string,
  scene: UpsertSceneInput,
  chapter: Chapter,
  extra: { handledBeatOrDuty?: string; storyBibleNeeds?: unknown } = {}
): CreatedSceneForAudit {
  return {
    id: sceneId,
    title: scene.title || "Nowa scena",
    chapterId: scene.chapterId ?? null,
    analysisText: renderScenePlanAnalysisTextForAudit(scene, chapter, extra)
  };
}

function renderScenePlanAnalysisTextForAudit(
  scene: UpsertSceneInput,
  chapter: Chapter,
  extra: { handledBeatOrDuty?: string; storyBibleNeeds?: unknown }
): string {
  return [
    `Rozdział: ${chapter.workingTitle || "Bez tytułu"}`,
    `Scena: ${scene.title || "Nowa scena"}`,
    `Streszczenie: ${scene.summary || "(brak)"}`,
    `Cel: ${scene.goal || "(brak)"}`,
    `Konflikt: ${scene.conflict || "(brak)"}`,
    `Wynik: ${scene.outcome || "(brak)"}`,
    `Docelowa liczba słów: ${scene.targetWordCount ?? "(brak)"}`,
    extra.handledBeatOrDuty ? `Obsługiwany beat lub obowiązek: ${extra.handledBeatOrDuty}` : "",
    storyBibleNeedsText(extra.storyBibleNeeds)
  ]
    .filter(Boolean)
    .join("\n");
}

function storyBibleNeedsText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  const items = value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }

      const record = item as Record<string, unknown>;
      const kind = textValue(record.kind);
      const label = textValue(record.label);
      const reason = textValue(record.reason);
      return [kind, label, reason].filter(Boolean).join(" / ");
    })
    .filter(Boolean);

  return items.length ? `Potrzeby Story Bible: ${items.join("; ")}` : "";
}
