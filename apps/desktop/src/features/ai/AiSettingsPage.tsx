import {
  ExternalLink,
  KeyRound,
  RefreshCw,
  SlidersHorizontal,
  Terminal
} from "lucide-react";
import { useEffect, useState } from "react";
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
  TextProviderId
} from "../../shared/api/types";
import { DEFAULT_AI_SETTINGS } from "../../shared/api/types";
import { Button, Field, StatusPill } from "../../shared/ui";
import { CodexStatusPanel } from "./CodexStatusPanel";
import { useCodexSettingsStore } from "./codexSettingsStore";

const CLAUDE_MODELS = [
  { value: "sonnet", label: "Sonnet (zalecany)" },
  { value: "opus", label: "Opus (najmocniejszy)" },
  { value: "haiku", label: "Haiku (najszybszy)" }
];

const OPENAI_TEXT_MODELS = ["gpt-5.5", "gpt-5", "gpt-4.1"];

const ANTHROPIC_MODELS = [
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (zalecany)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
];

const TEXT_PROVIDERS: Array<{ value: TextProviderId; label: string; hint: string }> = [
  {
    value: "codex-cli",
    label: "Codex CLI (subskrypcja OpenAI)",
    hint: "Obecne domyślne. Wymaga zalogowanego Codex CLI."
  },
  {
    value: "claude-cli",
    label: "Claude Code CLI (subskrypcja Anthropic)",
    hint: "Wymaga zainstalowanego i zalogowanego Claude Code CLI."
  },
  {
    value: "openai-api",
    label: "OpenAI API (klucz)",
    hint: "Bezpośrednie wywołania API — rozliczane za tokeny."
  },
  {
    value: "anthropic-api",
    label: "Anthropic API (klucz)",
    hint: "Bezpośrednie wywołania API — rozliczane za tokeny."
  }
];

const IMAGE_PROVIDERS: Array<{ value: ImageProviderId; label: string; hint: string }> = [
  {
    value: "codex-cli",
    label: "Codex CLI (subskrypcja OpenAI)",
    hint: "Obecne domyślne — generowanie przez narzędzie image_generation."
  },
  {
    value: "openai-api",
    label: "OpenAI Images API (klucz)",
    hint: "gpt-image-1 przez klucz API."
  },
  {
    value: "local-sdwebui",
    label: "Lokalny SD WebUI / A1111",
    hint: "Wymaga uruchomionego WebUI z flagą --api."
  },
  {
    value: "local-comfyui",
    label: "Lokalny ComfyUI",
    hint: "Wymaga wklejenia workflow w formacie API."
  }
];

