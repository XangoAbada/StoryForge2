export type Project = {
  id: string;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  activeBookId: string | null;
  settingsJson: string;
};

export type Book = {
  id: string;
  projectId: string;
  title: string;
  workingTitle: string;
  premise: string;
  protagonistSummary: string;
  protagonistGoal: string;
  expandedPremise: string;
  logline: string;
  centralConflict: string;
  antagonistForce: string;
  stakes: string;
  settingSketch: string;
  endingDirection: string;
  genre: string;
  subgenre: string;
  targetAudience: string;
  tone: string;
  styleGuide: string;
  pointOfView: string;
  targetWordCount: number | null;
  themesJson: string;
  unwantedThemes: string;
  alternativeTitlesJson: string;
  coverImagePath: string;
  coverPrompt: string;
  coverNegativePrompt: string;
  coverGeneratedAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  language: string;
  updatedAt: string;
  activeBookId: string | null;
  workingTitle: string;
  coverImagePath: string;
};

export type ProjectDetails = {
  project: Project;
  book: Book;
};

export type StoryStructure = {
  id: string;
  bookId: string;
  structureType: string;
  description: string;
  notes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanVersion = {
  id: string;
  bookId: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Act = {
  id: string;
  bookId: string;
  name: string;
  purpose: string;
  summary: string;
  startPercent: number;
  endPercent: number;
  orderIndex: number;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type Beat = {
  id: string;
  bookId: string;
  name: string;
  description: string;
  role: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type PlotThread = {
  id: string;
  bookId: string;
  name: string;
  description: string;
  color: string;
  status: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type Chapter = {
  id: string;
  bookId: string;
  actId: string | null;
  number: number;
  workingTitle: string;
  summary: string;
  purpose: string;
  conflict: string;
  turningPoint: string;
  targetWordCount: number | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type ChapterThread = {
  chapterId: string;
  threadId: string;
  description: string;
};

export type ChapterBeat = {
  chapterId: string;
  beatId: string;
};

export type Scene = {
  id: string;
  bookId: string;
  planVersionId: string;
  chapterId: string | null;
  orderIndex: number;
  title: string;
  summary: string;
  goal: string;
  conflict: string;
  outcome: string;
  povCharacterId: string | null;
  locationId: string | null;
  targetWordCount: number | null;
  actualWordCount: number | null;
  manuscriptContent: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type SceneCharacter = {
  sceneId: string;
  characterId: string;
};

export type SceneThread = {
  sceneId: string;
  threadId: string;
};

export type SceneWorldElement = {
  sceneId: string;
  elementId: string;
};

export type SceneWorldRule = {
  sceneId: string;
  ruleId: string;
};

export type BookPlan = {
  planVersion: PlanVersion;
  planVersions: PlanVersion[];
  structure: StoryStructure | null;
  acts: Act[];
  beats: Beat[];
  threads: PlotThread[];
  chapters: Chapter[];
  chapterThreads: ChapterThread[];
  chapterBeats: ChapterBeat[];
  scenes: Scene[];
  sceneCharacters: SceneCharacter[];
  sceneThreads: SceneThread[];
  sceneWorldElements: SceneWorldElement[];
  sceneWorldRules: SceneWorldRule[];
};

export type VisualAsset = {
  id: string;
  projectId: string;
  relatedType: string;
  relatedId: string;
  assetType: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  filePath: string;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type Character = {
  id: string;
  projectId: string;
  characterType: string;
  name: string;
  aliasesJson: string;
  role: string;
  shortDescription: string;
  externalGoal: string;
  internalNeed: string;
  wound: string;
  falseBelief: string;
  secret: string;
  strengthsJson: string;
  weaknessesJson: string;
  voiceNotes: string;
  arcSummary: string;
  knowledgeNotes: string;
  visualPrompt: string;
  imageAssetId: string | null;
  status: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type CharacterRelation = {
  id: string;
  projectId: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationType: string;
  description: string;
  history: string;
  conflict: string;
  opinion: string;
  trustLevel: number;
  secret: string;
  changeOverTime: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CharacterMemory = {
  id: string;
  projectId: string;
  characterId: string;
  title: string;
  summary: string;
  details: string;
  memoryType: string;
  subject: string;
  emotion: string;
  importance: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CharacterMemoryLink = {
  id: string;
  projectId: string;
  fromMemoryId: string;
  toMemoryId: string;
  linkType: string;
  description: string;
  strength: number;
  createdAt: string;
  updatedAt: string;
};

export type CharacterWorkspace = {
  characters: Character[];
  relations: CharacterRelation[];
  memories: CharacterMemory[];
  memoryLinks: CharacterMemoryLink[];
  visualAssets: VisualAsset[];
};

export type WorldElement = {
  id: string;
  projectId: string;
  elementType: string;
  name: string;
  summary: string;
  details: string;
  storyPurpose: string;
  constraints: string;
  visualPrompt: string;
  imageAssetId: string | null;
  status: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type WorldRule = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  scope: string;
  cost: string;
  limitation: string;
  exceptions: string;
  violationConsequences: string;
  sceneExamples: string;
  status: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type WorldElementCharacter = {
  elementId: string;
  characterId: string;
};

export type WorldElementThread = {
  elementId: string;
  threadId: string;
};

export type WorldElementChapter = {
  elementId: string;
  chapterId: string;
};

export type WorldElementRule = {
  elementId: string;
  ruleId: string;
};

export type WorldRuleThread = {
  ruleId: string;
  threadId: string;
};

export type WorldRuleChapter = {
  ruleId: string;
  chapterId: string;
};

export type WorldWorkspace = {
  elements: WorldElement[];
  rules: WorldRule[];
  elementCharacters: WorldElementCharacter[];
  elementThreads: WorldElementThread[];
  elementChapters: WorldElementChapter[];
  elementScenes: SceneWorldElement[];
  elementRules: WorldElementRule[];
  ruleThreads: WorldRuleThread[];
  ruleChapters: WorldRuleChapter[];
  ruleScenes: SceneWorldRule[];
  visualAssets: VisualAsset[];
};

export type UpsertCharacterInput = {
  id?: string;
  projectId: string;
  characterType: string;
  name: string;
  aliasesJson: string;
  role: string;
  shortDescription: string;
  externalGoal: string;
  internalNeed: string;
  wound: string;
  falseBelief: string;
  secret: string;
  strengthsJson: string;
  weaknessesJson: string;
  voiceNotes: string;
  arcSummary: string;
  knowledgeNotes: string;
  visualPrompt: string;
  imageAssetId?: string | null;
  status: string;
  orderIndex: number;
};

export type UpsertCharacterRelationInput = {
  id?: string;
  projectId: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationType: string;
  description: string;
  history: string;
  conflict: string;
  opinion: string;
  trustLevel: number;
  secret: string;
  changeOverTime: string;
  status: string;
};

export type UpsertCharacterMemoryInput = {
  id?: string;
  projectId: string;
  characterId: string;
  title: string;
  summary: string;
  details: string;
  memoryType: string;
  subject: string;
  emotion: string;
  importance: number;
  status: string;
};

export type UpsertCharacterMemoryLinkInput = {
  id?: string;
  projectId: string;
  fromMemoryId: string;
  toMemoryId: string;
  linkType: string;
  description: string;
  strength: number;
};

export type UpsertWorldElementInput = {
  id?: string;
  projectId: string;
  elementType: string;
  name: string;
  summary: string;
  details: string;
  storyPurpose: string;
  constraints: string;
  visualPrompt: string;
  imageAssetId?: string | null;
  status: string;
  orderIndex: number;
};

export type UpsertWorldRuleInput = {
  id?: string;
  projectId: string;
  name: string;
  description: string;
  scope: string;
  cost: string;
  limitation: string;
  exceptions: string;
  violationConsequences: string;
  sceneExamples: string;
  status: string;
  orderIndex: number;
};

export type SetWorldElementRelationsInput = {
  projectId: string;
  elementId: string;
  characterIds: string[];
  threadIds: string[];
  chapterIds: string[];
  sceneIds: string[];
  ruleIds: string[];
};

export type SetWorldRuleRelationsInput = {
  projectId: string;
  ruleId: string;
  elementIds: string[];
  threadIds: string[];
  chapterIds: string[];
  sceneIds: string[];
};

export type CreatePlanVersionInput = {
  bookId: string;
  name: string;
  description: string;
};

export type SetActivePlanVersionInput = {
  bookId: string;
  planVersionId: string;
};

export type DeletePlanVersionInput = {
  bookId: string;
  planVersionId: string;
};

export type UpsertSceneInput = {
  id?: string;
  bookId: string;
  chapterId?: string | null;
  orderIndex: number;
  title: string;
  summary: string;
  goal: string;
  conflict: string;
  outcome: string;
  povCharacterId?: string | null;
  locationId?: string | null;
  targetWordCount?: number | null;
  actualWordCount?: number | null;
  manuscriptContent?: string;
  status: string;
};

export type SetSceneRelationsInput = {
  bookId: string;
  sceneId: string;
  characterIds: string[];
  threadIds: string[];
  elementIds: string[];
  ruleIds: string[];
};

export type ReorderScenesInput = {
  bookId: string;
  chapterId?: string | null;
  sceneIds: string[];
};

export type SaveStoryStructureInput = {
  id?: string;
  bookId: string;
  structureType: string;
  description: string;
  notes: string;
  status?: string;
};

export type UpsertActInput = {
  id?: string;
  bookId: string;
  name: string;
  purpose: string;
  summary: string;
  startPercent: number;
  endPercent: number;
  orderIndex: number;
  color: string;
};

export type UpsertBeatInput = {
  id?: string;
  bookId: string;
  name: string;
  description: string;
  role: string;
  orderIndex: number;
};

export type MoveBeatToChapterInput = {
  bookId: string;
  beatId: string;
  chapterId: string | null;
  orderIndex: number;
};

export type UpsertPlotThreadInput = {
  id?: string;
  bookId: string;
  name: string;
  description: string;
  color: string;
  status: string;
  orderIndex: number;
};

export type UpsertChapterInput = {
  id?: string;
  bookId: string;
  actId?: string | null;
  number: number;
  workingTitle: string;
  summary: string;
  purpose: string;
  conflict: string;
  turningPoint: string;
  targetWordCount?: number | null;
  orderIndex: number;
  threadIds: string[];
  beatIds: string[];
};

export type UpsertChapterThreadInput = {
  bookId: string;
  chapterId: string;
  threadId: string;
  description: string;
};

export type ReorderPlanItemsInput = {
  itemType: "acts" | "beats" | "threads" | "chapters";
  orderedIds: string[];
};

export type CreateProjectInput = {
  name: string;
  language?: string;
};

export type BookConceptInput = {
  title?: string;
  workingTitle?: string;
  premise?: string;
  protagonistSummary?: string;
  protagonistGoal?: string;
  expandedPremise?: string;
  logline?: string;
  centralConflict?: string;
  antagonistForce?: string;
  stakes?: string;
  settingSketch?: string;
  endingDirection?: string;
  genre?: string;
  subgenre?: string;
  targetAudience?: string;
  tone?: string;
  styleGuide?: string;
  pointOfView?: string;
  targetWordCount?: number | null;
  themesJson?: string;
  unwantedThemes?: string;
  alternativeTitlesJson?: string;
};

export type AIAction =
  | "generate_working_title"
  | "generate_title"
  | "generate_premise"
  | "generate_protagonist_summary"
  | "generate_protagonist_goal"
  | "expand_premise"
  | "generate_logline"
  | "generate_expanded_premise"
  | "generate_central_conflict"
  | "generate_antagonist_force"
  | "generate_stakes"
  | "generate_setting_sketch"
  | "generate_ending_direction"
  | "suggest_genre"
  | "suggest_subgenre"
  | "suggest_target_audience"
  | "suggest_tone"
  | "suggest_point_of_view"
  | "suggest_target_word_count"
  | "suggest_themes"
  | "suggest_unwanted_themes"
  | "generate_alternative_titles"
  | "generate_style_guide"
  | "generate_cover_image"
  | "suggest_story_structure"
  | "generate_acts"
  | "generate_act_field"
  | "generate_beat_sheet"
  | "generate_beat_field"
  | "generate_plot_threads"
  | "generate_chapter_plan"
  | "generate_chapter_field"
  | "generate_scene_field"
  | "generate_thread_chapter_field"
  | "suggest_chapter_relations"
  | "find_plan_gaps"
  | "generate_character_field"
  | "generate_character_relation_field"
  | "generate_character_memory_field"
  | "generate_character_image"
  | "generate_world_element_field"
  | "generate_world_rule_field"
  | "generate_world_rule_analysis"
  | "draft_scene"
  | "continue_scene"
  | "rewrite_selection"
  | "expand_selection"
  | "analyze_scene_story_bible_opportunities";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type CodexCliStatus = {
  available: boolean;
  path?: string;
  version?: string;
  authLikelyReady?: boolean | null;
  message?: string;
};

export type CodexModelReasoningLevel = {
  effort: ReasoningEffort | string;
  description?: string;
};

export type CodexModel = {
  slug: string;
  displayName: string;
  description?: string;
  defaultReasoningLevel?: ReasoningEffort | string;
  supportedReasoningLevels?: CodexModelReasoningLevel[];
};

export type CodexModelCatalog = {
  models: CodexModel[];
  fallback: boolean;
  errorMessage?: string | null;
};

export type RunCodexPromptRequest = {
  projectId: string;
  action: AIAction;
  promptPackageId: string;
  promptPackageJson: unknown;
  prompt: string;
  codexPath?: string;
  timeoutSeconds?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
};

export type GenerateNewProjectTitleRequest = {
  action: Extract<AIAction, "generate_working_title">;
  promptPackageId: string;
  promptPackageJson: unknown;
  prompt: string;
  codexPath?: string;
  timeoutSeconds?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
};

export type AiRunResult = {
  id: string;
  providerId: string;
  promptPackageId: string;
  action: string;
  status: "success" | "error" | "cancelled" | "timeout" | string;
  rawOutput?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
  durationMs: number;
};

export type AiLogEntry = {
  id: string;
  projectId: string;
  providerId: string;
  model?: string | null;
  reasoningEffort?: string | null;
  action: string;
  promptPackageJson: unknown;
  prompt: string;
  rawOutput?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  decisionStatus?: AiProposalDecisionStatus | null;
  proposalSnapshot?: unknown;
};

export type AiProposalDecisionStatus = "pending" | "accepted" | "rejected";

export type AiProposalRecord = {
  id: string;
  aiRunId?: string | null;
  projectId: string;
  proposalType: string;
  payloadJson: unknown;
  status: string;
  decisionStatus: AiProposalDecisionStatus;
  appliedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAiProposalSnapshotInput = {
  id: string;
  aiRunId?: string | null;
  projectId: string;
  proposalType: string;
  payloadJson: unknown;
  status: string;
};

export type GenerateBookCoverInput = {
  projectId: string;
  bookId: string;
  promptPackageId: string;
  promptPackageJson: unknown;
  prompt: string;
  coverPrompt: string;
  coverNegativePrompt: string;
  codexPath?: string;
  timeoutSeconds?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
};

export type AcceptGeneratedBookCoverInput = {
  bookId: string;
  imagePath: string;
  coverPrompt: string;
  coverNegativePrompt: string;
  generatedAt: string;
};

export type BookCoverResult = {
  book: Book;
  aiRun: AiRunResult;
  imagePath: string;
  prompt: string;
  negativePrompt: string;
  generatedAt: string;
};

export type GenerateCharacterImageInput = {
  projectId: string;
  characterId: string;
  promptPackageId: string;
  promptPackageJson: unknown;
  prompt: string;
  imagePrompt: string;
  negativePrompt: string;
  codexPath?: string;
  timeoutSeconds?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
};

export type AcceptGeneratedCharacterImageInput = {
  projectId: string;
  characterId: string;
  imagePath: string;
  imagePrompt: string;
  negativePrompt: string;
  generatedAt: string;
};

export type CharacterImageResult = {
  character: Character;
  visualAsset: VisualAsset;
  aiRun: AiRunResult;
  imagePath: string;
  prompt: string;
  negativePrompt: string;
  generatedAt: string;
};

export type CoverGenerationProgressEvent = {
  projectId: string;
  bookId: string;
  aiRunId: string;
  phase: "queued" | "request" | "streaming" | "partial" | "final" | "saved" | "error" | string;
  message: string;
  partialImageDataUrl?: string | null;
  progress?: number | null;
};
