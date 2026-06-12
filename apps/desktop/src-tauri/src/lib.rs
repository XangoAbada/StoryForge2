use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

const PROVIDER_ID: &str = "codex-cli-bridge";
const COVER_GENERATION_EVENT: &str = "cover-generation-progress";
const MIN_COVER_TIMEOUT_SECONDS: u64 = 600;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Clone)]
pub struct AppState {
    db: SqlitePool,
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
    pub logline: String,
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
    pub logline: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPlan {
    pub structure: Option<StoryStructure>,
    pub acts: Vec<Act>,
    pub beats: Vec<Beat>,
    pub threads: Vec<PlotThread>,
    pub chapters: Vec<Chapter>,
    pub chapter_threads: Vec<ChapterThread>,
    pub chapter_beats: Vec<ChapterBeat>,
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
    pub element_rules: Vec<WorldElementRule>,
    pub rule_threads: Vec<WorldRuleThread>,
    pub rule_chapters: Vec<WorldRuleChapter>,
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
pub struct UpsertCharacterInput {
    pub id: Option<String>,
    pub project_id: String,
    pub character_type: String,
    pub name: String,
    pub aliases_json: String,
    pub role: String,
    pub short_description: String,
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
    Ok(pool)
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
    let structure = sqlx::query_as::<_, StoryStructure>(
        "SELECT * FROM story_structures WHERE book_id = ?",
    )
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    let acts = sqlx::query_as::<_, Act>(
        "SELECT * FROM acts WHERE book_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    let beats = sqlx::query_as::<_, Beat>(
        "SELECT * FROM beats WHERE book_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    let threads = sqlx::query_as::<_, PlotThread>(
        "SELECT * FROM plot_threads WHERE book_id = ? ORDER BY order_index, created_at",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    let chapters = sqlx::query_as::<_, Chapter>(
        "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index, number, created_at",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    let chapter_threads = sqlx::query_as::<_, ChapterThread>(
        r#"
        SELECT ct.chapter_id, ct.thread_id, ct.description
        FROM chapter_threads ct
        INNER JOIN chapters c ON c.id = ct.chapter_id
        WHERE c.book_id = ?
        ORDER BY c.order_index
        "#,
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    let chapter_beats = sqlx::query_as::<_, ChapterBeat>(
        r#"
        SELECT cb.chapter_id, cb.beat_id
        FROM chapter_beats cb
        INNER JOIN chapters c ON c.id = cb.chapter_id
        WHERE c.book_id = ?
        ORDER BY c.order_index
        "#,
    )
    .bind(book_id)
    .fetch_all(pool)
    .await?;

    Ok(BookPlan {
        structure,
        acts,
        beats,
        threads,
        chapters,
        chapter_threads,
        chapter_beats,
    })
}

pub async fn save_story_structure_in_pool(
    pool: &SqlitePool,
    input: SaveStoryStructureInput,
) -> Result<StoryStructure, AppError> {
    if input.structure_type.trim().is_empty() {
        return Err(AppError::Process("Typ struktury nie moze byc pusty.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let status = input.status.unwrap_or_else(|| "draft".into());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO story_structures
          (id, book_id, structure_type, description, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
          structure_type = excluded.structure_type,
          description = excluded.description,
          notes = excluded.notes,
          status = excluded.status,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
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

    sqlx::query_as::<_, StoryStructure>("SELECT * FROM story_structures WHERE book_id = ?")
        .bind(&input.book_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

pub async fn upsert_act_in_pool(
    pool: &SqlitePool,
    input: UpsertActInput,
) -> Result<Act, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process("Nazwa aktu nie moze byc pusta.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO acts
          (id, book_id, name, purpose, summary, start_percent, end_percent, order_index, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    sqlx::query(
        r#"
        INSERT INTO beats
          (id, book_id, name, description, role, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

    let beat_exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM beats WHERE id = ? AND book_id = ?")
            .bind(&input.beat_id)
            .bind(&input.book_id)
            .fetch_one(&mut *tx)
            .await?;
    if beat_exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono beatu.".into()));
    }

    if let Some(chapter_id) = &input.chapter_id {
        let chapter_exists: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ?")
                .bind(chapter_id)
                .bind(&input.book_id)
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

    sqlx::query(
        r#"
        INSERT INTO plot_threads
          (id, book_id, name, description, color, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          color = excluded.color,
          status = excluded.status,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&input.book_id)
    .bind(input.name)
    .bind(input.description)
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
        return Err(AppError::Process("Tytul rozdzialu nie moze byc pusty.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO chapters
          (id, book_id, act_id, number, working_title, summary, purpose, conflict, turning_point, target_word_count, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    let chapter_exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM chapters WHERE id = ? AND book_id = ?")
            .bind(&input.chapter_id)
            .bind(&input.book_id)
            .fetch_one(&mut *tx)
            .await?;
    if chapter_exists.0 == 0 {
        return Err(AppError::Process("Nie znaleziono rozdzialu.".into()));
    }

    let thread_exists: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plot_threads WHERE id = ? AND book_id = ?")
            .bind(&input.thread_id)
            .bind(&input.book_id)
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
        element_rules,
        rule_threads,
        rule_chapters,
        visual_assets,
    })
}

pub async fn upsert_character_in_pool(
    pool: &SqlitePool,
    input: UpsertCharacterInput,
) -> Result<Character, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Process("Nazwa postaci nie moze byc pusta.".into()));
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO characters
          (id, project_id, character_type, name, aliases_json, role, short_description, external_goal, internal_need, wound, false_belief, secret, strengths_json, weaknesses_json, voice_notes, arc_summary, knowledge_notes, visual_prompt, image_asset_id, status, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          character_type = excluded.character_type,
          name = excluded.name,
          aliases_json = excluded.aliases_json,
          role = excluded.role,
          short_description = excluded.short_description,
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
        return Err(AppError::Process("Tytul wspomnienia nie moze byc pusty.".into()));
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

pub async fn delete_character_memory_in_pool(
    pool: &SqlitePool,
    id: &str,
) -> Result<(), AppError> {
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
        sqlx::query("INSERT OR IGNORE INTO world_element_threads (element_id, thread_id) VALUES (?, ?)")
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
        sqlx::query("INSERT OR IGNORE INTO world_element_chapters (element_id, chapter_id) VALUES (?, ?)")
            .bind(&input.element_id)
            .bind(chapter_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM world_element_rules WHERE element_id = ?")
        .bind(&input.element_id)
        .execute(&mut *tx)
        .await?;
    for rule_id in unique_ids(input.rule_ids) {
        validate_world_rule_in_project(&mut tx, &rule_id, &input.project_id).await?;
        sqlx::query("INSERT OR IGNORE INTO world_element_rules (element_id, rule_id) VALUES (?, ?)")
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
        sqlx::query("INSERT OR IGNORE INTO world_element_rules (element_id, rule_id) VALUES (?, ?)")
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
        sqlx::query("INSERT OR IGNORE INTO world_rule_chapters (rule_id, chapter_id) VALUES (?, ?)")
            .bind(&input.rule_id)
            .bind(chapter_id)
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

pub async fn list_ai_runs_in_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<AiLogEntry>, AppError> {
    let rows = sqlx::query_as::<_, AiLogEntryRow>(
        r#"
        SELECT
          id,
          project_id,
          provider_id,
          model,
          reasoning_effort,
          action,
          prompt_package_json,
          prompt,
          raw_output,
          status,
          error_message,
          created_at,
          completed_at
        FROM ai_runs
        WHERE project_id = ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let prompt_package_json =
                serde_json::from_str(&row.prompt_package_json).unwrap_or(Value::Null);
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
            })
        })
        .collect()
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
          logline = COALESCE(?, logline),
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
    .bind(input.logline)
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

pub async fn generate_book_cover_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
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

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'generate_cover_image', ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(PROVIDER_ID)
    .bind(input.model.as_deref().unwrap_or(""))
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
    let run_result = execute_codex_image_generation(app, &input, &ai_run_id, timeout_seconds).await;
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
            provider_id: PROVIDER_ID.into(),
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

pub async fn generate_character_image_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    input: GenerateCharacterImageInput,
) -> Result<CharacterImageResult, AppError> {
    if input.image_prompt.trim().is_empty() {
        return Err(AppError::Process(
            "Prompt obrazu postaci nie moze byc pusty.".into(),
        ));
    }

    let character = sqlx::query_as::<_, Character>(
        "SELECT * FROM characters WHERE id = ? AND project_id = ?",
    )
    .bind(&input.character_id)
    .bind(&input.project_id)
    .fetch_one(pool)
    .await?;

    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&input.prompt_package_json)?;
    let timeout_seconds = cover_timeout_seconds(input.timeout_seconds);

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'generate_character_image', ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(PROVIDER_ID)
    .bind(input.model.as_deref().unwrap_or(""))
    .bind(input.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&prompt_package_json)
    .bind(&input.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    let started_at = Instant::now();
    let run_result =
        execute_codex_character_image_generation(app, &input, &ai_run_id, timeout_seconds).await;
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

    verify_generated_png_file(&generated_image_path, "Codex CLI generated character image")
        .await?;

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
            provider_id: PROVIDER_ID.into(),
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

    let character = sqlx::query_as::<_, Character>(
        "SELECT * FROM characters WHERE id = ? AND project_id = ?",
    )
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
    delete_act_in_pool(&state.db, &id).await.map_err(command_error)
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
    generate_book_cover_in_pool(&app, &state.db, input)
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
    generate_character_image_in_pool(&app, &state.db, input)
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
    run_codex_prompt_in_pool(&app, &state.db, request)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn generate_new_project_title(
    app: AppHandle,
    request: GenerateNewProjectTitleRequest,
) -> Result<AiRunResult, String> {
    generate_new_project_title_with_codex(&app, request)
        .await
        .map_err(command_error)
}

pub async fn generate_new_project_title_with_codex(
    app: &AppHandle,
    request: GenerateNewProjectTitleRequest,
) -> Result<AiRunResult, AppError> {
    if request.prompt.trim().is_empty() {
        return Err(AppError::Process("Prompt cannot be empty.".into()));
    }

    let ai_run_id = Uuid::new_v4().to_string();
    let timeout_seconds = request.timeout_seconds.unwrap_or(180);
    let codex_request = RunCodexPromptRequest {
        project_id: "new-project-title".into(),
        action: request.action,
        prompt_package_id: request.prompt_package_id,
        prompt_package_json: request.prompt_package_json,
        prompt: request.prompt,
        codex_path: request.codex_path,
        timeout_seconds: request.timeout_seconds,
        model: request.model,
        reasoning_effort: request.reasoning_effort,
    };

    let started_at = Instant::now();
    let run_result = execute_codex(app, &codex_request, timeout_seconds).await;
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
        Err(error) => ("error".to_string(), None, None, Some(error.to_string())),
    };

    Ok(AiRunResult {
        id: ai_run_id,
        provider_id: PROVIDER_ID.into(),
        prompt_package_id: codex_request.prompt_package_id,
        action: codex_request.action,
        status,
        raw_output,
        stderr,
        error_message,
        duration_ms,
    })
}

pub async fn run_codex_prompt_in_pool(
    app: &AppHandle,
    pool: &SqlitePool,
    request: RunCodexPromptRequest,
) -> Result<AiRunResult, AppError> {
    let ai_run_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prompt_package_json = serde_json::to_string(&request.prompt_package_json)?;
    let timeout_seconds = request.timeout_seconds.unwrap_or(180);

    sqlx::query(
        r#"
        INSERT INTO ai_runs
          (id, project_id, provider_id, model, reasoning_effort, action, prompt_package_json, prompt, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&request.project_id)
    .bind(PROVIDER_ID)
    .bind(request.model.as_deref().unwrap_or(""))
    .bind(request.reasoning_effort.as_deref().unwrap_or(""))
    .bind(&request.action)
    .bind(&prompt_package_json)
    .bind(&request.prompt)
    .bind(&created_at)
    .execute(pool)
    .await?;

    let started_at = Instant::now();
    let run_result = execute_codex(app, &request, timeout_seconds).await;
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
        provider_id: PROVIDER_ID.into(),
        prompt_package_id: request.prompt_package_id,
        action: request.action,
        status,
        raw_output,
        stderr,
        error_message,
        duration_ms,
    })
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

    let output = timeout(Duration::from_secs(timeout_seconds), async {
        let mut child = command.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await?;
        }
        child.wait_with_output().await.map_err(AppError::from)
    })
    .await
    .map_err(|_| AppError::Timeout(timeout_seconds))??;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": "generate_cover_image",
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": output.status.code(),
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

    if !output.status.success() {
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

    let output = timeout(Duration::from_secs(timeout_seconds), async {
        let mut child = command.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await?;
        }
        child.wait_with_output().await.map_err(AppError::from)
    })
    .await
    .map_err(|_| AppError::Timeout(timeout_seconds))??;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": "generate_character_image",
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": output.status.code(),
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

    if !output.status.success() {
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

    let output = timeout(Duration::from_secs(timeout_seconds), async {
        let mut child = command.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(request.prompt.as_bytes()).await?;
        }
        child.wait_with_output().await.map_err(AppError::from)
    })
    .await
    .map_err(|_| AppError::Timeout(timeout_seconds))??;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;
    tokio::fs::write(
        workspace.join("last-run.json"),
        serde_json::json!({
            "action": request.action,
            "model": request.model,
            "reasoningEffort": request.reasoning_effort,
            "status": output.status.code(),
            "stderr": stderr,
            "completedAt": Utc::now().to_rfc3339()
        })
        .to_string()
        .as_bytes(),
    )
    .await?;

    if output.status.success() {
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
            app.manage(AppState { db: pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            list_projects,
            get_project,
            get_book_plan,
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
            update_book_concept,
            generate_book_cover,
            accept_generated_book_cover,
            generate_character_image,
            accept_generated_character_image,
            check_codex_cli,
            list_codex_models,
            generate_new_project_title,
            run_codex_prompt
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

        let plan = get_book_plan_in_pool(&pool, &created.book.id).await.unwrap();
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

        let plan = get_book_plan_in_pool(&pool, &created.book.id).await.unwrap();
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

        let plan = get_book_plan_in_pool(&pool, &created.book.id).await.unwrap();
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
        let chapter_thread_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM chapter_threads")
                .fetch_one(&pool)
                .await
                .unwrap();
        let chapter_beat_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM chapter_beats")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(chapter_thread_count.0, 0);
        assert_eq!(chapter_beat_count.0, 0);

        delete_beat_in_pool(&pool, &beat.id).await.unwrap();
        delete_plot_thread_in_pool(&pool, &thread.id).await.unwrap();
        let plan = get_book_plan_in_pool(&pool, &created.book.id).await.unwrap();
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

        delete_character_in_pool(&pool, &character.id).await.unwrap();
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
}
