import type {
  AcceptGeneratedBookCoverInput,
  AcceptGeneratedCharacterImageInput,
  Act,
  AiLogEntry,
  AiRunResult,
  Beat,
  Book,
  BookCoverResult,
  BookConceptInput,
  BookPlan,
  Chapter,
  Character,
  CharacterImageResult,
  CharacterMemory,
  CharacterMemoryLink,
  CharacterRelation,
  CharacterWorkspace,
  CodexCliStatus,
  CodexModelCatalog,
  CreateProjectInput,
  GenerateBookCoverInput,
  GenerateCharacterImageInput,
  GenerateNewProjectTitleRequest,
  MoveBeatToChapterInput,
  PlotThread,
  Project,
  ProjectDetails,
  ProjectSummary,
  ReorderPlanItemsInput,
  RunCodexPromptRequest,
  SaveStoryStructureInput,
  SetWorldElementRelationsInput,
  SetWorldRuleRelationsInput,
  StoryStructure,
  UpsertActInput,
  UpsertBeatInput,
  UpsertChapterInput,
  UpsertChapterThreadInput,
  UpsertCharacterInput,
  UpsertCharacterMemoryInput,
  UpsertCharacterMemoryLinkInput,
  UpsertCharacterRelationInput,
  UpsertPlotThreadInput,
  UpsertWorldElementInput,
  UpsertWorldRuleInput,
  VisualAsset,
  WorldElement,
  WorldRule,
  WorldWorkspace
} from "./types";

const STORAGE_KEY = "storyforge2.browserPreview.projects";

type BrowserPreviewState = {
  projects: ProjectDetails[];
  aiRuns: AiLogEntry[];
  plans: Record<string, BookPlan>;
  characterWorkspaces: Record<string, CharacterWorkspace>;
  worldWorkspaces: Record<string, WorldWorkspace>;
};

let memoryState: BrowserPreviewState = {
  projects: [],
  aiRuns: [],
  plans: {},
  characterWorkspaces: {},
  worldWorkspaces: {}
};

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return "__TAURI_INTERNALS__" in window;
}

export async function browserCreateProject(
  input: CreateProjectInput
): Promise<ProjectDetails> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name cannot be empty.");
  }

  const state = readState();
  const now = new Date().toISOString();
  const projectId = createId();
  const bookId = createId();

  const project: Project = {
    id: projectId,
    name,
    language: input.language ?? "pl",
    createdAt: now,
    updatedAt: now,
    activeBookId: bookId,
    settingsJson: "{}"
  };

  const book: Book = {
    id: bookId,
    projectId,
    title: "",
    workingTitle: name,
    premise: "",
    protagonistSummary: "",
    protagonistGoal: "",
    expandedPremise: "",
    logline: "",
    centralConflict: "",
    antagonistForce: "",
    stakes: "",
    settingSketch: "",
    endingDirection: "",
    genre: "",
    subgenre: "",
    targetAudience: "",
    tone: "",
    styleGuide: "",
    pointOfView: "",
    targetWordCount: null,
    themesJson: "[]",
    unwantedThemes: "",
    alternativeTitlesJson: "[]",
    coverImagePath: "",
    coverPrompt: "",
    coverNegativePrompt: "",
    coverGeneratedAt: null,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };

  const details = { project, book };
  state.projects.unshift(details);
  writeState(state);
  return details;
}

