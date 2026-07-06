use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::AppError;

pub const TEXT_PROVIDER_CODEX: &str = "codex-cli";
pub const TEXT_PROVIDER_CLAUDE: &str = "claude-cli";
pub const TEXT_PROVIDER_OPENAI_API: &str = "openai-api";
pub const TEXT_PROVIDER_ANTHROPIC_API: &str = "anthropic-api";

pub const IMAGE_PROVIDER_CODEX: &str = "codex-cli";

// ponytail: plaintext JSON w app_data_dir (jak ~/.codex/auth.json); upgrade path = keyring crate
const SETTINGS_FILE: &str = "ai-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub text_provider: String,
    pub image_provider: String,
    pub claude_path: String,
    pub claude_model: String,
    pub openai_api_key: String,
    pub openai_text_model: String,
    pub openai_image_model: String,
    pub anthropic_api_key: String,
    pub anthropic_model: String,
    pub sdwebui_base_url: String,
    pub comfyui_base_url: String,
    pub comfyui_workflow_json: String,
    /// Kurs przeliczenia szacunkowego kosztu USD→PLN pokazywanego w UI.
    pub pln_per_usd: f64,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            text_provider: TEXT_PROVIDER_CODEX.into(),
            image_provider: IMAGE_PROVIDER_CODEX.into(),
            claude_path: "claude".into(),
            claude_model: "sonnet".into(),
            openai_api_key: String::new(),
            openai_text_model: "gpt-5.5".into(),
            openai_image_model: "gpt-image-1".into(),
            anthropic_api_key: String::new(),
            anthropic_model: "claude-sonnet-5".into(),
            sdwebui_base_url: "http://127.0.0.1:7860".into(),
            comfyui_base_url: "http://127.0.0.1:8188".into(),
            comfyui_workflow_json: String::new(),
            pln_per_usd: 4.0,
        }
    }
}

impl AiSettings {
    pub fn text_provider_id(&self) -> &str {
        match self.text_provider.as_str() {
            TEXT_PROVIDER_CLAUDE => "claude-cli",
            TEXT_PROVIDER_OPENAI_API => "openai-api",
            TEXT_PROVIDER_ANTHROPIC_API => "anthropic-api",
            _ => crate::PROVIDER_ID,
        }
    }

    pub fn image_provider_id(&self) -> &str {
        if self.image_provider == IMAGE_PROVIDER_CODEX {
            crate::PROVIDER_ID
        } else {
            self.image_provider.as_str()
        }
    }

    pub fn effective_image_model(&self) -> Option<String> {
        match self.image_provider.as_str() {
            "openai-api" => Some(self.openai_image_model.clone()),
            _ => None,
        }
    }

    pub fn effective_text_model(&self) -> Option<String> {
        match self.text_provider.as_str() {
            TEXT_PROVIDER_CLAUDE => Some(self.claude_model.clone()),
            TEXT_PROVIDER_OPENAI_API => Some(self.openai_text_model.clone()),
            TEXT_PROVIDER_ANTHROPIC_API => Some(self.anthropic_model.clone()),
            _ => None,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        AppError::Process(format!(
            "Nie udało się ustalić katalogu danych aplikacji: {error}"
        ))
    })?;
    Ok(dir.join(SETTINGS_FILE))
}

pub async fn load_ai_settings(app: &AppHandle) -> AiSettings {
    let Ok(path) = settings_path(app) else {
        return AiSettings::default();
    };
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AiSettings::default(),
    }
}

pub async fn save_ai_settings_to_disk(
    app: &AppHandle,
    settings: &AiSettings,
) -> Result<(), AppError> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, serde_json::to_string_pretty(settings)?.as_bytes()).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_ai_settings(app: AppHandle) -> Result<AiSettings, String> {
    Ok(load_ai_settings(&app).await)
}

#[tauri::command]
pub async fn save_ai_settings(app: AppHandle, settings: AiSettings) -> Result<(), String> {
    save_ai_settings_to_disk(&app, &settings)
        .await
        .map_err(|error| error.to_string())
}
