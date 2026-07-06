import { invoke } from "@tauri-apps/api/core";
import {
  browserAcceptGeneratedBookCover,
  browserAcceptGeneratedCharacterImage,
  browserCheckCodexCli,
  browserCheckClaudeCli,
  browserGetAiSettings,
  browserSaveAiSettings,
  browserCancelActiveCodexRun,
  browserCreatePlanVersionFromActive,
  browserDeletePlanVersion,
  browserListCodexModels,
  browserListPlanVersions,
  browserListAiRuns,
  browserListAiRunUsageTotals,
  browserListAiRunUsageTotalsAll,
  browserListAiProposals,
  browserListActiveCodexRuns,
  browserMarkAiProposalAccepted,
  browserMarkAiProposalRejected,
  browserUpsertAiProposalSnapshot,
  browserCreateProject,
  browserDeleteProject,
  browserDeleteCharacter,
  browserDeleteCharacterMemory,
  browserDeleteCharacterMemoryLink,
  browserDeleteCharacterRelation,
  browserGenerateCharacterImage,
  browserGenerateExportArtwork,
  browserAcceptGeneratedExportArtwork,
  browserChooseExportDirectory,
  browserChooseImportFile,
  browserExportBook,
  browserExportProject,
  browserImportProject,
  browserRevealExportFile,
  browserListExportPresets,
  browserSaveExportPreset,
  browserDeleteAct,
  browserDeleteBeat,
  browserDeleteChapter,
  browserDeleteScene,
  browserDeletePlotThread,
  browserGetBookPlan,
  browserGetCharacterWorkspace,
  browserGetWorldWorkspace,
  browserGetProject,
  browserListProjects,
  browserMoveBeatToChapter,
  browserReorderPlanItems,
  browserReorderScenes,
  browserSearchProject,
  browserCreateSceneSnapshot,
  browserListSceneSnapshots,
  browserGetSceneSnapshot,
  browserRestoreSceneSnapshot,
  browserRunCodexPrompt,
  browserListSceneCritiques,
  browserSaveChapterAutoSummary,
  browserSaveSceneAutoSummary,
  browserSaveSceneCritique,
  browserSetSceneStyleReference,
  browserSaveStorySoFar,
  browserSaveStoryStructure,
  browserSetActivePlanVersion,
  browserSetSceneRelations,
  browserUpsertChapterThreadRelation,
  browserUpsertCharacter,
  browserUpsertCharacterMemory,
  browserUpsertCharacterMemoryLink,
  browserUpsertCharacterRelation,
  browserSetWorldElementRelations,
  browserSetWorldRuleRelations,
  browserUpsertWorldElement,
  browserUpsertWorldRule,
  browserUpsertAct,
  browserUpsertBeat,
  browserUpsertChapter,
  browserUpsertScene,
  browserUpsertPlotThread,
  browserUpdateBookConcept,
  browserDeleteWorldElement,
  browserDeleteWorldRule,
  browserGenerateBookCover,
  browserGenerateNewProjectTitle,
  isTauriRuntime
} from "./browserDevCommands";
import type {
  AcceptGeneratedBookCoverInput,
  AcceptGeneratedCharacterImageInput,
  AcceptGeneratedExportArtworkInput,
  AiRunResult,
  AiSettings,
  ActiveCodexRun,
  AiLogEntry,
  AiProposalRecord,
  AiRunUsageGroup,
  Act,
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
  CreatePlanVersionInput,
  DeletePlanVersionInput,
  CreateProjectInput,
  ExportBookInput,
  ExportBookResult,
  ExportPreset,
  ExportProjectInput,
  ExportProjectResult,
  ImportProjectResult,
  ExportArtworkResult,
  GenerateBookCoverInput,
  GenerateCharacterImageInput,
  GenerateExportArtworkInput,
  GenerateNewProjectTitleRequest,
  MoveBeatToChapterInput,
  PlotThread,
  PlanVersion,
  ProjectDetails,
  ProjectSummary,
  ReorderPlanItemsInput,
  ReorderScenesInput,
  RunCodexPromptRequest,
  SaveChapterAutoSummaryInput,
  SaveSceneAutoSummaryInput,
  SaveSceneCritiqueInput,
  SceneCritiqueRecord,
  SetSceneStyleReferenceInput,
  SaveStorySoFarInput,
  SaveStoryStructureInput,
  SaveExportPresetInput,
  Scene,
  SceneSnapshot,
  SceneSnapshotMeta,
  SearchResult,
  SetActivePlanVersionInput,
  SetSceneRelationsInput,
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
  UpsertSceneInput,
  UpsertAiProposalSnapshotInput,
  UpsertWorldElementInput,
  UpsertWorldRuleInput,
  WorldElement,
  WorldRule,
  WorldWorkspace
} from "./types";