export function AiSettingsPage() {
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const setTimeoutSeconds = useCodexSettingsStore(
    (state) => state.setTimeoutSeconds
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
      ? "Wybrano dostawcę OpenAI API, ale nie podano klucza OpenAI."
      : draft.textProvider === "anthropic-api" && !draft.anthropicApiKey.trim()
        ? "Wybrano dostawcę Anthropic API, ale nie podano klucza Anthropic."
        : null;

  const codexAvailable = codexCliQuery.data?.available === true;
  const codexLoggedIn = codexLoginQuery.data?.authLikelyReady === true;
  const claudeAvailable = claudeQuery.data?.available === true;
  const claudeLoggedIn = claudeQuery.data?.authLikelyReady === true;

  return (
    <section className="content-panel settings-content">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Ustawienia</p>
          <h2>Dostawcy AI</h2>
        </div>
        <SlidersHorizontal size={20} aria-hidden="true" />
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Subskrypcje</p>
            <h2>Aktywne konta</h2>
          </div>
        </div>

        <div className="provider-body">
          <div className="section-title-row">
            <div>
              <strong>OpenAI (Codex CLI)</strong>
              <p className="muted-text">
                {codexLoginQuery.data?.message ??
                  codexCliQuery.data?.message ??
                  "Sprawdzam status..."}
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
              title="Uruchamia `codex login` — logowanie otworzy się w przeglądarce."
            >
              <ExternalLink size={14} aria-hidden="true" /> Zaloguj przez Codex CLI
            </Button>
            <Button
              variant="icon"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["codex-login"] });
                void queryClient.invalidateQueries({ queryKey: ["codex-cli"] });
              }}
              title="Odśwież status subskrypcji OpenAI"
              aria-label="Odśwież status subskrypcji OpenAI"
            >
              <RefreshCw size={16} />
            </Button>
          </div>

          <div className="section-title-row">
            <div>
              <strong>Anthropic (Claude Code CLI)</strong>
              <p className="muted-text">
                {claudeQuery.data?.message ?? "Sprawdzam status..."}
              </p>
            </div>
            <SubscriptionPill
              available={claudeAvailable}
              loggedIn={claudeLoggedIn}
              loading={claudeQuery.isLoading}
            />
          </div>
          <Field label="Ścieżka do Claude Code CLI">
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
                title="Sprawdź Claude Code CLI"
                aria-label="Sprawdź Claude Code CLI"
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
              title="Otwiera terminal z Claude Code CLI — wpisz /login, aby zalogować się subskrypcją."
            >
              <ExternalLink size={14} aria-hidden="true" /> Otwórz terminal logowania
            </Button>
          </div>
          <p className="help-text">
            Status logowania Anthropic to heurystyka (na podstawie plików logowania
            Claude Code CLI). Po zalogowaniu w terminalu odśwież status.
          </p>
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Generowanie tekstu</p>
            <h2>Dostawca treści</h2>
          </div>
        </div>
        <div className="provider-body">
          {TEXT_PROVIDERS.map((provider) => (
            <label className="field-label" key={provider.value}>
              <div className="inline-control">
                <input
                  type="radio"
                  name="text-provider"
                  checked={draft.textProvider === provider.value}
                  onChange={() => update("textProvider", provider.value)}
                />
                <span>
                  {provider.label}
                  <p className="muted-text">{provider.hint}</p>
                </span>
              </div>
            </label>
          ))}

          {draft.textProvider === "codex-cli" ? <CodexStatusPanel compact /> : null}

          {draft.textProvider === "claude-cli" ? (
            <label className="field-label narrow">
              Model Claude
              <select
                value={draft.claudeModel}
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
              Model OpenAI
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
              Model Anthropic
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
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Generowanie obrazów</p>
            <h2>Dostawca grafik</h2>
          </div>
        </div>
        <div className="provider-body">
          {IMAGE_PROVIDERS.map((provider) => (
            <label className="field-label" key={provider.value}>
              <div className="inline-control">
                <input
                  type="radio"
                  name="image-provider"
                  checked={draft.imageProvider === provider.value}
                  onChange={() => update("imageProvider", provider.value)}
                />
                <span>
                  {provider.label}
                  <p className="muted-text">{provider.hint}</p>
                </span>
              </div>
            </label>
          ))}

          {draft.imageProvider === "openai-api" ? (
            <label className="field-label narrow">
              Model obrazów OpenAI
              <input
                value={draft.openaiImageModel}
                onChange={(event) => update("openaiImageModel", event.target.value)}
                placeholder="gpt-image-1"
              />
            </label>
          ) : null}

          {draft.imageProvider === "local-sdwebui" ? (
            <label className="field-label narrow">
              Adres SD WebUI
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
                Adres ComfyUI
                <input
                  value={draft.comfyuiBaseUrl}
                  onChange={(event) => update("comfyuiBaseUrl", event.target.value)}
                  placeholder="http://127.0.0.1:8188"
                />
              </label>
              <label className="field-label">
                Workflow ComfyUI (format API)
                <textarea
                  rows={8}
                  value={draft.comfyuiWorkflowJson}
                  onChange={(event) =>
                    update("comfyuiWorkflowJson", event.target.value)
                  }
                  placeholder='Wklej JSON wyeksportowany przez "Save (API Format)"'
                />
              </label>
              <p className="help-text">
                W workflow użyj placeholderów {"{PROMPT}"}, {"{NEGATIVE}"} i{" "}
                {"{SEED}"} w polach tekstu pozytywnego, negatywnego i seeda. Eksport:
                ComfyUI → Save (API Format).
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="settings-panel provider-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Klucze API</p>
            <h2>Uwierzytelnianie API</h2>
          </div>
          <KeyRound size={18} aria-hidden="true" />
        </div>
        <div className="provider-body">
          <Field label="Klucz OpenAI API">
            <input
              type="password"
              value={draft.openaiApiKey}
              onChange={(event) => update("openaiApiKey", event.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </Field>
          <Field label="Klucz Anthropic API">
            <input
              type="password"
              value={draft.anthropicApiKey}
              onChange={(event) => update("anthropicApiKey", event.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
          </Field>
          <p className="help-text">
            Klucze są zapisywane lokalnie w pliku ustawień aplikacji i wysyłane
            wyłącznie do wybranego dostawcy.
          </p>
        </div>
      </div>

      <Field label="Timeout generowania (sekundy)" className="field-label-narrow">
        <input
          type="number"
          min={30}
          max={600}
          step={30}
          value={timeoutSeconds}
          onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
        />
      </Field>

      {missingKeyWarning ? (
        <p className="warning-text">{missingKeyWarning}</p>
      ) : null}

      {saveMutation.isError ? (
        <p className="warning-text">
          Nie udało się zapisać ustawień: {String(saveMutation.error)}
        </p>
      ) : null}

      <div className="button-row">
        <Button
          variant="primary"
          busy={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
          disabled={settingsQuery.isLoading}
        >
          {saveMutation.isPending ? "Zapisywanie..." : "Zapisz ustawienia"}
        </Button>
        {saved ? <StatusPill tone="success">Zapisano</StatusPill> : null}
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
  if (loading) {
    return <StatusPill tone="muted">Sprawdzam</StatusPill>;
  }
  if (!available) {
    return <StatusPill tone="danger">Brak CLI</StatusPill>;
  }
  if (loggedIn) {
    return <StatusPill tone="success">Zalogowano</StatusPill>;
  }
  return <StatusPill tone="muted">Wymaga logowania</StatusPill>;
}
