use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::watch;
use uuid::Uuid;

use crate::ai_settings::AiSettings;
use crate::{
    ensure_git_workspace, resolve_codex_command, run_registered_codex_command, ActiveCodexRun,
    ActiveCodexRunHandle, ActiveCodexRunRegistry, AppError, RunCodexPromptRequest,
};

/// Odpowiednik run_registered_codex_command dla futures (HTTP): rejestruje run,
/// obsługuje timeout i anulowanie z UI przez istniejący rejestr.
pub(crate) async fn run_registered_future<T, F>(
    registry: &ActiveCodexRunRegistry,
    run: ActiveCodexRun,
    timeout_seconds: u64,
    fut: F,
) -> Result<T, AppError>
where
    F: Future<Output = Result<T, AppError>>,
{
    let (cancel, mut cancel_rx) = watch::channel(false);
    registry.lock().await.insert(
        run.ai_run_id.clone(),
        ActiveCodexRunHandle {
            run: run.clone(),
            cancel,
        },
    );

    let timeout_sleep = tokio::time::sleep(Duration::from_secs(timeout_seconds));
    tokio::pin!(timeout_sleep);
    tokio::pin!(fut);

    let result = tokio::select! {
        result = &mut fut => result,
        _ = &mut timeout_sleep => Err(AppError::Timeout(timeout_seconds)),
        _ = cancel_rx.changed() => Err(AppError::Cancelled),
    };

    registry.lock().await.remove(&run.ai_run_id);
    result
}

fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .build()
        .map_err(|error| AppError::Process(format!("Nie udało się utworzyć klienta HTTP: {error}")))
}

// ---------------------------------------------------------------------------
// Tekst: Claude Code CLI (subskrypcja Anthropic)
// ---------------------------------------------------------------------------

pub(crate) async fn execute_claude_cli(
    app: &AppHandle,
    registry: &ActiveCodexRunRegistry,
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    settings: &AiSettings,
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

    let command_spec = resolve_codex_command(&settings.claude_path).await;
    let model = if settings.claude_model.trim().is_empty() {
        "sonnet"
    } else {
        settings.claude_model.trim()
    };

    let mut command = Command::new(command_spec.program);
    command
        .args(command_spec.prefix_args)
        .arg("-p")
        .arg("--output-format")
        .arg("json")
        .arg("--model")
        .arg(model)
        // 1 tura bywa za ciasna: model potrafi zgłosić error_max_turns, nawet
        // gdy narzędzia są wyłączone. Kilka tur to bezpieczny sufit — przy
        // zwykłej odpowiedzi i tak zużywa jedną.
        .arg("--max-turns")
        .arg("6")
        .arg("--setting-sources")
        .arg("")
        .arg("--strict-mcp-config")
        .arg("--disallowedTools")
        .arg("Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Glob,Grep,Read")
        // Wymuś subskrypcję (zalogowaną sesję OAuth), a nie rozliczenie API.
        // Claude CLI używa klucza API, jeśli jest w środowisku — usuwamy go
        // z podprocesu, żeby korzystał z konta zalogowanego przez `claude`.
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Claude CLI odpowiednikiem reasoning jest `--effort` (low/medium/high/xhigh).
    let effort = request
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(effort) = effort {
        command.arg("--effort").arg(effort);
    }

    let (status, stdout, stderr) = run_registered_codex_command(
        registry,
        ActiveCodexRun {
            ai_run_id: ai_run_id.to_string(),
            project_id: request.project_id.clone(),
            action: request.action.clone(),
            started_at: Utc::now().to_rfc3339(),
            model: Some(model.to_string()),
            reasoning_effort: request.reasoning_effort.clone(),
            phase: "running".into(),
        },
        &mut command,
        &request.prompt,
        timeout_seconds,
    )
    .await?;

    tokio::fs::write(workspace.join("response.raw.md"), stdout.as_bytes()).await?;

    if !status.success() {
        if stdout.contains("error_max_turns") {
            return Err(AppError::Process(
                "Claude CLI przerwał odpowiedź na limicie tur (error_max_turns). Spróbuj ponownie lub uprość pole.".into(),
            ));
        }
        return Err(AppError::Process(if stderr.trim().is_empty() {
            format!(
                "Claude CLI zwrócił niezerowy status. Początek stdout: {}",
                truncate(&stdout, 300)
            )
        } else {
            format!("Claude CLI: {}", stderr.trim())
        }));
    }

    let parsed: Value = serde_json::from_str(stdout.trim()).map_err(|_| {
        AppError::Process(format!(
            "Claude CLI nie zwrócił poprawnego JSON. Początek odpowiedzi: {}",
            truncate(&stdout, 300)
        ))
    })?;

    let is_error = parsed
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let result_text = parsed.get("result").and_then(Value::as_str);

    match (is_error, result_text) {
        (false, Some(text)) => Ok((text.to_string(), stderr)),
        _ => Err(AppError::Process(format!(
            "Claude CLI zgłosił błąd: {}",
            result_text
                .map(|text| truncate(text, 300))
                .unwrap_or_else(|| truncate(&stdout, 300))
        ))),
    }
}