export function createProject(input: CreateProjectInput): Promise<ProjectDetails> {
  if (!isTauriRuntime()) {
    return browserCreateProject(input);
  }

  return invoke("create_project", { input });
}

export function listProjects(): Promise<ProjectSummary[]> {
  if (!isTauriRuntime()) {
    return browserListProjects();
  }

  return invoke("list_projects");
}

export function deleteProject(projectId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteProject(projectId);
  }

  return invoke("delete_project", { projectId });
}

export function getProject(projectId: string): Promise<ProjectDetails> {
  if (!isTauriRuntime()) {
    return browserGetProject(projectId);
  }

  return invoke("get_project", { projectId });
}

export function getBookPlan(bookId: string): Promise<BookPlan> {
  if (!isTauriRuntime()) {
    return browserGetBookPlan(bookId);
  }

  return invoke("get_book_plan", { bookId });
}

export function listPlanVersions(bookId: string): Promise<PlanVersion[]> {
  if (!isTauriRuntime()) {
    return browserListPlanVersions(bookId);
  }

  return invoke("list_plan_versions", { bookId });
}

export function createPlanVersionFromActive(
  input: CreatePlanVersionInput
): Promise<PlanVersion> {
  if (!isTauriRuntime()) {
    return browserCreatePlanVersionFromActive(input);
  }

  return invoke("create_plan_version_from_active", { input });
}

export function setActivePlanVersion(
  input: SetActivePlanVersionInput
): Promise<void> {
  if (!isTauriRuntime()) {
    return browserSetActivePlanVersion(input);
  }

  return invoke("set_active_plan_version", { input });
}

export function deletePlanVersion(input: DeletePlanVersionInput): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeletePlanVersion(input);
  }

  return invoke("delete_plan_version", { input });
}

export function getCharacterWorkspace(projectId: string): Promise<CharacterWorkspace> {
  if (!isTauriRuntime()) {
    return browserGetCharacterWorkspace(projectId);
  }

  return invoke("get_character_workspace", { projectId });
}

export function getWorldWorkspace(projectId: string): Promise<WorldWorkspace> {
  if (!isTauriRuntime()) {
    return browserGetWorldWorkspace(projectId);
  }

  return invoke("get_world_workspace", { projectId });
}

export function saveStoryStructure(
  input: SaveStoryStructureInput
): Promise<StoryStructure> {
  if (!isTauriRuntime()) {
    return browserSaveStoryStructure(input);
  }

  return invoke("save_story_structure", { input });
}

export function upsertAct(input: UpsertActInput): Promise<Act> {
  if (!isTauriRuntime()) {
    return browserUpsertAct(input);
  }

  return invoke("upsert_act", { input });
}

export function deleteAct(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteAct(id);
  }

  return invoke("delete_act", { id });
}

export function upsertBeat(input: UpsertBeatInput): Promise<Beat> {
  if (!isTauriRuntime()) {
    return browserUpsertBeat(input);
  }

  return invoke("upsert_beat", { input });
}

