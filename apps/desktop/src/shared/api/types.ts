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
  actId: string | null;
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
};

export type BeatThread = {
  beatId: string;
  threadId: string;
};

export type ChapterBeat = {
  chapterId: string;
  beatId: string;
};

export type BookPlan = {
  structure: StoryStructure | null;
  acts: Act[];
  beats: Beat[];
  threads: PlotThread[];
  chapters: Chapter[];
  chapterThreads: ChapterThread[];
  beatThreads: BeatThread[];
  chapterBeats: ChapterBeat[];
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
  actId?: string | null;
  name: string;
  description: string;
  role: string;
  orderIndex: number;
  threadIds: string[];
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
  | "generate_plot_threads"
  | "generate_chapter_plan"
  | "generate_chapter_field"
  | "suggest_chapter_relations"
  | "find_plan_gaps";

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

export type CoverGenerationProgressEvent = {
  projectId: string;
  bookId: string;
  aiRunId: string;
  phase: "queued" | "request" | "streaming" | "partial" | "final" | "saved" | "error" | string;
  message: string;
  partialImageDataUrl?: string | null;
  progress?: number | null;
};