// ---------------------------------------------------------------------------
// Tekst: OpenAI API (Responses) i Anthropic API (Messages)
// ---------------------------------------------------------------------------

pub(crate) async fn execute_openai_text(
    registry: &ActiveCodexRunRegistry,
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    settings: &AiSettings,
    timeout_seconds: u64,
) -> Result<(String, String), AppError> {
    if settings.openai_api_key.trim().is_empty() {
        return Err(AppError::Process(
            "Brak klucza OpenAI API. Uzupełnij go na stronie ustawień AI.".into(),
        ));
    }
    let model = settings.openai_text_model.clone();
    let mut body = serde_json::json!({
        "model": model,
        "input": request.prompt,
    });
    if let Some(effort) = request
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        // Responses API zna low|medium|high — xhigh mapujemy na high.
        let effort = if effort == "xhigh" { "high" } else { effort };
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }

    let api_key = settings.openai_api_key.clone();
    let run = text_run(ai_run_id, request, Some(model));
    let fut = async move {
        let response = http_client()?
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| AppError::Process(format!("OpenAI API: błąd połączenia: {error}")))?;
        let status = response.status();
        let payload: Value = response.json().await.map_err(|error| {
            AppError::Process(format!("OpenAI API: nieprawidłowa odpowiedź: {error}"))
        })?;

        if !status.is_success() {
            let message = payload
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("nieznany błąd");
            return Err(AppError::Process(format!("OpenAI API {status}: {message}")));
        }

        let mut text = String::new();
        if let Some(output) = payload.get("output").and_then(Value::as_array) {
            for item in output {
                if item.get("type").and_then(Value::as_str) != Some("message") {
                    continue;
                }
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("output_text") {
                            if let Some(part) = block.get("text").and_then(Value::as_str) {
                                text.push_str(part);
                            }
                        }
                    }
                }
            }
        }

        if text.trim().is_empty() {
            return Err(AppError::Process(
                "OpenAI API zwróciło pustą odpowiedź tekstową.".into(),
            ));
        }
        Ok((text, String::new()))
    };

    run_registered_future(registry, run, timeout_seconds, fut).await
}

pub(crate) async fn execute_anthropic_text(
    registry: &ActiveCodexRunRegistry,
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    settings: &AiSettings,
    timeout_seconds: u64,
) -> Result<(String, String), AppError> {
    if settings.anthropic_api_key.trim().is_empty() {
        return Err(AppError::Process(
            "Brak klucza Anthropic API. Uzupełnij go na stronie ustawień AI.".into(),
        ));
    }
    let model = settings.anthropic_model.clone();
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 16000,
        "messages": [{ "role": "user", "content": request.prompt }],
    });

    let api_key = settings.anthropic_api_key.clone();
    let run = text_run(ai_run_id, request, Some(model));
    let fut = async move {
        let response = http_client()?
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                AppError::Process(format!("Anthropic API: błąd połączenia: {error}"))
            })?;
        let status = response.status();
        let payload: Value = response.json().await.map_err(|error| {
            AppError::Process(format!("Anthropic API: nieprawidłowa odpowiedź: {error}"))
        })?;

        if !status.is_success() {
            let message = payload
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("nieznany błąd");
            return Err(AppError::Process(format!(
                "Anthropic API {status}: {message}"
            )));
        }

        let mut text = String::new();
        if let Some(content) = payload.get("content").and_then(Value::as_array) {
            for block in content {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(part) = block.get("text").and_then(Value::as_str) {
                        text.push_str(part);
                    }
                }
            }
        }

        if text.trim().is_empty() {
            return Err(AppError::Process(
                "Anthropic API zwróciło pustą odpowiedź tekstową.".into(),
            ));
        }
        Ok((text, String::new()))
    };

    run_registered_future(registry, run, timeout_seconds, fut).await
}

fn text_run(
    ai_run_id: &str,
    request: &RunCodexPromptRequest,
    model: Option<String>,
) -> ActiveCodexRun {
    ActiveCodexRun {
        ai_run_id: ai_run_id.to_string(),
        project_id: request.project_id.clone(),
        action: request.action.clone(),
        started_at: Utc::now().to_rfc3339(),
        model,
        reasoning_effort: request.reasoning_effort.clone(),
        phase: "running".into(),
    }
}