export function deleteBeat(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteBeat(id);
  }

  return invoke("delete_beat", { id });
}

export function moveBeatToChapter(input: MoveBeatToChapterInput): Promise<void> {
  if (!isTauriRuntime()) {
    return browserMoveBeatToChapter(input);
  }

  return invoke("move_beat_to_chapter", { input });
}

export function upsertPlotThread(
  input: UpsertPlotThreadInput
): Promise<PlotThread> {
  if (!isTauriRuntime()) {
    return browserUpsertPlotThread(input);
  }

  return invoke("upsert_plot_thread", { input });
}

export function deletePlotThread(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeletePlotThread(id);
  }

  return invoke("delete_plot_thread", { id });
}

export function upsertChapter(input: UpsertChapterInput): Promise<Chapter> {
  if (!isTauriRuntime()) {
    return browserUpsertChapter(input);
  }

  return invoke("upsert_chapter", { input });
}

export function upsertChapterThreadRelation(
  input: UpsertChapterThreadInput
): Promise<void> {
  if (!isTauriRuntime()) {
    return browserUpsertChapterThreadRelation(input);
  }

  return invoke("upsert_chapter_thread_relation", { input });
}

export function deleteChapter(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteChapter(id);
  }

  return invoke("delete_chapter", { id });
}

export function upsertScene(input: UpsertSceneInput): Promise<Scene> {
  if (!isTauriRuntime()) {
    return browserUpsertScene(input);
  }

  return invoke("upsert_scene", { input });
}

export function deleteScene(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteScene(id);
  }

  return invoke("delete_scene", { id });
}

export function searchProject(projectId: string, query: string): Promise<SearchResult[]> {
  if (!isTauriRuntime()) {
    return browserSearchProject(projectId, query);
  }

  return invoke("search_project", { projectId, query });
}

export function createSceneSnapshot(
  sceneId: string,
  source: string
): Promise<SceneSnapshotMeta | null> {
  if (!isTauriRuntime()) {
    return browserCreateSceneSnapshot(sceneId, source);
  }

  return invoke("create_scene_snapshot", { sceneId, source });
}

export function listSceneSnapshots(sceneId: string): Promise<SceneSnapshotMeta[]> {
  if (!isTauriRuntime()) {
    return browserListSceneSnapshots(sceneId);
  }

  return invoke("list_scene_snapshots", { sceneId });
}

export function getSceneSnapshot(id: string): Promise<SceneSnapshot> {
  if (!isTauriRuntime()) {
    return browserGetSceneSnapshot(id);
  }

  return invoke("get_scene_snapshot", { id });
}

export function restoreSceneSnapshot(id: string): Promise<Scene> {
  if (!isTauriRuntime()) {
    return browserRestoreSceneSnapshot(id);
  }

  return invoke("restore_scene_snapshot", { id });
}

export function saveSceneAutoSummary(input: SaveSceneAutoSummaryInput): Promise<Scene> {
  if (!isTauriRuntime()) {
    return browserSaveSceneAutoSummary(input);
  }

  return invoke("save_scene_auto_summary", { input });
}

export function saveSceneCritique(input: SaveSceneCritiqueInput): Promise<SceneCritiqueRecord> {
  if (!isTauriRuntime()) {
    return browserSaveSceneCritique(input);
  }

  return invoke("save_scene_critique", { input });
}

export function listSceneCritiques(bookId: string): Promise<SceneCritiqueRecord[]> {
  if (!isTauriRuntime()) {
    return browserListSceneCritiques(bookId);
  }

  return invoke("list_scene_critiques", { bookId });
}

export function setSceneStyleReference(input: SetSceneStyleReferenceInput): Promise<Scene> {
  if (!isTauriRuntime()) {
    return browserSetSceneStyleReference(input);
  }

  return invoke("set_scene_style_reference", { input });
}

