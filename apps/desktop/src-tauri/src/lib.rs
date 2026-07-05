use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

mod ai_settings;
mod providers;

use ai_settings::{get_ai_settings, load_ai_settings, save_ai_settings, AiSettings};

pub(crate) const PROVIDER_ID: &str = "codex-cli-bridge";
const COVER_GENERATION_EVENT: &str = "cover-generation-progress";
const MIN_COVER_TIMEOUT_SECONDS: u64 = 600;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Clone)]
pub struct AppState {
    db: SqlitePool,
    active_codex_runs: ActiveCodexRunRegistry,
}

type ActiveCodexRunRegistry = Arc<Mutex<HashMap<String, ActiveCodexRunHandle>>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCodexRun {
    pub ai_run_id: String,
    pub project_id: String,
    pub action: String,
    pub started_at: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub phase: String,
}

#[derive(Clone)]
struct ActiveCodexRunHandle {
    run: ActiveCodexRun,
    cancel: watch::Sender<bool>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Process(String),
    #[error("Codex CLI przekroczył limit czasu po {0} sekundach")]
    Timeout(u64),
    #[error("Generowanie Codex CLI zostało przerwane")]
    Cancelled,
}

fn command_error(error: AppError) -> String {
    error.to_string()
}

#[derive(Debug, Clone)]
struct CodexCommandSpec {
    program: OsString,
    prefix_args: Vec<OsString>,
    display_path: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub language: String,
    pub created_at: String,
    pub updated_at: String,
    pub active_book_id: Option<String>,
    pub settings_json: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub working_title: String,
    pub premise: String,
    pub protagonist_summary: String,
    pub protagonist_goal: String,
    pub expanded_premise: String,
    pub central_conflict: String,
    pub antagonist_force: String,
    pub stakes: String,
    pub setting_sketch: String,
    pub ending_direction: String,
    pub genre: String,
    pub subgenre: String,
    pub target_audience: String,
    pub tone: String,
    pub style_guide: String,
    pub point_of_view: String,
    pub target_word_count: Option<i64>,
    pub themes_json: String,
    pub unwanted_themes: String,
    pub alternative_titles_json: String,
    pub cover_image_path: String,
    pub cover_prompt: String,
    pub cover_negative_prompt: String,
    pub cover_generated_at: Option<String>,
    pub story_so_far: String,
    pub story_so_far_stale: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub language: String,
    pub updated_at: String,
    pub active_book_id: Option<String>,
    pub working_title: String,
    pub cover_image_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    pub project: Project,
    pub book: Book,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookConceptInput {
    pub title: Option<String>,
    pub working_title: Option<String>,
    pub premise: Option<String>,
    pub protagonist_summary: Option<String>,
    pub protagonist_goal: Option<String>,
    pub expanded_premise: Option<String>,
    pub central_conflict: Option<String>,
    pub antagonist_force: Option<String>,
    pub stakes: Option<String>,
    pub setting_sketch: Option<String>,
    pub ending_direction: Option<String>,
    pub genre: Option<String>,
    pub subgenre: Option<String>,
    pub target_audience: Option<String>,
    pub tone: Option<String>,
    pub style_guide: Option<String>,
    pub point_of_view: Option<String>,
    pub target_word_count: Option<i64>,
    pub themes_json: Option<String>,
    pub unwanted_themes: Option<String>,
    pub alternative_titles_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub auth_likely_ready: Option<bool>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelCatalog {
    pub models: Vec<Value>,
    pub fallback: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCodexPromptRequest {
    pub project_id: String,
    pub action: String,
    pub prompt_package_id: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub codex_path: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateNewProjectTitleRequest {
    pub action: String,
    pub prompt_package_id: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub codex_path: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateBookCoverInput {
    pub project_id: String,
    pub book_id: String,
    pub prompt_package_id: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub cover_prompt: String,
    pub cover_negative_prompt: String,
    pub codex_path: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptGeneratedBookCoverInput {
    pub book_id: String,
    pub image_path: String,
    pub cover_prompt: String,
    pub cover_negative_prompt: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverGenerationProgress {
    pub project_id: String,
    pub book_id: String,
    pub ai_run_id: String,
    pub phase: String,
    pub message: String,
    pub partial_image_data_url: Option<String>,
    pub progress: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunResult {
    pub id: String,
    pub provider_id: String,
    pub prompt_package_id: String,
    pub action: String,
    pub status: String,
    pub raw_output: Option<String>,
    pub stderr: Option<String>,
    pub error_message: Option<String>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLogEntry {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model: String,
    pub reasoning_effort: String,
    pub action: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub raw_output: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub decision_status: Option<String>,
    pub proposal_snapshot: Option<Value>,
}

#[derive(Debug, sqlx::FromRow)]
struct AiLogEntryRow {
    id: String,
    project_id: String,
    provider_id: String,
    model: String,
    reasoning_effort: String,
    action: String,
    prompt_package_json: String,
    prompt: String,
    raw_output: Option<String>,
    status: String,
    error_message: Option<String>,
    created_at: String,
    completed_at: Option<String>,
    decision_status: Option<String>,
    proposal_snapshot_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProposalRecord {
    pub id: String,
    pub ai_run_id: Option<String>,
    pub project_id: String,
    pub proposal_type: String,
    pub payload_json: Value,
    pub status: String,
    pub decision_status: String,
    pub applied_at: Option<String>,
    pub accepted_at: Option<String>,
    pub rejected_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct AiProposalRow {
    id: String,
    ai_run_id: Option<String>,
    project_id: String,
    proposal_type: String,
    payload_json: String,
    status: String,
    decision_status: String,
    applied_at: Option<String>,
    accepted_at: Option<String>,
    rejected_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAiProposalSnapshotInput {
    pub id: String,
    pub ai_run_id: Option<String>,
    pub project_id: String,
    pub proposal_type: String,
    pub payload_json: Value,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookCoverResult {
    pub book: Book,
    pub ai_run: AiRunResult,
    pub image_path: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlanVersion {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub is_active: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StoryStructure {
    pub id: String,
    pub book_id: String,
    pub structure_type: String,
    pub description: String,
    pub notes: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Act {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub purpose: String,
    pub summary: String,
    pub start_percent: i64,
    pub end_percent: i64,
    pub order_index: i64,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Beat {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub role: String,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlotThread {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub resolution: String,
    pub color: String,
    pub status: String,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub book_id: String,
    pub act_id: Option<String>,
    pub number: i64,
    pub working_title: String,
    pub summary: String,
    pub purpose: String,
    pub conflict: String,
    pub turning_point: String,
    pub target_word_count: Option<i64>,
    pub order_index: i64,
    pub auto_summary: String,
    pub auto_summary_stale: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChapterThread {
    pub chapter_id: String,
    pub thread_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBeat {
    pub chapter_id: String,
    pub beat_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub book_id: String,
    pub plan_version_id: String,
    pub chapter_id: Option<String>,
    pub order_index: i64,
    pub title: String,
    pub summary: String,
    pub goal: String,
    pub conflict: String,
    pub outcome: String,
    pub time_marker: String,
    pub pov_character_id: Option<String>,
    pub location_id: Option<String>,
    pub target_word_count: Option<i64>,
    pub actual_word_count: i64,
    pub manuscript_content: String,
    pub auto_summary: String,
    pub auto_summary_source_hash: String,
    pub is_style_reference: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshotMeta {
    pub id: String,
    pub scene_id: String,
    pub word_count: i64,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshot {
    pub id: String,
    pub scene_id: String,
    pub content: String,
    pub word_count: i64,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneCharacter {
    pub scene_id: String,
    pub character_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneThread {
    pub scene_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneWorldElement {
    pub scene_id: String,
    pub element_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneWorldRule {
    pub scene_id: String,
    pub rule_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPlan {
    pub plan_version: PlanVersion,
    pub plan_versions: Vec<PlanVersion>,
    pub structure: Option<StoryStructure>,
    pub acts: Vec<Act>,
    pub beats: Vec<Beat>,
    pub threads: Vec<PlotThread>,
    pub chapters: Vec<Chapter>,
    pub chapter_threads: Vec<ChapterThread>,
    pub chapter_beats: Vec<ChapterBeat>,
    pub scenes: Vec<Scene>,
    pub scene_characters: Vec<SceneCharacter>,
    pub scene_threads: Vec<SceneThread>,
    pub scene_world_elements: Vec<SceneWorldElement>,
    pub scene_world_rules: Vec<SceneWorldRule>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VisualAsset {
    pub id: String,
    pub project_id: String,
    pub related_type: String,
    pub related_id: String,
    pub asset_type: String,
    pub title: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub file_path: String,
    pub source: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub project_id: String,
    pub character_type: String,
    pub name: String,
    pub aliases_json: String,
    pub role: String,
    pub short_description: String,
    pub appearance: String,
    pub external_goal: String,
    pub internal_need: String,
    pub wound: String,
    pub false_belief: String,
    pub secret: String,
    pub strengths_json: String,
    pub weaknesses_json: String,
    pub voice_notes: String,
    pub arc_summary: String,
    pub knowledge_notes: String,
    pub visual_prompt: String,
    pub image_asset_id: Option<String>,
    pub status: String,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRelation {
    pub id: String,
    pub project_id: String,
    pub from_character_id: String,
    pub to_character_id: String,
    pub relation_type: String,
    pub description: String,
    pub history: String,
    pub conflict: String,
    pub opinion: String,
    pub trust_level: i64,
    pub secret: String,
    pub change_over_time: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CharacterMemory {
    pub id: String,
    pub project_id: String,
    pub character_id: String,
    pub title: String,
    pub summary: String,
    pub details: String,
    pub memory_type: String,
    pub subject: String,
    pub emotion: String,
    pub importance: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CharacterMemoryLink {
    pub id: String,
    pub project_id: String,
    pub from_memory_id: String,
    pub to_memory_id: String,
    pub link_type: String,
    pub description: String,
    pub strength: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterWorkspace {
    pub characters: Vec<Character>,
    pub relations: Vec<CharacterRelation>,
    pub memories: Vec<CharacterMemory>,
    pub memory_links: Vec<CharacterMemoryLink>,
    pub visual_assets: Vec<VisualAsset>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldElement {
    pub id: String,
    pub project_id: String,
    pub element_type: String,
    pub name: String,
    pub summary: String,
    pub details: String,
    pub story_purpose: String,
    pub constraints: String,
    pub visual_prompt: String,
    pub image_asset_id: Option<String>,
    pub status: String,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldRule {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
    pub cost: String,
    pub limitation: String,
    pub exceptions: String,
    pub violation_consequences: String,
    pub scene_examples: String,
    pub status: String,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldElementCharacter {
    pub element_id: String,
    pub character_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldElementThread {
    pub element_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldElementChapter {
    pub element_id: String,
    pub chapter_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldElementRule {
    pub element_id: String,
    pub rule_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldRuleThread {
    pub rule_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorldRuleChapter {
    pub rule_id: String,
    pub chapter_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldWorkspace {
    pub elements: Vec<WorldElement>,
    pub rules: Vec<WorldRule>,
    pub element_characters: Vec<WorldElementCharacter>,
    pub element_threads: Vec<WorldElementThread>,
    pub element_chapters: Vec<WorldElementChapter>,
    pub element_scenes: Vec<SceneWorldElement>,
    pub element_rules: Vec<WorldElementRule>,
    pub rule_threads: Vec<WorldRuleThread>,
    pub rule_chapters: Vec<WorldRuleChapter>,
    pub rule_scenes: Vec<SceneWorldRule>,
    pub visual_assets: Vec<VisualAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStoryStructureInput {
    pub id: Option<String>,
    pub book_id: String,
    pub structure_type: String,
    pub description: String,
    pub notes: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertActInput {
    pub id: Option<String>,
    pub book_id: String,
    pub name: String,
    pub purpose: String,
    pub summary: String,
    pub start_percent: i64,
    pub end_percent: i64,
    pub order_index: i64,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBeatInput {
    pub id: Option<String>,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub role: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveBeatToChapterInput {
    pub book_id: String,
    pub beat_id: String,
    pub chapter_id: Option<String>,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertPlotThreadInput {
    pub id: Option<String>,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub resolution: String,
    pub color: String,
    pub status: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertChapterInput {
    pub id: Option<String>,
    pub book_id: String,
    pub act_id: Option<String>,
    pub number: i64,
    pub working_title: String,
    pub summary: String,
    pub purpose: String,
    pub conflict: String,
    pub turning_point: String,
    pub target_word_count: Option<i64>,
    pub order_index: i64,
    pub thread_ids: Vec<String>,
    pub beat_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertChapterThreadInput {
    pub book_id: String,
    pub chapter_id: String,
    pub thread_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPlanItemsInput {
    pub item_type: String,
    pub ordered_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanVersionInput {
    pub book_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActivePlanVersionInput {
    pub book_id: String,
    pub plan_version_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlanVersionInput {
    pub book_id: String,
    pub plan_version_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSceneInput {
    pub id: Option<String>,
    pub book_id: String,
    pub chapter_id: Option<String>,
    pub order_index: i64,
    pub title: String,
    pub summary: String,
    pub goal: String,
    pub conflict: String,
    pub outcome: String,
    pub time_marker: Option<String>,
    pub pov_character_id: Option<String>,
    pub location_id: Option<String>,
    pub target_word_count: Option<i64>,
    pub actual_word_count: Option<i64>,
    pub manuscript_content: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSceneAutoSummaryInput {
    pub scene_id: String,
    pub auto_summary: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSceneStyleReferenceInput {
    pub scene_id: String,
    pub is_style_reference: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneCritiqueRecord {
    pub id: String,
    pub project_id: String,
    pub book_id: String,
    pub scene_id: String,
    pub ai_run_id: Option<String>,
    pub summary: String,
    pub findings_json: String,
    pub source_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSceneCritiqueInput {
    pub id: Option<String>,
    pub project_id: String,
    pub book_id: String,
    pub scene_id: String,
    pub ai_run_id: Option<String>,
    pub summary: String,
    pub findings_json: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterAutoSummaryInput {
    pub chapter_id: String,
    pub auto_summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStorySoFarInput {
    pub book_id: String,
    pub story_so_far: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSceneRelationsInput {
    pub book_id: String,
    pub scene_id: String,
    pub character_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub element_ids: Vec<String>,
    pub rule_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderScenesInput {
    pub book_id: String,
    pub chapter_id: Option<String>,
    pub ordered_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCharacterInput {
    pub id: Option<String>,
    pub project_id: String,
    pub character_type: String,
    pub name: String,
    pub aliases_json: String,
    pub role: String,
    pub short_description: String,
    pub appearance: String,
    pub external_goal: String,
    pub internal_need: String,
    pub wound: String,
    pub false_belief: String,
    pub secret: String,
    pub strengths_json: String,
    pub weaknesses_json: String,
    pub voice_notes: String,
    pub arc_summary: String,
    pub knowledge_notes: String,
    pub visual_prompt: String,
    pub image_asset_id: Option<String>,
    pub status: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCharacterRelationInput {
    pub id: Option<String>,
    pub project_id: String,
    pub from_character_id: String,
    pub to_character_id: String,
    pub relation_type: String,
    pub description: String,
    pub history: String,
    pub conflict: String,
    pub opinion: String,
    pub trust_level: i64,
    pub secret: String,
    pub change_over_time: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCharacterMemoryInput {
    pub id: Option<String>,
    pub project_id: String,
    pub character_id: String,
    pub title: String,
    pub summary: String,
    pub details: String,
    pub memory_type: String,
    pub subject: String,
    pub emotion: String,
    pub importance: i64,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCharacterMemoryLinkInput {
    pub id: Option<String>,
    pub project_id: String,
    pub from_memory_id: String,
    pub to_memory_id: String,
    pub link_type: String,
    pub description: String,
    pub strength: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertWorldElementInput {
    pub id: Option<String>,
    pub project_id: String,
    pub element_type: String,
    pub name: String,
    pub summary: String,
    pub details: String,
    pub story_purpose: String,
    pub constraints: String,
    pub visual_prompt: String,
    pub image_asset_id: Option<String>,
    pub status: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertWorldRuleInput {
    pub id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
    pub cost: String,
    pub limitation: String,
    pub exceptions: String,
    pub violation_consequences: String,
    pub scene_examples: String,
    pub status: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorldElementRelationsInput {
    pub project_id: String,
    pub element_id: String,
    pub character_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub chapter_ids: Vec<String>,
    pub scene_ids: Vec<String>,
    pub rule_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorldRuleRelationsInput {
    pub project_id: String,
    pub rule_id: String,
    pub element_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub chapter_ids: Vec<String>,
    pub scene_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCharacterImageInput {
    pub project_id: String,
    pub character_id: String,
    pub prompt_package_id: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub image_prompt: String,
    pub negative_prompt: String,
    pub codex_path: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptGeneratedCharacterImageInput {
    pub project_id: String,
    pub character_id: String,
    pub image_path: String,
    pub image_prompt: String,
    pub negative_prompt: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterImageResult {
    pub character: Character,
    pub visual_asset: VisualAsset,
    pub ai_run: AiRunResult,
    pub image_path: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSeparatorSettings {
    pub text: String,
    pub font_size: i64,
    pub align: String,
    pub spacing_before: i64,
    pub spacing_after: i64,
    pub line: bool,
    pub color: String,
    pub background: String,
    pub image_asset_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStyleSettings {
    pub chapter_separator: ExportSeparatorSettings,
    pub scene_separator: ExportSeparatorSettings,
    pub page_numbers: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookInput {
    pub project_id: String,
    pub book_id: String,
    pub format: String,
    pub chapter_ids: Vec<String>,
    pub content_mode: String,
    pub style: ExportStyleSettings,
    pub output_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookResult {
    pub file_path: String,
    pub format: String,
    pub fallback_file_path: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreset {
    pub id: String,
    pub project_id: String,
    pub book_id: String,
    pub name: String,
    pub settings_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportPresetInput {
    pub id: Option<String>,
    pub project_id: String,
    pub book_id: String,
    pub name: String,
    pub settings_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateExportArtworkInput {
    pub project_id: String,
    pub book_id: String,
    pub related_type: String,
    pub related_id: String,
    pub prompt_package_id: String,
    pub prompt_package_json: Value,
    pub prompt: String,
    pub image_prompt: String,
    pub negative_prompt: String,
    pub codex_path: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptGeneratedExportArtworkInput {
    pub project_id: String,
    pub related_type: String,
    pub related_id: String,
    pub image_path: String,
    pub image_prompt: String,
    pub negative_prompt: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtworkResult {
    pub visual_asset: VisualAsset,
    pub ai_run: AiRunResult,
    pub image_path: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub generated_at: String,
}

pub async fn init_database(app_data_dir: PathBuf) -> Result<SqlitePool, AppError> {
    tokio::fs::create_dir_all(&app_data_dir).await?;
    let database_path = app_data_dir.join("storyforge2.sqlite");
    init_database_at(database_path).await
}

async fn init_database_at(database_path: PathBuf) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    recover_interrupted_ai_work(&pool).await?;
    Ok(pool)
}

pub async fn recover_interrupted_ai_work(pool: &SqlitePool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        UPDATE ai_runs
        SET status = 'terminated',
            error_message = COALESCE(error_message, 'Generacja została przerwana przez zamknięcie aplikacji.'),
            completed_at = COALESCE(completed_at, ?)
        WHERE status = 'running'
        "#,
    )
    .bind(&now)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        UPDATE ai_proposals
        SET status = 'terminated',
            updated_at = ?
        WHERE status = 'running'
        "#,
    )
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn create_project_in_pool(
    pool: &SqlitePool,
    input: CreateProjectInput,
) -> Result<ProjectDetails, AppError> {
    let trimmed_name = input.name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Process(
            "Nazwa projektu nie może być pusta".into(),
        ));
    }

    let project_id = Uuid::new_v4().to_string();
    let book_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let language = input.language.unwrap_or_else(|| "pl".to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO projects (id, name, language, created_at, updated_at, active_book_id, settings_json)
        VALUES (?, ?, ?, ?, ?, ?, '{}')
        "#,
    )
    .bind(&project_id)
    .bind(trimmed_name)
    .bind(&language)
    .bind(&now)
    .bind(&now)
    .bind(&book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO books (id, project_id, working_title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&book_id)
    .bind(&project_id)
    .bind(trimmed_name)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    get_project_details(pool, &project_id).await
}

pub async fn list_projects_in_pool(pool: &SqlitePool) -> Result<Vec<ProjectSummary>, AppError> {
    let projects = sqlx::query_as::<_, ProjectSummary>(
        r#"
        SELECT
          p.id,
          p.name,
          p.language,
          p.updated_at,
          p.active_book_id,
          COALESCE(b.working_title, '') AS working_title,
          COALESCE(b.cover_image_path, '') AS cover_image_path
        FROM projects p
        LEFT JOIN books b ON b.id = p.active_book_id
        ORDER BY p.updated_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(projects)
}

pub async fn delete_project_in_pool(pool: &SqlitePool, project_id: &str) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(project_id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::Process(
            "Nie znaleziono projektu do usunięcia.".into(),
        ));
    }

    Ok(())
}

pub async fn get_project_details(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<ProjectDetails, AppError> {
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await?;

    let book_id = project
        .active_book_id
        .clone()
        .ok_or_else(|| AppError::Process("Projekt nie ma aktywnej książki".into()))?;

    let book = sqlx::query_as::<_, Book>("SELECT * FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await?;

    Ok(ProjectDetails { project, book })
}

pub async fn get_book_plan_in_pool(pool: &SqlitePool, book_id: &str) -> Result<BookPlan, AppError> {
    let plan_version = ensure_active_plan_version_in_pool(pool, book_id).await?;
    let plan_versions = list_plan_versions_in_pool(pool, book_id).await?;

    let structure = sqlx::query_as::<_, StoryStructure>(
        "SELECT * FROM story_structures WHERE book_id = ? AND plan_version_id = ?",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_optional(pool)
    .await?;

    let acts = sqlx::query_as::<_, Act>(
        "SELECT * FROM acts WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let beats = sqlx::query_as::<_, Beat>(
        "SELECT * FROM beats WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let threads = sqlx::query_as::<_, PlotThread>(
        "SELECT * FROM plot_threads WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let chapters = sqlx::query_as::<_, Chapter>(
        "SELECT * FROM chapters WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, number, created_at",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let chapter_threads = sqlx::query_as::<_, ChapterThread>(
        r#"
        SELECT ct.chapter_id, ct.thread_id, ct.description
        FROM chapter_threads ct
        INNER JOIN chapters c ON c.id = ct.chapter_id
        WHERE c.book_id = ? AND c.plan_version_id = ?
        ORDER BY c.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let chapter_beats = sqlx::query_as::<_, ChapterBeat>(
        r#"
        SELECT cb.chapter_id, cb.beat_id
        FROM chapter_beats cb
        INNER JOIN chapters c ON c.id = cb.chapter_id
        WHERE c.book_id = ? AND c.plan_version_id = ?
        ORDER BY c.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let scenes = sqlx::query_as::<_, Scene>(
        "SELECT * FROM scenes WHERE book_id = ? AND plan_version_id = ? ORDER BY chapter_id, order_index, created_at",
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let scene_characters = sqlx::query_as::<_, SceneCharacter>(
        r#"
        SELECT sc.scene_id, sc.character_id
        FROM scene_characters sc
        INNER JOIN scenes s ON s.id = sc.scene_id
        WHERE s.book_id = ? AND s.plan_version_id = ?
        ORDER BY s.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let scene_threads = sqlx::query_as::<_, SceneThread>(
        r#"
        SELECT st.scene_id, st.thread_id
        FROM scene_threads st
        INNER JOIN scenes s ON s.id = st.scene_id
        WHERE s.book_id = ? AND s.plan_version_id = ?
        ORDER BY s.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let scene_world_elements = sqlx::query_as::<_, SceneWorldElement>(
        r#"
        SELECT swe.scene_id, swe.element_id
        FROM scene_world_elements swe
        INNER JOIN scenes s ON s.id = swe.scene_id
        WHERE s.book_id = ? AND s.plan_version_id = ?
        ORDER BY s.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    let scene_world_rules = sqlx::query_as::<_, SceneWorldRule>(
        r#"
        SELECT swr.scene_id, swr.rule_id
        FROM scene_world_rules swr
        INNER JOIN scenes s ON s.id = swr.scene_id
        WHERE s.book_id = ? AND s.plan_version_id = ?
        ORDER BY s.order_index
        "#,
    )
    .bind(book_id)
    .bind(&plan_version.id)
    .fetch_all(pool)
    .await?;

    Ok(BookPlan {
        plan_version,
        plan_versions,
        structure,
        acts,
        beats,
        threads,
        chapters,
        chapter_threads,
        chapter_beats,
        scenes,
        scene_characters,
        scene_threads,
        scene_world_elements,
        scene_world_rules,
    })
}

pub async fn list_plan_versions_in_pool(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<Vec<PlanVersion>, AppError> {
    sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE book_id = ? ORDER BY is_active DESC, updated_at DESC, created_at DESC",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

async fn ensure_active_plan_version_in_pool(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<PlanVersion, AppError> {
    if let Some(version) = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE book_id = ? AND is_active = 1 LIMIT 1",
    )
    .bind(book_id)
    .fetch_optional(pool)
    .await?
    {
        return Ok(version);
    }

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO plan_versions (id, book_id, name, description, is_active, created_at, updated_at)
        VALUES (?, ?, 'Plan główny', '', 1, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(book_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, PlanVersion>("SELECT * FROM plan_versions WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

async fn active_plan_version_id_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    book_id: &str,
) -> Result<String, AppError> {
    if let Some((id,)) = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM plan_versions WHERE book_id = ? AND is_active = 1 LIMIT 1",
    )
    .bind(book_id)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(id);
    }

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO plan_versions (id, book_id, name, description, is_active, created_at, updated_at)
        VALUES (?, ?, 'Plan główny', '', 1, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(book_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(id)
}

pub async fn save_story_structure_in_pool(
    pool: &SqlitePool,
    input: SaveStoryStructureInput,
) -> Result<StoryStructure, AppError> {
    if input.structure_type.trim().is_empty() {
        return Err(AppError::Process(
            "Typ struktury nie moze byc pusty.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let status = input.status.unwrap_or_else(|| "draft".into());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    sqlx::query(
        r#"
        INSERT INTO story_structures
          (id, book_id, plan_version_id, structure_type, description, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(plan_version_id) DO UPDATE SET
          structure_type = excluded.structure_type,
          description = excluded.description,
          notes = excluded.notes,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.structure_type.trim())
    .bind(input.description)
    .bind(input.notes)
    .bind(status)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, StoryStructure>(
        "SELECT * FROM story_structures WHERE book_id = ? AND plan_version_id = ?",
    )
    .bind(&input.book_id)
    .bind(plan_version_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn upsert_act_in_pool(pool: &SqlitePool, input: UpsertActInput) -> Result<Act, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process("Nazwa aktu nie moze byc pusta.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    sqlx::query(
        r#"
        INSERT INTO acts
          (id, book_id, plan_version_id, name, purpose, summary, start_percent, end_percent, order_index, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          purpose = excluded.purpose,
          summary = excluded.summary,
          start_percent = excluded.start_percent,
          end_percent = excluded.end_percent,
          order_index = excluded.order_index,
          color = excluded.color,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.name)
    .bind(input.purpose)
    .bind(input.summary)
    .bind(input.start_percent)
    .bind(input.end_percent)
    .bind(input.order_index)
    .bind(input.color)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Act>("SELECT * FROM acts WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_beat_in_pool(
    pool: &SqlitePool,
    input: UpsertBeatInput,
) -> Result<Beat, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process("Nazwa beatu nie moze byc pusta.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    sqlx::query(
        r#"
        INSERT INTO beats
          (id, book_id, plan_version_id, name, description, role, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          role = excluded.role,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.role)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Beat>("SELECT * FROM beats WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn move_beat_to_chapter_in_pool(
    pool: &SqlitePool,
    input: MoveBeatToChapterInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    let beat_exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM beats WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(&input.beat_id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .fetch_one(&mut *tx)
    .await?;
    if beat_exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono beatu.".into()));
    }

    if let Some(chapter_id) = &input.chapter_id {
        let chapter_exists: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ? AND plan_version_id = ?",
        )
        .bind(chapter_id)
        .bind(&input.book_id)
        .bind(&plan_version_id)
        .fetch_one(&mut *tx)
        .await?;
        if chapter_exists.0 == 0 {
            return Err(AppError::Process("Nie znaleziono rozdzialu.".into()));
        }
    }

    sqlx::query("DELETE FROM chapter_beats WHERE beat_id = ?")
        .bind(&input.beat_id)
        .execute(&mut *tx)
        .await?;

    if let Some(chapter_id) = &input.chapter_id {
        sqlx::query("INSERT OR IGNORE INTO chapter_beats (chapter_id, beat_id) VALUES (?, ?)")
            .bind(chapter_id)
            .bind(&input.beat_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("UPDATE beats SET order_index = ?, updated_at = ? WHERE id = ?")
        .bind(input.order_index)
        .bind(&now)
        .bind(&input.beat_id)
        .execute(&mut *tx)
        .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_plot_thread_in_pool(
    pool: &SqlitePool,
    input: UpsertPlotThreadInput,
) -> Result<PlotThread, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process("Nazwa watku nie moze byc pusta.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    sqlx::query(
        r#"
        INSERT INTO plot_threads
          (id, book_id, plan_version_id, name, description, resolution, color, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          resolution = excluded.resolution,
          color = excluded.color,
          status = excluded.status,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.resolution)
    .bind(input.color)
    .bind(input.status)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, PlotThread>("SELECT * FROM plot_threads WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_chapter_in_pool(
    pool: &SqlitePool,
    input: UpsertChapterInput,
) -> Result<Chapter, AppError> {
    if input.working_title.trim().is_empty() {
        return Err(AppError::Process(
            "Tytul rozdzialu nie moze byc pusty.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    sqlx::query(
        r#"
        INSERT INTO chapters
          (id, book_id, plan_version_id, act_id, number, working_title, summary, purpose, conflict, turning_point, target_word_count, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          act_id = excluded.act_id,
          number = excluded.number,
          working_title = excluded.working_title,
          summary = excluded.summary,
          purpose = excluded.purpose,
          conflict = excluded.conflict,
          turning_point = excluded.turning_point,
          target_word_count = excluded.target_word_count,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.act_id)
    .bind(input.number)
    .bind(input.working_title)
    .bind(input.summary)
    .bind(input.purpose)
    .bind(input.conflict)
    .bind(input.turning_point)
    .bind(input.target_word_count)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    let existing_thread_descriptions = sqlx::query_as::<_, (String, String)>(
        "SELECT thread_id, description FROM chapter_threads WHERE chapter_id = ?",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM chapter_threads WHERE chapter_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for thread_id in unique_ids(input.thread_ids) {
        let description = existing_thread_descriptions
            .iter()
            .find(|(existing_thread_id, _)| existing_thread_id == &thread_id)
            .map(|(_, description)| description.as_str())
            .unwrap_or("");
        sqlx::query(
            "INSERT OR IGNORE INTO chapter_threads (chapter_id, thread_id, description) VALUES (?, ?, ?)",
        )
        .bind(&id)
        .bind(thread_id)
        .bind(description)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM chapter_beats WHERE chapter_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    let beat_ids = unique_ids(input.beat_ids);
    for beat_id in &beat_ids {
        sqlx::query("DELETE FROM chapter_beats WHERE beat_id = ?")
            .bind(beat_id)
            .execute(&mut *tx)
            .await?;
    }
    for beat_id in beat_ids {
        sqlx::query("INSERT OR IGNORE INTO chapter_beats (chapter_id, beat_id) VALUES (?, ?)")
            .bind(&id)
            .bind(beat_id)
            .execute(&mut *tx)
            .await?;
    }

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Chapter>("SELECT * FROM chapters WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_chapter_thread_relation_in_pool(
    pool: &SqlitePool,
    input: UpsertChapterThreadInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;

    let chapter_exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(&input.chapter_id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .fetch_one(&mut *tx)
    .await?;
    if chapter_exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono rozdzialu.".into()));
    }

    let thread_exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM plot_threads WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(&input.thread_id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .fetch_one(&mut *tx)
    .await?;
    if thread_exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono watku.".into()));
    }

    sqlx::query(
        r#"
        INSERT INTO chapter_threads (chapter_id, thread_id, description)
        VALUES (?, ?, ?)
        ON CONFLICT(chapter_id, thread_id) DO UPDATE SET
          description = excluded.description
        "#,
    )
    .bind(&input.chapter_id)
    .bind(&input.thread_id)
    .bind(input.description)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn create_plan_version_from_active_in_pool(
    pool: &SqlitePool,
    input: CreatePlanVersionInput,
) -> Result<PlanVersion, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process(
            "Nazwa wariantu planu nie moze byc pusta.".into(),
        ));
    }

    let active = ensure_active_plan_version_in_pool(pool, &input.book_id).await?;
    let now = Utc::now().to_rfc3339();
    let new_version_id = Uuid::new_v4().to_string();
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO plan_versions (id, book_id, name, description, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        "#,
    )
    .bind(&new_version_id)
    .bind(&input.book_id)
    .bind(input.name.trim())
    .bind(input.description.unwrap_or_default())
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    let mut act_ids: Vec<(String, String)> = Vec::new();
    let acts = sqlx::query_as::<_, Act>(
        "SELECT * FROM acts WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_all(&mut *tx)
    .await?;
    for act in acts {
        let new_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO acts
              (id, book_id, plan_version_id, name, purpose, summary, start_percent, end_percent, order_index, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&new_id)
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(act.name)
        .bind(act.purpose)
        .bind(act.summary)
        .bind(act.start_percent)
        .bind(act.end_percent)
        .bind(act.order_index)
        .bind(act.color)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        act_ids.push((act.id, new_id));
    }

    let mut thread_ids: Vec<(String, String)> = Vec::new();
    let threads = sqlx::query_as::<_, PlotThread>(
        "SELECT * FROM plot_threads WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_all(&mut *tx)
    .await?;
    for thread in threads {
        let new_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO plot_threads
              (id, book_id, plan_version_id, name, description, color, status, order_index, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&new_id)
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(thread.name)
        .bind(thread.description)
        .bind(thread.color)
        .bind(thread.status)
        .bind(thread.order_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        thread_ids.push((thread.id, new_id));
    }

    let mut beat_ids: Vec<(String, String)> = Vec::new();
    let beats = sqlx::query_as::<_, Beat>(
        "SELECT * FROM beats WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, created_at",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_all(&mut *tx)
    .await?;
    for beat in beats {
        let new_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO beats
              (id, book_id, plan_version_id, name, description, role, order_index, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&new_id)
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(beat.name)
        .bind(beat.description)
        .bind(beat.role)
        .bind(beat.order_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        beat_ids.push((beat.id, new_id));
    }

    let structure = sqlx::query_as::<_, StoryStructure>(
        "SELECT * FROM story_structures WHERE book_id = ? AND plan_version_id = ?",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(structure) = structure {
        sqlx::query(
            r#"
            INSERT INTO story_structures
              (id, book_id, plan_version_id, structure_type, description, notes, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(structure.structure_type)
        .bind(structure.description)
        .bind(structure.notes)
        .bind(structure.status)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    }

    let mut chapter_ids: Vec<(String, String)> = Vec::new();
    let chapters = sqlx::query_as::<_, Chapter>(
        "SELECT * FROM chapters WHERE book_id = ? AND plan_version_id = ? ORDER BY order_index, number, created_at",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_all(&mut *tx)
    .await?;
    for chapter in chapters {
        let new_id = Uuid::new_v4().to_string();
        let mapped_act_id = chapter.act_id.as_ref().and_then(|id| map_id(&act_ids, id));
        sqlx::query(
            r#"
            INSERT INTO chapters
              (id, book_id, plan_version_id, act_id, number, working_title, summary, purpose, conflict, turning_point, target_word_count, order_index, auto_summary, auto_summary_stale, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&new_id)
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(mapped_act_id)
        .bind(chapter.number)
        .bind(chapter.working_title)
        .bind(chapter.summary)
        .bind(chapter.purpose)
        .bind(chapter.conflict)
        .bind(chapter.turning_point)
        .bind(chapter.target_word_count)
        .bind(chapter.order_index)
        .bind(chapter.auto_summary)
        .bind(chapter.auto_summary_stale)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        chapter_ids.push((chapter.id, new_id));
    }

    copy_mapped_chapter_relations(&mut tx, &chapter_ids, &thread_ids, &beat_ids).await?;

    let mut scene_ids: Vec<(String, String)> = Vec::new();
    let scenes = sqlx::query_as::<_, Scene>(
        "SELECT * FROM scenes WHERE book_id = ? AND plan_version_id = ? ORDER BY chapter_id, order_index",
    )
    .bind(&input.book_id)
    .bind(&active.id)
    .fetch_all(&mut *tx)
    .await?;
    for scene in scenes {
        let mapped_chapter_id = scene
            .chapter_id
            .as_ref()
            .and_then(|id| map_id(&chapter_ids, id));
        let new_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO scenes
              (id, book_id, plan_version_id, chapter_id, order_index, title, summary, goal, conflict, outcome, time_marker, pov_character_id, location_id, target_word_count, actual_word_count, manuscript_content, auto_summary, auto_summary_source_hash, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&new_id)
        .bind(&input.book_id)
        .bind(&new_version_id)
        .bind(mapped_chapter_id)
        .bind(scene.order_index)
        .bind(scene.title)
        .bind(scene.summary)
        .bind(scene.goal)
        .bind(scene.conflict)
        .bind(scene.outcome)
        .bind(scene.time_marker)
        .bind(scene.pov_character_id)
        .bind(scene.location_id)
        .bind(scene.target_word_count)
        .bind(scene.actual_word_count)
        .bind(scene.manuscript_content)
        .bind(scene.auto_summary)
        .bind(scene.auto_summary_source_hash)
        .bind(scene.status)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        scene_ids.push((scene.id, new_id));
    }
    copy_mapped_scene_relations(&mut tx, &scene_ids, &thread_ids).await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, PlanVersion>("SELECT * FROM plan_versions WHERE id = ?")
        .bind(new_version_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn set_active_plan_version_in_pool(
    pool: &SqlitePool,
    input: SetActivePlanVersionInput,
) -> Result<PlanVersion, AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plan_versions WHERE id = ? AND book_id = ?")
            .bind(&input.plan_version_id)
            .bind(&input.book_id)
            .fetch_one(&mut *tx)
            .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono wariantu planu.".into()));
    }

    sqlx::query("UPDATE plan_versions SET is_active = 0, updated_at = ? WHERE book_id = ?")
        .bind(&now)
        .bind(&input.book_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE plan_versions SET is_active = 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&input.plan_version_id)
        .execute(&mut *tx)
        .await?;
    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, PlanVersion>("SELECT * FROM plan_versions WHERE id = ?")
        .bind(input.plan_version_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn delete_plan_version_in_pool(
    pool: &SqlitePool,
    input: DeletePlanVersionInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let version = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE id = ? AND book_id = ?",
    )
    .bind(&input.plan_version_id)
    .bind(&input.book_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(version) = version else {
        return Err(AppError::Process("Nie znaleziono wariantu planu.".into()));
    };
    if version.is_active != 0 {
        return Err(AppError::Process(
            "Nie można usunąć aktywnego wariantu planu.".into(),
        ));
    }

    let version_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plan_versions WHERE book_id = ?")
            .bind(&input.book_id)
            .fetch_one(&mut *tx)
            .await?;
    if version_count.0 <= 1 {
        return Err(AppError::Process(
            "Nie można usunąć ostatniego wariantu planu.".into(),
        ));
    }

    sqlx::query(
        "DELETE FROM chapter_threads WHERE chapter_id IN (SELECT id FROM chapters WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM chapter_beats WHERE chapter_id IN (SELECT id FROM chapters WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM scene_characters WHERE scene_id IN (SELECT id FROM scenes WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM scene_threads WHERE scene_id IN (SELECT id FROM scenes WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM scene_world_elements WHERE scene_id IN (SELECT id FROM scenes WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM scene_world_rules WHERE scene_id IN (SELECT id FROM scenes WHERE plan_version_id = ?)",
    )
    .bind(&input.plan_version_id)
    .execute(&mut *tx)
    .await?;
    for table in [
        "story_structures",
        "scenes",
        "chapters",
        "acts",
        "beats",
        "plot_threads",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE plan_version_id = ?"))
            .bind(&input.plan_version_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM plan_versions WHERE id = ? AND book_id = ?")
        .bind(&input.plan_version_id)
        .bind(&input.book_id)
        .execute(&mut *tx)
        .await?;
    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_scene_in_pool(
    pool: &SqlitePool,
    input: UpsertSceneInput,
) -> Result<Scene, AppError> {
    if input.title.trim().is_empty() {
        return Err(AppError::Process("Tytuł sceny nie może być pusty.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;
    validate_optional_chapter_for_plan(
        &mut tx,
        &input.chapter_id,
        &input.book_id,
        &plan_version_id,
    )
    .await?;

    if let Some(character_id) = &input.pov_character_id {
        validate_character_for_book(&mut tx, character_id, &input.book_id).await?;
    }
    if let Some(location_id) = &input.location_id {
        validate_world_element_for_book(&mut tx, location_id, &input.book_id).await?;
    }

    sqlx::query(
        r#"
        INSERT INTO scenes
          (id, book_id, plan_version_id, chapter_id, order_index, title, summary, goal, conflict, outcome, time_marker, pov_character_id, location_id, target_word_count, actual_word_count, manuscript_content, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          chapter_id = excluded.chapter_id,
          order_index = excluded.order_index,
          title = excluded.title,
          summary = excluded.summary,
          goal = excluded.goal,
          conflict = excluded.conflict,
          outcome = excluded.outcome,
          time_marker = excluded.time_marker,
          pov_character_id = excluded.pov_character_id,
          location_id = excluded.location_id,
          target_word_count = excluded.target_word_count,
          actual_word_count = excluded.actual_word_count,
          manuscript_content = excluded.manuscript_content,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(&plan_version_id)
    .bind(input.chapter_id)
    .bind(input.order_index)
    .bind(input.title)
    .bind(input.summary)
    .bind(input.goal)
    .bind(input.conflict)
    .bind(input.outcome)
    .bind(input.time_marker.unwrap_or_default())
    .bind(input.pov_character_id)
    .bind(input.location_id)
    .bind(input.target_word_count)
    .bind(input.actual_word_count.unwrap_or(0))
    .bind(input.manuscript_content.unwrap_or_default())
    .bind(input.status)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Scene>("SELECT * FROM scenes WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn delete_scene_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM scenes WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn search_project_in_pool(
    pool: &SqlitePool,
    project_id: &str,
    query: &str,
) -> Result<Vec<SearchResult>, AppError> {
    // Frazy w cudzysłowach z prefiksem — bezpieczne wobec składni FTS5
    // i działa przy wpisywaniu ("smok" znajdzie "smoka" po prefiksie).
    let sanitized = query.replace('"', " ");
    let terms: Vec<String> = sanitized
        .split_whitespace()
        .map(|term| format!("\"{term}\"*"))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as::<_, SearchResult>(
        r#"
        SELECT
            entity_type,
            entity_id,
            title,
            snippet(search_index, 4, '[', ']', '…', 12) AS snippet
        FROM search_index
        WHERE search_index MATCH ? AND project_id = ?
        ORDER BY rank
        LIMIT 50
        "#,
    )
    .bind(terms.join(" "))
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

pub async fn create_scene_snapshot_in_pool(
    pool: &SqlitePool,
    scene_id: &str,
    source: &str,
) -> Result<Option<SceneSnapshotMeta>, AppError> {
    let scene = sqlx::query_as::<_, Scene>("SELECT * FROM scenes WHERE id = ?")
        .bind(scene_id)
        .fetch_one(pool)
        .await?;
    if html_to_plain_text(&scene.manuscript_content).trim().is_empty() {
        return Ok(None);
    }

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let word_count = html_to_plain_text(&scene.manuscript_content)
        .split_whitespace()
        .count() as i64;
    sqlx::query(
        r#"
        INSERT INTO scene_snapshots (id, scene_id, content, word_count, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(scene_id)
    .bind(&scene.manuscript_content)
    .bind(word_count)
    .bind(source)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(Some(SceneSnapshotMeta {
        id,
        scene_id: scene_id.to_string(),
        word_count,
        source: source.to_string(),
        created_at: now,
    }))
}

pub async fn list_scene_snapshots_in_pool(
    pool: &SqlitePool,
    scene_id: &str,
) -> Result<Vec<SceneSnapshotMeta>, AppError> {
    sqlx::query_as::<_, SceneSnapshotMeta>(
        r#"
        SELECT id, scene_id, word_count, source, created_at
        FROM scene_snapshots
        WHERE scene_id = ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(scene_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

pub async fn get_scene_snapshot_in_pool(
    pool: &SqlitePool,
    id: &str,
) -> Result<SceneSnapshot, AppError> {
    sqlx::query_as::<_, SceneSnapshot>("SELECT * FROM scene_snapshots WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn restore_scene_snapshot_in_pool(
    pool: &SqlitePool,
    id: &str,
) -> Result<Scene, AppError> {
    let snapshot = get_scene_snapshot_in_pool(pool, id).await?;
    // Auto-migawka bieżącego tekstu, żeby przywrócenie było odwracalne.
    create_scene_snapshot_in_pool(pool, &snapshot.scene_id, "restore").await?;

    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE scenes
        SET manuscript_content = ?, actual_word_count = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&snapshot.content)
    .bind(snapshot.word_count)
    .bind(&now)
    .bind(&snapshot.scene_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        UPDATE projects
        SET updated_at = ?
        WHERE id = (SELECT project_id FROM books WHERE id = (SELECT book_id FROM scenes WHERE id = ?))
        "#,
    )
    .bind(&now)
    .bind(&snapshot.scene_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    sqlx::query_as::<_, Scene>("SELECT * FROM scenes WHERE id = ?")
        .bind(&snapshot.scene_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn save_scene_auto_summary_in_pool(
    pool: &SqlitePool,
    input: SaveSceneAutoSummaryInput,
) -> Result<Scene, AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE scenes
        SET auto_summary = ?, auto_summary_source_hash = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&input.auto_summary)
    .bind(&input.source_hash)
    .bind(&now)
    .bind(&input.scene_id)
    .execute(&mut *tx)
    .await?;
    // Świeże streszczenie sceny unieważnia streszczenie rozdziału i książki.
    sqlx::query(
        r#"
        UPDATE chapters
        SET auto_summary_stale = 1
        WHERE id = (SELECT chapter_id FROM scenes WHERE id = ?)
        "#,
    )
    .bind(&input.scene_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        UPDATE books
        SET story_so_far_stale = 1
        WHERE id = (SELECT book_id FROM scenes WHERE id = ?)
        "#,
    )
    .bind(&input.scene_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    sqlx::query_as::<_, Scene>("SELECT * FROM scenes WHERE id = ?")
        .bind(&input.scene_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn save_scene_critique_in_pool(
    pool: &SqlitePool,
    input: SaveSceneCritiqueInput,
) -> Result<SceneCritiqueRecord, AppError> {
    let now = Utc::now().to_rfc3339();
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    // Jeden raport na scenę — kolejna krytyka nadpisuje poprzednią.
    sqlx::query(
        r#"
        INSERT INTO scene_critiques (
            id, project_id, book_id, scene_id, ai_run_id,
            summary, findings_json, source_hash, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scene_id) DO UPDATE SET
            ai_run_id = excluded.ai_run_id,
            summary = excluded.summary,
            findings_json = excluded.findings_json,
            source_hash = excluded.source_hash,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&input.book_id)
    .bind(&input.scene_id)
    .bind(&input.ai_run_id)
    .bind(&input.summary)
    .bind(&input.findings_json)
    .bind(&input.source_hash)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, SceneCritiqueRecord>(
        "SELECT * FROM scene_critiques WHERE scene_id = ?",
    )
    .bind(&input.scene_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn list_scene_critiques_in_pool(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<Vec<SceneCritiqueRecord>, AppError> {
    sqlx::query_as::<_, SceneCritiqueRecord>(
        "SELECT * FROM scene_critiques WHERE book_id = ? ORDER BY updated_at DESC",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

pub async fn set_scene_style_reference_in_pool(
    pool: &SqlitePool,
    input: SetSceneStyleReferenceInput,
) -> Result<Scene, AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let book_id: String = sqlx::query_scalar("SELECT book_id FROM scenes WHERE id = ?")
        .bind(&input.scene_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query(
        r#"
        UPDATE scenes
        SET is_style_reference = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(input.is_style_reference)
    .bind(&now)
    .bind(&input.scene_id)
    .execute(&mut *tx)
    .await?;
    touch_project_for_book(&mut tx, &book_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Scene>("SELECT * FROM scenes WHERE id = ?")
        .bind(&input.scene_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn save_chapter_auto_summary_in_pool(
    pool: &SqlitePool,
    input: SaveChapterAutoSummaryInput,
) -> Result<Chapter, AppError> {
    sqlx::query(
        r#"
        UPDATE chapters
        SET auto_summary = ?, auto_summary_stale = 0
        WHERE id = ?
        "#,
    )
    .bind(&input.auto_summary)
    .bind(&input.chapter_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, Chapter>("SELECT * FROM chapters WHERE id = ?")
        .bind(&input.chapter_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn save_story_so_far_in_pool(
    pool: &SqlitePool,
    input: SaveStorySoFarInput,
) -> Result<Book, AppError> {
    sqlx::query(
        r#"
        UPDATE books
        SET story_so_far = ?, story_so_far_stale = 0
        WHERE id = ?
        "#,
    )
    .bind(&input.story_so_far)
    .bind(&input.book_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, Book>("SELECT * FROM books WHERE id = ?")
        .bind(&input.book_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn reorder_scenes_in_pool(
    pool: &SqlitePool,
    input: ReorderScenesInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;
    validate_optional_chapter_for_plan(
        &mut tx,
        &input.chapter_id,
        &input.book_id,
        &plan_version_id,
    )
    .await?;
    for (index, id) in input.ordered_ids.iter().enumerate() {
        if let Some(chapter_id) = &input.chapter_id {
            sqlx::query(
                "UPDATE scenes SET order_index = ?, updated_at = ? WHERE id = ? AND book_id = ? AND plan_version_id = ? AND chapter_id = ?",
            )
            .bind(index as i64)
            .bind(&now)
            .bind(id)
            .bind(&input.book_id)
            .bind(&plan_version_id)
            .bind(chapter_id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE scenes SET order_index = ?, updated_at = ? WHERE id = ? AND book_id = ? AND plan_version_id = ? AND chapter_id IS NULL",
            )
            .bind(index as i64)
            .bind(&now)
            .bind(id)
            .bind(&input.book_id)
            .bind(&plan_version_id)
            .execute(&mut *tx)
            .await?;
        }
    }
    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_scene_relations_in_pool(
    pool: &SqlitePool,
    input: SetSceneRelationsInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    let plan_version_id = active_plan_version_id_in_tx(&mut tx, &input.book_id).await?;
    validate_scene_for_plan(&mut tx, &input.scene_id, &input.book_id, &plan_version_id).await?;

    sqlx::query("DELETE FROM scene_characters WHERE scene_id = ?")
        .bind(&input.scene_id)
        .execute(&mut *tx)
        .await?;
    for character_id in unique_ids(input.character_ids) {
        validate_character_for_book(&mut tx, &character_id, &input.book_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO scene_characters (scene_id, character_id) VALUES (?, ?)",
        )
        .bind(&input.scene_id)
        .bind(character_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM scene_threads WHERE scene_id = ?")
        .bind(&input.scene_id)
        .execute(&mut *tx)
        .await?;
    for thread_id in unique_ids(input.thread_ids) {
        validate_thread_for_plan(&mut tx, &thread_id, &input.book_id, &plan_version_id).await?;
        sqlx::query("INSERT OR IGNORE INTO scene_threads (scene_id, thread_id) VALUES (?, ?)")
            .bind(&input.scene_id)
            .bind(thread_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM scene_world_elements WHERE scene_id = ?")
        .bind(&input.scene_id)
        .execute(&mut *tx)
        .await?;
    for element_id in unique_ids(input.element_ids) {
        validate_world_element_for_book(&mut tx, &element_id, &input.book_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO scene_world_elements (scene_id, element_id) VALUES (?, ?)",
        )
        .bind(&input.scene_id)
        .bind(element_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM scene_world_rules WHERE scene_id = ?")
        .bind(&input.scene_id)
        .execute(&mut *tx)
        .await?;
    for rule_id in unique_ids(input.rule_ids) {
        validate_world_rule_for_book(&mut tx, &rule_id, &input.book_id).await?;
        sqlx::query("INSERT OR IGNORE INTO scene_world_rules (scene_id, rule_id) VALUES (?, ?)")
            .bind(&input.scene_id)
            .bind(rule_id)
            .execute(&mut *tx)
            .await?;
    }

    touch_project_for_book(&mut tx, &input.book_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn delete_act_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    delete_plan_item_in_pool(pool, "acts", id).await
}

pub async fn delete_beat_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    delete_plan_item_in_pool(pool, "beats", id).await
}

pub async fn delete_plot_thread_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    delete_plan_item_in_pool(pool, "plot_threads", id).await
}

pub async fn delete_chapter_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    delete_plan_item_in_pool(pool, "chapters", id).await
}

pub async fn reorder_plan_items_in_pool(
    pool: &SqlitePool,
    input: ReorderPlanItemsInput,
) -> Result<(), AppError> {
    let table = plan_table_for_item_type(&input.item_type)?;
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;

    for (index, id) in input.ordered_ids.iter().enumerate() {
        let sql = format!("UPDATE {table} SET order_index = ?, updated_at = ? WHERE id = ?");
        sqlx::query(&sql)
            .bind(index as i64)
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

async fn delete_plan_item_in_pool(
    pool: &SqlitePool,
    table: &str,
    id: &str,
) -> Result<(), AppError> {
    let sql = format!("DELETE FROM {table} WHERE id = ?");
    sqlx::query(&sql).bind(id).execute(pool).await?;
    Ok(())
}

fn plan_table_for_item_type(item_type: &str) -> Result<&'static str, AppError> {
    match item_type {
        "act" | "acts" => Ok("acts"),
        "beat" | "beats" => Ok("beats"),
        "thread" | "threads" | "plotThread" | "plotThreads" => Ok("plot_threads"),
        "chapter" | "chapters" => Ok("chapters"),
        _ => Err(AppError::Process("Nieznany typ elementu planu.".into())),
    }
}

fn map_id(map: &[(String, String)], old_id: &str) -> Option<String> {
    map.iter()
        .find(|(source_id, _)| source_id == old_id)
        .map(|(_, target_id)| target_id.clone())
}

async fn copy_mapped_chapter_relations(
    tx: &mut Transaction<'_, Sqlite>,
    chapter_ids: &[(String, String)],
    thread_ids: &[(String, String)],
    beat_ids: &[(String, String)],
) -> Result<(), AppError> {
    for (old_chapter_id, new_chapter_id) in chapter_ids {
        let chapter_threads = sqlx::query_as::<_, ChapterThread>(
            "SELECT chapter_id, thread_id, description FROM chapter_threads WHERE chapter_id = ?",
        )
        .bind(old_chapter_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in chapter_threads {
            if let Some(new_thread_id) = map_id(thread_ids, &relation.thread_id) {
                sqlx::query(
                    "INSERT OR IGNORE INTO chapter_threads (chapter_id, thread_id, description) VALUES (?, ?, ?)",
                )
                .bind(new_chapter_id)
                .bind(new_thread_id)
                .bind(relation.description)
                .execute(&mut **tx)
                .await?;
            }
        }

        let chapter_beats = sqlx::query_as::<_, ChapterBeat>(
            "SELECT chapter_id, beat_id FROM chapter_beats WHERE chapter_id = ?",
        )
        .bind(old_chapter_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in chapter_beats {
            if let Some(new_beat_id) = map_id(beat_ids, &relation.beat_id) {
                sqlx::query(
                    "INSERT OR IGNORE INTO chapter_beats (chapter_id, beat_id) VALUES (?, ?)",
                )
                .bind(new_chapter_id)
                .bind(new_beat_id)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    Ok(())
}

async fn copy_mapped_scene_relations(
    tx: &mut Transaction<'_, Sqlite>,
    scene_ids: &[(String, String)],
    thread_ids: &[(String, String)],
) -> Result<(), AppError> {
    for (old_scene_id, new_scene_id) in scene_ids {
        let characters = sqlx::query_as::<_, SceneCharacter>(
            "SELECT scene_id, character_id FROM scene_characters WHERE scene_id = ?",
        )
        .bind(old_scene_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in characters {
            sqlx::query(
                "INSERT OR IGNORE INTO scene_characters (scene_id, character_id) VALUES (?, ?)",
            )
            .bind(new_scene_id)
            .bind(relation.character_id)
            .execute(&mut **tx)
            .await?;
        }

        let threads = sqlx::query_as::<_, SceneThread>(
            "SELECT scene_id, thread_id FROM scene_threads WHERE scene_id = ?",
        )
        .bind(old_scene_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in threads {
            if let Some(new_thread_id) = map_id(thread_ids, &relation.thread_id) {
                sqlx::query(
                    "INSERT OR IGNORE INTO scene_threads (scene_id, thread_id) VALUES (?, ?)",
                )
                .bind(new_scene_id)
                .bind(new_thread_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        let elements = sqlx::query_as::<_, SceneWorldElement>(
            "SELECT scene_id, element_id FROM scene_world_elements WHERE scene_id = ?",
        )
        .bind(old_scene_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in elements {
            sqlx::query(
                "INSERT OR IGNORE INTO scene_world_elements (scene_id, element_id) VALUES (?, ?)",
            )
            .bind(new_scene_id)
            .bind(relation.element_id)
            .execute(&mut **tx)
            .await?;
        }

        let rules = sqlx::query_as::<_, SceneWorldRule>(
            "SELECT scene_id, rule_id FROM scene_world_rules WHERE scene_id = ?",
        )
        .bind(old_scene_id)
        .fetch_all(&mut **tx)
        .await?;
        for relation in rules {
            sqlx::query(
                "INSERT OR IGNORE INTO scene_world_rules (scene_id, rule_id) VALUES (?, ?)",
            )
            .bind(new_scene_id)
            .bind(relation.rule_id)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

async fn validate_chapter_for_plan(
    tx: &mut Transaction<'_, Sqlite>,
    chapter_id: &str,
    book_id: &str,
    plan_version_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(chapter_id)
    .bind(book_id)
    .bind(plan_version_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono rozdziału w aktywnym wariancie planu.".into(),
        ));
    }
    Ok(())
}

async fn validate_optional_chapter_for_plan(
    tx: &mut Transaction<'_, Sqlite>,
    chapter_id: &Option<String>,
    book_id: &str,
    plan_version_id: &str,
) -> Result<(), AppError> {
    if let Some(chapter_id) = chapter_id {
        validate_chapter_for_plan(tx, chapter_id, book_id, plan_version_id).await?;
    }

    Ok(())
}

async fn validate_thread_for_plan(
    tx: &mut Transaction<'_, Sqlite>,
    thread_id: &str,
    book_id: &str,
    plan_version_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM plot_threads WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(thread_id)
    .bind(book_id)
    .bind(plan_version_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono wątku w aktywnym wariancie planu.".into(),
        ));
    }
    Ok(())
}

async fn validate_scene_for_plan(
    tx: &mut Transaction<'_, Sqlite>,
    scene_id: &str,
    book_id: &str,
    plan_version_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM scenes WHERE id = ? AND book_id = ? AND plan_version_id = ?",
    )
    .bind(scene_id)
    .bind(book_id)
    .bind(plan_version_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono sceny w aktywnym wariancie planu.".into(),
        ));
    }
    Ok(())
}

async fn validate_character_for_book(
    tx: &mut Transaction<'_, Sqlite>,
    character_id: &str,
    book_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM characters c
        JOIN books b ON b.project_id = c.project_id
        WHERE c.id = ? AND b.id = ?
        "#,
    )
    .bind(character_id)
    .bind(book_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono postaci dla tej książki.".into(),
        ));
    }
    Ok(())
}

async fn validate_world_element_for_book(
    tx: &mut Transaction<'_, Sqlite>,
    element_id: &str,
    book_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM world_elements e
        JOIN books b ON b.project_id = e.project_id
        WHERE e.id = ? AND b.id = ?
        "#,
    )
    .bind(element_id)
    .bind(book_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono elementu świata dla tej książki.".into(),
        ));
    }
    Ok(())
}

async fn validate_world_rule_for_book(
    tx: &mut Transaction<'_, Sqlite>,
    rule_id: &str,
    book_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM world_rules r
        JOIN books b ON b.project_id = r.project_id
        WHERE r.id = ? AND b.id = ?
        "#,
    )
    .bind(rule_id)
    .bind(book_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono reguły świata dla tej książki.".into(),
        ));
    }
    Ok(())
}

async fn touch_project_for_book(
    tx: &mut Transaction<'_, Sqlite>,
    book_id: &str,
    updated_at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE books
        SET updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(updated_at)
    .bind(book_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE projects
        SET updated_at = ?
        WHERE id = (SELECT project_id FROM books WHERE id = ?)
        "#,
    )
    .bind(updated_at)
    .bind(book_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn touch_project_by_id(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    updated_at: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
        .bind(updated_at)
        .bind(project_id)
        .execute(&mut **tx)
        .await?;

    sqlx::query("UPDATE books SET updated_at = ? WHERE project_id = ?")
        .bind(updated_at)
        .bind(project_id)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

fn unique_ids(ids: Vec<String>) -> Vec<String> {
    let mut unique = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if !trimmed.is_empty() && !unique.iter().any(|item: &String| item == trimmed) {
            unique.push(trimmed.to_string());
        }
    }
    unique
}

pub async fn get_character_workspace_in_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<CharacterWorkspace, AppError> {
    let characters = sqlx::query_as::<_, Character>(
        "SELECT * FROM characters WHERE project_id = ? ORDER BY order_index, created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let relations = sqlx::query_as::<_, CharacterRelation>(
        "SELECT * FROM character_relations WHERE project_id = ? ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let memories = sqlx::query_as::<_, CharacterMemory>(
        "SELECT * FROM character_memories WHERE project_id = ? ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let memory_links = sqlx::query_as::<_, CharacterMemoryLink>(
        "SELECT * FROM character_memory_links WHERE project_id = ? ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let visual_assets = sqlx::query_as::<_, VisualAsset>(
        "SELECT * FROM visual_assets WHERE project_id = ? ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(CharacterWorkspace {
        characters,
        relations,
        memories,
        memory_links,
        visual_assets,
    })
}

pub async fn get_world_workspace_in_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<WorldWorkspace, AppError> {
    let elements = sqlx::query_as::<_, WorldElement>(
        "SELECT * FROM world_elements WHERE project_id = ? ORDER BY order_index, created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let rules = sqlx::query_as::<_, WorldRule>(
        "SELECT * FROM world_rules WHERE project_id = ? ORDER BY order_index, created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let element_characters = sqlx::query_as::<_, WorldElementCharacter>(
        r#"
        SELECT ec.*
        FROM world_element_characters ec
        JOIN world_elements e ON e.id = ec.element_id
        WHERE e.project_id = ?
        ORDER BY ec.element_id, ec.character_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let element_threads = sqlx::query_as::<_, WorldElementThread>(
        r#"
        SELECT et.*
        FROM world_element_threads et
        JOIN world_elements e ON e.id = et.element_id
        WHERE e.project_id = ?
        ORDER BY et.element_id, et.thread_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let element_chapters = sqlx::query_as::<_, WorldElementChapter>(
        r#"
        SELECT ec.*
        FROM world_element_chapters ec
        JOIN world_elements e ON e.id = ec.element_id
        WHERE e.project_id = ?
        ORDER BY ec.element_id, ec.chapter_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let element_scenes = sqlx::query_as::<_, SceneWorldElement>(
        r#"
        SELECT swe.*
        FROM scene_world_elements swe
        JOIN world_elements e ON e.id = swe.element_id
        WHERE e.project_id = ?
        ORDER BY swe.element_id, swe.scene_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let element_rules = sqlx::query_as::<_, WorldElementRule>(
        r#"
        SELECT er.*
        FROM world_element_rules er
        JOIN world_elements e ON e.id = er.element_id
        WHERE e.project_id = ?
        ORDER BY er.element_id, er.rule_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let rule_threads = sqlx::query_as::<_, WorldRuleThread>(
        r#"
        SELECT rt.*
        FROM world_rule_threads rt
        JOIN world_rules r ON r.id = rt.rule_id
        WHERE r.project_id = ?
        ORDER BY rt.rule_id, rt.thread_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let rule_chapters = sqlx::query_as::<_, WorldRuleChapter>(
        r#"
        SELECT rc.*
        FROM world_rule_chapters rc
        JOIN world_rules r ON r.id = rc.rule_id
        WHERE r.project_id = ?
        ORDER BY rc.rule_id, rc.chapter_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let rule_scenes = sqlx::query_as::<_, SceneWorldRule>(
        r#"
        SELECT swr.*
        FROM scene_world_rules swr
        JOIN world_rules r ON r.id = swr.rule_id
        WHERE r.project_id = ?
        ORDER BY swr.rule_id, swr.scene_id
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let visual_assets = sqlx::query_as::<_, VisualAsset>(
        "SELECT * FROM visual_assets WHERE project_id = ? AND related_type = 'world_element' ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(WorldWorkspace {
        elements,
        rules,
        element_characters,
        element_threads,
        element_chapters,
        element_scenes,
        element_rules,
        rule_threads,
        rule_chapters,
        rule_scenes,
        visual_assets,
    })
}

pub async fn upsert_character_in_pool(
    pool: &SqlitePool,
    input: UpsertCharacterInput,
) -> Result<Character, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process(
            "Nazwa postaci nie moze byc pusta.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO characters
          (id, project_id, character_type, name, aliases_json, role, short_description, appearance, external_goal, internal_need, wound, false_belief, secret, strengths_json, weaknesses_json, voice_notes, arc_summary, knowledge_notes, visual_prompt, image_asset_id, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          character_type = excluded.character_type,
          name = excluded.name,
          aliases_json = excluded.aliases_json,
          role = excluded.role,
          short_description = excluded.short_description,
          appearance = excluded.appearance,
          external_goal = excluded.external_goal,
          internal_need = excluded.internal_need,
          wound = excluded.wound,
          false_belief = excluded.false_belief,
          secret = excluded.secret,
          strengths_json = excluded.strengths_json,
          weaknesses_json = excluded.weaknesses_json,
          voice_notes = excluded.voice_notes,
          arc_summary = excluded.arc_summary,
          knowledge_notes = excluded.knowledge_notes,
          visual_prompt = excluded.visual_prompt,
          image_asset_id = COALESCE(excluded.image_asset_id, characters.image_asset_id),
          status = excluded.status,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(input.character_type)
    .bind(input.name)
    .bind(input.aliases_json)
    .bind(input.role)
    .bind(input.short_description)
    .bind(input.appearance)
    .bind(input.external_goal)
    .bind(input.internal_need)
    .bind(input.wound)
    .bind(input.false_belief)
    .bind(input.secret)
    .bind(input.strengths_json)
    .bind(input.weaknesses_json)
    .bind(input.voice_notes)
    .bind(input.arc_summary)
    .bind(input.knowledge_notes)
    .bind(input.visual_prompt)
    .bind(input.image_asset_id)
    .bind(input.status)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, Character>("SELECT * FROM characters WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_character_relation_in_pool(
    pool: &SqlitePool,
    input: UpsertCharacterRelationInput,
) -> Result<CharacterRelation, AppError> {
    if input.from_character_id == input.to_character_id {
        return Err(AppError::Process(
            "Relacja wymaga dwoch roznych postaci.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let trust_level = input.trust_level.clamp(0, 100);
    let mut tx = pool.begin().await?;

    validate_character_in_project(&mut tx, &input.from_character_id, &input.project_id).await?;
    validate_character_in_project(&mut tx, &input.to_character_id, &input.project_id).await?;

    sqlx::query(
        r#"
        INSERT INTO character_relations
          (id, project_id, from_character_id, to_character_id, relation_type, description, history, conflict, opinion, trust_level, secret, change_over_time, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(from_character_id, to_character_id, relation_type) DO UPDATE SET
          description = excluded.description,
          history = excluded.history,
          conflict = excluded.conflict,
          opinion = excluded.opinion,
          trust_level = excluded.trust_level,
          secret = excluded.secret,
          change_over_time = excluded.change_over_time,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&input.from_character_id)
    .bind(&input.to_character_id)
    .bind(&input.relation_type)
    .bind(input.description)
    .bind(input.history)
    .bind(input.conflict)
    .bind(input.opinion)
    .bind(trust_level)
    .bind(input.secret)
    .bind(input.change_over_time)
    .bind(input.status)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, CharacterRelation>(
        "SELECT * FROM character_relations WHERE from_character_id = ? AND to_character_id = ? AND relation_type = ?",
    )
    .bind(&input.from_character_id)
    .bind(&input.to_character_id)
    .bind(&input.relation_type)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn upsert_character_memory_in_pool(
    pool: &SqlitePool,
    input: UpsertCharacterMemoryInput,
) -> Result<CharacterMemory, AppError> {
    if input.title.trim().is_empty() {
        return Err(AppError::Process(
            "Tytul wspomnienia nie moze byc pusty.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let importance = input.importance.clamp(0, 100);
    let mut tx = pool.begin().await?;

    validate_character_in_project(&mut tx, &input.character_id, &input.project_id).await?;

    sqlx::query(
        r#"
        INSERT INTO character_memories
          (id, project_id, character_id, title, summary, details, memory_type, subject, emotion, importance, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          character_id = excluded.character_id,
          title = excluded.title,
          summary = excluded.summary,
          details = excluded.details,
          memory_type = excluded.memory_type,
          subject = excluded.subject,
          emotion = excluded.emotion,
          importance = excluded.importance,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&input.character_id)
    .bind(input.title)
    .bind(input.summary)
    .bind(input.details)
    .bind(input.memory_type)
    .bind(input.subject)
    .bind(input.emotion)
    .bind(importance)
    .bind(input.status)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, CharacterMemory>("SELECT * FROM character_memories WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_character_memory_link_in_pool(
    pool: &SqlitePool,
    input: UpsertCharacterMemoryLinkInput,
) -> Result<CharacterMemoryLink, AppError> {
    if input.from_memory_id == input.to_memory_id {
        return Err(AppError::Process(
            "Polaczenie wymaga dwoch roznych wspomnien.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let strength = input.strength.clamp(0, 100);
    let mut tx = pool.begin().await?;

    validate_memory_in_project(&mut tx, &input.from_memory_id, &input.project_id).await?;
    validate_memory_in_project(&mut tx, &input.to_memory_id, &input.project_id).await?;

    sqlx::query(
        r#"
        INSERT INTO character_memory_links
          (id, project_id, from_memory_id, to_memory_id, link_type, description, strength, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(from_memory_id, to_memory_id, link_type) DO UPDATE SET
          description = excluded.description,
          strength = excluded.strength,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&input.from_memory_id)
    .bind(&input.to_memory_id)
    .bind(&input.link_type)
    .bind(input.description)
    .bind(strength)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, CharacterMemoryLink>(
        "SELECT * FROM character_memory_links WHERE from_memory_id = ? AND to_memory_id = ? AND link_type = ?",
    )
    .bind(&input.from_memory_id)
    .bind(&input.to_memory_id)
    .bind(&input.link_type)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn delete_character_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM characters WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_character_relation_in_pool(
    pool: &SqlitePool,
    id: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM character_relations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_character_memory_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM character_memories WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_character_memory_link_in_pool(
    pool: &SqlitePool,
    id: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM character_memory_links WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn upsert_world_element_in_pool(
    pool: &SqlitePool,
    input: UpsertWorldElementInput,
) -> Result<WorldElement, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process(
            "Nazwa elementu swiata nie moze byc pusta.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO world_elements
          (id, project_id, element_type, name, summary, details, story_purpose, constraints, visual_prompt, image_asset_id, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          element_type = excluded.element_type,
          name = excluded.name,
          summary = excluded.summary,
          details = excluded.details,
          story_purpose = excluded.story_purpose,
          constraints = excluded.constraints,
          visual_prompt = excluded.visual_prompt,
          image_asset_id = COALESCE(excluded.image_asset_id, world_elements.image_asset_id),
          status = excluded.status,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(input.element_type)
    .bind(input.name)
    .bind(input.summary)
    .bind(input.details)
    .bind(input.story_purpose)
    .bind(input.constraints)
    .bind(input.visual_prompt)
    .bind(input.image_asset_id)
    .bind(input.status)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, WorldElement>("SELECT * FROM world_elements WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_world_rule_in_pool(
    pool: &SqlitePool,
    input: UpsertWorldRuleInput,
) -> Result<WorldRule, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process(
            "Nazwa reguly swiata nie moze byc pusta.".into(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO world_rules
          (id, project_id, name, description, scope, cost, limitation, exceptions, violation_consequences, scene_examples, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          scope = excluded.scope,
          cost = excluded.cost,
          limitation = excluded.limitation,
          exceptions = excluded.exceptions,
          violation_consequences = excluded.violation_consequences,
          scene_examples = excluded.scene_examples,
          status = excluded.status,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.scope)
    .bind(input.cost)
    .bind(input.limitation)
    .bind(input.exceptions)
    .bind(input.violation_consequences)
    .bind(input.scene_examples)
    .bind(input.status)
    .bind(input.order_index)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    sqlx::query_as::<_, WorldRule>("SELECT * FROM world_rules WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn delete_world_element_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM world_elements WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_world_rule_in_pool(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM world_rules WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_world_element_relations_in_pool(
    pool: &SqlitePool,
    input: SetWorldElementRelationsInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    validate_world_element_in_project(&mut tx, &input.element_id, &input.project_id).await?;

    sqlx::query("DELETE FROM world_element_characters WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for character_id in unique_ids(input.character_ids) {
        validate_character_in_project(&mut tx, &character_id, &input.project_id).await?;
        sqlx::query("INSERT OR IGNORE INTO world_element_characters (element_id, character_id) VALUES (?, ?)")
            .bind(&input.element_id)
            .bind(character_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM world_element_threads WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for thread_id in unique_ids(input.thread_ids) {
        validate_thread_in_project(&mut tx, &thread_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO world_element_threads (element_id, thread_id) VALUES (?, ?)",
        )
        .bind(&input.element_id)
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM world_element_chapters WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for chapter_id in unique_ids(input.chapter_ids) {
        validate_chapter_in_project(&mut tx, &chapter_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO world_element_chapters (element_id, chapter_id) VALUES (?, ?)",
        )
        .bind(&input.element_id)
        .bind(chapter_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM scene_world_elements WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for scene_id in unique_ids(input.scene_ids) {
        validate_scene_in_project(&mut tx, &scene_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO scene_world_elements (scene_id, element_id) VALUES (?, ?)",
        )
        .bind(scene_id)
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM world_element_rules WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for rule_id in unique_ids(input.rule_ids) {
        validate_world_rule_in_project(&mut tx, &rule_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO world_element_rules (element_id, rule_id) VALUES (?, ?)",
        )
        .bind(&input.element_id)
        .bind(rule_id)
        .execute(&mut *tx)
        .await?;
    }

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_world_rule_relations_in_pool(
    pool: &SqlitePool,
    input: SetWorldRuleRelationsInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;
    validate_world_rule_in_project(&mut tx, &input.rule_id, &input.project_id).await?;

    sqlx::query("DELETE FROM world_element_rules WHERE rule_id = ?")
        .bind(&input.rule_id)
        .execute(&mut *tx)
        .await?;
    for element_id in unique_ids(input.element_ids) {
        validate_world_element_in_project(&mut tx, &element_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO world_element_rules (element_id, rule_id) VALUES (?, ?)",
        )
        .bind(element_id)
        .bind(&input.rule_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM world_rule_threads WHERE rule_id = ?")
        .bind(&input.rule_id)
        .execute(&mut *tx)
        .await?;
    for thread_id in unique_ids(input.thread_ids) {
        validate_thread_in_project(&mut tx, &thread_id, &input.project_id).await?;
        sqlx::query("INSERT OR IGNORE INTO world_rule_threads (rule_id, thread_id) VALUES (?, ?)")
            .bind(&input.rule_id)
            .bind(thread_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM world_rule_chapters WHERE rule_id = ?")
        .bind(&input.rule_id)
        .execute(&mut *tx)
        .await?;
    for chapter_id in unique_ids(input.chapter_ids) {
        validate_chapter_in_project(&mut tx, &chapter_id, &input.project_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO world_rule_chapters (rule_id, chapter_id) VALUES (?, ?)",
        )
        .bind(&input.rule_id)
        .bind(chapter_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM scene_world_rules WHERE rule_id = ?")
        .bind(&input.rule_id)
        .execute(&mut *tx)
        .await?;
    for scene_id in unique_ids(input.scene_ids) {
        validate_scene_in_project(&mut tx, &scene_id, &input.project_id).await?;
        sqlx::query("INSERT OR IGNORE INTO scene_world_rules (scene_id, rule_id) VALUES (?, ?)")
            .bind(scene_id)
            .bind(&input.rule_id)
            .execute(&mut *tx)
            .await?;
    }

    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;
    Ok(())
}

async fn validate_character_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    character_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM characters WHERE id = ? AND project_id = ?")
            .bind(character_id)
            .bind(project_id)
            .fetch_one(&mut **tx)
            .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono postaci.".into()));
    }

    Ok(())
}

async fn validate_memory_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    memory_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM character_memories WHERE id = ? AND project_id = ?")
            .bind(memory_id)
            .bind(project_id)
            .fetch_one(&mut **tx)
            .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono wspomnienia.".into()));
    }

    Ok(())
}

async fn validate_world_element_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    element_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM world_elements WHERE id = ? AND project_id = ?")
            .bind(element_id)
            .bind(project_id)
            .fetch_one(&mut **tx)
            .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono elementu swiata.".into()));
    }

    Ok(())
}

async fn validate_world_rule_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    rule_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM world_rules WHERE id = ? AND project_id = ?")
            .bind(rule_id)
            .bind(project_id)
            .fetch_one(&mut **tx)
            .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono reguly swiata.".into()));
    }

    Ok(())
}

async fn validate_thread_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    thread_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM plot_threads t
        JOIN books b ON b.id = t.book_id
        WHERE t.id = ? AND b.project_id = ?
        "#,
    )
    .bind(thread_id)
    .bind(project_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono watku.".into()));
    }

    Ok(())
}

async fn validate_chapter_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    chapter_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM chapters c
        JOIN books b ON b.id = c.book_id
        WHERE c.id = ? AND b.project_id = ?
        "#,
    )
    .bind(chapter_id)
    .bind(project_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono rozdzialu.".into()));
    }

    Ok(())
}

async fn validate_scene_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    scene_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let exists: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM scenes s
        JOIN books b ON b.id = s.book_id
        WHERE s.id = ? AND b.project_id = ?
        "#,
    )
    .bind(scene_id)
    .bind(project_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono sceny.".into()));
    }

    Ok(())
}

pub async fn list_ai_runs_in_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<AiLogEntry>, AppError> {
    let rows = sqlx::query_as::<_, AiLogEntryRow>(
        r#"
        SELECT
          ai_runs.id,
          ai_runs.project_id,
          ai_runs.provider_id,
          ai_runs.model,
          ai_runs.reasoning_effort,
          ai_runs.action,
          ai_runs.prompt_package_json,
          ai_runs.prompt,
          ai_runs.raw_output,
          ai_runs.status,
          ai_runs.error_message,
          ai_runs.created_at,
          ai_runs.completed_at,
          ai_proposals.decision_status,
          ai_proposals.payload_json AS proposal_snapshot_json
        FROM ai_runs
        LEFT JOIN ai_proposals ON ai_proposals.ai_run_id = ai_runs.id
        WHERE ai_runs.project_id = ?
        ORDER BY ai_runs.created_at DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let prompt_package_json =
                serde_json::from_str(&row.prompt_package_json).unwrap_or(Value::Null);
            let proposal_snapshot = row
                .proposal_snapshot_json
                .as_deref()
                .and_then(|value| serde_json::from_str(value).ok());
            Ok(AiLogEntry {
                id: row.id,
                project_id: row.project_id,
                provider_id: row.provider_id,
                model: row.model,
                reasoning_effort: row.reasoning_effort,
                action: row.action,
                prompt_package_json,
                prompt: row.prompt,
                raw_output: row.raw_output,
                status: row.status,
                error_message: row.error_message,
                created_at: row.created_at,
                completed_at: row.completed_at,
                decision_status: row.decision_status,
                proposal_snapshot,
            })
        })
        .collect()
}

pub async fn list_ai_proposals_in_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<AiProposalRecord>, AppError> {
    let rows = sqlx::query_as::<_, AiProposalRow>(
        r#"
        SELECT
          id,
          ai_run_id,
          project_id,
          proposal_type,
          payload_json,
          status,
          decision_status,
          applied_at,
          accepted_at,
          rejected_at,
          created_at,
          updated_at
        FROM ai_proposals
        WHERE project_id = ?
          AND decision_status = 'pending'
          AND status NOT IN ('running', 'terminated')
        ORDER BY updated_at DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(ai_proposal_record_from_row).collect()
}

pub async fn upsert_ai_proposal_snapshot_in_pool(
    pool: &SqlitePool,
    input: UpsertAiProposalSnapshotInput,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let payload_json = serde_json::to_string(&input.payload_json)?;
    sqlx::query(
        r#"
        INSERT INTO ai_proposals
          (
            id,
            ai_run_id,
            project_id,
            proposal_type,
            payload_json,
            status,
            decision_status,
            created_at,
            updated_at
          )
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ai_run_id = COALESCE(excluded.ai_run_id, ai_proposals.ai_run_id),
          project_id = excluded.project_id,
          proposal_type = excluded.proposal_type,
          payload_json = excluded.payload_json,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&input.id)
    .bind(&input.ai_run_id)
    .bind(&input.project_id)
    .bind(&input.proposal_type)
    .bind(&payload_json)
    .bind(&input.status)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn mark_ai_proposal_decision_in_pool(
    pool: &SqlitePool,
    id: &str,
    decision_status: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let (accepted_at, rejected_at, applied_at) = if decision_status == "accepted" {
        (Some(now.as_str()), None, Some(now.as_str()))
    } else {
        (None, Some(now.as_str()), None)
    };

    sqlx::query(
        r#"
        UPDATE ai_proposals
        SET decision_status = ?,
            applied_at = COALESCE(?, applied_at),
            accepted_at = COALESCE(?, accepted_at),
            rejected_at = COALESCE(?, rejected_at),
            updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(decision_status)
    .bind(applied_at)
    .bind(accepted_at)
    .bind(rejected_at)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;

    Ok(())
}

fn ai_proposal_record_from_row(row: AiProposalRow) -> Result<AiProposalRecord, AppError> {
    let payload_json = serde_json::from_str(&row.payload_json).unwrap_or(Value::Null);
    Ok(AiProposalRecord {
        id: row.id,
        ai_run_id: row.ai_run_id,
        project_id: row.project_id,
        proposal_type: row.proposal_type,
        payload_json,
        status: row.status,
        decision_status: row.decision_status,
        applied_at: row.applied_at,
        accepted_at: row.accepted_at,
        rejected_at: row.rejected_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

pub async fn update_book_concept_in_pool(
    pool: &SqlitePool,
    book_id: &str,
    input: BookConceptInput,
) -> Result<Book, AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        UPDATE books
        SET
          title = COALESCE(?, title),
          working_title = COALESCE(?, working_title),
          premise = COALESCE(?, premise),
          protagonist_summary = COALESCE(?, protagonist_summary),
          protagonist_goal = COALESCE(?, protagonist_goal),
          expanded_premise = COALESCE(?, expanded_premise),
          central_conflict = COALESCE(?, central_conflict),
          antagonist_force = COALESCE(?, antagonist_force),
          stakes = COALESCE(?, stakes),
          setting_sketch = COALESCE(?, setting_sketch),
          ending_direction = COALESCE(?, ending_direction),
          genre = COALESCE(?, genre),
          subgenre = COALESCE(?, subgenre),
          target_audience = COALESCE(?, target_audience),
          tone = COALESCE(?, tone),
          style_guide = COALESCE(?, style_guide),
          point_of_view = COALESCE(?, point_of_view),
          target_word_count = COALESCE(?, target_word_count),
          themes_json = COALESCE(?, themes_json),
          unwanted_themes = COALESCE(?, unwanted_themes),
          alternative_titles_json = COALESCE(?, alternative_titles_json),
          updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(input.title)
    .bind(input.working_title)
    .bind(input.premise)
    .bind(input.protagonist_summary)
    .bind(input.protagonist_goal)
    .bind(input.expanded_premise)
    .bind(input.central_conflict)
    .bind(input.antagonist_force)
    .bind(input.stakes)
    .bind(input.setting_sketch)
    .bind(input.ending_direction)
    .bind(input.genre)
    .bind(input.subgenre)
    .bind(input.target_audience)
    .bind(input.tone)
    .bind(input.style_guide)
    .bind(input.point_of_view)
    .bind(input.target_word_count)
    .bind(input.themes_json)
    .bind(input.unwanted_themes)
    .bind(input.alternative_titles_json)
    .bind(&now)
    .bind(book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE projects
        SET updated_at = ?
        WHERE id = (SELECT project_id FROM books WHERE id = ?)
        "#,
    )
    .bind(&now)
    .bind(book_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query_as::<_, Book>("SELECT * FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn update_book_cover_metadata_in_pool(
    pool: &SqlitePool,
    book_id: &str,
    image_path: &str,
    prompt: &str,
    negative_prompt: &str,
    generated_at: &str,
) -> Result<Book, AppError> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        UPDATE books
        SET
          cover_image_path = ?,
          cover_prompt = ?,
          cover_negative_prompt = ?,
          cover_generated_at = ?,
          updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(image_path)
    .bind(prompt)
    .bind(negative_prompt)
    .bind(generated_at)
    .bind(&now)
    .bind(book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE projects
        SET updated_at = ?
        WHERE id = (SELECT project_id FROM books WHERE id = ?)
        "#,
    )
    .bind(&now)
    .bind(book_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query_as::<_, Book>("SELECT * FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub(crate) async fn generate_book_cover_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    active_codex_runs: &ActiveCodexRunRegistry,
    input: GenerateBookCoverInput,
) -> Result<BookCoverResult, AppError> {
    if input.cover_prompt.trim().is_empty() {
        return Err(AppError::Process(
            "Prompt okĹ‚adki nie moĹĽe byÄ‡ pusty".into(),
        ));
    }

    let details = get_project_details(pool, &input.project_id).await?;
    if details.book.id != input.book_id {
        return Err(AppError::Process(
            "OkĹ‚adka moĹĽe byÄ‡ generowana tylko dla aktywnej ksiÄ…ĹĽki projektu".into(),
        ));
    }

    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&input.prompt_package_json)?;
    let timeout_seconds = cover_timeout_seconds(input.timeout_seconds);
    let settings = load_ai_settings(app).await;
    let image_provider_id = settings.image_provider_id().to_string();

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'generate_cover_image', ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(&image_provider_id)
    .bind(
        settings
            .effective_image_model()
            .or_else(|| input.model.clone())
            .as_deref()
            .unwrap_or(""),
    )
    .bind(input.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&prompt_package_json)
    .bind(&input.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    emit_cover_progress(
        app,
        &input,
        &ai_run_id,
        "queued",
        "Przygotowuje zadanie generowania okladki.",
        None,
        Some(5),
    );

    let started_at = Instant::now();
    let run_result = if settings.image_provider == ai_settings::IMAGE_PROVIDER_CODEX {
        execute_codex_image_generation(app, active_codex_runs, &input, &ai_run_id, timeout_seconds)
            .await
    } else {
        execute_direct_image_provider(
            app,
            active_codex_runs,
            &settings,
            &ai_run_id,
            &input.project_id,
            "generate_cover_image",
            "cover-runs",
            "cover.png",
            &input.cover_prompt,
            &input.cover_negative_prompt,
            true,
            timeout_seconds,
        )
        .await
    };
    let duration_ms = started_at.elapsed().as_millis();
    let completed_at = Utc::now().to_rfc3339();

    let (stdout, stderr, generated_image_path) = match run_result {
        Ok(result) => result,
        Err(error) => {
            let error_message = error.to_string();
            emit_cover_progress(app, &input, &ai_run_id, "error", &error_message, None, None);
            complete_ai_run(
                pool,
                &ai_run_id,
                if matches!(error, AppError::Timeout(_)) {
                    "timeout"
                } else if matches!(error, AppError::Cancelled) {
                    "cancelled"
                } else {
                    "error"
                },
                None,
                Some(&error_message),
                &completed_at,
            )
            .await?;
            return Err(error);
        }
    };

    verify_generated_png_file(&generated_image_path, "Codex CLI generated image").await?;
    reject_duplicate_existing_cover(&generated_image_path, &details.book.cover_image_path).await?;

    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udaĹ‚o siÄ™ ustaliÄ‡ katalogu danych aplikacji: {error}"
        ))
    })?;
    let final_dir = app_data_dir
        .join("covers")
        .join(&input.project_id)
        .join(&input.book_id);
    tokio::fs::create_dir_all(&final_dir).await?;
    reject_duplicate_previous_cover_file(&generated_image_path, &final_dir).await?;
    let final_image_path = final_dir.join(format!("cover-{ai_run_id}.png"));
    tokio::fs::copy(&generated_image_path, &final_image_path).await?;
    verify_generated_png_file(&final_image_path, "Saved cover image").await?;
    let raw_output = codex_image_raw_output(&stdout, &stderr, &generated_image_path);
    complete_ai_run(
        pool,
        &ai_run_id,
        "success",
        Some(&raw_output),
        None,
        &completed_at,
    )
    .await?;

    let final_image_path_text = final_image_path.to_string_lossy().to_string();
    emit_cover_progress(
        app,
        &input,
        &ai_run_id,
        "final",
        "Okladka gotowa do akceptacji.",
        None,
        Some(100),
    );

    Ok(BookCoverResult {
        book: details.book,
        ai_run: AiRunResult {
            id: ai_run_id,
            provider_id: image_provider_id,
            prompt_package_id: input.prompt_package_id,
            action: "generate_cover_image".into(),
            status: "success".into(),
            raw_output: Some(raw_output),
            stderr: if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
            error_message: None,
            duration_ms,
        },
        image_path: final_image_path_text,
        prompt: input.cover_prompt,
        negative_prompt: input.cover_negative_prompt,
        generated_at: completed_at,
    })
}

pub(crate) async fn generate_character_image_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    active_codex_runs: &ActiveCodexRunRegistry,
    input: GenerateCharacterImageInput,
) -> Result<CharacterImageResult, AppError> {
    if input.image_prompt.trim().is_empty() {
        return Err(AppError::Process(
            "Prompt obrazu postaci nie moze byc pusty.".into(),
        ));
    }

    let character =
        sqlx::query_as::<_, Character>("SELECT * FROM characters WHERE id = ? AND project_id = ?")
            .bind(&input.character_id)
            .bind(&input.project_id)
            .fetch_one(pool)
            .await?;

    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&input.prompt_package_json)?;
    let timeout_seconds = cover_timeout_seconds(input.timeout_seconds);
    let settings = load_ai_settings(app).await;
    let image_provider_id = settings.image_provider_id().to_string();

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'generate_character_image', ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(&image_provider_id)
    .bind(
        settings
            .effective_image_model()
            .or_else(|| input.model.clone())
            .as_deref()
            .unwrap_or(""),
    )
    .bind(input.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&prompt_package_json)
    .bind(&input.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    let started_at = Instant::now();
    let run_result = if settings.image_provider == ai_settings::IMAGE_PROVIDER_CODEX {
        execute_codex_character_image_generation(
            app,
            active_codex_runs,
            &input,
            &ai_run_id,
            timeout_seconds,
        )
        .await
    } else {
        execute_direct_image_provider(
            app,
            active_codex_runs,
            &settings,
            &ai_run_id,
            &input.project_id,
            "generate_character_image",
            "character-image-runs",
            "character.png",
            &input.image_prompt,
            &input.negative_prompt,
            true,
            timeout_seconds,
        )
        .await
    };
    let duration_ms = started_at.elapsed().as_millis();
    let completed_at = Utc::now().to_rfc3339();

    let (stdout, stderr, generated_image_path) = match run_result {
        Ok(result) => result,
        Err(error) => {
            let error_message = error.to_string();
            complete_ai_run(
                pool,
                &ai_run_id,
                if matches!(error, AppError::Timeout(_)) {
                    "timeout"
                } else if matches!(error, AppError::Cancelled) {
                    "cancelled"
                } else {
                    "error"
                },
                None,
                Some(&error_message),
                &completed_at,
            )
            .await?;
            return Err(error);
        }
    };

    verify_generated_png_file(&generated_image_path, "Codex CLI generated character image").await?;

    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udalo sie ustalic katalogu danych aplikacji: {error}"
        ))
    })?;
    let final_dir = app_data_dir
        .join("characters")
        .join(&input.project_id)
        .join(&input.character_id);
    tokio::fs::create_dir_all(&final_dir).await?;
    let final_image_path = final_dir.join(format!("character-{ai_run_id}.png"));
    tokio::fs::copy(&generated_image_path, &final_image_path).await?;
    verify_generated_png_file(&final_image_path, "Saved character image").await?;
    let raw_output = codex_image_raw_output(&stdout, &stderr, &generated_image_path);
    complete_ai_run(
        pool,
        &ai_run_id,
        "success",
        Some(&raw_output),
        None,
        &completed_at,
    )
    .await?;

    let final_image_path_text = final_image_path.to_string_lossy().to_string();
    let proposed_asset = VisualAsset {
        id: Uuid::new_v4().to_string(),
        project_id: input.project_id.clone(),
        related_type: "character".into(),
        related_id: input.character_id.clone(),
        asset_type: "image".into(),
        title: character.name.clone(),
        prompt: input.image_prompt.clone(),
        negative_prompt: input.negative_prompt.clone(),
        file_path: final_image_path_text.clone(),
        source: "ai".into(),
        status: "proposed".into(),
        created_at: completed_at.clone(),
        updated_at: completed_at.clone(),
    };

    Ok(CharacterImageResult {
        character,
        visual_asset: proposed_asset,
        ai_run: AiRunResult {
            id: ai_run_id,
            provider_id: image_provider_id,
            prompt_package_id: input.prompt_package_id,
            action: "generate_character_image".into(),
            status: "success".into(),
            raw_output: Some(raw_output),
            stderr: if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
            error_message: None,
            duration_ms,
        },
        image_path: final_image_path_text,
        prompt: input.image_prompt,
        negative_prompt: input.negative_prompt,
        generated_at: completed_at,
    })
}

pub async fn accept_generated_character_image_in_pool(
    pool: &SqlitePool,
    input: AcceptGeneratedCharacterImageInput,
) -> Result<CharacterImageResult, AppError> {
    verify_generated_png_file(Path::new(&input.image_path), "Accepted character image").await?;

    let now = Utc::now().to_rfc3339();
    let asset_id = Uuid::new_v4().to_string();
    let mut tx = pool.begin().await?;
    validate_character_in_project(&mut tx, &input.character_id, &input.project_id).await?;

    let character =
        sqlx::query_as::<_, Character>("SELECT * FROM characters WHERE id = ? AND project_id = ?")
            .bind(&input.character_id)
            .bind(&input.project_id)
            .fetch_one(&mut *tx)
            .await?;

    sqlx::query(
        r#"
        INSERT INTO visual_assets
          (id, project_id, related_type, related_id, asset_type, title, prompt, negative_prompt, file_path, source, status, created_at, updated_at)
        VALUES (?, ?, 'character', ?, 'image', ?, ?, ?, ?, 'ai', 'canon', ?, ?)
        "#,
    )
    .bind(&asset_id)
    .bind(&input.project_id)
    .bind(&input.character_id)
    .bind(&character.name)
    .bind(&input.image_prompt)
    .bind(&input.negative_prompt)
    .bind(&input.image_path)
    .bind(&input.generated_at)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE characters SET image_asset_id = ?, visual_prompt = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&asset_id)
    .bind(&input.image_prompt)
    .bind(&now)
    .bind(&input.character_id)
    .execute(&mut *tx)
    .await?;
    touch_project_by_id(&mut tx, &input.project_id, &now).await?;
    tx.commit().await?;

    let character = sqlx::query_as::<_, Character>("SELECT * FROM characters WHERE id = ?")
        .bind(&input.character_id)
        .fetch_one(pool)
        .await?;
    let visual_asset = sqlx::query_as::<_, VisualAsset>("SELECT * FROM visual_assets WHERE id = ?")
        .bind(&asset_id)
        .fetch_one(pool)
        .await?;

    Ok(CharacterImageResult {
        character,
        visual_asset,
        ai_run: AiRunResult {
            id: asset_id.clone(),
            provider_id: PROVIDER_ID.into(),
            prompt_package_id: "accepted-character-image".into(),
            action: "generate_character_image".into(),
            status: "success".into(),
            raw_output: None,
            stderr: None,
            error_message: None,
            duration_ms: 0,
        },
        image_path: input.image_path,
        prompt: input.image_prompt,
        negative_prompt: input.negative_prompt,
        generated_at: input.generated_at,
    })
}

pub async fn export_book_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    input: ExportBookInput,
) -> Result<ExportBookResult, AppError> {
    let details = get_project_details(pool, &input.project_id).await?;
    if details.book.id != input.book_id {
        return Err(AppError::Process(
            "Książka nie należy do wybranego projektu.".into(),
        ));
    }
    let plan = get_book_plan_in_pool(pool, &input.book_id).await?;
    let export_doc = build_export_document(&details.book, &plan, &input)?;
    if export_doc.body_plain.trim().is_empty() {
        return Err(AppError::Process(
            "Brak tekstu manuskryptu do eksportu.".into(),
        ));
    }

    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    let export_dir = app_data_dir
        .join("exports")
        .join(&input.project_id)
        .join(&input.book_id);
    let export_dir = match input.output_directory.as_deref().map(str::trim) {
        Some(directory) if !directory.is_empty() => {
            let path = PathBuf::from(directory);
            if path.exists() && !path.is_dir() {
                return Err(AppError::Process(
                    "Wybrana lokalizacja eksportu nie jest folderem.".into(),
                ));
            }
            path
        }
        _ => export_dir,
    };
    tokio::fs::create_dir_all(&export_dir).await?;
    let base_name = export_file_stem(&details.book);
    let format = input.format.to_lowercase();

    match format.as_str() {
        "markdown" => {
            let path = export_dir.join(format!("{base_name}.md"));
            tokio::fs::write(&path, export_doc.markdown.as_bytes()).await?;
            Ok(export_result(path, "markdown", None, None))
        }
        "txt" => {
            let path = export_dir.join(format!("{base_name}.txt"));
            tokio::fs::write(&path, export_doc.plain_text.as_bytes()).await?;
            Ok(export_result(path, "txt", None, None))
        }
        "docx" => {
            let path = export_dir.join(format!("{base_name}.docx"));
            let bytes = build_docx(&export_doc, input.style.page_numbers)?;
            tokio::fs::write(&path, bytes).await?;
            Ok(export_result(path, "docx", None, None))
        }
        "epub" => {
            let path = export_dir.join(format!("{base_name}.epub"));
            let bytes = build_epub(&export_doc, &details.book)?;
            tokio::fs::write(&path, bytes).await?;
            Ok(export_result(path, "epub", None, None))
        }
        "mobi" => {
            let epub_path = export_dir.join(format!("{base_name}.epub"));
            let bytes = build_epub(&export_doc, &details.book)?;
            tokio::fs::write(&epub_path, bytes).await?;
            let mobi_path = export_dir.join(format!("{base_name}.mobi"));
            match convert_epub_to_mobi(&epub_path, &mobi_path).await {
                Ok(()) => Ok(export_result(mobi_path, "mobi", Some(epub_path), None)),
                Err(message) => Ok(export_result(
                    epub_path.clone(),
                    "mobi",
                    Some(epub_path),
                    Some(format!(
                        "Nie znaleziono konwertera MOBI lub konwersja się nie powiodła: {message}. Zapisano EPUB."
                    )),
                )),
            }
        }
        _ => Err(AppError::Process("Nieobsługiwany format eksportu.".into())),
    }
}

pub async fn list_export_presets_in_pool(
    pool: &SqlitePool,
    project_id: &str,
    book_id: &str,
) -> Result<Vec<ExportPreset>, AppError> {
    let presets = sqlx::query_as::<_, ExportPreset>(
        "SELECT * FROM export_presets WHERE project_id = ? AND book_id = ? ORDER BY updated_at DESC",
    )
    .bind(project_id)
    .bind(book_id)
    .fetch_all(pool)
    .await?;
    Ok(presets)
}

pub async fn save_export_preset_in_pool(
    pool: &SqlitePool,
    input: SaveExportPresetInput,
) -> Result<ExportPreset, AppError> {
    serde_json::from_str::<Value>(&input.settings_json)?;
    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = sqlx::query_as::<_, ExportPreset>("SELECT * FROM export_presets WHERE id = ?")
        .bind(&id)
        .fetch_optional(pool)
        .await?;
    let created_at = existing
        .as_ref()
        .map(|preset| preset.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let name = if input.name.trim().is_empty() {
        "Preset eksportu"
    } else {
        input.name.trim()
    };

    sqlx::query(
        r#"
        INSERT INTO export_presets
          (id, project_id, book_id, name, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&input.book_id)
    .bind(name)
    .bind(&input.settings_json)
    .bind(&created_at)
    .bind(&now)
    .execute(pool)
    .await?;

    let preset = sqlx::query_as::<_, ExportPreset>("SELECT * FROM export_presets WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await?;
    Ok(preset)
}

pub(crate) async fn generate_export_artwork_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    active_codex_runs: &ActiveCodexRunRegistry,
    input: GenerateExportArtworkInput,
) -> Result<ExportArtworkResult, AppError> {
    if input.image_prompt.trim().is_empty() {
        return Err(AppError::Process(
            "Prompt grafiki eksportu nie może być pusty.".into(),
        ));
    }
    validate_export_artwork_target(
        pool,
        &input.project_id,
        &input.book_id,
        &input.related_type,
        &input.related_id,
    )
    .await?;

    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&input.prompt_package_json)?;
    let timeout_seconds = cover_timeout_seconds(input.timeout_seconds);
    let settings = load_ai_settings(app).await;
    let image_provider_id = settings.image_provider_id().to_string();

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'generate_export_artwork', ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(&image_provider_id)
    .bind(
        settings
            .effective_image_model()
            .or_else(|| input.model.clone())
            .as_deref()
            .unwrap_or(""),
    )
    .bind(input.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&prompt_package_json)
    .bind(&input.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    let started_at = Instant::now();
    let run_result = if settings.image_provider == ai_settings::IMAGE_PROVIDER_CODEX {
        execute_codex_export_artwork_generation(
            app,
            active_codex_runs,
            &input,
            &ai_run_id,
            timeout_seconds,
        )
        .await
    } else {
        execute_direct_image_provider(
            app,
            active_codex_runs,
            &settings,
            &ai_run_id,
            &input.project_id,
            "generate_export_artwork",
            "export-artwork-runs",
            "export-artwork.png",
            &input.image_prompt,
            &input.negative_prompt,
            false,
            timeout_seconds,
        )
        .await
    };
    let duration_ms = started_at.elapsed().as_millis();
    let completed_at = Utc::now().to_rfc3339();
    let (stdout, stderr, generated_image_path) = match run_result {
        Ok(result) => result,
        Err(error) => {
            let error_message = error.to_string();
            complete_ai_run(
                pool,
                &ai_run_id,
                if matches!(error, AppError::Timeout(_)) {
                    "timeout"
                } else if matches!(error, AppError::Cancelled) {
                    "cancelled"
                } else {
                    "error"
                },
                None,
                Some(&error_message),
                &completed_at,
            )
            .await?;
            return Err(error);
        }
    };
    verify_generated_png_file(&generated_image_path, "Codex CLI generated export artwork").await?;

    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    let final_dir = app_data_dir
        .join("exports")
        .join("artwork")
        .join(&input.project_id)
        .join(&input.related_type)
        .join(&input.related_id);
    tokio::fs::create_dir_all(&final_dir).await?;
    let final_image_path = final_dir.join(format!("export-artwork-{ai_run_id}.png"));
    tokio::fs::copy(&generated_image_path, &final_image_path).await?;
    verify_generated_png_file(&final_image_path, "Saved export artwork").await?;
    let raw_output = codex_image_raw_output(&stdout, &stderr, &generated_image_path);
    complete_ai_run(
        pool,
        &ai_run_id,
        "success",
        Some(&raw_output),
        None,
        &completed_at,
    )
    .await?;

    let file_path = final_image_path.to_string_lossy().to_string();
    let visual_asset = VisualAsset {
        id: Uuid::new_v4().to_string(),
        project_id: input.project_id.clone(),
        related_type: input.related_type.clone(),
        related_id: input.related_id.clone(),
        asset_type: "image".into(),
        title: "Grafika eksportu".into(),
        prompt: input.image_prompt.clone(),
        negative_prompt: input.negative_prompt.clone(),
        file_path: file_path.clone(),
        source: "ai".into(),
        status: "proposed".into(),
        created_at: completed_at.clone(),
        updated_at: completed_at.clone(),
    };

    Ok(ExportArtworkResult {
        visual_asset,
        ai_run: AiRunResult {
            id: ai_run_id,
            provider_id: image_provider_id,
            prompt_package_id: input.prompt_package_id,
            action: "generate_export_artwork".into(),
            status: "success".into(),
            raw_output: Some(raw_output),
            stderr: if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
            error_message: None,
            duration_ms,
        },
        image_path: file_path,
        prompt: input.image_prompt,
        negative_prompt: input.negative_prompt,
        generated_at: completed_at,
    })
}

pub async fn accept_generated_export_artwork_in_pool(
    pool: &SqlitePool,
    input: AcceptGeneratedExportArtworkInput,
) -> Result<ExportArtworkResult, AppError> {
    verify_generated_png_file(Path::new(&input.image_path), "Accepted export artwork").await?;
    validate_export_artwork_related_type(&input.related_type)?;

    let now = Utc::now().to_rfc3339();
    let asset_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO visual_assets
          (id, project_id, related_type, related_id, asset_type, title, prompt, negative_prompt, file_path, source, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'image', 'Grafika eksportu', ?, ?, ?, 'ai', 'canon', ?, ?)
        "#,
    )
    .bind(&asset_id)
    .bind(&input.project_id)
    .bind(&input.related_type)
    .bind(&input.related_id)
    .bind(&input.image_prompt)
    .bind(&input.negative_prompt)
    .bind(&input.image_path)
    .bind(&input.generated_at)
    .bind(&now)
    .execute(pool)
    .await?;
    let visual_asset = sqlx::query_as::<_, VisualAsset>("SELECT * FROM visual_assets WHERE id = ?")
        .bind(&asset_id)
        .fetch_one(pool)
        .await?;
    Ok(ExportArtworkResult {
        visual_asset,
        ai_run: AiRunResult {
            id: asset_id.clone(),
            provider_id: PROVIDER_ID.into(),
            prompt_package_id: "accepted-export-artwork".into(),
            action: "generate_export_artwork".into(),
            status: "success".into(),
            raw_output: None,
            stderr: None,
            error_message: None,
            duration_ms: 0,
        },
        image_path: input.image_path,
        prompt: input.image_prompt,
        negative_prompt: input.negative_prompt,
        generated_at: input.generated_at,
    })
}

#[derive(Debug)]
struct ExportDocument {
    title: String,
    cover_image_path: Option<String>,
    markdown: String,
    plain_text: String,
    body_plain: String,
    html_body: String,
}

fn build_export_document(
    book: &Book,
    plan: &BookPlan,
    input: &ExportBookInput,
) -> Result<ExportDocument, AppError> {
    let selected = if input.chapter_ids.is_empty() {
        plan.chapters.iter().collect::<Vec<_>>()
    } else {
        plan.chapters
            .iter()
            .filter(|chapter| input.chapter_ids.iter().any(|id| id == &chapter.id))
            .collect::<Vec<_>>()
    };
    let mut chapters = selected;
    chapters.sort_by(|left, right| {
        left.order_index
            .cmp(&right.order_index)
            .then(left.number.cmp(&right.number))
    });
    if chapters.is_empty() {
        return Err(AppError::Process(
            "Nie wybrano rozdziałów do eksportu.".into(),
        ));
    }

    let title = if book.title.trim().is_empty() {
        book.working_title.clone()
    } else {
        book.title.clone()
    };
    let mut markdown = format!("# {}\n\n", title);
    let mut plain = format!("{title}\n\n");
    let mut body_plain = String::new();
    let mut html = format!("<h1>{}</h1>", escape_xml(&title));

    for chapter in chapters {
        let chapter_heading =
            render_export_separator(&input.style.chapter_separator, book, chapter, None);
        markdown.push_str(&format!("## {chapter_heading}\n\n"));
        plain.push_str(&format!("{chapter_heading}\n\n"));
        html.push_str(&format!("<h2>{}</h2>", escape_xml(&chapter_heading)));
        if input.content_mode == "manuscript_with_summaries" && !chapter.summary.trim().is_empty() {
            markdown.push_str(&format!("> {}\n\n", chapter.summary.trim()));
            plain.push_str(&format!("Streszczenie: {}\n\n", chapter.summary.trim()));
            html.push_str(&format!(
                "<blockquote>{}</blockquote>",
                escape_xml(chapter.summary.trim())
            ));
        }
        let mut scenes = plan
            .scenes
            .iter()
            .filter(|scene| scene.chapter_id.as_deref() == Some(chapter.id.as_str()))
            .collect::<Vec<_>>();
        scenes.sort_by(|left, right| {
            left.order_index
                .cmp(&right.order_index)
                .then(left.created_at.cmp(&right.created_at))
        });
        for (index, scene) in scenes.iter().enumerate() {
            if index > 0 || !input.style.scene_separator.text.trim().is_empty() {
                let scene_separator = render_export_separator(
                    &input.style.scene_separator,
                    book,
                    chapter,
                    Some(scene),
                );
                if !scene_separator.trim().is_empty() {
                    markdown.push_str(&format!("{scene_separator}\n\n"));
                    plain.push_str(&format!("{scene_separator}\n\n"));
                    html.push_str(&format!(
                        "<p class=\"scene-separator\">{}</p>",
                        escape_xml(&scene_separator)
                    ));
                }
            }
            let scene_text = html_to_plain_text(&scene.manuscript_content);
            if !scene_text.trim().is_empty() {
                markdown.push_str(&format!("{}\n\n", scene_text.trim()));
                plain.push_str(&format!("{}\n\n", scene_text.trim()));
                body_plain.push_str(scene_text.trim());
                body_plain.push_str("\n\n");
                html.push_str(&plain_paragraphs_to_html(&scene_text));
            }
        }
    }

    Ok(ExportDocument {
        title,
        cover_image_path: non_empty_string(&book.cover_image_path),
        markdown,
        plain_text: plain,
        body_plain,
        html_body: html,
    })
}

fn render_export_separator(
    settings: &ExportSeparatorSettings,
    book: &Book,
    chapter: &Chapter,
    scene: Option<&&Scene>,
) -> String {
    settings
        .text
        .replace("{number}", &chapter.number.to_string())
        .replace(
            "{title}",
            if chapter.working_title.is_empty() {
                "Bez tytułu"
            } else {
                &chapter.working_title
            },
        )
        .replace(
            "{book}",
            if book.title.is_empty() {
                &book.working_title
            } else {
                &book.title
            },
        )
        .replace(
            "{scene}",
            scene.map(|item| item.title.as_str()).unwrap_or(""),
        )
}

fn export_result(
    path: PathBuf,
    format: &str,
    fallback: Option<PathBuf>,
    warning: Option<String>,
) -> ExportBookResult {
    ExportBookResult {
        file_path: path.to_string_lossy().to_string(),
        format: format.into(),
        fallback_file_path: fallback.map(|path| path.to_string_lossy().to_string()),
        warning,
    }
}

fn export_file_stem(book: &Book) -> String {
    let raw = if book.title.trim().is_empty() {
        book.working_title.trim()
    } else {
        book.title.trim()
    };
    let mut stem = String::new();
    for character in raw.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            stem.push(character);
        } else if character.is_whitespace() || character == '-' || character == '_' {
            if !stem.ends_with('-') {
                stem.push('-');
            }
        }
    }
    let stem = stem.trim_matches('-');
    if stem.is_empty() {
        "manuskrypt".into()
    } else {
        stem.into()
    }
}

fn html_to_plain_text(value: &str) -> String {
    let mut text = value
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</h1>", "\n\n")
        .replace("</h2>", "\n\n")
        .replace("<li>", "- ")
        .replace("</li>", "\n");
    let mut out = String::new();
    let mut in_tag = false;
    for character in text.drain(..) {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(character),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn plain_paragraphs_to_html(value: &str) -> String {
    value
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| format!("<p>{}</p>", escape_xml(part)))
        .collect::<Vec<_>>()
        .join("")
}

struct ExportCoverImage {
    data: Vec<u8>,
    extension: &'static str,
    content_type: &'static str,
}

fn docx_cover_page(document: &ExportDocument, cover_image: Option<&ExportCoverImage>) -> String {
    let content = if cover_image.is_some() {
        r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3657600" cy="5486400"/><wp:docPr id="1" name="Okładka"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="cover"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdCoverImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3657600" cy="5486400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#.to_string()
    } else {
        format!(
            r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>{}</w:t></w:r></w:p>"#,
            escape_xml(&document.title)
        )
    };
    format!(r#"{content}<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#)
}

fn read_export_cover_image(path: Option<&str>) -> Option<ExportCoverImage> {
    let path = path?.trim();
    if path.is_empty() || path.starts_with("data:") || path.starts_with("asset:") {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    let (extension, content_type) = export_cover_image_type(path, &data)?;
    Some(ExportCoverImage {
        data,
        extension,
        content_type,
    })
}

fn export_cover_image_type(path: &str, data: &[u8]) -> Option<(&'static str, &'static str)> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if data.starts_with(PNG_SIGNATURE) || extension == "png" {
        return Some(("png", "image/png"));
    }
    if data.starts_with(&[0xff, 0xd8, 0xff]) || extension == "jpg" || extension == "jpeg" {
        return Some(("jpg", "image/jpeg"));
    }
    None
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_docx(document: &ExportDocument, page_numbers: bool) -> Result<Vec<u8>, AppError> {
    let cover_image = read_export_cover_image(document.cover_image_path.as_deref());
    let mut body = String::new();
    body.push_str(&docx_cover_page(document, cover_image.as_ref()));
    body.push_str(&format!(
        "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
        escape_xml(&document.title)
    ));
    for paragraph in document
        .plain_text
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        body.push_str(&format!(
            "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escape_xml(paragraph)
        ));
    }
    if false && page_numbers {
        body.push_str("<w:p><w:r><w:t>Numeracja stron: włączona w ustawieniach eksportu DOCX.</w:t></w:r></w:p>");
    }
    let section_properties = if page_numbers {
        r#"<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/></w:sectPr>"#
    } else {
        "<w:sectPr/>"
    };
    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}{section_properties}</w:body></w:document>"#
    );
    let footer_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>"#;
    let cover_content_type = cover_image
        .as_ref()
        .map(|image| {
            format!(
                r#"<Default Extension="{}" ContentType="{}"/>"#,
                image.extension, image.content_type
            )
        })
        .unwrap_or_default();
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{cover_content_type}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>"#
    );
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let cover_relationship = cover_image
        .as_ref()
        .map(|image| {
            format!(
                r#"<Relationship Id="rIdCoverImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.{}"/>"#,
                image.extension
            )
        })
        .unwrap_or_default();
    let document_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>{cover_relationship}</Relationships>"#
    );
    let mut files = vec![
        (
            "[Content_Types].xml".to_string(),
            content_types.into_bytes(),
        ),
        ("_rels/.rels".to_string(), rels.as_bytes().to_vec()),
        ("word/document.xml".to_string(), document_xml.into_bytes()),
        (
            "word/_rels/document.xml.rels".to_string(),
            document_rels.into_bytes(),
        ),
        (
            "word/footer1.xml".to_string(),
            footer_xml.as_bytes().to_vec(),
        ),
    ];
    if let Some(image) = cover_image {
        files.push((format!("word/media/cover.{}", image.extension), image.data));
    }
    Ok(zip_store(files))
}

fn build_epub(document: &ExportDocument, book: &Book) -> Result<Vec<u8>, AppError> {
    let title = escape_xml(&document.title);
    let identifier = escape_xml(&book.id);
    let cover_image = read_export_cover_image(document.cover_image_path.as_deref());
    let (cover_manifest, cover_metadata, cover_body) = if let Some(image) = cover_image.as_ref() {
        (
            format!(
                r#"<item id="cover-image" href="images/cover.{}" media-type="{}" properties="cover-image"/>"#,
                image.extension, image.content_type
            ),
            r#"<meta name="cover" content="cover-image"/>"#.to_string(),
            format!(
                r#"<section class="cover-page"><img src="images/cover.{}" alt="{}"/></section>"#,
                image.extension, title
            ),
        )
    } else {
        (
            String::new(),
            String::new(),
            format!(r#"<section class="cover-page"><h1>{title}</h1></section>"#),
        )
    };
    let cover = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="pl"><head><title>{title}</title><link href="style.css" rel="stylesheet" type="text/css"/></head><body>{cover_body}</body></html>"#
    );
    let content = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="pl"><head><title>{title}</title><link href="style.css" rel="stylesheet" type="text/css"/></head><body>{}</body></html>"#,
        document.html_body
    );
    let opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">{identifier}</dc:identifier><dc:title>{title}</dc:title><dc:language>pl</dc:language>{cover_metadata}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="style" href="style.css" media-type="text/css"/>{cover_manifest}</manifest><spine><itemref idref="cover"/><itemref idref="content"/></spine></package>"#
    );
    let nav = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="pl"><head><title>{title}</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="content.xhtml">{title}</a></li></ol></nav></body></html>"#
    );
    let container = r#"<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    let css = "body{font-family:serif;line-height:1.6;margin:5%;}h1,h2{text-align:center;}.cover-page{display:block;text-align:center;page-break-after:always;}.cover-page img{display:block;max-width:100%;max-height:95vh;margin:0 auto;}.cover-page h1{margin-top:35vh;font-size:2.4em;}.scene-separator{text-align:center;margin:2em 0;color:#6f5c42;}";
    let mut files = vec![
        ("mimetype".to_string(), b"application/epub+zip".to_vec()),
        (
            "META-INF/container.xml".to_string(),
            container.as_bytes().to_vec(),
        ),
        ("OEBPS/content.opf".to_string(), opf.into_bytes()),
        ("OEBPS/nav.xhtml".to_string(), nav.into_bytes()),
        ("OEBPS/cover.xhtml".to_string(), cover.into_bytes()),
        ("OEBPS/content.xhtml".to_string(), content.into_bytes()),
        ("OEBPS/style.css".to_string(), css.as_bytes().to_vec()),
    ];
    if let Some(image) = cover_image {
        files.push((
            format!("OEBPS/images/cover.{}", image.extension),
            image.data,
        ));
    }
    Ok(zip_store(files))
}

async fn convert_epub_to_mobi(epub_path: &Path, mobi_path: &Path) -> Result<(), String> {
    let ebook_convert = Command::new("ebook-convert")
        .arg(epub_path)
        .arg(mobi_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .await;
    match ebook_convert {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("ebook-convert zakończył się kodem {status}")),
        Err(error) => Err(error.to_string()),
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn zip_store(files: Vec<(String, Vec<u8>)>) -> Vec<u8> {
    let mut output = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = output.len() as u32;
        let crc = crc32(&data);
        let name_bytes = name.as_bytes();
        write_u32(&mut output, 0x04034b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, crc);
        write_u32(&mut output, data.len() as u32);
        write_u32(&mut output, data.len() as u32);
        write_u16(&mut output, name_bytes.len() as u16);
        write_u16(&mut output, 0);
        output.extend_from_slice(name_bytes);
        output.extend_from_slice(&data);

        write_u32(&mut central, 0x02014b50);
        write_u16(&mut central, 20);
        write_u16(&mut central, 20);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u32(&mut central, crc);
        write_u32(&mut central, data.len() as u32);
        write_u32(&mut central, data.len() as u32);
        write_u16(&mut central, name_bytes.len() as u16);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u32(&mut central, 0);
        write_u32(&mut central, offset);
        central.extend_from_slice(name_bytes);
    }
    let central_offset = output.len() as u32;
    let central_size = central.len() as u32;
    let file_count = files_len_from_central(&central);
    output.extend_from_slice(&central);
    write_u32(&mut output, 0x06054b50);
    write_u16(&mut output, 0);
    write_u16(&mut output, 0);
    write_u16(&mut output, file_count);
    write_u16(&mut output, file_count);
    write_u32(&mut output, central_size);
    write_u32(&mut output, central_offset);
    write_u16(&mut output, 0);
    output
}

fn files_len_from_central(central: &[u8]) -> u16 {
    central
        .windows(4)
        .filter(|window| *window == [0x50, 0x4b, 0x01, 0x02])
        .count() as u16
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = if crc & 1 == 1 { 0xedb8_8320 } else { 0 };
            crc = (crc >> 1) ^ mask;
        }
    }
    !crc
}

async fn validate_export_artwork_target(
    pool: &SqlitePool,
    project_id: &str,
    book_id: &str,
    related_type: &str,
    related_id: &str,
) -> Result<(), AppError> {
    validate_export_artwork_related_type(related_type)?;
    let count: (i64,) = match related_type {
        "book" => {
            sqlx::query_as("SELECT COUNT(*) FROM books WHERE id = ? AND project_id = ?")
                .bind(related_id)
                .bind(project_id)
                .fetch_one(pool)
                .await?
        }
        "chapter" => {
            sqlx::query_as("SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ?")
                .bind(related_id)
                .bind(book_id)
                .fetch_one(pool)
                .await?
        }
        "scene" => {
            sqlx::query_as("SELECT COUNT(*) FROM scenes WHERE id = ? AND book_id = ?")
                .bind(related_id)
                .bind(book_id)
                .fetch_one(pool)
                .await?
        }
        _ => unreachable!(),
    };
    if count.0 == 0 {
        return Err(AppError::Process(
            "Nie znaleziono celu grafiki eksportu.".into(),
        ));
    }
    Ok(())
}

fn validate_export_artwork_related_type(related_type: &str) -> Result<(), AppError> {
    match related_type {
        "book" | "chapter" | "scene" => Ok(()),
        _ => Err(AppError::Process(
            "Nieobsługiwany typ celu grafiki eksportu.".into(),
        )),
    }
}

fn reveal_file_in_system(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let mut select_arg = OsString::from("/select,");
        select_arg.push(path.as_os_str());
        StdCommand::new("explorer.exe").arg(select_arg).spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open").arg("-R").arg(path).spawn()?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::Process("Nie znaleziono katalogu pliku eksportu.".into()))?;
        StdCommand::new("xdg-open").arg(parent).spawn()?;
        return Ok(());
    }
}

#[tauri::command]
async fn create_project(
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> Result<ProjectDetails, String> {
    create_project_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    list_projects_in_pool(&state.db)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    delete_project_in_pool(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn get_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectDetails, String> {
    get_project_details(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn get_book_plan(state: State<'_, AppState>, book_id: String) -> Result<BookPlan, String> {
    get_book_plan_in_pool(&state.db, &book_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn get_character_workspace(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<CharacterWorkspace, String> {
    get_character_workspace_in_pool(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn get_world_workspace(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<WorldWorkspace, String> {
    get_world_workspace_in_pool(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_story_structure(
    state: State<'_, AppState>,
    input: SaveStoryStructureInput,
) -> Result<StoryStructure, String> {
    save_story_structure_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_act(state: State<'_, AppState>, input: UpsertActInput) -> Result<Act, String> {
    upsert_act_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_act(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_act_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_beat(state: State<'_, AppState>, input: UpsertBeatInput) -> Result<Beat, String> {
    upsert_beat_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_beat(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_beat_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn move_beat_to_chapter(
    state: State<'_, AppState>,
    input: MoveBeatToChapterInput,
) -> Result<(), String> {
    move_beat_to_chapter_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_plot_thread(
    state: State<'_, AppState>,
    input: UpsertPlotThreadInput,
) -> Result<PlotThread, String> {
    upsert_plot_thread_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_plot_thread(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_plot_thread_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_chapter(
    state: State<'_, AppState>,
    input: UpsertChapterInput,
) -> Result<Chapter, String> {
    upsert_chapter_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_chapter_thread_relation(
    state: State<'_, AppState>,
    input: UpsertChapterThreadInput,
) -> Result<(), String> {
    upsert_chapter_thread_relation_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_chapter(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_chapter_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_plan_versions(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<PlanVersion>, String> {
    list_plan_versions_in_pool(&state.db, &book_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn create_plan_version_from_active(
    state: State<'_, AppState>,
    input: CreatePlanVersionInput,
) -> Result<PlanVersion, String> {
    create_plan_version_from_active_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn set_active_plan_version(
    state: State<'_, AppState>,
    input: SetActivePlanVersionInput,
) -> Result<PlanVersion, String> {
    set_active_plan_version_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_plan_version(
    state: State<'_, AppState>,
    input: DeletePlanVersionInput,
) -> Result<(), String> {
    delete_plan_version_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_scene(
    state: State<'_, AppState>,
    input: UpsertSceneInput,
) -> Result<Scene, String> {
    upsert_scene_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_scene(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_scene_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn search_project(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    search_project_in_pool(&state.db, &project_id, &query)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn create_scene_snapshot(
    state: State<'_, AppState>,
    scene_id: String,
    source: String,
) -> Result<Option<SceneSnapshotMeta>, String> {
    create_scene_snapshot_in_pool(&state.db, &scene_id, &source)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_scene_auto_summary(
    state: State<'_, AppState>,
    input: SaveSceneAutoSummaryInput,
) -> Result<Scene, String> {
    save_scene_auto_summary_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_scene_critique(
    state: State<'_, AppState>,
    input: SaveSceneCritiqueInput,
) -> Result<SceneCritiqueRecord, String> {
    save_scene_critique_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_scene_critiques(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<SceneCritiqueRecord>, String> {
    list_scene_critiques_in_pool(&state.db, &book_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn set_scene_style_reference(
    state: State<'_, AppState>,
    input: SetSceneStyleReferenceInput,
) -> Result<Scene, String> {
    set_scene_style_reference_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_chapter_auto_summary(
    state: State<'_, AppState>,
    input: SaveChapterAutoSummaryInput,
) -> Result<Chapter, String> {
    save_chapter_auto_summary_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_story_so_far(
    state: State<'_, AppState>,
    input: SaveStorySoFarInput,
) -> Result<Book, String> {
    save_story_so_far_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_scene_snapshots(
    state: State<'_, AppState>,
    scene_id: String,
) -> Result<Vec<SceneSnapshotMeta>, String> {
    list_scene_snapshots_in_pool(&state.db, &scene_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn get_scene_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<SceneSnapshot, String> {
    get_scene_snapshot_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn restore_scene_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<Scene, String> {
    restore_scene_snapshot_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn reorder_scenes(
    state: State<'_, AppState>,
    input: ReorderScenesInput,
) -> Result<(), String> {
    reorder_scenes_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn set_scene_relations(
    state: State<'_, AppState>,
    input: SetSceneRelationsInput,
) -> Result<(), String> {
    set_scene_relations_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_character(
    state: State<'_, AppState>,
    input: UpsertCharacterInput,
) -> Result<Character, String> {
    upsert_character_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_character(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_character_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_character_relation(
    state: State<'_, AppState>,
    input: UpsertCharacterRelationInput,
) -> Result<CharacterRelation, String> {
    upsert_character_relation_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_character_relation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_character_relation_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_character_memory(
    state: State<'_, AppState>,
    input: UpsertCharacterMemoryInput,
) -> Result<CharacterMemory, String> {
    upsert_character_memory_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_character_memory(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_character_memory_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_character_memory_link(
    state: State<'_, AppState>,
    input: UpsertCharacterMemoryLinkInput,
) -> Result<CharacterMemoryLink, String> {
    upsert_character_memory_link_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_character_memory_link(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    delete_character_memory_link_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_world_element(
    state: State<'_, AppState>,
    input: UpsertWorldElementInput,
) -> Result<WorldElement, String> {
    upsert_world_element_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_world_element(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_world_element_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_world_rule(
    state: State<'_, AppState>,
    input: UpsertWorldRuleInput,
) -> Result<WorldRule, String> {
    upsert_world_rule_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn delete_world_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    delete_world_rule_in_pool(&state.db, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn set_world_element_relations(
    state: State<'_, AppState>,
    input: SetWorldElementRelationsInput,
) -> Result<(), String> {
    set_world_element_relations_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn set_world_rule_relations(
    state: State<'_, AppState>,
    input: SetWorldRuleRelationsInput,
) -> Result<(), String> {
    set_world_rule_relations_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn reorder_plan_items(
    state: State<'_, AppState>,
    input: ReorderPlanItemsInput,
) -> Result<(), String> {
    reorder_plan_items_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_ai_runs(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<AiLogEntry>, String> {
    list_ai_runs_in_pool(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_ai_proposals(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<AiProposalRecord>, String> {
    list_ai_proposals_in_pool(&state.db, &project_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn upsert_ai_proposal_snapshot(
    state: State<'_, AppState>,
    input: UpsertAiProposalSnapshotInput,
) -> Result<(), String> {
    upsert_ai_proposal_snapshot_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn mark_ai_proposal_accepted(state: State<'_, AppState>, id: String) -> Result<(), String> {
    mark_ai_proposal_decision_in_pool(&state.db, &id, "accepted")
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn mark_ai_proposal_rejected(state: State<'_, AppState>, id: String) -> Result<(), String> {
    mark_ai_proposal_decision_in_pool(&state.db, &id, "rejected")
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn update_book_concept(
    state: State<'_, AppState>,
    book_id: String,
    input: BookConceptInput,
) -> Result<Book, String> {
    update_book_concept_in_pool(&state.db, &book_id, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn generate_book_cover(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateBookCoverInput,
) -> Result<BookCoverResult, String> {
    generate_book_cover_in_pool(&app, &state.db, &state.active_codex_runs, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn accept_generated_book_cover(
    state: State<'_, AppState>,
    input: AcceptGeneratedBookCoverInput,
) -> Result<Book, String> {
    verify_generated_png_file(Path::new(&input.image_path), "Accepted cover image")
        .await
        .map_err(command_error)?;

    update_book_cover_metadata_in_pool(
        &state.db,
        &input.book_id,
        &input.image_path,
        &input.cover_prompt,
        &input.cover_negative_prompt,
        &input.generated_at,
    )
    .await
    .map_err(command_error)
}

#[tauri::command]
async fn generate_character_image(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateCharacterImageInput,
) -> Result<CharacterImageResult, String> {
    generate_character_image_in_pool(&app, &state.db, &state.active_codex_runs, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn accept_generated_character_image(
    state: State<'_, AppState>,
    input: AcceptGeneratedCharacterImageInput,
) -> Result<CharacterImageResult, String> {
    accept_generated_character_image_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn export_book(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportBookInput,
) -> Result<ExportBookResult, String> {
    export_book_in_pool(&app, &state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn choose_export_directory() -> Result<Option<String>, String> {
    let selected = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Wybierz folder eksportu")
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("Nie udało się otworzyć wyboru folderu: {error}"))?;

    Ok(selected)
}

#[tauri::command]
async fn reveal_export_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    let canonical = path
        .canonicalize()
        .map_err(AppError::from)
        .map_err(command_error)?;

    if !canonical.is_file() {
        return Err("Nie znaleziono pliku eksportu.".into());
    }

    reveal_file_in_system(&canonical).map_err(command_error)
}

#[tauri::command]
async fn list_export_presets(
    state: State<'_, AppState>,
    project_id: String,
    book_id: String,
) -> Result<Vec<ExportPreset>, String> {
    list_export_presets_in_pool(&state.db, &project_id, &book_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn save_export_preset(
    state: State<'_, AppState>,
    input: SaveExportPresetInput,
) -> Result<ExportPreset, String> {
    save_export_preset_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn generate_export_artwork(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateExportArtworkInput,
) -> Result<ExportArtworkResult, String> {
    generate_export_artwork_in_pool(&app, &state.db, &state.active_codex_runs, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn accept_generated_export_artwork(
    state: State<'_, AppState>,
    input: AcceptGeneratedExportArtworkInput,
) -> Result<ExportArtworkResult, String> {
    accept_generated_export_artwork_in_pool(&state.db, input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn check_codex_cli(codex_path: Option<String>) -> Result<CodexCliStatus, String> {
    let path = codex_path.unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&path).await;
    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.prefix_args)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command.output().await;

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let version = if stdout.is_empty() { stderr } else { stdout };
            Ok(CodexCliStatus {
                available: true,
                path: Some(command_spec.display_path),
                version: if version.is_empty() { None } else { Some(version) },
                auth_likely_ready: None,
                message: Some("Codex CLI jest dostępny. Logowanie zostanie zweryfikowane przy pierwszym uruchomieniu codex exec.".into()),
            })
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok(CodexCliStatus {
                available: false,
                path: Some(command_spec.display_path),
                version: None,
                auth_likely_ready: None,
                message: Some(if stderr.is_empty() {
                    "Codex CLI zwrócił niezerowy status dla --version.".into()
                } else {
                    stderr
                }),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: None,
            message: Some("Nie znaleziono Codex CLI w PATH ani pod skonfigurowaną ścieżką.".into()),
        }),
        Err(error) => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: None,
            message: Some(format!("Nie udało się uruchomić Codex CLI: {error}")),
        }),
    }
}

#[tauri::command]
async fn check_codex_login(codex_path: Option<String>) -> Result<CodexCliStatus, String> {
    let path = codex_path.unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&path).await;
    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.prefix_args)
        .arg("login")
        .arg("status")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match command.output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if stdout.is_empty() { stderr } else { stdout };
            Ok(CodexCliStatus {
                available: true,
                path: Some(command_spec.display_path),
                version: None,
                auth_likely_ready: Some(output.status.success()),
                message: Some(if message.is_empty() {
                    if output.status.success() {
                        "Zalogowano w Codex CLI.".into()
                    } else {
                        "Codex CLI nie jest zalogowany. Użyj przycisku logowania.".into()
                    }
                } else {
                    message
                }),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: Some(false),
            message: Some("Nie znaleziono Codex CLI w PATH ani pod skonfigurowaną ścieżką.".into()),
        }),
        Err(error) => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: Some(false),
            message: Some(format!("Nie udało się uruchomić Codex CLI: {error}")),
        }),
    }
}

fn claude_auth_heuristic() -> bool {
    let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) else {
        return false;
    };
    let home = PathBuf::from(home);
    if home.join(".claude").join(".credentials.json").is_file() {
        return true;
    }
    std::fs::read_to_string(home.join(".claude.json"))
        .map(|text| text.contains("oauthAccount"))
        .unwrap_or(false)
}

#[tauri::command]
async fn check_claude_cli(claude_path: Option<String>) -> Result<CodexCliStatus, String> {
    let path = claude_path.unwrap_or_else(|| "claude".to_string());
    let command_spec = resolve_codex_command(&path).await;
    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.prefix_args)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match command.output().await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let version = if stdout.is_empty() { stderr } else { stdout };
            let auth_ready = claude_auth_heuristic();
            Ok(CodexCliStatus {
                available: true,
                path: Some(command_spec.display_path),
                version: if version.is_empty() { None } else { Some(version) },
                auth_likely_ready: Some(auth_ready),
                message: Some(if auth_ready {
                    "Claude Code CLI jest dostępny i wygląda na zalogowany (heurystyka na podstawie plików logowania).".into()
                } else {
                    "Claude Code CLI jest dostępny, ale nie znaleziono danych logowania. Zaloguj się przez terminal (/login).".into()
                }),
            })
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok(CodexCliStatus {
                available: false,
                path: Some(command_spec.display_path),
                version: None,
                auth_likely_ready: Some(false),
                message: Some(if stderr.is_empty() {
                    "Claude Code CLI zwrócił niezerowy status dla --version.".into()
                } else {
                    stderr
                }),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: Some(false),
            message: Some(
                "Nie znaleziono Claude Code CLI. Zainstaluj: npm install -g @anthropic-ai/claude-code".into(),
            ),
        }),
        Err(error) => Ok(CodexCliStatus {
            available: false,
            path: Some(command_spec.display_path),
            version: None,
            auth_likely_ready: Some(false),
            message: Some(format!("Nie udało się uruchomić Claude Code CLI: {error}")),
        }),
    }
}

#[tauri::command]
async fn start_codex_login(codex_path: Option<String>) -> Result<(), String> {
    let path = codex_path.unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&path).await;
    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.prefix_args)
        .arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Nie udało się uruchomić logowania Codex CLI: {error}"))
}

#[tauri::command]
async fn start_claude_login(claude_path: Option<String>) -> Result<(), String> {
    let path = claude_path.unwrap_or_else(|| "claude".to_string());
    let command_spec = resolve_codex_command(&path).await;

    if cfg!(windows) {
        // Otwórz osobne okno terminala z REPL claude — użytkownik wpisuje /login.
        StdCommand::new("cmd.exe")
            .args(["/C", "start", "", "cmd", "/K", &command_spec.display_path])
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Nie udało się otworzyć terminala logowania: {error}"))
    } else {
        Err("Uruchom `claude` w terminalu i wpisz /login, aby zalogować się subskrypcją Anthropic."
            .into())
    }
}

#[tauri::command]
async fn list_codex_models(codex_path: Option<String>) -> Result<CodexModelCatalog, String> {
    let path = codex_path.unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&path).await;
    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.prefix_args)
        .arg("debug")
        .arg("models")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match command.output().await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let parsed: Value = serde_json::from_str(&stdout)
                .map_err(AppError::from)
                .map_err(command_error)?;
            let models = parsed
                .get("models")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            Ok(CodexModelCatalog {
                models,
                fallback: false,
                error_message: None,
            })
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok(fallback_model_catalog(if stderr.is_empty() {
                "Codex CLI zwrócił niezerowy status dla debug models.".into()
            } else {
                stderr
            }))
        }
        Err(error) => Ok(fallback_model_catalog(format!(
            "Nie udało się odczytać katalogu modeli Codex: {error}"
        ))),
    }
}

#[tauri::command]
async fn run_codex_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RunCodexPromptRequest,
) -> Result<AiRunResult, String> {
    run_codex_prompt_in_pool(&app, &state.db, &state.active_codex_runs, request)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn list_active_codex_runs(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<ActiveCodexRun>, String> {
    Ok(list_active_codex_runs_in_registry(&state.active_codex_runs, project_id.as_deref()).await)
}

#[tauri::command]
async fn cancel_active_codex_run(
    state: State<'_, AppState>,
    project_id: Option<String>,
    ai_run_id: Option<String>,
) -> Result<bool, String> {
    Ok(cancel_active_codex_run_in_registry(
        &state.active_codex_runs,
        project_id.as_deref(),
        ai_run_id.as_deref(),
    )
    .await)
}

#[tauri::command]
async fn generate_new_project_title(
    app: AppHandle,
    state: State<'_, AppState>,
    request: GenerateNewProjectTitleRequest,
) -> Result<AiRunResult, String> {
    generate_new_project_title_with_codex(&app, &state.active_codex_runs, request)
        .await
        .map_err(command_error)
}

pub(crate) async fn generate_new_project_title_with_codex(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    request: GenerateNewProjectTitleRequest,
) -> Result<AiRunResult, AppError> {
    if request.prompt.trim().is_empty() {
        return Err(AppError::Process("Prompt cannot be empty.".into()));
    }

    let ai_run_id = Uuid::new_v4().to_string();
    let timeout_seconds = request.timeout_seconds.unwrap_or(180);
    let codex_request = RunCodexPromptRequest {
        project_id: "__new_project__".into(),
        action: request.action,
        prompt_package_id: request.prompt_package_id,
        prompt_package_json: request.prompt_package_json,
        prompt: request.prompt,
        codex_path: request.codex_path,
        timeout_seconds: request.timeout_seconds,
        model: request.model,
        reasoning_effort: request.reasoning_effort,
    };

    let settings = load_ai_settings(app).await;
    let provider_id = settings.text_provider_id().to_string();

    let started_at = Instant::now();
    let run_result = execute_text_provider(
        app,
        active_codex_runs,
        &ai_run_id,
        &codex_request,
        &settings,
        timeout_seconds,
    )
    .await;
    let duration_ms = started_at.elapsed().as_millis();

    let (status, raw_output, stderr, error_message) = match run_result {
        Ok((stdout, stderr)) => (
            "success".to_string(),
            Some(stdout),
            if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
            None,
        ),
        Err(AppError::Timeout(seconds)) => (
            "timeout".to_string(),
            None,
            None,
            Some(format!(
                "Codex CLI przekroczył limit czasu po {seconds} sekundach"
            )),
        ),
        Err(AppError::Cancelled) => (
            "cancelled".to_string(),
            None,
            None,
            Some("Generowanie Codex CLI zostało przerwane.".to_string()),
        ),
        Err(error) => ("error".to_string(), None, None, Some(error.to_string())),
    };

    Ok(AiRunResult {
        id: ai_run_id,
        provider_id,
        prompt_package_id: codex_request.prompt_package_id,
        action: codex_request.action,
        status,
        raw_output,
        stderr,
        error_message,
        duration_ms,
    })
}

pub(crate) async fn run_codex_prompt_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    active_codex_runs: &ActiveCodexRunRegistry,
    request: RunCodexPromptRequest,
) -> Result<AiRunResult, AppError> {
    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&request.prompt_package_json)?;
    let timeout_seconds = request.timeout_seconds.unwrap_or(180);
    let settings = load_ai_settings(app).await;
    let provider_id = settings.text_provider_id().to_string();
    let effective_model = settings
        .effective_text_model()
        .or_else(|| request.model.clone());

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&request.project_id)
    .bind(&provider_id)
    .bind(effective_model.as_deref().unwrap_or(""))
    .bind(request.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&request.action)
    .bind(&prompt_package_json)
    .bind(&request.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    let started_at = Instant::now();
    let run_result = execute_text_provider(
        app,
        active_codex_runs,
        &ai_run_id,
        &request,
        &settings,
        timeout_seconds,
    )
    .await;
    let duration_ms = started_at.elapsed().as_millis();
    let completed_at = Utc::now().to_rfc3339();

    let (status, raw_output, stderr, error_message) = match run_result {
        Ok((stdout, stderr)) => (
            "success".to_string(),
            Some(stdout),
            if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
            None,
        ),
        Err(AppError::Timeout(seconds)) => (
            "timeout".to_string(),
            None,
            None,
            Some(format!(
                "Codex CLI przekroczył limit czasu po {seconds} sekundach"
            )),
        ),
        Err(AppError::Cancelled) => (
            "cancelled".to_string(),
            None,
            None,
            Some("Generowanie Codex CLI zostało przerwane.".to_string()),
        ),
        Err(error) => ("error".to_string(), None, None, Some(error.to_string())),
    };

    sqlx::query(
        r#"
        UPDATE ai_runs
        SET raw_output = ?, status = ?, error_message = ?, completed_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&raw_output)
    .bind(&status)
    .bind(&error_message)
    .bind(&completed_at)
    .bind(&ai_run_id)
    .execute(pool)
    .await?;

    Ok(AiRunResult {
        id: ai_run_id,
        provider_id,
        prompt_package_id: request.prompt_package_id,
        action: request.action,
        status,
        raw_output,
        stderr,
        error_message,
        duration_ms,
    })
}

async fn execute_text_provider(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    settings: &AiSettings,
    timeout_seconds: u64,
) -> Result<(String, String), AppError> {
    match settings.text_provider.as_str() {
        ai_settings::TEXT_PROVIDER_CLAUDE => {
            providers::execute_claude_cli(
                app,
                active_codex_runs,
                ai_run_id,
                request,
                settings,
                timeout_seconds,
            )
            .await
        }
        ai_settings::TEXT_PROVIDER_OPENAI_API => {
            providers::execute_openai_text(
                active_codex_runs,
                ai_run_id,
                request,
                settings,
                timeout_seconds,
            )
            .await
        }
        ai_settings::TEXT_PROVIDER_ANTHROPIC_API => {
            providers::execute_anthropic_text(
                active_codex_runs,
                ai_run_id,
                request,
                settings,
                timeout_seconds,
            )
            .await
        }
        _ => execute_codex(app, active_codex_runs, ai_run_id, request, timeout_seconds).await,
    }
}

#[allow(clippy::too_many_arguments)]
async fn execute_direct_image_provider(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    settings: &AiSettings,
    ai_run_id: &str,
    project_id: &str,
    action: &str,
    subdir: &str,
    file_name: &str,
    visual_prompt: &str,
    negative_prompt: &str,
    portrait: bool,
    timeout_seconds: u64,
) -> Result<(String, String, PathBuf), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    let image_path = app_data_dir
        .join("codex-workspaces")
        .join(project_id)
        .join(subdir)
        .join(ai_run_id)
        .join(file_name);

    providers::execute_direct_image_generation(
        active_codex_runs,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: project_id.to_string(),
            action: action.to_string(),
            started_at: Utc::now().to_rfc3339(),
            model: settings.effective_image_model(),
            reasoning_effort: None,
            phase: "image_generation".into(),
        },
        settings,
        providers::DirectImageJob {
            visual_prompt,
            negative_prompt,
            portrait,
            out_path: &image_path,
        },
        timeout_seconds,
    )
    .await
}

async fn complete_ai_run(
    pool: &SqlitePool,
    ai_run_id: &str,
    status: &str,
    raw_output: Option<&str>,
    error_message: Option<&str>,
    completed_at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE ai_runs
        SET raw_output = ?, status = ?, error_message = ?, completed_at = ?
        WHERE id = ?
        "#,
    )
    .bind(raw_output)
    .bind(status)
    .bind(error_message)
    .bind(completed_at)
    .bind(ai_run_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn list_active_codex_runs_in_registry(
    registry: &ActiveCodexRunRegistry,
    project_id: Option<&str>,
) -> Vec<ActiveCodexRun> {
    let runs = registry.lock().await;
    runs.values()
        .filter(|handle| {
            project_id
                .map(|id| handle.run.project_id == id)
                .unwrap_or(true)
        })
        .map(|handle| handle.run.clone())
        .collect()
}

async fn cancel_active_codex_run_in_registry(
    registry: &ActiveCodexRunRegistry,
    project_id: Option<&str>,
    ai_run_id: Option<&str>,
) -> bool {
    let runs = registry.lock().await;
    let handle = runs.values().find(|handle| {
        project_id
            .map(|id| handle.run.project_id == id)
            .unwrap_or(true)
            && ai_run_id
                .map(|id| handle.run.ai_run_id == id)
                .unwrap_or(true)
    });

    if let Some(handle) = handle {
        let _ = handle.cancel.send(true);
        return true;
    }

    false
}

async fn run_registered_codex_command(
    registry: &ActiveCodexRunRegistry,
    run: ActiveCodexRun,
    command: &mut Command,
    stdin_text: &str,
    timeout_seconds: u64,
) -> Result<(ExitStatus, String, String), AppError> {
    let (cancel, mut cancel_rx) = watch::channel(false);
    registry.lock().await.insert(
        run.ai_run_id.clone(),
        ActiveCodexRunHandle {
            run: run.clone(),
            cancel,
        },
    );

    let result = async {
        let mut child = command.spawn()?;
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(stdin_text.as_bytes()).await?;
        }

        let stdout_task = tokio::spawn(async move {
            let mut buffer = Vec::new();
            if let Some(mut reader) = stdout.take() {
                reader.read_to_end(&mut buffer).await?;
            }
            Ok::<Vec<u8>, std::io::Error>(buffer)
        });
        let stderr_task = tokio::spawn(async move {
            let mut buffer = Vec::new();
            if let Some(mut reader) = stderr.take() {
                reader.read_to_end(&mut buffer).await?;
            }
            Ok::<Vec<u8>, std::io::Error>(buffer)
        });

        let timeout_sleep = tokio::time::sleep(Duration::from_secs(timeout_seconds));
        tokio::pin!(timeout_sleep);
        let wait_result = tokio::select! {
            status = child.wait() => {
                status.map_err(AppError::from)
            }
            _ = &mut timeout_sleep => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                Err(AppError::Timeout(timeout_seconds))
            }
            _ = cancel_rx.changed() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                Err(AppError::Cancelled)
            }
        };

        let stdout_bytes = stdout_task.await.map_err(|error| {
            AppError::Process(format!("Nie udało się odczytać stdout Codex CLI: {error}"))
        })??;
        let stderr_bytes = stderr_task.await.map_err(|error| {
            AppError::Process(format!("Nie udało się odczytać stderr Codex CLI: {error}"))
        })??;

        let status = wait_result?;
        let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
        let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
        Ok((status, stdout, stderr))
    }
    .await;

    registry.lock().await.remove(&run.ai_run_id);
    result
}

fn emit_cover_progress(
    app: &AppHandle,
    request: &GenerateBookCoverInput,
    ai_run_id: &str,
    phase: &str,
    message: &str,
    partial_image_data_url: Option<String>,
    progress: Option<u8>,
) {
    let _ = app.emit(
        COVER_GENERATION_EVENT,
        CoverGenerationProgress {
            project_id: request.project_id.clone(),
            book_id: request.book_id.clone(),
            ai_run_id: ai_run_id.to_string(),
            phase: phase.to_string(),
            message: message.to_string(),
            partial_image_data_url,
            progress,
        },
    );
}

fn cover_timeout_seconds(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(MIN_COVER_TIMEOUT_SECONDS)
        .max(MIN_COVER_TIMEOUT_SECONDS)
}

async fn execute_codex_image_generation(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    request: &GenerateBookCoverInput,
    ai_run_id: &str,
    timeout_seconds: u64,
) -> Result<(String, String, PathBuf), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udaĹ‚o siÄ™ ustaliÄ‡ katalogu danych aplikacji: {error}"
        ))
    })?;
    let workspace = app_data_dir
        .join("codex-workspaces")
        .join(&request.project_id)
        .join("cover-runs")
        .join(ai_run_id);
    tokio::fs::create_dir_all(&workspace).await?;
    ensure_git_workspace(&workspace).await;

    let image_path = workspace.join("cover.png");
    let image_path_text = image_path.to_string_lossy().to_string();
    let prompt = format!(
        "{}\nFresh generation nonce: {ai_run_id}. Use this only to randomize the image generation; do not render it as visible cover text.\n",
        request.prompt.replace("{OUTPUT_FILE}", &image_path_text)
    );
    match tokio::fs::remove_file(&image_path).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::from(error)),
    }
    let generation_started_at = SystemTime::now()
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    tokio::fs::write(workspace.join("prompt.md"), prompt.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("context.json"),
        serde_json::to_string_pretty(&request.prompt_package_json)?.as_bytes(),
    )
    .await?;

    let codex_path = request
        .codex_path
        .clone()
        .unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&codex_path).await;
    let instruction = "Run the StoryForge2 cover image prompt from stdin. You must invoke the built-in $imagegen/image_generation tool to create a brand-new PNG from scratch before returning. Do not edit, extend, inpaint, upscale, vary, reuse, or derive from any previous image. Do not run shell commands, inspect the filesystem, copy files, or move files. Never return placeholder paths such as _image_id_.png. Return only compact JSON with imagePath set to the actual generated PNG path; if the exact filename is unavailable, return the generated_images session directory. StoryForge2 will resolve and copy the final PNG.";

    emit_cover_progress(
        app,
        request,
        ai_run_id,
        "request",
        "Uruchamiam Codex CLI z image_generation.",
        None,
        Some(12),
    );

    let mut command = Command::new(command_spec.program);
    command
        .args(command_spec.prefix_args)
        .arg("exec")
        .arg("--enable")
        .arg("image_generation")
        .arg("--disable")
        .arg("hooks")
        .arg("--disable")
        .arg("shell_tool");

    if let Some(model) = request
        .model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }

    if let Some(reasoning_effort) = request
        .reasoning_effort
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-c")
            .arg(format!("model_reasoning_effort=\"{reasoning_effort}\""));
    }

    command
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("workspace-write")
        .arg(instruction)
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    emit_cover_progress(
        app,
        request,
        ai_run_id,
        "streaming",
        "Codex CLI generuje okladke.",
        None,
        Some(25),
    );

    let (status, stdout, stderr) = run_registered_codex_command(
        active_codex_runs,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: request.project_id.clone(),
            action: "generate_cover_image".into(),
            started_at: Utc::now().to_rfc3339(),
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            phase: "image_generation".into(),
        },
        &mut command,
        &prompt,
        timeout_seconds,
    )
    .await?;
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": "generate_cover_image",
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": status.code(),
            "stderr": stderr,
            "imagePath": image_path_text,
            "completedAt": Utc::now().to_rfc3339()
        })
        .to_string()
        .as_bytes(),
    )
    .await?;

    let actual_image_path_result =
        resolve_generated_cover_path(&image_path, &stdout, &stderr, generation_started_at).await;

    if !status.success() {
        return Err(AppError::Process(if stderr.trim().is_empty() {
            "Codex CLI zwrĂłciĹ‚ niezerowy status podczas generowania okĹ‚adki.".into()
        } else {
            stderr
        }));
    }

    let actual_image_path = actual_image_path_result?;
    verify_generated_png_file(&actual_image_path, "Codex CLI generated image").await?;

    emit_cover_progress(
        app,
        request,
        ai_run_id,
        "final",
        "Codex CLI utworzyl obraz.",
        None,
        Some(92),
    );

    Ok((stdout, stderr, actual_image_path))
}

async fn execute_codex_character_image_generation(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    request: &GenerateCharacterImageInput,
    ai_run_id: &str,
    timeout_seconds: u64,
) -> Result<(String, String, PathBuf), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udalo sie ustalic katalogu danych aplikacji: {error}"
        ))
    })?;
    let workspace = app_data_dir
        .join("codex-workspaces")
        .join(&request.project_id)
        .join("character-image-runs")
        .join(ai_run_id);
    tokio::fs::create_dir_all(&workspace).await?;
    ensure_git_workspace(&workspace).await;

    let image_path = workspace.join("character.png");
    let image_path_text = image_path.to_string_lossy().to_string();
    let prompt = format!(
        "{}\nFresh generation nonce: {ai_run_id}. Use this only to randomize the image generation; do not render it as visible text.\n",
        request.prompt.replace("{OUTPUT_FILE}", &image_path_text)
    );
    match tokio::fs::remove_file(&image_path).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::from(error)),
    }
    let generation_started_at = SystemTime::now()
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    tokio::fs::write(workspace.join("prompt.md"), prompt.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("context.json"),
        serde_json::to_string_pretty(&request.prompt_package_json)?.as_bytes(),
    )
    .await?;

    let codex_path = request
        .codex_path
        .clone()
        .unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&codex_path).await;
    let instruction = "Run the StoryForge2 character image prompt from stdin. You must invoke the built-in $imagegen/image_generation tool to create a brand-new PNG portrait/reference image from scratch before returning. Do not edit, extend, inpaint, upscale, vary, reuse, or derive from any previous image. Do not run shell commands, inspect the filesystem, copy files, or move files. Never return placeholder paths such as _image_id_.png. Return only compact JSON with imagePath set to the actual generated PNG path; if the exact filename is unavailable, return the generated_images session directory. StoryForge2 will resolve and copy the final PNG.";

    let mut command = Command::new(command_spec.program);
    command
        .args(command_spec.prefix_args)
        .arg("exec")
        .arg("--enable")
        .arg("image_generation")
        .arg("--disable")
        .arg("hooks")
        .arg("--disable")
        .arg("shell_tool");

    if let Some(model) = request
        .model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }

    if let Some(reasoning_effort) = request
        .reasoning_effort
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-c")
            .arg(format!("model_reasoning_effort=\"{reasoning_effort}\""));
    }

    command
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("workspace-write")
        .arg(instruction)
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let (status, stdout, stderr) = run_registered_codex_command(
        active_codex_runs,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: request.project_id.clone(),
            action: "generate_character_image".into(),
            started_at: Utc::now().to_rfc3339(),
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            phase: "image_generation".into(),
        },
        &mut command,
        &prompt,
        timeout_seconds,
    )
    .await?;
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": "generate_character_image",
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": status.code(),
            "stderr": stderr,
            "imagePath": image_path_text,
            "completedAt": Utc::now().to_rfc3339()
        })
        .to_string()
        .as_bytes(),
    )
    .await?;

    let actual_image_path_result =
        resolve_generated_cover_path(&image_path, &stdout, &stderr, generation_started_at).await;

    if !status.success() {
        return Err(AppError::Process(if stderr.trim().is_empty() {
            "Codex CLI zwrocil niezerowy status podczas generowania obrazu postaci.".into()
        } else {
            stderr
        }));
    }

    let actual_image_path = actual_image_path_result?;
    verify_generated_png_file(&actual_image_path, "Codex CLI generated character image").await?;

    Ok((stdout, stderr, actual_image_path))
}

async fn execute_codex_export_artwork_generation(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    request: &GenerateExportArtworkInput,
    ai_run_id: &str,
    timeout_seconds: u64,
) -> Result<(String, String, PathBuf), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    let workspace = app_data_dir
        .join("codex-workspaces")
        .join(&request.project_id)
        .join("export-artwork-runs")
        .join(ai_run_id);
    tokio::fs::create_dir_all(&workspace).await?;
    ensure_git_workspace(&workspace).await;

    let image_path = workspace.join("export-artwork.png");
    let image_path_text = image_path.to_string_lossy().to_string();
    let prompt = format!(
        "{}\nFresh generation nonce: {ai_run_id}. Use this only to randomize the image generation; do not render it as visible text.\n",
        request.prompt.replace("{OUTPUT_FILE}", &image_path_text)
    );
    match tokio::fs::remove_file(&image_path).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::from(error)),
    }
    let generation_started_at = SystemTime::now()
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    tokio::fs::write(workspace.join("prompt.md"), prompt.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("context.json"),
        serde_json::to_string_pretty(&request.prompt_package_json)?.as_bytes(),
    )
    .await?;

    let codex_path = request
        .codex_path
        .clone()
        .unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&codex_path).await;
    let instruction = "Run the StoryForge2 export artwork prompt from stdin. You must invoke the built-in $imagegen/image_generation tool to create a brand-new PNG decorative separator, ornament, or editorial illustration from scratch before returning. Do not make a book cover or character portrait unless the prompt explicitly asks for it. Do not render text, labels, watermarks, signatures, or logos inside the image. Do not edit, extend, inpaint, upscale, vary, reuse, or derive from any previous image. Do not run shell commands, inspect the filesystem, copy files, or move files. Never return placeholder paths such as _image_id_.png. Return only compact JSON with imagePath set to the actual generated PNG path; if the exact filename is unavailable, return the generated_images session directory. StoryForge2 will resolve and copy the final PNG.";

    let mut command = Command::new(command_spec.program);
    command
        .args(command_spec.prefix_args)
        .arg("exec")
        .arg("--enable")
        .arg("image_generation")
        .arg("--disable")
        .arg("hooks")
        .arg("--disable")
        .arg("shell_tool");

    if let Some(model) = request
        .model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }

    if let Some(reasoning_effort) = request
        .reasoning_effort
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-c")
            .arg(format!("model_reasoning_effort=\"{reasoning_effort}\""));
    }

    command
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("workspace-write")
        .arg(instruction)
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let (status, stdout, stderr) = run_registered_codex_command(
        active_codex_runs,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: request.project_id.clone(),
            action: "generate_export_artwork".into(),
            started_at: Utc::now().to_rfc3339(),
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            phase: "image_generation".into(),
        },
        &mut command,
        &prompt,
        timeout_seconds,
    )
    .await?;
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": "generate_export_artwork",
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": status.code(),
            "stderr": stderr,
            "imagePath": image_path_text,
            "completedAt": Utc::now().to_rfc3339()
        })
        .to_string()
        .as_bytes(),
    )
    .await?;

    let actual_image_path_result =
        resolve_generated_cover_path(&image_path, &stdout, &stderr, generation_started_at).await;

    if !status.success() {
        return Err(AppError::Process(if stderr.trim().is_empty() {
            "Codex CLI zwrócił niezerowy status podczas generowania grafiki eksportu.".into()
        } else {
            stderr
        }));
    }

    let actual_image_path = actual_image_path_result?;
    verify_generated_png_file(&actual_image_path, "Codex CLI generated export artwork").await?;

    Ok((stdout, stderr, actual_image_path))
}

fn codex_image_raw_output(stdout: &str, stderr: &str, image_path: &Path) -> String {
    serde_json::json!({
        "providerId": PROVIDER_ID,
        "tool": "codex-cli",
        "feature": "image_generation",
        "stdout": stdout,
        "stderr": stderr,
        "imagePath": image_path.to_string_lossy()
    })
    .to_string()
}

async fn verify_generated_png_file(path: &Path, label: &str) -> Result<(), AppError> {
    let bytes = tokio::fs::read(path).await.map_err(|error| {
        AppError::Process(format!(
            "{label} is missing or cannot be read at {}: {error}",
            path.to_string_lossy()
        ))
    })?;

    if bytes.is_empty() {
        return Err(AppError::Process(format!(
            "{label} is empty at {}",
            path.to_string_lossy()
        )));
    }

    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(AppError::Process(format!(
            "{label} is not a PNG file at {}",
            path.to_string_lossy()
        )));
    }

    Ok(())
}

async fn reject_duplicate_existing_cover(
    generated_path: &Path,
    existing_cover_path: &str,
) -> Result<(), AppError> {
    let existing_cover_path = existing_cover_path.trim();
    if existing_cover_path.is_empty() || existing_cover_path.starts_with("data:") {
        return Ok(());
    }

    let existing_path = Path::new(existing_cover_path);
    let (Ok(generated_bytes), Ok(existing_bytes)) = (
        tokio::fs::read(generated_path).await,
        tokio::fs::read(existing_path).await,
    ) else {
        return Ok(());
    };

    if !generated_bytes.is_empty() && generated_bytes == existing_bytes {
        return Err(AppError::Process(
            "Codex CLI zwrocil obraz identyczny z aktualna okladka. Uruchom ponownie generowanie, aby utworzyc nowa grafike od zera.".into(),
        ));
    }

    Ok(())
}

async fn reject_duplicate_previous_cover_file(
    generated_path: &Path,
    cover_dir: &Path,
) -> Result<(), AppError> {
    let generated_bytes = tokio::fs::read(generated_path).await?;
    if generated_bytes.is_empty() {
        return Ok(());
    }

    let mut entries = match tokio::fs::read_dir(cover_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(AppError::from(error)),
    };

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path == generated_path {
            continue;
        }
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(AppError::from(error)),
        };
        if !metadata.is_file() {
            continue;
        }
        let existing_bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(AppError::from(error)),
        };
        if existing_bytes == generated_bytes {
            return Err(AppError::Process(
                "Codex CLI zwrocil obraz identyczny z poprzednia propozycja okladki. Ponow generowanie; StoryForge nie zapisze zduplikowanego PNG jako nowej okladki.".into(),
            ));
        }
    }

    Ok(())
}

async fn resolve_generated_cover_path(
    requested_path: &Path,
    stdout: &str,
    stderr: &str,
    min_modified_at: SystemTime,
) -> Result<PathBuf, AppError> {
    resolve_generated_cover_path_from_sources(
        requested_path,
        stdout,
        stderr,
        codex_generated_images_dir(),
        min_modified_at,
    )
    .await
}

async fn resolve_generated_cover_path_from_sources(
    requested_path: &Path,
    stdout: &str,
    stderr: &str,
    generated_images_dir: Option<PathBuf>,
    min_modified_at: SystemTime,
) -> Result<PathBuf, AppError> {
    if let Some(path) = resolve_fresh_png_path(requested_path, min_modified_at).await? {
        return Ok(path);
    }

    let base_dir = requested_path.parent().unwrap_or_else(|| Path::new("."));
    for candidate in [cover_path_from_json(stdout), cover_path_from_json(stderr)]
        .into_iter()
        .flatten()
    {
        let resolved = if candidate.is_absolute() {
            candidate
        } else {
            base_dir.join(candidate)
        };
        if let Some(path) = resolve_fresh_png_path(&resolved, min_modified_at).await? {
            return Ok(path);
        }
    }

    if let Some(generated_images_dir) = generated_images_dir {
        if let Some(path) = latest_codex_generated_image_from_output(
            stdout,
            stderr,
            &generated_images_dir,
            min_modified_at,
        )
        .await?
        {
            return Ok(path);
        }
    }

    Err(AppError::Process(format!(
        "Codex CLI zakonczyl generowanie, ale nie znaleziono pliku okladki. Oczekiwana sciezka: {}. Jesli Codex zapisal obraz w innym miejscu, odpowiedz musi zawierac JSON z polem imagePath.",
        requested_path.to_string_lossy()
    )))
}

async fn resolve_fresh_png_path(
    path: &Path,
    min_modified_at: SystemTime,
) -> Result<Option<PathBuf>, AppError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::from(error)),
    };

    if metadata.is_file() {
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if modified < min_modified_at {
            return Ok(None);
        }
        return Ok(Some(path.to_path_buf()));
    }

    if metadata.is_dir() {
        return newest_png_in_dir_after(path, min_modified_at).await;
    }

    Ok(None)
}

async fn latest_codex_generated_image_from_output(
    stdout: &str,
    stderr: &str,
    generated_images_dir: &Path,
    min_modified_at: SystemTime,
) -> Result<Option<PathBuf>, AppError> {
    let mut session_ids = Vec::new();
    for output in [stdout, stderr] {
        for session_id in codex_session_ids(output) {
            if !session_ids.contains(&session_id) {
                session_ids.push(session_id);
            }
        }
    }

    for session_id in session_ids {
        let session_dir = generated_images_dir.join(session_id);
        if let Some(path) = newest_png_in_dir_after(&session_dir, min_modified_at).await? {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn codex_session_ids(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("session id:"))
        .map(str::trim)
        .filter(|session_id| is_codex_session_id(session_id))
        .map(str::to_string)
        .collect()
}

fn is_codex_session_id(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

async fn newest_png_in_dir_after(
    dir: &Path,
    min_modified_at: SystemTime,
) -> Result<Option<PathBuf>, AppError> {
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::from(error)),
    };
    let mut newest: Option<(PathBuf, SystemTime)> = None;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        {
            continue;
        }

        let modified = entry
            .metadata()
            .await
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if modified < min_modified_at {
            continue;
        }
        if newest
            .as_ref()
            .is_none_or(|(_, newest_modified)| modified > *newest_modified)
        {
            newest = Some((path, modified));
        }
    }

    Ok(newest.map(|(path, _)| path))
}

fn codex_generated_images_dir() -> Option<PathBuf> {
    codex_home_dir().map(|codex_home| codex_home.join("generated_images"))
}

fn codex_home_dir() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

fn cover_path_from_json(output: &str) -> Option<PathBuf> {
    let candidate = extract_json_candidate(output)?;
    let parsed: Value = serde_json::from_str(candidate).ok()?;
    let path = parsed.get("imagePath").and_then(Value::as_str)?;
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }

    Some(PathBuf::from(trimmed))
}

fn extract_json_candidate(output: &str) -> Option<&str> {
    let start = output.find('{')?;
    let end = output.rfind('}')?;
    if start >= end {
        return None;
    }

    Some(&output[start..=end])
}

async fn execute_codex(
    app: &AppHandle,
    active_codex_runs: &ActiveCodexRunRegistry,
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    timeout_seconds: u64,
) -> Result<(String, String), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    let workspace = app_data_dir
        .join("codex-workspaces")
        .join(&request.project_id);
    tokio::fs::create_dir_all(&workspace).await?;
    ensure_git_workspace(&workspace).await;

    tokio::fs::write(workspace.join("prompt.md"), request.prompt.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("context.md"),
        serde_json::to_string_pretty(&request.prompt_package_json)?.as_bytes(),
    )
    .await?;

    let codex_path = request
        .codex_path
        .clone()
        .unwrap_or_else(|| "codex".to_string());
    let command_spec = resolve_codex_command(&codex_path).await;
    let instruction = "Run the StoryForge2 writing-assistant prompt from stdin. Return only the requested output contract.";

    let mut command = Command::new(command_spec.program);
    command.args(command_spec.prefix_args).arg("exec");

    if let Some(model) = request
        .model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }

    if let Some(reasoning_effort) = request
        .reasoning_effort
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-c")
            .arg(format!("model_reasoning_effort=\"{reasoning_effort}\""));
    }

    command
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("read-only")
        .arg(instruction)
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let (status, stdout, stderr) = run_registered_codex_command(
        active_codex_runs,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: request.project_id.clone(),
            action: request.action.clone(),
            started_at: Utc::now().to_rfc3339(),
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            phase: "running".into(),
        },
        &mut command,
        &request.prompt,
        timeout_seconds,
    )
    .await?;
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": request.action,
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": status.code(),
            "stderr": stderr,
            "completedAt": Utc::now().to_rfc3339()
        })
        .to_string()
        .as_bytes(),
    )
    .await?;

    if status.success() {
        Ok((stdout, stderr))
    } else {
        Err(AppError::Process(if stderr.trim().is_empty() {
            "Codex CLI zwrócił niezerowy status.".into()
        } else {
            stderr
        }))
    }
}

async fn ensure_git_workspace(workspace: &Path) {
    if workspace.join(".git").exists() {
        return;
    }

    let _ = Command::new("git")
        .arg("init")
        .current_dir(workspace)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
}

async fn resolve_codex_command(path: &str) -> CodexCommandSpec {
    let resolved = resolve_codex_path(path).unwrap_or_else(|| PathBuf::from(path));
    command_spec_for_path(resolved)
}

fn resolve_codex_path(path: &str) -> Option<PathBuf> {
    let path_buf = PathBuf::from(path);
    if has_path_separator(path) {
        return resolve_explicit_codex_path(path_buf);
    }

    let path_var = env::var_os("PATH")?;
    let mut candidates = Vec::new();
    for dir in env::split_paths(&path_var) {
        for candidate in command_candidates(&dir.join(path)) {
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }

    candidates.sort_by_key(|candidate| command_candidate_priority(candidate));
    candidates.into_iter().next()
}

fn resolve_explicit_codex_path(path: PathBuf) -> Option<PathBuf> {
    let mut candidates = command_candidates(&path)
        .into_iter()
        .filter(|candidate| candidate.is_file())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|candidate| command_candidate_priority(candidate));
    candidates.into_iter().next()
}

fn command_candidates(base: &Path) -> Vec<PathBuf> {
    if base.extension().is_some() {
        return vec![base.to_path_buf()];
    }

    let mut candidates = Vec::new();
    if cfg!(windows) {
        candidates.push(base.with_extension("exe"));
        candidates.push(base.with_extension("cmd"));
        candidates.push(base.with_extension("bat"));
        candidates.push(base.with_extension("ps1"));
    }
    candidates.push(base.to_path_buf());
    candidates
}

fn command_spec_for_path(path: PathBuf) -> CodexCommandSpec {
    let display_path = path.to_string_lossy().to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if cfg!(windows) && matches!(extension.as_str(), "cmd" | "bat") {
        return CodexCommandSpec {
            program: OsString::from("cmd.exe"),
            prefix_args: vec![OsString::from("/C"), path.into_os_string()],
            display_path,
        };
    }

    if cfg!(windows) && extension == "ps1" {
        return CodexCommandSpec {
            program: OsString::from("powershell.exe"),
            prefix_args: vec![
                OsString::from("-NoProfile"),
                OsString::from("-ExecutionPolicy"),
                OsString::from("Bypass"),
                OsString::from("-File"),
                path.into_os_string(),
            ],
            display_path,
        };
    }

    CodexCommandSpec {
        program: path.into_os_string(),
        prefix_args: Vec::new(),
        display_path,
    }
}

fn command_candidate_priority(path: &Path) -> u16 {
    let path_text = path.to_string_lossy().to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mut priority: u16 = match extension.as_str() {
        "cmd" => 10,
        "bat" => 11,
        "ps1" => 20,
        "exe" => 30,
        _ => 40,
    };

    if cfg!(windows) && path_text.contains("\\appdata\\roaming\\npm\\") {
        priority = priority.saturating_sub(8);
    }

    if cfg!(windows) && path_text.contains("\\windowsapps\\") {
        priority += 1000;
    }

    priority
}

fn fallback_model_catalog(error_message: String) -> CodexModelCatalog {
    CodexModelCatalog {
        models: vec![serde_json::json!({
            "slug": "gpt-5.5",
            "display_name": "GPT-5.5",
            "description": "Model fallback używany, gdy katalog modeli Codex CLI jest niedostępny.",
            "default_reasoning_level": "medium",
            "supported_reasoning_levels": [
                { "effort": "low", "description": "Fast responses with lighter reasoning" },
                { "effort": "medium", "description": "Balances speed and reasoning depth" },
                { "effort": "high", "description": "Greater reasoning depth" },
                { "effort": "xhigh", "description": "Extra high reasoning depth" }
            ]
        })],
        fallback: true,
        error_message: Some(error_message),
    }
}

fn has_path_separator(path: &str) -> bool {
    path.contains('\\') || path.contains('/') || path.contains(':')
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Nie udało się ustalić katalogu danych aplikacji: {error}"),
                ))
            })?;
            let pool =
                tauri::async_runtime::block_on(init_database(app_data_dir)).map_err(|error| {
                    Box::<dyn std::error::Error>::from(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        error.to_string(),
                    ))
                })?;
            app.manage(AppState {
                db: pool,
                active_codex_runs: Arc::new(Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            list_projects,
            delete_project,
            get_project,
            get_book_plan,
            list_plan_versions,
            create_plan_version_from_active,
            set_active_plan_version,
            delete_plan_version,
            get_character_workspace,
            get_world_workspace,
            save_story_structure,
            upsert_act,
            delete_act,
            upsert_beat,
            delete_beat,
            move_beat_to_chapter,
            upsert_plot_thread,
            delete_plot_thread,
            upsert_chapter,
            upsert_chapter_thread_relation,
            delete_chapter,
            upsert_scene,
            delete_scene,
            search_project,
            create_scene_snapshot,
            list_scene_snapshots,
            get_scene_snapshot,
            restore_scene_snapshot,
            save_scene_auto_summary,
            save_scene_critique,
            list_scene_critiques,
            set_scene_style_reference,
            save_chapter_auto_summary,
            save_story_so_far,
            reorder_scenes,
            set_scene_relations,
            reorder_plan_items,
            upsert_character,
            delete_character,
            upsert_character_relation,
            delete_character_relation,
            upsert_character_memory,
            delete_character_memory,
            upsert_character_memory_link,
            delete_character_memory_link,
            upsert_world_element,
            delete_world_element,
            upsert_world_rule,
            delete_world_rule,
            set_world_element_relations,
            set_world_rule_relations,
            list_ai_runs,
            list_ai_proposals,
            upsert_ai_proposal_snapshot,
            mark_ai_proposal_accepted,
            mark_ai_proposal_rejected,
            update_book_concept,
            generate_book_cover,
            accept_generated_book_cover,
            generate_character_image,
            accept_generated_character_image,
            export_book,
            choose_export_directory,
            reveal_export_file,
            list_export_presets,
            save_export_preset,
            generate_export_artwork,
            accept_generated_export_artwork,
            check_codex_cli,
            list_codex_models,
            list_active_codex_runs,
            cancel_active_codex_run,
            generate_new_project_title,
            run_codex_prompt,
            get_ai_settings,
            save_ai_settings,
            check_codex_login,
            check_claude_cli,
            start_codex_login,
            start_claude_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running StoryForge2");
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let database_path =
            std::env::temp_dir().join(format!("storyforge2-test-{}.sqlite", Uuid::new_v4()));
        init_database_at(database_path).await.unwrap()
    }

    fn scene_input(book_id: &str, title: &str, manuscript: &str) -> UpsertSceneInput {
        UpsertSceneInput {
            id: None,
            book_id: book_id.to_string(),
            chapter_id: None,
            order_index: 0,
            title: title.to_string(),
            summary: String::new(),
            goal: String::new(),
            conflict: String::new(),
            outcome: String::new(),
            time_marker: None,
            pov_character_id: None,
            location_id: None,
            target_word_count: None,
            actual_word_count: None,
            manuscript_content: Some(manuscript.to_string()),
            status: "draft".into(),
        }
    }

    #[tokio::test]
    async fn books_table_has_no_logline_column() {
        let pool = test_pool().await;
        let columns: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM pragma_table_info('books')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(!columns.iter().any(|(name,)| name == "logline"));
        assert!(columns.iter().any(|(name,)| name == "premise"));
    }

    #[tokio::test]
    async fn scene_snapshot_roundtrip_restores_manuscript() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt migawek".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let scene = upsert_scene_in_pool(
            &pool,
            scene_input(&created.book.id, "Scena", "<p>Stary tekst sceny</p>"),
        )
        .await
        .unwrap();

        let snapshot = create_scene_snapshot_in_pool(&pool, &scene.id, "manual")
            .await
            .unwrap()
            .expect("niepusta scena powinna dac migawke");
        assert_eq!(snapshot.word_count, 3);

        let mut overwrite = scene_input(&created.book.id, "Scena", "<p>Nowy tekst</p>");
        overwrite.id = Some(scene.id.clone());
        upsert_scene_in_pool(&pool, overwrite).await.unwrap();

        let restored = restore_scene_snapshot_in_pool(&pool, &snapshot.id)
            .await
            .unwrap();
        assert_eq!(restored.manuscript_content, "<p>Stary tekst sceny</p>");
        assert_eq!(restored.actual_word_count, 3);

        // restore zostawia po sobie migawke nadpisanego tekstu
        let snapshots = list_scene_snapshots_in_pool(&pool, &scene.id).await.unwrap();
        assert_eq!(snapshots.len(), 2);
        assert!(snapshots.iter().any(|item| item.source == "restore"));
    }

    #[tokio::test]
    async fn empty_scene_does_not_create_snapshot() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt pustej sceny".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let scene = upsert_scene_in_pool(&pool, scene_input(&created.book.id, "Pusta", ""))
            .await
            .unwrap();

        let snapshot = create_scene_snapshot_in_pool(&pool, &scene.id, "manual")
            .await
            .unwrap();
        assert!(snapshot.is_none());
    }

    #[tokio::test]
    async fn search_index_finds_scene_text_and_scopes_by_project() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt wyszukiwania".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        upsert_scene_in_pool(
            &pool,
            scene_input(
                &created.book.id,
                "Smocza scena",
                "<p>Smok przelecial nad wieza zegarowa.</p>",
            ),
        )
        .await
        .unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO characters (id, project_id, name, short_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("char-search-1")
        .bind(&created.project.id)
        .bind("Zegarmistrz Anzelm")
        .bind("Opiekun wiezy zegarowej.")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let scene_hits = search_project_in_pool(&pool, &created.project.id, "smok")
            .await
            .unwrap();
        assert!(scene_hits.iter().any(|hit| hit.entity_type == "scene"));

        // prefiks przy wpisywaniu
        let prefix_hits = search_project_in_pool(&pool, &created.project.id, "zegar")
            .await
            .unwrap();
        assert!(prefix_hits.iter().any(|hit| hit.entity_type == "character"));

        // inny projekt nie widzi wynikow
        let foreign_hits = search_project_in_pool(&pool, "inny-projekt", "smok")
            .await
            .unwrap();
        assert!(foreign_hits.is_empty());
    }

    #[tokio::test]
    async fn migration_creates_core_tables() {
        let pool = test_pool().await;
        let table_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('projects', 'books', 'ai_runs', 'ai_proposals')
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(table_count.0, 4);
    }

    #[tokio::test]
    async fn migration_creates_plan_tables() {
        let pool = test_pool().await;
        let table_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN (
                'story_structures',
                'acts',
                'beats',
                'plot_threads',
                'chapters',
                'chapter_threads',
                'chapter_beats'
              )
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(table_count.0, 7);
    }

    #[tokio::test]
    async fn migration_creates_character_workspace_tables() {
        let pool = test_pool().await;
        let table_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN (
                'characters',
                'character_relations',
                'character_memories',
                'character_memory_links',
                'visual_assets'
              )
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(table_count.0, 5);
    }

    #[tokio::test]
    async fn create_project_persists_default_book() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Nowa powiesc".into(),
                language: None,
            },
        )
        .await
        .unwrap();

        let listed = list_projects_in_pool(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.project.id);
        assert_eq!(created.book.working_title, "Nowa powiesc");
        assert_eq!(created.book.cover_image_path, "");
        assert_eq!(listed[0].cover_image_path, "");
    }

    #[tokio::test]
    async fn delete_project_removes_it_from_project_list() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt do usuniecia".into(),
                language: None,
            },
        )
        .await
        .unwrap();

        delete_project_in_pool(&pool, &created.project.id)
            .await
            .unwrap();

        let listed = list_projects_in_pool(&pool).await.unwrap();
        assert!(listed.is_empty());
        let deleted = get_project_details(&pool, &created.project.id).await;
        assert!(deleted.is_err());
    }

    #[tokio::test]
    async fn list_ai_runs_returns_prompt_log_entries() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt z logiem".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let now = Utc::now().to_rfc3339();
        let prompt_package = serde_json::json!({
            "context": {
                "targetField": "premise",
                "generationMode": "generate"
            }
        });

        sqlx::query(
            r#"
            INSERT INTO ai_runs
              (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, raw_output, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)
            "#,
        )
        .bind("run-log-1")
        .bind(&created.project.id)
        .bind(PROVIDER_ID)
        .bind("gpt-5.5")
        .bind("medium")
        .bind("generate_premise")
        .bind(prompt_package.to_string())
        .bind("# Role\nPrompt testowy")
        .bind(r#"{"kind":"concept_field_suggestion","value":"Premisa"}"#)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let logs = list_ai_runs_in_pool(&pool, &created.project.id)
            .await
            .unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, "run-log-1");
        assert_eq!(logs[0].model, "gpt-5.5");
        assert_eq!(logs[0].reasoning_effort, "medium");
        assert_eq!(logs[0].prompt, "# Role\nPrompt testowy");
        assert_eq!(logs[0].prompt_package_json, prompt_package);
        assert_eq!(
            logs[0].raw_output.as_deref(),
            Some(r#"{"kind":"concept_field_suggestion","value":"Premisa"}"#)
        );
    }

    #[tokio::test]
    async fn recovery_marks_running_ai_work_as_terminated() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt recovery".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO ai_runs
              (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
            VALUES (?, ?, ?, '', '', ?, ?, ?, 'running', ?)
            "#,
        )
        .bind("run-running")
        .bind(&created.project.id)
        .bind(PROVIDER_ID)
        .bind("generate_premise")
        .bind(r#"{"context":{"targetField":"premise"}}"#)
        .bind("# Prompt")
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO ai_proposals
              (id, ai_run_id, project_id, proposal_type, payload_json, status, decision_status, created_at, updated_at)
            VALUES (?, ?, ?, 'bookConcept', ?, 'running', 'pending', ?, ?)
            "#,
        )
        .bind("proposal-running")
        .bind("run-running")
        .bind(&created.project.id)
        .bind(r#"{"id":"proposal-running"}"#)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        recover_interrupted_ai_work(&pool).await.unwrap();

        let logs = list_ai_runs_in_pool(&pool, &created.project.id)
            .await
            .unwrap();
        let proposals = list_ai_proposals_in_pool(&pool, &created.project.id)
            .await
            .unwrap();

        assert_eq!(logs[0].status, "terminated");
        assert!(logs[0].error_message.is_some());
        assert!(proposals.is_empty());
    }

    #[tokio::test]
    async fn ai_proposal_decision_status_updates_log_entries() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Projekt decyzji AI".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO ai_runs
              (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, raw_output, status, created_at, completed_at)
            VALUES (?, ?, ?, '', '', ?, ?, ?, ?, 'success', ?, ?)
            "#,
        )
        .bind("run-decision")
        .bind(&created.project.id)
        .bind(PROVIDER_ID)
        .bind("generate_premise")
        .bind(r#"{"context":{"targetField":"premise"}}"#)
        .bind("# Prompt")
        .bind(r#"{"value":"Premisa"}"#)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        upsert_ai_proposal_snapshot_in_pool(
            &pool,
            UpsertAiProposalSnapshotInput {
                id: "proposal-decision".into(),
                ai_run_id: Some("run-decision".into()),
                project_id: created.project.id.clone(),
                proposal_type: "bookConcept".into(),
                payload_json: serde_json::json!({
                    "id": "proposal-decision",
                    "projectId": created.project.id
                }),
                status: "success".into(),
            },
        )
        .await
        .unwrap();
        mark_ai_proposal_decision_in_pool(&pool, "proposal-decision", "accepted")
            .await
            .unwrap();

        let logs = list_ai_runs_in_pool(&pool, &created.project.id)
            .await
            .unwrap();
        let proposals = list_ai_proposals_in_pool(&pool, &created.project.id)
            .await
            .unwrap();

        assert_eq!(logs[0].decision_status.as_deref(), Some("accepted"));
        assert!(logs[0].proposal_snapshot.is_some());
        assert!(proposals.is_empty());
    }

    #[tokio::test]
    async fn project_summary_includes_cover_metadata() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Ksiazka z okladka".into(),
                language: None,
            },
        )
        .await
        .unwrap();

        let generated_at = Utc::now().to_rfc3339();
        let book = update_book_cover_metadata_in_pool(
            &pool,
            &created.book.id,
            "C:\\covers\\cover.png",
            "dark editorial cover",
            "watermark",
            &generated_at,
        )
        .await
        .unwrap();

        let listed = list_projects_in_pool(&pool).await.unwrap();
        assert_eq!(book.cover_image_path, "C:\\covers\\cover.png");
        assert_eq!(book.cover_prompt, "dark editorial cover");
        assert_eq!(book.cover_negative_prompt, "watermark");
        assert_eq!(
            book.cover_generated_at.as_deref(),
            Some(generated_at.as_str())
        );
        assert_eq!(listed[0].cover_image_path, "C:\\covers\\cover.png");
    }

    #[tokio::test]
    async fn book_plan_persists_entities_and_relations() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Planowana ksiazka".into(),
                language: None,
            },
        )
        .await
        .unwrap();

        let structure = save_story_structure_in_pool(
            &pool,
            SaveStoryStructureInput {
                id: None,
                book_id: created.book.id.clone(),
                structure_type: "three_act".into(),
                description: "Trzy akty".into(),
                notes: "Robocze notatki".into(),
                status: Some("draft".into()),
            },
        )
        .await
        .unwrap();
        let act = upsert_act_in_pool(
            &pool,
            UpsertActInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Akt I".into(),
                purpose: "Ustawienie historii".into(),
                summary: "Poczatek".into(),
                start_percent: 0,
                end_percent: 25,
                order_index: 0,
                color: "#3f8f6b".into(),
            },
        )
        .await
        .unwrap();
        let thread = upsert_plot_thread_in_pool(
            &pool,
            UpsertPlotThreadInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Glowny watek".into(),
                description: "Droga bohatera".into(),
                resolution: "".into(),
                color: "#3f8f6b".into(),
                status: "planned".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let beat = upsert_beat_in_pool(
            &pool,
            UpsertBeatInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Incydent".into(),
                description: "Bohater zostaje wezwany".into(),
                role: "inciting_incident".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let chapter = upsert_chapter_in_pool(
            &pool,
            UpsertChapterInput {
                id: None,
                book_id: created.book.id.clone(),
                act_id: Some(act.id.clone()),
                number: 1,
                working_title: "Nowy dzien".into(),
                summary: "Otwarcie".into(),
                purpose: "Pokazac brak".into(),
                conflict: "Bohater kontra rutyna".into(),
                turning_point: "Decyzja".into(),
                target_word_count: Some(2500),
                order_index: 0,
                thread_ids: vec![thread.id.clone()],
                beat_ids: vec![beat.id.clone()],
            },
        )
        .await
        .unwrap();

        let plan = get_book_plan_in_pool(&pool, &created.book.id)
            .await
            .unwrap();
        assert_eq!(plan.structure.unwrap().id, structure.id);
        assert_eq!(plan.acts[0].id, act.id);
        assert_eq!(plan.beats[0].id, beat.id);
        assert_eq!(plan.threads[0].id, thread.id);
        assert_eq!(plan.chapters[0].id, chapter.id);
        assert_eq!(plan.chapter_threads[0].thread_id, thread.id);
        assert_eq!(plan.chapter_beats[0].beat_id, beat.id);
    }

    #[tokio::test]
    async fn moving_beat_to_chapter_replaces_previous_assignment() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Przenoszenie beatow".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let beat = upsert_beat_in_pool(
            &pool,
            UpsertBeatInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Beat".into(),
                description: "".into(),
                role: "".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let first_chapter = upsert_chapter_in_pool(
            &pool,
            UpsertChapterInput {
                id: None,
                book_id: created.book.id.clone(),
                act_id: None,
                number: 1,
                working_title: "Pierwszy".into(),
                summary: "".into(),
                purpose: "".into(),
                conflict: "".into(),
                turning_point: "".into(),
                target_word_count: None,
                order_index: 0,
                thread_ids: vec![],
                beat_ids: vec![beat.id.clone()],
            },
        )
        .await
        .unwrap();
        let second_chapter = upsert_chapter_in_pool(
            &pool,
            UpsertChapterInput {
                id: None,
                book_id: created.book.id.clone(),
                act_id: None,
                number: 2,
                working_title: "Drugi".into(),
                summary: "".into(),
                purpose: "".into(),
                conflict: "".into(),
                turning_point: "".into(),
                target_word_count: None,
                order_index: 1,
                thread_ids: vec![],
                beat_ids: vec![],
            },
        )
        .await
        .unwrap();

        move_beat_to_chapter_in_pool(
            &pool,
            MoveBeatToChapterInput {
                book_id: created.book.id.clone(),
                beat_id: beat.id.clone(),
                chapter_id: Some(second_chapter.id.clone()),
                order_index: 7,
            },
        )
        .await
        .unwrap();

        let plan = get_book_plan_in_pool(&pool, &created.book.id)
            .await
            .unwrap();
        assert_eq!(plan.beats[0].order_index, 7);
        assert_eq!(plan.chapter_beats.len(), 1);
        assert_eq!(plan.chapter_beats[0].beat_id, beat.id);
        assert_eq!(plan.chapter_beats[0].chapter_id, second_chapter.id);
        assert_ne!(plan.chapter_beats[0].chapter_id, first_chapter.id);

        move_beat_to_chapter_in_pool(
            &pool,
            MoveBeatToChapterInput {
                book_id: created.book.id.clone(),
                beat_id: beat.id.clone(),
                chapter_id: None,
                order_index: 8,
            },
        )
        .await
        .unwrap();

        let plan = get_book_plan_in_pool(&pool, &created.book.id)
            .await
            .unwrap();
        assert!(plan.chapter_beats.is_empty());
        assert_eq!(plan.beats[0].order_index, 8);
    }

    #[tokio::test]
    async fn deleting_plan_entities_cascades_join_rows() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Kasowanie relacji".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let thread = upsert_plot_thread_in_pool(
            &pool,
            UpsertPlotThreadInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Watek".into(),
                description: "".into(),
                resolution: "".into(),
                color: "#3f8f6b".into(),
                status: "planned".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let beat = upsert_beat_in_pool(
            &pool,
            UpsertBeatInput {
                id: None,
                book_id: created.book.id.clone(),
                name: "Beat".into(),
                description: "".into(),
                role: "".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let chapter = upsert_chapter_in_pool(
            &pool,
            UpsertChapterInput {
                id: None,
                book_id: created.book.id.clone(),
                act_id: None,
                number: 1,
                working_title: "Rozdzial".into(),
                summary: "".into(),
                purpose: "".into(),
                conflict: "".into(),
                turning_point: "".into(),
                target_word_count: None,
                order_index: 0,
                thread_ids: vec![thread.id.clone()],
                beat_ids: vec![beat.id.clone()],
            },
        )
        .await
        .unwrap();

        delete_chapter_in_pool(&pool, &chapter.id).await.unwrap();
        let chapter_thread_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chapter_threads")
            .fetch_one(&pool)
            .await
            .unwrap();
        let chapter_beat_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chapter_beats")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(chapter_thread_count.0, 0);
        assert_eq!(chapter_beat_count.0, 0);

        delete_beat_in_pool(&pool, &beat.id).await.unwrap();
        delete_plot_thread_in_pool(&pool, &thread.id).await.unwrap();
        let plan = get_book_plan_in_pool(&pool, &created.book.id)
            .await
            .unwrap();
        assert!(plan.threads.is_empty());
    }

    #[tokio::test]
    async fn character_workspace_persists_relations_memories_and_links() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Postacie".into(),
                language: None,
            },
        )
        .await
        .unwrap();

        let hero = upsert_character_in_pool(
            &pool,
            UpsertCharacterInput {
                id: None,
                project_id: created.project.id.clone(),
                character_type: "person".into(),
                name: "Mira".into(),
                aliases_json: "[]".into(),
                role: "bohaterka".into(),
                short_description: "Kartografka".into(),
                appearance: "".into(),
                external_goal: "Odnalezc mape".into(),
                internal_need: "Zaufac komus".into(),
                wound: "".into(),
                false_belief: "".into(),
                secret: "".into(),
                strengths_json: "[]".into(),
                weaknesses_json: "[]".into(),
                voice_notes: "".into(),
                arc_summary: "".into(),
                knowledge_notes: "".into(),
                visual_prompt: "".into(),
                image_asset_id: None,
                status: "draft".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let rival = upsert_character_in_pool(
            &pool,
            UpsertCharacterInput {
                id: None,
                project_id: created.project.id.clone(),
                character_type: "creature".into(),
                name: "Szept".into(),
                aliases_json: "[]".into(),
                role: "rywal".into(),
                short_description: "".into(),
                appearance: "".into(),
                external_goal: "".into(),
                internal_need: "".into(),
                wound: "".into(),
                false_belief: "".into(),
                secret: "".into(),
                strengths_json: "[]".into(),
                weaknesses_json: "[]".into(),
                voice_notes: "".into(),
                arc_summary: "".into(),
                knowledge_notes: "".into(),
                visual_prompt: "".into(),
                image_asset_id: None,
                status: "draft".into(),
                order_index: 1,
            },
        )
        .await
        .unwrap();
        let relation = upsert_character_relation_in_pool(
            &pool,
            UpsertCharacterRelationInput {
                id: None,
                project_id: created.project.id.clone(),
                from_character_id: hero.id.clone(),
                to_character_id: rival.id.clone(),
                relation_type: "rywalizacja".into(),
                description: "Mira nie ufa Szeptowi.".into(),
                history: "".into(),
                conflict: "Mapa".into(),
                opinion: "Niebezpieczny".into(),
                trust_level: 18,
                secret: "".into(),
                change_over_time: "".into(),
                status: "draft".into(),
            },
        )
        .await
        .unwrap();
        let first_memory = upsert_character_memory_in_pool(
            &pool,
            UpsertCharacterMemoryInput {
                id: None,
                project_id: created.project.id.clone(),
                character_id: hero.id.clone(),
                title: "Most".into(),
                summary: "Ucieczka przez most".into(),
                details: "".into(),
                memory_type: "wydarzenie".into(),
                subject: "most".into(),
                emotion: "strach".into(),
                importance: 80,
                status: "canon".into(),
            },
        )
        .await
        .unwrap();
        let second_memory = upsert_character_memory_in_pool(
            &pool,
            UpsertCharacterMemoryInput {
                id: None,
                project_id: created.project.id.clone(),
                character_id: hero.id.clone(),
                title: "Mapa".into(),
                summary: "Pierwsza mapa".into(),
                details: "".into(),
                memory_type: "przedmiot".into(),
                subject: "mapa".into(),
                emotion: "nadzieja".into(),
                importance: 70,
                status: "canon".into(),
            },
        )
        .await
        .unwrap();
        upsert_character_memory_link_in_pool(
            &pool,
            UpsertCharacterMemoryLinkInput {
                id: None,
                project_id: created.project.id.clone(),
                from_memory_id: first_memory.id.clone(),
                to_memory_id: second_memory.id.clone(),
                link_type: "skojarzenie".into(),
                description: "Mapa przypomina jej most.".into(),
                strength: 75,
            },
        )
        .await
        .unwrap();

        let workspace = get_character_workspace_in_pool(&pool, &created.project.id)
            .await
            .unwrap();
        assert_eq!(workspace.characters.len(), 2);
        assert_eq!(workspace.relations[0].id, relation.id);
        assert_eq!(workspace.memories.len(), 2);
        assert_eq!(workspace.memory_links.len(), 1);
    }

    #[tokio::test]
    async fn character_relation_rejects_missing_character_and_upserts_duplicate() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Relacje".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let first = upsert_character_in_pool(
            &pool,
            UpsertCharacterInput {
                id: None,
                project_id: created.project.id.clone(),
                character_type: "person".into(),
                name: "A".into(),
                aliases_json: "[]".into(),
                role: "".into(),
                short_description: "".into(),
                appearance: "".into(),
                external_goal: "".into(),
                internal_need: "".into(),
                wound: "".into(),
                false_belief: "".into(),
                secret: "".into(),
                strengths_json: "[]".into(),
                weaknesses_json: "[]".into(),
                voice_notes: "".into(),
                arc_summary: "".into(),
                knowledge_notes: "".into(),
                visual_prompt: "".into(),
                image_asset_id: None,
                status: "draft".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let second = upsert_character_in_pool(
            &pool,
            UpsertCharacterInput {
                id: None,
                project_id: created.project.id.clone(),
                character_type: "person".into(),
                name: "B".into(),
                aliases_json: "[]".into(),
                role: "".into(),
                short_description: "".into(),
                appearance: "".into(),
                external_goal: "".into(),
                internal_need: "".into(),
                wound: "".into(),
                false_belief: "".into(),
                secret: "".into(),
                strengths_json: "[]".into(),
                weaknesses_json: "[]".into(),
                voice_notes: "".into(),
                arc_summary: "".into(),
                knowledge_notes: "".into(),
                visual_prompt: "".into(),
                image_asset_id: None,
                status: "draft".into(),
                order_index: 1,
            },
        )
        .await
        .unwrap();

        let missing_error = upsert_character_relation_in_pool(
            &pool,
            UpsertCharacterRelationInput {
                id: None,
                project_id: created.project.id.clone(),
                from_character_id: first.id.clone(),
                to_character_id: "missing".into(),
                relation_type: "sojusz".into(),
                description: "".into(),
                history: "".into(),
                conflict: "".into(),
                opinion: "".into(),
                trust_level: 50,
                secret: "".into(),
                change_over_time: "".into(),
                status: "draft".into(),
            },
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(missing_error.contains("Nie znaleziono postaci"));

        let relation = upsert_character_relation_in_pool(
            &pool,
            UpsertCharacterRelationInput {
                id: None,
                project_id: created.project.id.clone(),
                from_character_id: first.id.clone(),
                to_character_id: second.id.clone(),
                relation_type: "sojusz".into(),
                description: "Pierwszy opis".into(),
                history: "".into(),
                conflict: "".into(),
                opinion: "".into(),
                trust_level: 50,
                secret: "".into(),
                change_over_time: "".into(),
                status: "draft".into(),
            },
        )
        .await
        .unwrap();
        let updated = upsert_character_relation_in_pool(
            &pool,
            UpsertCharacterRelationInput {
                id: None,
                project_id: created.project.id.clone(),
                from_character_id: first.id.clone(),
                to_character_id: second.id.clone(),
                relation_type: "sojusz".into(),
                description: "Drugi opis".into(),
                history: "".into(),
                conflict: "".into(),
                opinion: "".into(),
                trust_level: 65,
                secret: "".into(),
                change_over_time: "".into(),
                status: "canon".into(),
            },
        )
        .await
        .unwrap();

        let workspace = get_character_workspace_in_pool(&pool, &created.project.id)
            .await
            .unwrap();
        assert_eq!(workspace.relations.len(), 1);
        assert_eq!(updated.id, relation.id);
        assert_eq!(workspace.relations[0].description, "Drugi opis");
    }

    #[tokio::test]
    async fn deleting_character_cascades_character_memory_graph() {
        let pool = test_pool().await;
        let created = create_project_in_pool(
            &pool,
            CreateProjectInput {
                name: "Kasowanie postaci".into(),
                language: None,
            },
        )
        .await
        .unwrap();
        let character = upsert_character_in_pool(
            &pool,
            UpsertCharacterInput {
                id: None,
                project_id: created.project.id.clone(),
                character_type: "person".into(),
                name: "A".into(),
                aliases_json: "[]".into(),
                role: "".into(),
                short_description: "".into(),
                appearance: "".into(),
                external_goal: "".into(),
                internal_need: "".into(),
                wound: "".into(),
                false_belief: "".into(),
                secret: "".into(),
                strengths_json: "[]".into(),
                weaknesses_json: "[]".into(),
                voice_notes: "".into(),
                arc_summary: "".into(),
                knowledge_notes: "".into(),
                visual_prompt: "".into(),
                image_asset_id: None,
                status: "draft".into(),
                order_index: 0,
            },
        )
        .await
        .unwrap();
        let memory = upsert_character_memory_in_pool(
            &pool,
            UpsertCharacterMemoryInput {
                id: None,
                project_id: created.project.id.clone(),
                character_id: character.id.clone(),
                title: "Wspomnienie".into(),
                summary: "".into(),
                details: "".into(),
                memory_type: "wydarzenie".into(),
                subject: "".into(),
                emotion: "".into(),
                importance: 50,
                status: "draft".into(),
            },
        )
        .await
        .unwrap();
        let other = upsert_character_memory_in_pool(
            &pool,
            UpsertCharacterMemoryInput {
                id: None,
                project_id: created.project.id.clone(),
                character_id: character.id.clone(),
                title: "Drugie".into(),
                summary: "".into(),
                details: "".into(),
                memory_type: "wydarzenie".into(),
                subject: "".into(),
                emotion: "".into(),
                importance: 50,
                status: "draft".into(),
            },
        )
        .await
        .unwrap();
        upsert_character_memory_link_in_pool(
            &pool,
            UpsertCharacterMemoryLinkInput {
                id: None,
                project_id: created.project.id.clone(),
                from_memory_id: memory.id,
                to_memory_id: other.id,
                link_type: "association".into(),
                description: "".into(),
                strength: 50,
            },
        )
        .await
        .unwrap();

        delete_character_in_pool(&pool, &character.id)
            .await
            .unwrap();
        let workspace = get_character_workspace_in_pool(&pool, &created.project.id)
            .await
            .unwrap();
        assert!(workspace.characters.is_empty());
        assert!(workspace.memories.is_empty());
        assert!(workspace.memory_links.is_empty());
    }

    #[test]
    fn cover_generation_timeout_has_image_generation_floor() {
        assert_eq!(cover_timeout_seconds(None), MIN_COVER_TIMEOUT_SECONDS);
        assert_eq!(cover_timeout_seconds(Some(180)), MIN_COVER_TIMEOUT_SECONDS);
        assert_eq!(cover_timeout_seconds(Some(900)), 900);
    }

    #[tokio::test]
    async fn cover_path_can_be_resolved_from_codex_json_output() {
        let image_path =
            std::env::temp_dir().join(format!("storyforge2-cover-{}.png", Uuid::new_v4()));
        tokio::fs::write(&image_path, PNG_SIGNATURE).await.unwrap();

        let stdout = serde_json::json!({
            "version": 1,
            "kind": "book_cover_image",
            "imagePath": image_path.to_string_lossy()
        })
        .to_string();
        let requested_path =
            std::env::temp_dir().join(format!("storyforge2-requested-{}.png", Uuid::new_v4()));

        let resolved =
            resolve_generated_cover_path(&requested_path, &stdout, "", SystemTime::UNIX_EPOCH)
                .await
                .unwrap();

        assert_eq!(resolved, image_path);
        let _ = tokio::fs::remove_file(resolved).await;
    }

    #[tokio::test]
    async fn cover_path_can_be_resolved_from_relative_codex_json_output() {
        let run_dir =
            std::env::temp_dir().join(format!("storyforge2-cover-run-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&run_dir).await.unwrap();
        let image_path = run_dir.join("cover.png");
        tokio::fs::write(&image_path, PNG_SIGNATURE).await.unwrap();

        let stdout = serde_json::json!({
            "version": 1,
            "kind": "book_cover_image",
            "imagePath": "cover.png"
        })
        .to_string();
        let requested_path = run_dir.join("requested.png");

        let resolved =
            resolve_generated_cover_path(&requested_path, &stdout, "", SystemTime::UNIX_EPOCH)
                .await
                .unwrap();

        assert_eq!(resolved, image_path);
        let _ = tokio::fs::remove_dir_all(run_dir).await;
    }

    #[tokio::test]
    async fn cover_path_ignores_png_created_before_generation_window() {
        let requested_path =
            std::env::temp_dir().join(format!("storyforge2-stale-cover-{}.png", Uuid::new_v4()));
        tokio::fs::write(&requested_path, PNG_SIGNATURE)
            .await
            .unwrap();

        let error = resolve_generated_cover_path(
            &requested_path,
            "",
            "",
            SystemTime::now() + Duration::from_secs(60),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("nie znaleziono pliku okladki"));
        let _ = tokio::fs::remove_file(requested_path).await;
    }

    #[tokio::test]
    async fn duplicate_existing_cover_is_rejected() {
        let existing_path =
            std::env::temp_dir().join(format!("storyforge2-existing-cover-{}.png", Uuid::new_v4()));
        let generated_path = std::env::temp_dir().join(format!(
            "storyforge2-generated-cover-{}.png",
            Uuid::new_v4()
        ));
        tokio::fs::write(&existing_path, PNG_SIGNATURE)
            .await
            .unwrap();
        tokio::fs::write(&generated_path, PNG_SIGNATURE)
            .await
            .unwrap();
        let existing_path_text = existing_path.to_string_lossy().to_string();

        let error = reject_duplicate_existing_cover(&generated_path, &existing_path_text)
            .await
            .unwrap_err()
            .to_string();

        assert!(error.contains("identyczny z aktualna okladka"));

        tokio::fs::write(
            &generated_path,
            [PNG_SIGNATURE.as_slice(), b"fresh"].concat(),
        )
        .await
        .unwrap();
        reject_duplicate_existing_cover(&generated_path, &existing_path_text)
            .await
            .unwrap();

        let _ = tokio::fs::remove_file(existing_path).await;
        let _ = tokio::fs::remove_file(generated_path).await;
    }

    #[tokio::test]
    async fn duplicate_previous_cover_file_is_rejected() {
        let cover_dir =
            std::env::temp_dir().join(format!("storyforge2-cover-dir-{}", Uuid::new_v4()));
        let previous_path = cover_dir.join("cover-previous.png");
        let generated_path = std::env::temp_dir().join(format!(
            "storyforge2-generated-cover-{}.png",
            Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&cover_dir).await.unwrap();
        tokio::fs::write(&previous_path, PNG_SIGNATURE)
            .await
            .unwrap();
        tokio::fs::write(&generated_path, PNG_SIGNATURE)
            .await
            .unwrap();

        let error = reject_duplicate_previous_cover_file(&generated_path, &cover_dir)
            .await
            .unwrap_err()
            .to_string();

        assert!(error.contains("poprzednia propozycja okladki"));

        tokio::fs::write(
            &generated_path,
            [PNG_SIGNATURE.as_slice(), b"fresh"].concat(),
        )
        .await
        .unwrap();
        reject_duplicate_previous_cover_file(&generated_path, &cover_dir)
            .await
            .unwrap();

        let _ = tokio::fs::remove_dir_all(cover_dir).await;
        let _ = tokio::fs::remove_file(generated_path).await;
    }

    #[tokio::test]
    async fn cover_path_can_fall_back_to_codex_generated_images_session_dir() {
        let session_id = "019e9993-5197-7d43-b614-a49d9a906010";
        let generated_root =
            std::env::temp_dir().join(format!("storyforge2-generated-images-{}", Uuid::new_v4()));
        let session_dir = generated_root.join(session_id);
        tokio::fs::create_dir_all(&session_dir).await.unwrap();
        let generated_path = session_dir.join("ig_test.png");
        tokio::fs::write(&generated_path, PNG_SIGNATURE)
            .await
            .unwrap();

        let requested_path =
            std::env::temp_dir().join(format!("storyforge2-requested-{}.png", Uuid::new_v4()));
        let stdout = serde_json::json!({
            "version": 1,
            "kind": "book_cover_image",
            "imagePath": requested_path.to_string_lossy()
        })
        .to_string();
        let stderr = format!("session id: {session_id}");

        let resolved = resolve_generated_cover_path_from_sources(
            &requested_path,
            &stdout,
            &stderr,
            Some(generated_root.clone()),
            SystemTime::UNIX_EPOCH,
        )
        .await
        .unwrap();

        assert_eq!(resolved, generated_path);
        let _ = tokio::fs::remove_dir_all(generated_root).await;
    }

    #[tokio::test]
    async fn cover_path_can_be_resolved_when_json_points_to_session_directory() {
        let session_dir = std::env::temp_dir().join(format!(
            "storyforge2-generated-image-session-{}",
            Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&session_dir).await.unwrap();
        let generated_path = session_dir.join("ig_from_session_dir.png");
        tokio::fs::write(&generated_path, PNG_SIGNATURE)
            .await
            .unwrap();

        let requested_path =
            std::env::temp_dir().join(format!("storyforge2-requested-{}.png", Uuid::new_v4()));
        let stdout = serde_json::json!({
            "version": 1,
            "kind": "book_cover_image",
            "imagePath": session_dir.to_string_lossy()
        })
        .to_string();

        let resolved = resolve_generated_cover_path_from_sources(
            &requested_path,
            &stdout,
            "",
            None,
            SystemTime::UNIX_EPOCH,
        )
        .await
        .unwrap();

        assert_eq!(resolved, generated_path);
        let _ = tokio::fs::remove_dir_all(session_dir).await;
    }

    #[test]
    fn docx_export_starts_with_cover_image_when_available() {
        let cover_path =
            std::env::temp_dir().join(format!("storyforge2-docx-cover-{}.png", Uuid::new_v4()));
        std::fs::write(&cover_path, tiny_png()).unwrap();
        let mut document = export_test_document();
        document.cover_image_path = Some(cover_path.to_string_lossy().to_string());

        let bytes = build_docx(&document, false).unwrap();
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("word/media/cover.png"));
        assert!(text.contains("rIdCoverImage"));
        assert!(text.contains(r#"<w:br w:type="page"/>"#));
        let _ = std::fs::remove_file(cover_path);
    }

    #[test]
    fn docx_export_uses_title_cover_fallback_without_image() {
        let mut document = export_test_document();
        document.cover_image_path = None;

        let bytes = build_docx(&document, false).unwrap();
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("Testowa książka"));
        assert!(text.contains(r#"<w:br w:type="page"/>"#));
        assert!(!text.contains("word/media/cover.png"));
    }

    #[test]
    fn epub_export_starts_with_cover_xhtml_and_image_when_available() {
        let cover_path =
            std::env::temp_dir().join(format!("storyforge2-epub-cover-{}.png", Uuid::new_v4()));
        std::fs::write(&cover_path, tiny_png()).unwrap();
        let mut document = export_test_document();
        document.cover_image_path = Some(cover_path.to_string_lossy().to_string());
        let book = export_test_book();

        let bytes = build_epub(&document, &book).unwrap();
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("OEBPS/cover.xhtml"));
        assert!(text.contains("OEBPS/images/cover.png"));
        assert!(text.contains(r#"<itemref idref="cover"/><itemref idref="content"/>"#));
        assert!(text.contains(r#"<meta name="cover" content="cover-image"/>"#));
        let _ = std::fs::remove_file(cover_path);
    }

    #[test]
    fn epub_export_uses_title_cover_fallback_without_image() {
        let mut document = export_test_document();
        document.cover_image_path = None;
        let book = export_test_book();

        let bytes = build_epub(&document, &book).unwrap();
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("OEBPS/cover.xhtml"));
        assert!(text.contains(r#"<section class="cover-page"><h1>Testowa książka</h1></section>"#));
        assert!(!text.contains("OEBPS/images/cover.png"));
    }

    #[tokio::test]
    async fn generated_png_validation_rejects_missing_or_empty_files() {
        let missing_path =
            std::env::temp_dir().join(format!("storyforge2-missing-{}.png", Uuid::new_v4()));
        let missing_error = verify_generated_png_file(&missing_path, "test image")
            .await
            .unwrap_err()
            .to_string();
        assert!(missing_error.contains("missing or cannot be read"));

        let empty_path =
            std::env::temp_dir().join(format!("storyforge2-empty-{}.png", Uuid::new_v4()));
        tokio::fs::write(&empty_path, b"").await.unwrap();
        let empty_error = verify_generated_png_file(&empty_path, "test image")
            .await
            .unwrap_err()
            .to_string();
        assert!(empty_error.contains("is empty"));
        let _ = tokio::fs::remove_file(empty_path).await;
    }

    fn export_test_document() -> ExportDocument {
        ExportDocument {
            title: "Testowa książka".into(),
            cover_image_path: None,
            markdown: "# Testowa książka\n".into(),
            plain_text: "Testowa książka\n\nRozdział 1".into(),
            body_plain: "Treść".into(),
            html_body: "<h1>Testowa książka</h1><p>Treść</p>".into(),
        }
    }

    fn export_test_book() -> Book {
        Book {
            id: "book-test".into(),
            project_id: "project-test".into(),
            title: "Testowa książka".into(),
            working_title: "Robocza książka".into(),
            premise: String::new(),
            protagonist_summary: String::new(),
            protagonist_goal: String::new(),
            expanded_premise: String::new(),
            central_conflict: String::new(),
            antagonist_force: String::new(),
            stakes: String::new(),
            setting_sketch: String::new(),
            ending_direction: String::new(),
            genre: String::new(),
            subgenre: String::new(),
            target_audience: String::new(),
            tone: String::new(),
            style_guide: String::new(),
            point_of_view: String::new(),
            target_word_count: None,
            themes_json: "[]".into(),
            unwanted_themes: String::new(),
            alternative_titles_json: "[]".into(),
            cover_image_path: String::new(),
            cover_prompt: String::new(),
            cover_negative_prompt: String::new(),
            cover_generated_at: None,
            story_so_far: String::new(),
            story_so_far_stale: 0,
            status: "draft".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn tiny_png() -> &'static [u8] {
        &[
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
            5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]
    }
}