// ---------------------------------------------------------------------------
// Obrazy: OpenAI Images API / SD WebUI (A1111) / ComfyUI
// ---------------------------------------------------------------------------

pub(crate) struct DirectImageJob<'a> {
    pub visual_prompt: &'a str,
    pub negative_prompt: &'a str,
    pub portrait: bool,
    pub out_path: &'a Path,
}

pub(crate) async fn execute_direct_image_generation(
    registry: &ActiveCodexRunRegistry,
    run: ActiveCodexRun,
    settings: &AiSettings,
    job: DirectImageJob<'_>,
    timeout_seconds: u64,
) -> Result<(String, String, PathBuf), AppError> {
    if let Some(parent) = job.out_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::remove_file(job.out_path).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::from(error)),
    }

    let provider = settings.image_provider.clone();
    let settings = settings.clone();
    let visual_prompt = job.visual_prompt.to_string();
    let negative_prompt = job.negative_prompt.to_string();
    let portrait = job.portrait;
    let out_path = job.out_path.to_path_buf();

    let fut = async move {
        let png_bytes = match provider.as_str() {
            "openai-api" => {
                generate_openai_image(&settings, &visual_prompt, &negative_prompt, portrait).await?
            }
            "local-sdwebui" => {
                generate_sdwebui_image(&settings, &visual_prompt, &negative_prompt, portrait)
                    .await?
            }
            "local-comfyui" => {
                generate_comfyui_image(&settings, &visual_prompt, &negative_prompt).await?
            }
            other => {
                return Err(AppError::Process(format!(
                    "Nieznany dostawca obrazów: {other}"
                )))
            }
        };
        tokio::fs::write(&out_path, &png_bytes).await?;
        Ok((String::new(), String::new(), out_path))
    };

    run_registered_future(registry, run, timeout_seconds, fut).await
}

async fn generate_openai_image(
    settings: &AiSettings,
    visual_prompt: &str,
    negative_prompt: &str,
    portrait: bool,
) -> Result<Vec<u8>, AppError> {
    if settings.openai_api_key.trim().is_empty() {
        return Err(AppError::Process(
            "Brak klucza OpenAI API. Uzupełnij go na stronie ustawień AI.".into(),
        ));
    }
    // gpt-image-1 nie ma negative promptu — doklejamy sekcję "Avoid".
    let prompt = if negative_prompt.trim().is_empty() {
        visual_prompt.to_string()
    } else {
        format!("{visual_prompt}\nAvoid: {negative_prompt}")
    };
    let model = if settings.openai_image_model.trim().is_empty() {
        "gpt-image-1"
    } else {
        settings.openai_image_model.trim()
    };
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "size": if portrait { "1024x1536" } else { "1024x1024" },
        "output_format": "png",
    });

    let response = http_client()?
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(settings.openai_api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|error| AppError::Process(format!("OpenAI Images: błąd połączenia: {error}")))?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| {
        AppError::Process(format!("OpenAI Images: nieprawidłowa odpowiedź: {error}"))
    })?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("nieznany błąd");
        return Err(AppError::Process(format!(
            "OpenAI Images {status}: {message}"
        )));
    }

    let b64 = payload
        .pointer("/data/0/b64_json")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::Process("OpenAI Images: brak danych obrazu w odpowiedzi.".into())
        })?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|error| AppError::Process(format!("OpenAI Images: błąd dekodowania: {error}")))
}

async fn generate_sdwebui_image(
    settings: &AiSettings,
    visual_prompt: &str,
    negative_prompt: &str,
    portrait: bool,
) -> Result<Vec<u8>, AppError> {
    let base = settings.sdwebui_base_url.trim_end_matches('/');
    let body = serde_json::json!({
        "prompt": visual_prompt,
        "negative_prompt": negative_prompt,
        "width": if portrait { 832 } else { 1024 },
        "height": if portrait { 1216 } else { 1024 },
        "steps": 30,
    });

    let response = http_client()?
        .post(format!("{base}/sdapi/v1/txt2img"))
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            AppError::Process(format!(
                "SD WebUI: błąd połączenia z {base}: {error}. Sprawdź, czy WebUI działa z flagą --api."
            ))
        })?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| {
        AppError::Process(format!("SD WebUI: nieprawidłowa odpowiedź: {error}"))
    })?;

    if !status.is_success() {
        return Err(AppError::Process(format!(
            "SD WebUI {status}: {}",
            truncate(&payload.to_string(), 300)
        )));
    }

    let b64 = payload
        .pointer("/images/0")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Process("SD WebUI: brak obrazu w odpowiedzi.".into()))?;
    // A1111 potrafi zwrócić "data:image/png;base64,..." — utnij prefiks.
    let b64 = b64.rsplit(',').next().unwrap_or(b64);
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|error| AppError::Process(format!("SD WebUI: błąd dekodowania: {error}")))
}