export function saveChapterAutoSummary(input: SaveChapterAutoSummaryInput): Promise<Chapter> {
  if (!isTauriRuntime()) {
    return browserSaveChapterAutoSummary(input);
  }

  return invoke("save_chapter_auto_summary", { input });
}

export function saveStorySoFar(input: SaveStorySoFarInput): Promise<Book> {
  if (!isTauriRuntime()) {
    return browserSaveStorySoFar(input);
  }

  return invoke("save_story_so_far", { input });
}

export function reorderScenes(input: ReorderScenesInput): Promise<void> {
  if (!isTauriRuntime()) {
    return browserReorderScenes(input);
  }

  return invoke("reorder_scenes", { input });
}

export function setSceneRelations(input: SetSceneRelationsInput): Promise<void> {
  if (!isTauriRuntime()) {
    return browserSetSceneRelations(input);
  }

  return invoke("set_scene_relations", { input });
}

export function upsertCharacter(input: UpsertCharacterInput): Promise<Character> {
  if (!isTauriRuntime()) {
    return browserUpsertCharacter(input);
  }

  return invoke("upsert_character", { input });
}

export function deleteCharacter(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteCharacter(id);
  }

  return invoke("delete_character", { id });
}

export function upsertCharacterRelation(
  input: UpsertCharacterRelationInput
): Promise<CharacterRelation> {
  if (!isTauriRuntime()) {
    return browserUpsertCharacterRelation(input);
  }

  return invoke("upsert_character_relation", { input });
}

export function deleteCharacterRelation(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteCharacterRelation(id);
  }

  return invoke("delete_character_relation", { id });
}

export function upsertCharacterMemory(
  input: UpsertCharacterMemoryInput
): Promise<CharacterMemory> {
  if (!isTauriRuntime()) {
    return browserUpsertCharacterMemory(input);
  }

  return invoke("upsert_character_memory", { input });
}

export function deleteCharacterMemory(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteCharacterMemory(id);
  }

  return invoke("delete_character_memory", { id });
}

export function upsertCharacterMemoryLink(
  input: UpsertCharacterMemoryLinkInput
): Promise<CharacterMemoryLink> {
  if (!isTauriRuntime()) {
    return browserUpsertCharacterMemoryLink(input);
  }

  return invoke("upsert_character_memory_link", { input });
}

export function deleteCharacterMemoryLink(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteCharacterMemoryLink(id);
  }

  return invoke("delete_character_memory_link", { id });
}

export function upsertWorldElement(input: UpsertWorldElementInput): Promise<WorldElement> {
  if (!isTauriRuntime()) {
    return browserUpsertWorldElement(input);
  }

  return invoke("upsert_world_element", { input });
}

export function deleteWorldElement(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteWorldElement(id);
  }

  return invoke("delete_world_element", { id });
}

export function upsertWorldRule(input: UpsertWorldRuleInput): Promise<WorldRule> {
  if (!isTauriRuntime()) {
    return browserUpsertWorldRule(input);
  }

  return invoke("upsert_world_rule", { input });
}

export function deleteWorldRule(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserDeleteWorldRule(id);
  }

  return invoke("delete_world_rule", { id });
}

export function setWorldElementRelations(
  input: SetWorldElementRelationsInput
): Promise<void> {
  if (!isTauriRuntime()) {
    return browserSetWorldElementRelations(input);
  }

  return invoke("set_world_element_relations", { input });
}

export function setWorldRuleRelations(
  input: SetWorldRuleRelationsInput
): Promise<void> {
  if (!isTauriRuntime()) {
    return browserSetWorldRuleRelations(input);
  }

  return invoke("set_world_rule_relations", { input });
}

export function reorderPlanItems(input: ReorderPlanItemsInput): Promise<void> {
  if (!isTauriRuntime()) {
    return browserReorderPlanItems(input);
  }

  return invoke("reorder_plan_items", { input });
}

