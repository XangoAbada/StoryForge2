import {
  ExternalLink,
  KeyRound,
  RefreshCw,
  SlidersHorizontal,
  Terminal
} from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkClaudeCli,
  checkCodexCli,
  checkCodexLogin,
  getAiSettings,
  saveAiSettings,
  startClaudeLogin,
  startCodexLogin
} from "../../shared/api/commands";
import type {
  AiSettings,
  ImageProviderId,
  ReasoningEffort,
  TextProviderId
} from "../../shared/api/types";
import { DEFAULT_AI_SETTINGS, REASONING_LEVELS } from "../../shared/api/types";
import { setUiLanguage, UI_LANGUAGES } from "../../shared/i18n";
import { Button, Field, StatusPill } from "../../shared/ui";
import { CodexStatusPanel } from "./CodexStatusPanel";
import { useCodexSettingsStore } from "./codexSettingsStore";
import {
  ANTHROPIC_MODELS,
  CLAUDE_MODELS,
  normalizeClaudeModel,
  OPENAI_TEXT_MODELS
} from "./textProviderInfo";

const TEXT_PROVIDER_IDS: TextProviderId[] = [
  "codex-cli",
  "claude-cli",
  "openai-api",
  "anthropic-api"
];

const IMAGE_PROVIDER_IDS: ImageProviderId[] = [
  "codex-cli",
  "openai-api",
  "local-sdwebui",
  "local-comfyui"
];

