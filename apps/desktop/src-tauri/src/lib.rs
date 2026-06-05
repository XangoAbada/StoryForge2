use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};
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
    pub logline: String,
    pub genre: String,
    pub subgenre: String,
    pub target_audience: String,
    pub tone: String,
    pub style_guide: String,
    pub point_of_view: String,
    pub target_word_count: Option<i64>,
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
    pub logline: Option<String>,
    pub genre: Option<String>,
    pub subgenre: Option<String>,
    pub target_audience: Option<String>,
    pub tone: Option<String>,
    pub style_guide: Option<String>,
    pub point_of_view: Option<String>,
    pub target_word_count: Option<i64>,
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
pub struct BookCoverResult {
    pub book: Book,
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
          logline = COALESCE(?, logline),
          genre = COALESCE(?, genre),
          subgenre = COALESCE(?, subgenre),
          target_audience = COALESCE(?, target_audience),
          tone = COALESCE(?, tone),
          style_guide = COALESCE(?, style_guide),
          point_of_view = COALESCE(?, point_of_view),
          target_word_count = COALESCE(?, target_word_count),
          updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(input.title)
    .bind(input.working_title)
    .bind(input.premise)
    .bind(input.logline)
    .bind(input.genre)
    .bind(input.subgenre)
    .bind(input.target_audience)
    .bind(input.tone)
    .bind(input.style_guide)
    .bind(input.point_of_view)
    .bind(input.target_word_count)
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
          (id, project_id, provider_id, action, prompt_package_json, status, created_at)
        VALUES (?, ?, ?, 'generate_cover_image', ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&input.project_id)
    .bind(PROVIDER_ID)
    .bind(&prompt_package_json)
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
    let book = update_book_cover_metadata_in_pool(
        pool,
        &input.book_id,
        &final_image_path_text,
        &input.cover_prompt,
        &input.cover_negative_prompt,
        &completed_at,
    )
    .await?;

    emit_cover_progress(
        app,
        &input,
        &ai_run_id,
        "saved",
        "Okladka zapisana.",
        None,
        Some(100),
    );

    Ok(BookCoverResult {
        book,
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
          (id, project_id, provider_id, action, prompt_package_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?)
        "#,
    )
    .bind(&ai_run_id)
    .bind(&request.project_id)
    .bind(PROVIDER_ID)
    .bind(&request.action)
    .bind(&prompt_package_json)
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
    let prompt = request.prompt.replace("{OUTPUT_FILE}", &image_path_text);

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
    let instruction = "Run the StoryForge2 cover image prompt from stdin. Use Codex image generation when requested. Prefer the requested output path, but if the image tool saves elsewhere or filesystem copying is blocked, do not retry shell commands; return only the requested JSON with the best available imagePath. StoryForge2 will resolve and copy the final PNG.";

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
        .arg("image_generation");

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
        resolve_generated_cover_path(&image_path, &stdout, &stderr).await;

    if !output.status.success() && actual_image_path_result.is_err() {
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

async fn resolve_generated_cover_path(
    requested_path: &Path,
    stdout: &str,
    stderr: &str,
) -> Result<PathBuf, AppError> {
    resolve_generated_cover_path_from_sources(
        requested_path,
        stdout,
        stderr,
        codex_generated_images_dir(),
    )
    .await
}

async fn resolve_generated_cover_path_from_sources(
    requested_path: &Path,
    stdout: &str,
    stderr: &str,
    generated_images_dir: Option<PathBuf>,
) -> Result<PathBuf, AppError> {
    if let Some(path) = resolve_existing_png_path(requested_path).await? {
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
        if let Some(path) = resolve_existing_png_path(&resolved).await? {
            return Ok(path);
        }
    }

    if let Some(generated_images_dir) = generated_images_dir {
        if let Some(path) =
            latest_codex_generated_image_from_output(stdout, stderr, &generated_images_dir).await?
        {
            return Ok(path);
        }
    }

    Err(AppError::Process(format!(
        "Codex CLI zakonczyl generowanie, ale nie znaleziono pliku okladki. Oczekiwana sciezka: {}. Jesli Codex zapisal obraz w innym miejscu, odpowiedz musi zawierac JSON z polem imagePath.",
        requested_path.to_string_lossy()
    )))
}

async fn resolve_existing_png_path(path: &Path) -> Result<Option<PathBuf>, AppError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::from(error)),
    };

    if metadata.is_file() {
        return Ok(Some(path.to_path_buf()));
    }

    if metadata.is_dir() {
        return newest_png_in_dir(path).await;
    }

    Ok(None)
}

async fn latest_codex_generated_image_from_output(
    stdout: &str,
    stderr: &str,
    generated_images_dir: &Path,
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
        if let Some(path) = newest_png_in_dir(&session_dir).await? {
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

async fn newest_png_in_dir(dir: &Path) -> Result<Option<PathBuf>, AppError> {
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
            update_book_concept,
            generate_book_cover,
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

        let resolved = resolve_generated_cover_path(&requested_path, &stdout, "")
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

        let resolved = resolve_generated_cover_path(&requested_path, &stdout, "")
            .await
            .unwrap();

        assert_eq!(resolved, image_path);
        let _ = tokio::fs::remove_dir_all(run_dir).await;
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

        let resolved =
            resolve_generated_cover_path_from_sources(&requested_path, &stdout, "", None)
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