export function listAiRuns(projectId: string): Promise<AiLogEntry[]> {
  if (!isTauriRuntime()) {
    return browserListAiRuns(projectId);
  }

  return invoke("list_ai_runs", { projectId });
}

export function listAiRunUsageTotals(projectId: string): Promise<AiRunUsageGroup[]> {
  if (!isTauriRuntime()) {
    return browserListAiRunUsageTotals(projectId);
  }

  return invoke("list_ai_run_usage_totals", { projectId });
}

export function listAiRunUsageTotalsAll(): Promise<AiRunUsageGroup[]> {
  if (!isTauriRuntime()) {
    return browserListAiRunUsageTotalsAll();
  }

  return invoke("list_ai_run_usage_totals_all");
}

export function listAiProposals(projectId: string): Promise<AiProposalRecord[]> {
  if (!isTauriRuntime()) {
    return browserListAiProposals(projectId);
  }

  return invoke("list_ai_proposals", { projectId });
}

export function upsertAiProposalSnapshot(
  input: UpsertAiProposalSnapshotInput
): Promise<void> {
  if (!isTauriRuntime()) {
    return browserUpsertAiProposalSnapshot(input);
  }

  return invoke("upsert_ai_proposal_snapshot", { input });
}

export function markAiProposalAccepted(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserMarkAiProposalAccepted(id);
  }

  return invoke("mark_ai_proposal_accepted", { id });
}

export function markAiProposalRejected(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserMarkAiProposalRejected(id);
  }

  return invoke("mark_ai_proposal_rejected", { id });
}

export function updateBookConcept(
  bookId: string,
  input: BookConceptInput
): Promise<Book> {
  if (!isTauriRuntime()) {
    return browserUpdateBookConcept(bookId, input);
  }

  return invoke("update_book_concept", { bookId, input });
}

export function checkCodexCli(codexPath?: string): Promise<CodexCliStatus> {
  if (!isTauriRuntime()) {
    return browserCheckCodexCli(codexPath);
  }

  return invoke("check_codex_cli", { codexPath: codexPath || undefined });
}

export function checkCodexLogin(codexPath?: string): Promise<CodexCliStatus> {
  if (!isTauriRuntime()) {
    return browserCheckCodexCli(codexPath);
  }

  return invoke("check_codex_login", { codexPath: codexPath || undefined });
}

export function checkClaudeCli(claudePath?: string): Promise<CodexCliStatus> {
  if (!isTauriRuntime()) {
    return browserCheckClaudeCli(claudePath);
  }

  return invoke("check_claude_cli", { claudePath: claudePath || undefined });
}

export function startCodexLogin(codexPath?: string): Promise<void> {
  if (!isTauriRuntime()) {
    return Promise.resolve();
  }

  return invoke("start_codex_login", { codexPath: codexPath || undefined });
}

export function startClaudeLogin(claudePath?: string): Promise<void> {
  if (!isTauriRuntime()) {
    return Promise.resolve();
  }

  return invoke("start_claude_login", { claudePath: claudePath || undefined });
}

export function getAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime()) {
    return browserGetAiSettings();
  }

  return invoke("get_ai_settings");
}

export function saveAiSettings(settings: AiSettings): Promise<void> {
  if (!isTauriRuntime()) {
    return browserSaveAiSettings(settings);
  }

  return invoke("save_ai_settings", { settings });
}

export function listCodexModels(codexPath?: string): Promise<CodexModelCatalog> {
  if (!isTauriRuntime()) {
    return browserListCodexModels(codexPath);
  }

  return invoke("list_codex_models", { codexPath: codexPath || undefined });
}

export function runCodexPrompt(
  request: RunCodexPromptRequest
): Promise<AiRunResult> {
  if (!isTauriRuntime()) {
    return browserRunCodexPrompt(request);
  }

  return invoke("run_codex_prompt", { request });
}