export function AiSettingsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const setTimeoutSeconds = useCodexSettingsStore(
    (state) => state.setTimeoutSeconds
  );
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );
  const setReasoningEffort = useCodexSettingsStore(
    (state) => state.setReasoningEffort
  );

  const settingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings
  });

  const [draft, setDraft] = useState<AiSettings>({ ...DEFAULT_AI_SETTINGS });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setDraft(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveAiSettings,
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    }
  });

  const codexLoginQuery = useQuery({
    queryKey: ["codex-login", codexPath],
    queryFn: () => checkCodexLogin(codexPath),
    retry: 0
  });

  const codexCliQuery = useQuery({
    queryKey: ["codex-cli", codexPath],
    queryFn: () => checkCodexCli(codexPath),
    retry: 0
  });

  const claudeQuery = useQuery({
    queryKey: ["claude-cli", draft.claudePath],
    queryFn: () => checkClaudeCli(draft.claudePath),
    retry: 0
  });

  function update<K extends keyof AiSettings>(key: K, value: AiSettings[K]) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const missingKeyWarning =
    (draft.textProvider === "openai-api" && !draft.openaiApiKey.trim()) ||
    (draft.imageProvider === "openai-api" && !draft.openaiApiKey.trim())
      ? t("aiSettings.missingOpenaiKey")
      : draft.textProvider === "anthropic-api" && !draft.anthropicApiKey.trim()
        ? t("aiSettings.missingAnthropicKey")
        : null;

  const codexAvailable = codexCliQuery.data?.available === true;
  const codexLoggedIn = codexLoginQuery.data?.authLikelyReady === true;
  const claudeAvailable = claudeQuery.data?.available === true;
  const claudeLoggedIn = claudeQuery.data?.authLikelyReady === true;

  return (
    <section className="content-panel settings-content">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("aiSettings.eyebrow")}</p>
          <h2>{t("aiSettings.heading")}</h2>
        </div>
        <SlidersHorizontal size={20} aria-hidden="true" />
      </div>

      <Field label={t("aiSettings.uiLanguage")} className="field-label-narrow">
        <select
          value={i18n.language}
          onChange={(event) => setUiLanguage(event.target.value)}
        >
          {UI_LANGUAGES.map((lang) => (
            <option value={lang.value} key={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("aiSettings.subscriptionsEyebrow")}</p>
            <h2>{t("aiSettings.activeAccounts")}</h2>
          </div>
        </div>

        <div className="provider-body">
          <div className="section-title-row">
            <div>
              <strong>{t("aiSettings.openaiCodex")}</strong>
              <p className="muted-text">
                {codexLoginQuery.data?.message ??
                  codexCliQuery.data?.message ??
                  t("aiSettings.checkingStatus")}
              </p>
            </div>
            <SubscriptionPill
              available={codexAvailable}
              loggedIn={codexLoggedIn}
              loading={codexLoginQuery.isLoading || codexCliQuery.isLoading}
            />
          </div>
          <div className="inline-control">
            <Button
              onClick={() => {
                void startCodexLogin(codexPath);
              }}
              disabled={!codexAvailable}
              title={t("aiSettings.loginViaCodexTitle")}
            >
              <ExternalLink size={14} aria-hidden="true" />{" "}
              {t("aiSettings.loginViaCodex")}
            </Button>
            <Button
              variant="icon"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["codex-login"] });
                void queryClient.invalidateQueries({ queryKey: ["codex-cli"] });
              }}
              title={t("aiSettings.refreshOpenaiStatus")}
              aria-label={t("aiSettings.refreshOpenaiStatus")}
            >
              <RefreshCw size={16} />
            </Button>
          </div>

          <div className="section-title-row">
            <div>
              <strong>{t("aiSettings.anthropicClaude")}</strong>
              <p className="muted-text">
                {claudeQuery.data?.message ?? t("aiSettings.checkingStatus")}
              </p>
            </div>
            <SubscriptionPill
              available={claudeAvailable}
              loggedIn={claudeLoggedIn}
              loading={claudeQuery.isLoading}
            />
          </div>
          <Field label={t("aiSettings.claudePathLabel")}>
            <div className="inline-control">
              <Terminal size={16} aria-hidden="true" />
              <input
                value={draft.claudePath}
                onChange={(event) => update("claudePath", event.target.value)}
                placeholder="claude"
              />
              <Button
                variant="icon"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ["claude-cli"] });
                }}
                title={t("aiSettings.checkClaudeCli")}
                aria-label={t("aiSettings.checkClaudeCli")}
              >
                <RefreshCw size={16} />
              </Button>
            </div>
          </Field>
          <div className="inline-control">
            <Button
              onClick={() => {
                void startClaudeLogin(draft.claudePath);
              }}
              disabled={!claudeAvailable}
              title={t("aiSettings.openLoginTerminalTitle")}
            >
              <ExternalLink size={14} aria-hidden="true" />{" "}
              {t("aiSettings.openLoginTerminal")}
            </Button>
          </div>
          <p className="help-text">{t("aiSettings.anthropicStatusHelp")}</p>
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("aiSettings.textEyebrow")}</p>
            <h2>{t("aiSettings.textProviderHeading")}</h2>
          </div>
        </div>
        <div className="provider-body">
          {TEXT_PROVIDER_IDS.map((provider) => (
            <label className="field-label" key={provider}>
              <div className="inline-control">
                <input
                  type="radio"
                  name="text-provider"
                  checked={draft.textProvider === provider}
                  onChange={() => update("textProvider", provider)}
                />
                <span>
                  {t(`aiSettings.textProvider.${provider}.label`)}
                  <p className="muted-text">
                    {t(`aiSettings.textProvider.${provider}.hint`)}
                  </p>
                </span>
              </div>
            </label>
          ))}

          {draft.textProvider === "codex-cli" ? <CodexStatusPanel compact /> : null}

          {draft.textProvider === "claude-cli" ? (
            <label className="field-label narrow">
              {t("aiSettings.claudeModel")}
              <select
                value={normalizeClaudeModel(draft.claudeModel)}
                onChange={(event) => update("claudeModel", event.target.value)}
              >
                {CLAUDE_MODELS.map((model) => (
                  <option value={model.value} key={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {draft.textProvider === "openai-api" ? (
            <label className="field-label narrow">
              {t("aiSettings.openaiModel")}
              <select
                value={draft.openaiTextModel}
                onChange={(event) => update("openaiTextModel", event.target.value)}
              >
                {[...new Set([draft.openaiTextModel, ...OPENAI_TEXT_MODELS])].map(
                  (model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  )
                )}
              </select>
            </label>
          ) : null}

          {draft.textProvider === "anthropic-api" ? (
            <label className="field-label narrow">
              {t("aiSettings.anthropicModel")}
              <select
                value={draft.anthropicModel}
                onChange={(event) => update("anthropicModel", event.target.value)}
              >
                {ANTHROPIC_MODELS.map((model) => (
                  <option value={model.value} key={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field-label narrow">
            {t("aiSettings.reasoningLevel")}
            <select
              value={reasoningEffort}
              onChange={(event) =>
                setReasoningEffort(event.target.value as ReasoningEffort)
              }
              title={
                REASONING_LEVELS.find((level) => level.value === reasoningEffort)
                  ?.hint
              }
            >
              {REASONING_LEVELS.map((level) => (
                <option value={level.value} key={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <p className="help-text">
            <Trans i18nKey="aiSettings.reasoningHelp" components={{ effort: <code /> }} />
          </p>

          <Field
            label={t("aiSettings.aiResponseLanguage")}
            className="field-label-narrow"
          >
            <input
              value={draft.aiResponseLanguage}
              onChange={(event) =>
                update("aiResponseLanguage", event.target.value)
              }
              placeholder={t("aiSettings.aiResponseLanguagePlaceholder")}
            />
          </Field>
          <p className="help-text">{t("aiSettings.aiResponseLanguageHelp")}</p>
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("aiSettings.imageEyebrow")}</p>
            <h2>{t("aiSettings.imageProviderHeading")}</h2>
          </div>
        </div>
        <div className="provider-body">
          {IMAGE_PROVIDER_IDS.map((provider) => (
            <label className="field-label" key={provider}>
              <div className="inline-control">
                <input
                  type="radio"
                  name="image-provider"
                  checked={draft.imageProvider === provider}
                  onChange={() => update("imageProvider", provider)}
                />
                <span>
                  {t(`aiSettings.imageProvider.${provider}.label`)}
                  <p className="muted-text">
                    {t(`aiSettings.imageProvider.${provider}.hint`)}
                  </p>
                </span>
              </div>
            </label>
          ))}

          {draft.imageProvider === "openai-api" ? (
            <label className="field-label narrow">
              {t("aiSettings.openaiImageModel")}
              <input
                value={draft.openaiImageModel}
                onChange={(event) => update("openaiImageModel", event.target.value)}
                placeholder="gpt-image-1"
              />
            </label>
          ) : null}

          {draft.imageProvider === "local-sdwebui" ? (
            <label className="field-label narrow">
              {t("aiSettings.sdwebuiUrl")}
              <input
                value={draft.sdwebuiBaseUrl}
                onChange={(event) => update("sdwebuiBaseUrl", event.target.value)}
                placeholder="http://127.0.0.1:7860"
              />
            </label>
          ) : null}

          {draft.imageProvider === "local-comfyui" ? (
            <>
              <label className="field-label narrow">
                {t("aiSettings.comfyuiUrl")}
                <input
                  value={draft.comfyuiBaseUrl}
                  onChange={(event) => update("comfyuiBaseUrl", event.target.value)}
                  placeholder="http://127.0.0.1:8188"
                />
              </label>
              <label className="field-label">
                {t("aiSettings.comfyuiWorkflow")}
                <textarea
                  rows={8}
                  value={draft.comfyuiWorkflowJson}
                  onChange={(event) =>
                    update("comfyuiWorkflowJson", event.target.value)
                  }
                  placeholder={t("aiSettings.comfyuiWorkflowPlaceholder")}
                />
              </label>
              <p className="help-text">
                {t("aiSettings.comfyuiHelp", {
                  prompt: "{PROMPT}",
                  negative: "{NEGATIVE}",
                  seed: "{SEED}"
                })}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("aiSettings.keysEyebrow")}</p>
            <h2>{t("aiSettings.keysHeading")}</h2>
          </div>
          <KeyRound size={18} aria-hidden="true" />
        </div>
        <div className="provider-body">
          <Field label={t("aiSettings.openaiApiKey")}>
            <input
              type="password"
              value={draft.openaiApiKey}
              onChange={(event) => update("openaiApiKey", event.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </Field>
          <Field label={t("aiSettings.anthropicApiKey")}>
            <input
              type="password"
              value={draft.anthropicApiKey}
              onChange={(event) => update("anthropicApiKey", event.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
          </Field>
          <p className="help-text">{t("aiSettings.keysHelp")}</p>
        </div>
      </div>

      <Field
        label={t("aiSettings.timeoutLabel")}
        className="field-label-narrow"
      >
        <input
          type="number"
          min={30}
          max={600}
          step={30}
          value={timeoutSeconds}
          onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
        />
      </Field>

      <Field
        label={t("aiSettings.plnRateLabel")}
        className="field-label-narrow"
      >
        <input
          type="number"
          min={0}
          step={0.1}
          value={draft.plnPerUsd}
          onChange={(event) => update("plnPerUsd", Number(event.target.value))}
          title={t("aiSettings.plnRateTitle")}
        />
      </Field>

      {missingKeyWarning ? (
        <p className="warning-text">{missingKeyWarning}</p>
      ) : null}

      {saveMutation.isError ? (
        <p className="warning-text">
          {t("aiSettings.saveError", { error: String(saveMutation.error) })}
        </p>
      ) : null}

      <div className="button-row">
        <Button
          variant="primary"
          busy={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
          disabled={settingsQuery.isLoading}
        >
          {saveMutation.isPending
            ? t("aiSettings.saving")
            : t("aiSettings.save")}
        </Button>
        {saved ? (
          <StatusPill tone="success">{t("aiSettings.saved")}</StatusPill>
        ) : null}
      </div>
    </section>
  );
}

function SubscriptionPill({
  available,
  loggedIn,
  loading
}: {
  available: boolean;
  loggedIn: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <StatusPill tone="muted">{t("aiSettings.pillChecking")}</StatusPill>;
  }
  if (!available) {
    return <StatusPill tone="danger">{t("aiSettings.pillNoCli")}</StatusPill>;
  }
  if (loggedIn) {
    return (
      <StatusPill tone="success">{t("aiSettings.pillLoggedIn")}</StatusPill>
    );
  }
  return <StatusPill tone="muted">{t("aiSettings.pillNeedsLogin")}</StatusPill>;
}
