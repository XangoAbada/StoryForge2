import { invoke } from "@tauri-apps/api/core";
import {
  browserAcceptGeneratedBookCover,
  browserAcceptGeneratedCharacterImage,
  browserCheckCodexCli,
  browserListCodexModels,
  browserListAiRuns,
  browserCreateProject,
  browserDeleteCharacter,
  browserDeleteCharacterMemory,
  browserDeleteCharacterMemoryLink,
  browserDeleteCharacterRelation,
  browserGenerateCharacterImage,
  browserDeleteAct,
  browserDeleteBeat,
  browserDeleteChapter,
  browserDeletePlotThread,
  browserGetBookPlan,
  browserGetCharacterWorkspace,
  browserGetWorldWorkspace,
  browserGetProject,
  browserListProjects,
  browserMoveBeatToChapter,
  browserReorderPlanItems,
  browserRunCodexPrompt,
  browserSaveStoryStructure,
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
  AiRunResult,
  AiLogEntry,
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
  CreateProjectInput,
  GenerateBookCoverInput,
  GenerateCharacterImageInput,
  GenerateNewProjectTitleRequest,
  MoveBeatToChapterInput,
  PlotThread,
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