export function listActiveCodexRuns(
  projectId?: string
): Promise<ActiveCodexRun[]> {
  if (!isTauriRuntime()) {
    return browserListActiveCodexRuns(projectId);
  }

  return invoke("list_active_codex_runs", { projectId: projectId || undefined });
}

export function cancelActiveCodexRun(
  input: { projectId?: string; aiRunId?: string } = {}
): Promise<boolean> {
  if (!isTauriRuntime()) {
    return browserCancelActiveCodexRun(input);
  }

  return invoke("cancel_active_codex_run", {
    projectId: input.projectId || undefined,
    aiRunId: input.aiRunId || undefined
  });
}

export function generateNewProjectTitle(
  request: GenerateNewProjectTitleRequest
): Promise<AiRunResult> {
  if (!isTauriRuntime()) {
    return browserGenerateNewProjectTitle(request);
  }

  return invoke("generate_new_project_title", { request });
}

export function generateBookCover(
  input: GenerateBookCoverInput
): Promise<BookCoverResult> {
  if (!isTauriRuntime()) {
    return browserGenerateBookCover(input);
  }

  return invoke("generate_book_cover", { input });
}

export function acceptGeneratedBookCover(
  input: AcceptGeneratedBookCoverInput
): Promise<Book> {
  if (!isTauriRuntime()) {
    return browserAcceptGeneratedBookCover(input);
  }

  return invoke("accept_generated_book_cover", { input });
}

export function generateCharacterImage(
  input: GenerateCharacterImageInput
): Promise<CharacterImageResult> {
  if (!isTauriRuntime()) {
    return browserGenerateCharacterImage(input);
  }

  return invoke("generate_character_image", { input });
}

export function acceptGeneratedCharacterImage(
  input: AcceptGeneratedCharacterImageInput
): Promise<CharacterImageResult> {
  if (!isTauriRuntime()) {
    return browserAcceptGeneratedCharacterImage(input);
  }

  return invoke("accept_generated_character_image", { input });
}

export function exportBook(input: ExportBookInput): Promise<ExportBookResult> {
  if (!isTauriRuntime()) {
    return browserExportBook(input);
  }

  return invoke("export_book", { input });
}

export function exportProject(
  input: ExportProjectInput
): Promise<ExportProjectResult> {
  if (!isTauriRuntime()) {
    return browserExportProject(input);
  }

  return invoke("export_project", { input });
}

export function importProject(zipPath: string): Promise<ImportProjectResult> {
  if (!isTauriRuntime()) {
    return browserImportProject(zipPath);
  }

  return invoke("import_project", { zipPath });
}

export function chooseImportFile(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return browserChooseImportFile();
  }

  return invoke("choose_import_file");
}

export function chooseExportDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return browserChooseExportDirectory();
  }

  return invoke("choose_export_directory");
}

export function revealExportFile(filePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return browserRevealExportFile(filePath);
  }

  return invoke("reveal_export_file", { filePath });
}

export function listExportPresets(
  projectId: string,
  bookId: string
): Promise<ExportPreset[]> {
  if (!isTauriRuntime()) {
    return browserListExportPresets(projectId, bookId);
  }

  return invoke("list_export_presets", { projectId, bookId });
}

export function saveExportPreset(
  input: SaveExportPresetInput
): Promise<ExportPreset> {
  if (!isTauriRuntime()) {
    return browserSaveExportPreset(input);
  }

  return invoke("save_export_preset", { input });
}

export function generateExportArtwork(
  input: GenerateExportArtworkInput
): Promise<ExportArtworkResult> {
  if (!isTauriRuntime()) {
    return browserGenerateExportArtwork(input);
  }

  return invoke("generate_export_artwork", { input });
}

export function acceptGeneratedExportArtwork(
  input: AcceptGeneratedExportArtworkInput
): Promise<ExportArtworkResult> {
  if (!isTauriRuntime()) {
    return browserAcceptGeneratedExportArtwork(input);
  }

  return invoke("accept_generated_export_artwork", { input });
}