export async function browserListProjects(): Promise<ProjectSummary[]> {
  return readState()
    .projects.map(({ project, book }) => ({
      id: project.id,
      name: project.name,
      language: project.language,
      updatedAt: project.updatedAt,
      activeBookId: project.activeBookId,
      workingTitle: book.workingTitle,
      coverImagePath: book.coverImagePath ?? ""
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function browserGetProject(
  projectId: string
): Promise<ProjectDetails> {
  const details = readState().projects.find(
    ({ project }) => project.id === projectId
  );

  if (!details) {
    throw new Error("Project not found in browser preview storage.");
  }

  return normalizeDetails(details);
}

export async function browserGetBookPlan(bookId: string): Promise<BookPlan> {
  const state = readState();
  return normalizePlan(state.plans[bookId]);
}

export async function browserGetCharacterWorkspace(
  projectId: string
): Promise<CharacterWorkspace> {
  const state = readState();
  return normalizeCharacterWorkspace(state.characterWorkspaces[projectId]);
}

export async function browserGetWorldWorkspace(
  projectId: string
): Promise<WorldWorkspace> {
  const state = readState();
  return normalizeWorldWorkspace(state.worldWorkspaces[projectId]);
}

export async function browserSaveStoryStructure(
  input: SaveStoryStructureInput
): Promise<StoryStructure> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const structure: StoryStructure = {
    id: input.id ?? plan.structure?.id ?? createId(),
    bookId: input.bookId,
    structureType: input.structureType,
    description: input.description,
    notes: input.notes,
    status: input.status ?? plan.structure?.status ?? "draft",
    createdAt: plan.structure?.createdAt ?? now,
    updatedAt: now
  };
  plan.structure = structure;
  touchBook(state, input.bookId, now);
  writeState(state);
  return structure;
}

export async function browserUpsertAct(input: UpsertActInput): Promise<Act> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const existing = input.id
    ? plan.acts.find((item) => item.id === input.id)
    : undefined;
  const act: Act = {
    id: existing?.id ?? input.id ?? createId(),
    bookId: input.bookId,
    name: input.name,
    purpose: input.purpose,
    summary: input.summary,
    startPercent: input.startPercent,
    endPercent: input.endPercent,
    orderIndex: input.orderIndex,
    color: input.color,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  plan.acts = upsertById(plan.acts, act);
  touchBook(state, input.bookId, now);
  writeState(state);
  return act;
}

export async function browserDeleteAct(id: string): Promise<void> {
  const state = readState();
  for (const plan of Object.values(state.plans)) {
    plan.acts = plan.acts.filter((item) => item.id !== id);
    plan.chapters = plan.chapters.map((item) =>
      item.actId === id ? { ...item, actId: null } : item
    );
  }
  writeState(state);
}

export async function browserUpsertBeat(input: UpsertBeatInput): Promise<Beat> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const existing = input.id
    ? plan.beats.find((item) => item.id === input.id)
    : undefined;
  const beat: Beat = {
    id: existing?.id ?? input.id ?? createId(),
    bookId: input.bookId,
    name: input.name,
    description: input.description,
    role: input.role,
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  plan.beats = upsertById(plan.beats, beat);
  touchBook(state, input.bookId, now);
  writeState(state);
  return beat;
}

export async function browserMoveBeatToChapter(
  input: MoveBeatToChapterInput
): Promise<void> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const beat = plan.beats.find((item) => item.id === input.beatId);

  if (!beat) {
    throw new Error("Nie znaleziono beatu.");
  }

  if (
    input.chapterId &&
    !plan.chapters.some((chapter) => chapter.id === input.chapterId)
  ) {
    throw new Error("Nie znaleziono rozdziału.");
  }

  plan.beats = plan.beats.map((item) =>
    item.id === input.beatId
      ? { ...item, orderIndex: input.orderIndex, updatedAt: now }
      : item
  );
  plan.chapterBeats = [
    ...plan.chapterBeats.filter((item) => item.beatId !== input.beatId),
    ...(input.chapterId ? [{ chapterId: input.chapterId, beatId: input.beatId }] : [])
  ];
  touchBook(state, input.bookId, now);
  writeState(state);
}

export async function browserDeleteBeat(id: string): Promise<void> {
  const state = readState();
  for (const plan of Object.values(state.plans)) {
    plan.beats = plan.beats.filter((item) => item.id !== id);
    plan.chapterBeats = plan.chapterBeats.filter((item) => item.beatId !== id);
  }
  writeState(state);
}

export async function browserUpsertPlotThread(
  input: UpsertPlotThreadInput
): Promise<PlotThread> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const existing = input.id
    ? plan.threads.find((item) => item.id === input.id)
    : undefined;
  const thread: PlotThread = {
    id: existing?.id ?? input.id ?? createId(),
    bookId: input.bookId,
    name: input.name,
    description: input.description,
    color: input.color,
    status: input.status,
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  plan.threads = upsertById(plan.threads, thread);
  touchBook(state, input.bookId, now);
  writeState(state);
  return thread;
}

export async function browserDeletePlotThread(id: string): Promise<void> {
  const state = readState();
  for (const plan of Object.values(state.plans)) {
    plan.threads = plan.threads.filter((item) => item.id !== id);
    plan.chapterThreads = plan.chapterThreads.filter((item) => item.threadId !== id);
  }
  writeState(state);
}

export async function browserUpsertChapter(
  input: UpsertChapterInput
): Promise<Chapter> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();
  const existing = input.id
    ? plan.chapters.find((item) => item.id === input.id)
    : undefined;
  const chapter: Chapter = {
    id: existing?.id ?? input.id ?? createId(),
    bookId: input.bookId,
    actId: input.actId ?? null,
    number: input.number,
    workingTitle: input.workingTitle,
    summary: input.summary,
    purpose: input.purpose,
    conflict: input.conflict,
    turningPoint: input.turningPoint,
    targetWordCount: input.targetWordCount ?? null,
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  plan.chapters = upsertById(plan.chapters, chapter);
  plan.chapterThreads = [
    ...plan.chapterThreads.filter((item) => item.chapterId !== chapter.id),
    ...uniqueIds(input.threadIds).map((threadId) => ({
      chapterId: chapter.id,
      threadId,
      description:
        plan.chapterThreads.find(
          (item) => item.chapterId === chapter.id && item.threadId === threadId
        )?.description ?? ""
    }))
  ];
  const beatIds = uniqueIds(input.beatIds);
  const beatIdSet = new Set(beatIds);
  plan.chapterBeats = [
    ...plan.chapterBeats.filter(
      (item) => item.chapterId !== chapter.id && !beatIdSet.has(item.beatId)
    ),
    ...beatIds.map((beatId) => ({
      chapterId: chapter.id,
      beatId
    }))
  ];
  touchBook(state, input.bookId, now);
  writeState(state);
  return chapter;
}

export async function browserUpsertChapterThreadRelation(
  input: UpsertChapterThreadInput
): Promise<void> {
  const state = readState();
  const plan = ensurePlan(state, input.bookId);
  const now = new Date().toISOString();

  if (!plan.chapters.some((chapter) => chapter.id === input.chapterId)) {
    throw new Error("Nie znaleziono rozdzialu.");
  }

  if (!plan.threads.some((thread) => thread.id === input.threadId)) {
    throw new Error("Nie znaleziono watku.");
  }

  plan.chapterThreads = [
    ...plan.chapterThreads.filter(
      (item) => item.chapterId !== input.chapterId || item.threadId !== input.threadId
    ),
    {
      chapterId: input.chapterId,
      threadId: input.threadId,
      description: input.description
    }
  ];
  touchBook(state, input.bookId, now);
  writeState(state);
}

export async function browserDeleteChapter(id: string): Promise<void> {
  const state = readState();
  for (const plan of Object.values(state.plans)) {
    plan.chapters = plan.chapters.filter((item) => item.id !== id);
    plan.chapterThreads = plan.chapterThreads.filter((item) => item.chapterId !== id);
    plan.chapterBeats = plan.chapterBeats.filter((item) => item.chapterId !== id);
  }
  writeState(state);
}

export async function browserUpsertCharacter(
  input: UpsertCharacterInput
): Promise<Character> {
  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  const existing = input.id
    ? workspace.characters.find((item) => item.id === input.id)
    : undefined;
  const character: Character = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    characterType: input.characterType || "person",
    name: input.name,
    aliasesJson: normalizeJsonList(input.aliasesJson),
    role: input.role,
    shortDescription: input.shortDescription,
    externalGoal: input.externalGoal,
    internalNeed: input.internalNeed,
    wound: input.wound,
    falseBelief: input.falseBelief,
    secret: input.secret,
    strengthsJson: normalizeJsonList(input.strengthsJson),
    weaknessesJson: normalizeJsonList(input.weaknessesJson),
    voiceNotes: input.voiceNotes,
    arcSummary: input.arcSummary,
    knowledgeNotes: input.knowledgeNotes,
    visualPrompt: input.visualPrompt,
    imageAssetId: input.imageAssetId ?? existing?.imageAssetId ?? null,
    status: input.status || "draft",
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.characters = upsertById(workspace.characters, character);
  touchProject(state, input.projectId, now);
  writeState(state);
  return character;
}

export async function browserDeleteCharacter(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.characterWorkspaces)) {
    const memoryIds = new Set(
      workspace.memories
        .filter((memory) => memory.characterId === id)
        .map((memory) => memory.id)
    );
    workspace.characters = workspace.characters.filter((item) => item.id !== id);
    workspace.relations = workspace.relations.filter(
      (item) => item.fromCharacterId !== id && item.toCharacterId !== id
    );
    workspace.memories = workspace.memories.filter((item) => item.characterId !== id);
    workspace.memoryLinks = workspace.memoryLinks.filter(
      (item) => !memoryIds.has(item.fromMemoryId) && !memoryIds.has(item.toMemoryId)
    );
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserUpsertCharacterRelation(
  input: UpsertCharacterRelationInput
): Promise<CharacterRelation> {
  if (input.fromCharacterId === input.toCharacterId) {
    throw new Error("Relacja wymaga dwoch roznych postaci.");
  }

  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  if (!workspace.characters.some((item) => item.id === input.fromCharacterId)) {
    throw new Error("Nie znaleziono pierwszej postaci relacji.");
  }
  if (!workspace.characters.some((item) => item.id === input.toCharacterId)) {
    throw new Error("Nie znaleziono drugiej postaci relacji.");
  }

  const existing = input.id
    ? workspace.relations.find((item) => item.id === input.id)
    : workspace.relations.find(
        (item) =>
          item.fromCharacterId === input.fromCharacterId &&
          item.toCharacterId === input.toCharacterId &&
          item.relationType === input.relationType
      );
  const relation: CharacterRelation = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    fromCharacterId: input.fromCharacterId,
    toCharacterId: input.toCharacterId,
    relationType: input.relationType || "other",
    description: input.description,
    history: input.history,
    conflict: input.conflict,
    opinion: input.opinion,
    trustLevel: clampNumber(input.trustLevel, 0, 100),
    secret: input.secret,
    changeOverTime: input.changeOverTime,
    status: input.status || "draft",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.relations = upsertById(workspace.relations, relation);
  touchProject(state, input.projectId, now);
  writeState(state);
  return relation;
}

export async function browserDeleteCharacterRelation(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.characterWorkspaces)) {
    workspace.relations = workspace.relations.filter((item) => item.id !== id);
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserUpsertCharacterMemory(
  input: UpsertCharacterMemoryInput
): Promise<CharacterMemory> {
  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  if (!workspace.characters.some((item) => item.id === input.characterId)) {
    throw new Error("Nie znaleziono postaci dla wspomnienia.");
  }
  const existing = input.id
    ? workspace.memories.find((item) => item.id === input.id)
    : undefined;
  const memory: CharacterMemory = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    characterId: input.characterId,
    title: input.title,
    summary: input.summary,
    details: input.details,
    memoryType: input.memoryType || "event",
    subject: input.subject,
    emotion: input.emotion,
    importance: clampNumber(input.importance, 0, 100),
    status: input.status || "draft",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.memories = upsertById(workspace.memories, memory);
  touchProject(state, input.projectId, now);
  writeState(state);
  return memory;
}

export async function browserDeleteCharacterMemory(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.characterWorkspaces)) {
    workspace.memories = workspace.memories.filter((item) => item.id !== id);
    workspace.memoryLinks = workspace.memoryLinks.filter(
      (item) => item.fromMemoryId !== id && item.toMemoryId !== id
    );
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserUpsertCharacterMemoryLink(
  input: UpsertCharacterMemoryLinkInput
): Promise<CharacterMemoryLink> {
  if (input.fromMemoryId === input.toMemoryId) {
    throw new Error("Polaczenie wymaga dwoch roznych wspomnien.");
  }

  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  if (!workspace.memories.some((item) => item.id === input.fromMemoryId)) {
    throw new Error("Nie znaleziono pierwszego wspomnienia.");
  }
  if (!workspace.memories.some((item) => item.id === input.toMemoryId)) {
    throw new Error("Nie znaleziono drugiego wspomnienia.");
  }
  const existing = input.id
    ? workspace.memoryLinks.find((item) => item.id === input.id)
    : workspace.memoryLinks.find(
        (item) =>
          item.fromMemoryId === input.fromMemoryId &&
          item.toMemoryId === input.toMemoryId &&
          item.linkType === input.linkType
      );
  const link: CharacterMemoryLink = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    fromMemoryId: input.fromMemoryId,
    toMemoryId: input.toMemoryId,
    linkType: input.linkType || "association",
    description: input.description,
    strength: clampNumber(input.strength, 0, 100),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.memoryLinks = upsertById(workspace.memoryLinks, link);
  touchProject(state, input.projectId, now);
  writeState(state);
  return link;
}

export async function browserDeleteCharacterMemoryLink(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.characterWorkspaces)) {
    workspace.memoryLinks = workspace.memoryLinks.filter((item) => item.id !== id);
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserUpsertWorldElement(
  input: UpsertWorldElementInput
): Promise<WorldElement> {
  const state = readState();
  const workspace = ensureWorldWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  const existing = input.id
    ? workspace.elements.find((item) => item.id === input.id)
    : undefined;
  const element: WorldElement = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    elementType: input.elementType || "location",
    name: input.name,
    summary: input.summary,
    details: input.details,
    storyPurpose: input.storyPurpose,
    constraints: input.constraints,
    visualPrompt: input.visualPrompt,
    imageAssetId: input.imageAssetId ?? existing?.imageAssetId ?? null,
    status: input.status || "draft",
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.elements = upsertById(workspace.elements, element);
  touchProject(state, input.projectId, now);
  writeState(state);
  return element;
}

export async function browserDeleteWorldElement(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.worldWorkspaces)) {
    workspace.elements = workspace.elements.filter((item) => item.id !== id);
    workspace.elementCharacters = workspace.elementCharacters.filter((item) => item.elementId !== id);
    workspace.elementThreads = workspace.elementThreads.filter((item) => item.elementId !== id);
    workspace.elementChapters = workspace.elementChapters.filter((item) => item.elementId !== id);
    workspace.elementRules = workspace.elementRules.filter((item) => item.elementId !== id);
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserUpsertWorldRule(
  input: UpsertWorldRuleInput
): Promise<WorldRule> {
  const state = readState();
  const workspace = ensureWorldWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  const existing = input.id
    ? workspace.rules.find((item) => item.id === input.id)
    : undefined;
  const rule: WorldRule = {
    id: existing?.id ?? input.id ?? createId(),
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    scope: input.scope,
    cost: input.cost,
    limitation: input.limitation,
    exceptions: input.exceptions,
    violationConsequences: input.violationConsequences,
    sceneExamples: input.sceneExamples,
    status: input.status || "draft",
    orderIndex: input.orderIndex,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  workspace.rules = upsertById(workspace.rules, rule);
  touchProject(state, input.projectId, now);
  writeState(state);
  return rule;
}

export async function browserDeleteWorldRule(id: string): Promise<void> {
  const state = readState();
  const now = new Date().toISOString();
  for (const [projectId, workspace] of Object.entries(state.worldWorkspaces)) {
    workspace.rules = workspace.rules.filter((item) => item.id !== id);
    workspace.elementRules = workspace.elementRules.filter((item) => item.ruleId !== id);
    workspace.ruleThreads = workspace.ruleThreads.filter((item) => item.ruleId !== id);
    workspace.ruleChapters = workspace.ruleChapters.filter((item) => item.ruleId !== id);
    touchProject(state, projectId, now);
  }
  writeState(state);
}

export async function browserSetWorldElementRelations(
  input: SetWorldElementRelationsInput
): Promise<void> {
  const state = readState();
  const workspace = ensureWorldWorkspace(state, input.projectId);
  const elementId = input.elementId;
  workspace.elementCharacters = [
    ...workspace.elementCharacters.filter((item) => item.elementId !== elementId),
    ...uniqueIds(input.characterIds).map((characterId) => ({ elementId, characterId }))
  ];
  workspace.elementThreads = [
    ...workspace.elementThreads.filter((item) => item.elementId !== elementId),
    ...uniqueIds(input.threadIds).map((threadId) => ({ elementId, threadId }))
  ];
  workspace.elementChapters = [
    ...workspace.elementChapters.filter((item) => item.elementId !== elementId),
    ...uniqueIds(input.chapterIds).map((chapterId) => ({ elementId, chapterId }))
  ];
  workspace.elementRules = [
    ...workspace.elementRules.filter((item) => item.elementId !== elementId),
    ...uniqueIds(input.ruleIds).map((ruleId) => ({ elementId, ruleId }))
  ];
  touchProject(state, input.projectId, new Date().toISOString());
  writeState(state);
}

export async function browserSetWorldRuleRelations(
  input: SetWorldRuleRelationsInput
): Promise<void> {
  const state = readState();
  const workspace = ensureWorldWorkspace(state, input.projectId);
  const ruleId = input.ruleId;
  workspace.elementRules = [
    ...workspace.elementRules.filter((item) => item.ruleId !== ruleId),
    ...uniqueIds(input.elementIds).map((elementId) => ({ elementId, ruleId }))
  ];
  workspace.ruleThreads = [
    ...workspace.ruleThreads.filter((item) => item.ruleId !== ruleId),
    ...uniqueIds(input.threadIds).map((threadId) => ({ ruleId, threadId }))
  ];
  workspace.ruleChapters = [
    ...workspace.ruleChapters.filter((item) => item.ruleId !== ruleId),
    ...uniqueIds(input.chapterIds).map((chapterId) => ({ ruleId, chapterId }))
  ];
  touchProject(state, input.projectId, new Date().toISOString());
  writeState(state);
}

export async function browserReorderPlanItems(
  input: ReorderPlanItemsInput
): Promise<void> {
  const state = readState();
  const ids = new Map(input.orderedIds.map((id, index) => [id, index]));
  for (const plan of Object.values(state.plans)) {
    if (input.itemType === "acts") {
      plan.acts = plan.acts.map((item) => reorderItem(item, ids));
    }
    if (input.itemType === "beats") {
      plan.beats = plan.beats.map((item) => reorderItem(item, ids));
    }
    if (input.itemType === "threads") {
      plan.threads = plan.threads.map((item) => reorderItem(item, ids));
    }
    if (input.itemType === "chapters") {
      plan.chapters = plan.chapters.map((item) => reorderItem(item, ids));
    }
  }
  writeState(state);
}

export async function browserListAiRuns(projectId: string): Promise<AiLogEntry[]> {
  return readState()
    .aiRuns.filter((run) => run.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function browserUpdateBookConcept(
  bookId: string,
  input: BookConceptInput
): Promise<Book> {
  const state = readState();
  const details = state.projects.find(({ book }) => book.id === bookId);

  if (!details) {
    throw new Error("Book not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  details.book = {
    ...details.book,
    ...definedOnly(input),
    updatedAt: now
  };
  details.project = {
    ...details.project,
    updatedAt: now
  };

  writeState(state);
  return details.book;
}

export async function browserCheckCodexCli(
  codexPath?: string
): Promise<CodexCliStatus> {
  return {
    available: false,
    path: codexPath || "codex",
    authLikelyReady: null,
    message:
      "Podgląd Vite działa bez backendu Tauri. Uruchom aplikację desktopową, aby sprawdzić Codex CLI."
  };
}

export async function browserListCodexModels(
  _codexPath?: string
): Promise<CodexModelCatalog> {
  return {
    fallback: true,
    models: [
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningLevel: "medium",
        supportedReasoningLevels: [
          { effort: "low", description: "Szybciej, mniej planowania" },
          { effort: "medium", description: "Dobry balans" },
          { effort: "high", description: "Glebsze rozumowanie" },
          { effort: "xhigh", description: "Najglebsze rozumowanie" }
        ]
      }
    ],
    errorMessage:
      "Podgląd Vite nie może odczytać katalogu modeli Codex CLI bez backendu Tauri."
  };
}

export async function browserRunCodexPrompt(
  request: RunCodexPromptRequest
): Promise<AiRunResult> {
  const now = new Date().toISOString();
  const id = createId();
  const errorMessage =
    "Podgląd Vite nie może uruchomić codex exec. Użyj aplikacji Tauri desktop.";

  appendAiRun({
    id,
    projectId: request.projectId,
    providerId: "codex-cli-bridge",
    model: request.model ?? "",
    reasoningEffort: request.reasoningEffort ?? "",
    action: request.action,
    promptPackageJson: request.promptPackageJson,
    prompt: request.prompt,
    rawOutput: null,
    status: "error",
    errorMessage,
    createdAt: now,
    completedAt: now
  });

  return {
    id,
    providerId: "codex-cli-bridge",
    promptPackageId: request.promptPackageId,
    action: request.action,
    status: "error",
    rawOutput: null,
    errorMessage,
    durationMs: 0
  };
}

export async function browserGenerateNewProjectTitle(
  request: GenerateNewProjectTitleRequest
): Promise<AiRunResult> {
  const seedTitle = extractSeedTitle(request.promptPackageJson);
  const value = seedTitle
    ? `Sekret ${seedTitle}`
    : "Sekret Trzeciego Dnia";

  return {
    id: createId(),
    providerId: "codex-cli-bridge",
    promptPackageId: request.promptPackageId,
    action: request.action,
    status: "success",
    rawOutput: JSON.stringify({
      version: 1,
      kind: "concept_field_suggestion",
      field: "workingTitle",
      summary: value,
      value,
      values: [],
      rationale: "Browser preview generated a deterministic title.",
      warnings: []
    }),
    durationMs: 0
  };
}

function extractSeedTitle(promptPackageJson: unknown): string {
  if (
    promptPackageJson &&
    typeof promptPackageJson === "object" &&
    "context" in promptPackageJson
  ) {
    const context = (promptPackageJson as { context?: { seedTitle?: unknown } })
      .context;
    if (typeof context?.seedTitle === "string") {
      return context.seedTitle.trim();
    }
  }

  return "";
}

export async function browserGenerateBookCover(
  input: GenerateBookCoverInput
): Promise<BookCoverResult> {
  const state = readState();
  const details = state.projects.find(
    ({ project, book }) => project.id === input.projectId && book.id === input.bookId
  );

  if (!details) {
    throw new Error("Book not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  const aiRunId = createId();
  const imagePath = createCoverDataUrl(
    details.book.workingTitle || details.project.name,
    input.coverPrompt
  );

  const rawOutput = JSON.stringify({
    version: 1,
    kind: "book_cover_image",
    imagePath,
    warnings: ["Browser preview generated a local placeholder data URL."]
  });

  appendAiRun({
    id: aiRunId,
    projectId: input.projectId,
    providerId: "codex-cli-bridge",
    model: input.model ?? "",
    reasoningEffort: input.reasoningEffort ?? "",
    action: "generate_cover_image",
    promptPackageJson: input.promptPackageJson,
    prompt: input.prompt,
    rawOutput,
    status: "success",
    errorMessage: null,
    createdAt: now,
    completedAt: now
  });

  return {
    book: details.book,
    aiRun: {
      id: aiRunId,
      providerId: "codex-cli-bridge",
      promptPackageId: input.promptPackageId,
      action: "generate_cover_image",
      status: "success",
      rawOutput,
      durationMs: 0
    },
    imagePath,
    prompt: input.coverPrompt,
    negativePrompt: input.coverNegativePrompt,
    generatedAt: now
  };
}

export async function browserAcceptGeneratedBookCover(
  input: AcceptGeneratedBookCoverInput
): Promise<Book> {
  const state = readState();
  const details = state.projects.find(({ book }) => book.id === input.bookId);

  if (!details) {
    throw new Error("Book not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  details.book = {
    ...details.book,
    coverImagePath: input.imagePath,
    coverPrompt: input.coverPrompt,
    coverNegativePrompt: input.coverNegativePrompt,
    coverGeneratedAt: input.generatedAt,
    updatedAt: now
  };
  details.project = {
    ...details.project,
    updatedAt: now
  };

  writeState(state);
  return details.book;
}

export async function browserGenerateCharacterImage(
  input: GenerateCharacterImageInput
): Promise<CharacterImageResult> {
  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const character = workspace.characters.find((item) => item.id === input.characterId);
  if (!character) {
    throw new Error("Character not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  const aiRunId = createId();
  const imagePath = createCharacterDataUrl(character.name || "Postac", input.imagePrompt);
  const asset: VisualAsset = {
    id: createId(),
    projectId: input.projectId,
    relatedType: "character",
    relatedId: input.characterId,
    assetType: "image",
    title: character.name,
    prompt: input.imagePrompt,
    negativePrompt: input.negativePrompt,
    filePath: imagePath,
    source: "ai",
    status: "proposed",
    createdAt: now,
    updatedAt: now
  };
  const rawOutput = JSON.stringify({
    version: 1,
    kind: "character_image",
    imagePath,
    warnings: ["Browser preview generated a local placeholder data URL."]
  });

  appendAiRun({
    id: aiRunId,
    projectId: input.projectId,
    providerId: "codex-cli-bridge",
    model: input.model ?? "",
    reasoningEffort: input.reasoningEffort ?? "",
    action: "generate_character_image",
    promptPackageJson: input.promptPackageJson,
    prompt: input.prompt,
    rawOutput,
    status: "success",
    errorMessage: null,
    createdAt: now,
    completedAt: now
  });

  return {
    character,
    visualAsset: asset,
    aiRun: {
      id: aiRunId,
      providerId: "codex-cli-bridge",
      promptPackageId: input.promptPackageId,
      action: "generate_character_image",
      status: "success",
      rawOutput,
      durationMs: 0
    },
    imagePath,
    prompt: input.imagePrompt,
    negativePrompt: input.negativePrompt,
    generatedAt: now
  };
}

export async function browserAcceptGeneratedCharacterImage(
  input: AcceptGeneratedCharacterImageInput
): Promise<CharacterImageResult> {
  const state = readState();
  const workspace = ensureCharacterWorkspace(state, input.projectId);
  const now = new Date().toISOString();
  const character = workspace.characters.find((item) => item.id === input.characterId);
  if (!character) {
    throw new Error("Character not found in browser preview storage.");
  }

  const asset: VisualAsset = {
    id: createId(),
    projectId: input.projectId,
    relatedType: "character",
    relatedId: input.characterId,
    assetType: "image",
    title: character.name,
    prompt: input.imagePrompt,
    negativePrompt: input.negativePrompt,
    filePath: input.imagePath,
    source: "ai",
    status: "canon",
    createdAt: now,
    updatedAt: now
  };
  workspace.visualAssets = upsertById(workspace.visualAssets, asset);
  const updatedCharacter = {
    ...character,
    imageAssetId: asset.id,
    visualPrompt: input.imagePrompt,
    updatedAt: now
  };
  workspace.characters = upsertById(workspace.characters, updatedCharacter);
  touchProject(state, input.projectId, now);
  writeState(state);

  return {
    character: updatedCharacter,
    visualAsset: asset,
    aiRun: {
      id: createId(),
      providerId: "browser-preview",
      promptPackageId: "accepted-character-image",
      action: "generate_character_image",
      status: "success",
      rawOutput: null,
      durationMs: 0
    },
    imagePath: input.imagePath,
    prompt: input.imagePrompt,
    negativePrompt: input.negativePrompt,
    generatedAt: input.generatedAt
  };
}

function readState(): BrowserPreviewState {
  if (typeof window === "undefined") {
    return memoryState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { projects: [], aiRuns: [], plans: {}, characterWorkspaces: {}, worldWorkspaces: {} };
    }

    const parsed = JSON.parse(raw) as BrowserPreviewState;
    return Array.isArray(parsed.projects)
      ? {
          projects: parsed.projects,
          aiRuns: Array.isArray(parsed.aiRuns)
            ? parsed.aiRuns.map((run) => ({
                ...run,
                model: run.model ?? "",
                reasoningEffort: run.reasoningEffort ?? ""
              }))
            : [],
          plans: normalizePlans(parsed.plans),
          characterWorkspaces: normalizeCharacterWorkspaces(parsed.characterWorkspaces),
          worldWorkspaces: normalizeWorldWorkspaces(parsed.worldWorkspaces)
        }
      : { projects: [], aiRuns: [], plans: {}, characterWorkspaces: {}, worldWorkspaces: {} };
  } catch {
    return memoryState;
  }
}

function writeState(state: BrowserPreviewState): void {
  memoryState = state;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    memoryState = state;
  }
}

function definedOnly(input: BookConceptInput): BookConceptInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as BookConceptInput;
}

function appendAiRun(entry: AiLogEntry): void {
  const state = readState();
  state.aiRuns.unshift(entry);
  writeState(state);
}

function ensurePlan(state: BrowserPreviewState, bookId: string): BookPlan {
  const plan = normalizePlan(state.plans[bookId]);
  state.plans[bookId] = plan;
  return plan;
}

function normalizePlans(plans: BrowserPreviewState["plans"] | undefined): Record<string, BookPlan> {
  if (!plans || typeof plans !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(plans).map(([bookId, plan]) => [bookId, normalizePlan(plan)])
  );
}

function normalizeCharacterWorkspaces(
  workspaces: BrowserPreviewState["characterWorkspaces"] | undefined
): Record<string, CharacterWorkspace> {
  if (!workspaces || typeof workspaces !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(workspaces).map(([projectId, workspace]) => [
      projectId,
      normalizeCharacterWorkspace(workspace)
    ])
  );
}

function normalizeWorldWorkspaces(
  workspaces: BrowserPreviewState["worldWorkspaces"] | undefined
): Record<string, WorldWorkspace> {
  if (!workspaces || typeof workspaces !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(workspaces).map(([projectId, workspace]) => [
      projectId,
      normalizeWorldWorkspace(workspace)
    ])
  );
}

function normalizePlan(plan: Partial<BookPlan> | undefined): BookPlan {
  return {
    structure: plan?.structure ?? null,
    acts: Array.isArray(plan?.acts) ? plan.acts : [],
    beats: Array.isArray(plan?.beats) ? plan.beats : [],
    threads: Array.isArray(plan?.threads) ? plan.threads : [],
    chapters: Array.isArray(plan?.chapters) ? plan.chapters : [],
    chapterThreads: Array.isArray(plan?.chapterThreads)
      ? plan.chapterThreads.map((relation) => ({
          ...relation,
          description: relation.description ?? ""
        }))
      : [],
    chapterBeats: Array.isArray(plan?.chapterBeats) ? plan.chapterBeats : []
  };
}

function normalizeCharacterWorkspace(
  workspace: Partial<CharacterWorkspace> | undefined
): CharacterWorkspace {
  return {
    characters: Array.isArray(workspace?.characters) ? workspace.characters : [],
    relations: Array.isArray(workspace?.relations) ? workspace.relations : [],
    memories: Array.isArray(workspace?.memories) ? workspace.memories : [],
    memoryLinks: Array.isArray(workspace?.memoryLinks) ? workspace.memoryLinks : [],
    visualAssets: Array.isArray(workspace?.visualAssets) ? workspace.visualAssets : []
  };
}

function normalizeWorldWorkspace(
  workspace: Partial<WorldWorkspace> | undefined
): WorldWorkspace {
  return {
    elements: Array.isArray(workspace?.elements) ? workspace.elements : [],
    rules: Array.isArray(workspace?.rules) ? workspace.rules : [],
    elementCharacters: Array.isArray(workspace?.elementCharacters) ? workspace.elementCharacters : [],
    elementThreads: Array.isArray(workspace?.elementThreads) ? workspace.elementThreads : [],
    elementChapters: Array.isArray(workspace?.elementChapters) ? workspace.elementChapters : [],
    elementRules: Array.isArray(workspace?.elementRules) ? workspace.elementRules : [],
    ruleThreads: Array.isArray(workspace?.ruleThreads) ? workspace.ruleThreads : [],
    ruleChapters: Array.isArray(workspace?.ruleChapters) ? workspace.ruleChapters : [],
    visualAssets: Array.isArray(workspace?.visualAssets) ? workspace.visualAssets : []
  };
}

function ensureCharacterWorkspace(
  state: BrowserPreviewState,
  projectId: string
): CharacterWorkspace {
  const workspace = normalizeCharacterWorkspace(state.characterWorkspaces[projectId]);
  state.characterWorkspaces[projectId] = workspace;
  return workspace;
}

function ensureWorldWorkspace(
  state: BrowserPreviewState,
  projectId: string
): WorldWorkspace {
  const workspace = normalizeWorldWorkspace(state.worldWorkspaces[projectId]);
  state.worldWorkspaces[projectId] = workspace;
  return workspace;
}

function upsertById<Item extends { id: string }>(items: Item[], nextItem: Item): Item[] {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) {
    return [...items, nextItem];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function reorderItem<Item extends { id: string; orderIndex: number }>(
  item: Item,
  orderedIds: Map<string, number>
): Item {
  const orderIndex = orderedIds.get(item.id);
  return orderIndex === undefined ? item : { ...item, orderIndex };
}

function touchBook(
  state: BrowserPreviewState,
  bookId: string,
  updatedAt: string
): void {
  const details = state.projects.find(({ book }) => book.id === bookId);
  if (!details) {
    return;
  }

  details.book = { ...details.book, updatedAt };
  details.project = { ...details.project, updatedAt };
}

function touchProject(
  state: BrowserPreviewState,
  projectId: string,
  updatedAt: string
): void {
  const details = state.projects.find(({ project }) => project.id === projectId);
  if (!details) {
    return;
  }

  details.project = { ...details.project, updatedAt };
  details.book = { ...details.book, updatedAt };
}

function normalizeDetails(details: ProjectDetails): ProjectDetails {
  return {
    project: details.project,
    book: {
      ...details.book,
      protagonistSummary: details.book.protagonistSummary ?? "",
      protagonistGoal: details.book.protagonistGoal ?? "",
      expandedPremise: details.book.expandedPremise ?? "",
      centralConflict: details.book.centralConflict ?? "",
      antagonistForce: details.book.antagonistForce ?? "",
      stakes: details.book.stakes ?? "",
      settingSketch: details.book.settingSketch ?? "",
      endingDirection: details.book.endingDirection ?? "",
      themesJson: details.book.themesJson ?? "[]",
      unwantedThemes: details.book.unwantedThemes ?? "",
      alternativeTitlesJson: details.book.alternativeTitlesJson ?? "[]",
      coverImagePath: details.book.coverImagePath ?? "",
      coverPrompt: details.book.coverPrompt ?? "",
      coverNegativePrompt: details.book.coverNegativePrompt ?? "",
      coverGeneratedAt: details.book.coverGeneratedAt ?? null
    }
  };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createCoverDataUrl(title: string, prompt: string): string {
  const safeTitle = escapeSvg(title || "Untitled");
  const safePrompt = escapeSvg(prompt.slice(0, 120));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#263c35"/><stop offset="0.55" stop-color="#a86f25"/><stop offset="1" stop-color="#f5f1e8"/></linearGradient></defs><rect width="800" height="1200" fill="url(#g)"/><rect x="54" y="54" width="692" height="1092" fill="none" stroke="#fffdf8" stroke-width="6" opacity=".75"/><circle cx="400" cy="420" r="170" fill="#fffdf8" opacity=".22"/><text x="400" y="850" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="#fffdf8" font-weight="700">${safeTitle}</text><text x="400" y="930" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="24" fill="#fffdf8" opacity=".78">${safePrompt}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createCharacterDataUrl(name: string, prompt: string): string {
  const safeName = escapeSvg(name || "Postac");
  const safePrompt = escapeSvg(prompt.slice(0, 140));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f8f6"/><stop offset=".5" stop-color="#dfe8df"/><stop offset="1" stop-color="#2f8067"/></linearGradient></defs><rect width="900" height="1100" fill="url(#g)"/><circle cx="450" cy="390" r="210" fill="#fffdf8" opacity=".74"/><path d="M260 850c42-156 118-234 190-234s148 78 190 234" fill="#24463e" opacity=".82"/><circle cx="450" cy="340" r="128" fill="#24463e" opacity=".88"/><text x="450" y="940" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="58" fill="#fffdf8" font-weight="800">${safeName}</text><text x="450" y="1004" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="23" fill="#fffdf8" opacity=".78">${safePrompt}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeJsonList(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
  } catch {
    const items = value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return JSON.stringify([...new Set(items)]);
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