async fn generate_comfyui_image(
    settings: &AiSettings,
    visual_prompt: &str,
    negative_prompt: &str,
) -> Result<Vec<u8>, AppError> {
    if settings.comfyui_workflow_json.trim().is_empty() {
        return Err(AppError::Process(
            "Wklej workflow ComfyUI (format API, z placeholderami {PROMPT}/{NEGATIVE}/{SEED}) na stronie ustawień AI.".into(),
        ));
    }
    let base = settings.comfyui_base_url.trim_end_matches('/');
    let seed = u64::from_le_bytes(Uuid::new_v4().as_bytes()[..8].try_into().unwrap());
    let workflow_text = settings
        .comfyui_workflow_json
        .replace("{PROMPT}", &json_escape(visual_prompt))
        .replace("{NEGATIVE}", &json_escape(negative_prompt))
        .replace("{SEED}", &seed.to_string())
        .replace("\"{SEED}\"", &seed.to_string());
    let workflow: Value = serde_json::from_str(&workflow_text).map_err(|error| {
        AppError::Process(format!(
            "Workflow ComfyUI nie jest poprawnym JSON po podstawieniu placeholderów: {error}"
        ))
    })?;

    let client = http_client()?;
    let client_id = Uuid::new_v4().to_string();
    let response = client
        .post(format!("{base}/prompt"))
        .json(&serde_json::json!({ "prompt": workflow, "client_id": client_id }))
        .send()
        .await
        .map_err(|error| {
            AppError::Process(format!("ComfyUI: błąd połączenia z {base}: {error}"))
        })?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| {
        AppError::Process(format!("ComfyUI: nieprawidłowa odpowiedź: {error}"))
    })?;
    if !status.is_success() {
        return Err(AppError::Process(format!(
            "ComfyUI {status}: {}",
            truncate(&payload.to_string(), 300)
        )));
    }
    let prompt_id = payload
        .get("prompt_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Process("ComfyUI: brak prompt_id w odpowiedzi.".into()))?
        .to_string();

    // Poll co 1 s aż w historii pojawią się outputs (timeout obsługuje run_registered_future).
    let image_ref = loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let history: Value = client
            .get(format!("{base}/history/{prompt_id}"))
            .send()
            .await
            .map_err(|error| AppError::Process(format!("ComfyUI: błąd odczytu historii: {error}")))?
            .json()
            .await
            .map_err(|error| {
                AppError::Process(format!("ComfyUI: nieprawidłowa historia: {error}"))
            })?;
        let Some(entry) = history.get(&prompt_id) else {
            continue;
        };
        if let Some(error_message) = entry
            .pointer("/status/status_str")
            .and_then(Value::as_str)
            .filter(|value| *value == "error")
        {
            return Err(AppError::Process(format!(
                "ComfyUI zgłosił błąd wykonania workflow ({error_message})."
            )));
        }
        let Some(outputs) = entry.get("outputs").and_then(Value::as_object) else {
            continue;
        };
        let image = outputs.values().find_map(|output| {
            output
                .get("images")
                .and_then(Value::as_array)
                .and_then(|images| images.first())
                .cloned()
        });
        if let Some(image) = image {
            break image;
        }
    };

    let filename = image_ref
        .get("filename")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Process("ComfyUI: brak nazwy pliku w outputach.".into()))?;
    let subfolder = image_ref
        .get("subfolder")
        .and_then(Value::as_str)
        .unwrap_or("");
    let image_type = image_ref
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("output");

    let bytes = client
        .get(format!("{base}/view"))
        .query(&[
            ("filename", filename),
            ("subfolder", subfolder),
            ("type", image_type),
        ])
        .send()
        .await
        .map_err(|error| AppError::Process(format!("ComfyUI: błąd pobierania obrazu: {error}")))?
        .bytes()
        .await
        .map_err(|error| AppError::Process(format!("ComfyUI: błąd pobierania obrazu: {error}")))?;

    Ok(bytes.to_vec())
}

fn json_escape(value: &str) -> String {
    // serde_json::to_string dodaje cudzysłowy — utnij je, bo placeholder siedzi wewnątrz stringa JSON.
    let quoted = serde_json::to_string(value).unwrap_or_default();
    quoted[1..quoted.len().saturating_sub(1)].to_string()
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.trim().to_string()
    } else {
        let prefix: String = value.chars().take(max_chars).collect();
        format!("{}…", prefix.trim())
    }
}
