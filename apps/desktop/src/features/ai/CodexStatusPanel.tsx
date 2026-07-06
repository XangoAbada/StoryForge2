import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Terminal
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkCodexCli, listCodexModels } from "../../shared/api/commands";
import { REASONING_LEVELS } from "../../shared/api/types";
import type { ReasoningEffort } from "../../shared/api/types";
import { useCodexSettingsStore } from "./codexSettingsStore";
import { Button } from "../../shared/ui";

type CodexStatusPanelProps = {
  compact?: boolean;
};

const reasoningLevels = REASONING_LEVELS;

export function CodexStatusPanel({ compact = false }: CodexStatusPanelProps) {
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const setCodexPath = useCodexSettingsStore((state) => state.setCodexPath);
  const model = useCodexSettingsStore((state) => state.model);
  const setModel = useCodexSettingsStore((state) => state.setModel);
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );
  const setReasoningEffort = useCodexSettingsStore(
    (state) => state.setReasoningEffort
  );
  const [draftPath, setDraftPath] = useState(codexPath);
  const [open, setOpen] = useState(!compact);

  const statusQuery = useQuery({
    queryKey: ["codex-cli", codexPath],
    queryFn: () => checkCodexCli(codexPath),
    retry: 0
  });

  const modelQuery = useQuery({
    queryKey: ["codex-models", codexPath],
    queryFn: () => listCodexModels(codexPath),
    retry: 0
  });

  const status = statusQuery.data;
  const unavailable = statusQuery.isError || status?.available === false;
  const ready = status?.available === true;

  useEffect(() => {
    if (!compact) {
      setOpen(true);
      return;
    }

    if (ready) {
      setOpen(false);
    }

    if (unavailable) {
      setOpen(true);
    }
  }, [compact, ready, unavailable]);

  const modelOptions = useMemo(() => {
    const catalogModels = modelQuery.data?.models ?? [];
    const options = [
      ...catalogModels.map((item) => {
        const rawItem = item as typeof item & { display_name?: string };
        return {
          value: item.slug,
          label: item.displayName || rawItem.display_name || item.slug,
          title: item.description || item.slug
        };
      }),
      {
        value: model,
        label: model,
        title: "Aktualnie wybrany model"
      },
      {
        value: "gpt-5.5",
        label: "GPT-5.5",
        title: "Fallback, gdy katalog modeli jest niedostępny"
      }
    ];
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
  }, [model, modelQuery.data?.models]);

  function handleCheck() {
    const nextPath = draftPath.trim() || "codex";
    setCodexPath(nextPath);
    void queryClient.invalidateQueries({ queryKey: ["codex-cli", nextPath] });
    void queryClient.invalidateQueries({ queryKey: ["codex-models", nextPath] });
  }

  function updateReasoning(index: number) {
    setReasoningEffort(reasoningLevels[index]?.value ?? "medium");
  }

  const sectionClass = compact
    ? "context-section compact provider-panel"
    : "settings-panel provider-panel";
  const reasoningIndex = Math.max(
    0,
    reasoningLevels.findIndex((level) => level.value === reasoningEffort)
  );

  return (
    <details
      className={sectionClass}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="provider-summary-row">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Dostawca AI</p>
            <h2>{compact ? "Codex CLI" : "Status Codex CLI"}</h2>
            <p className="muted-text provider-subtitle">
              {model} / {reasoningLabel(reasoningEffort)}
            </p>
          </div>
          <span
            className={
              ready
                ? "status-pill ready"
                : unavailable
                  ? "status-pill muted"
                  : "status-pill"
            }
          >
            {ready ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {ready ? "Gotowy" : statusQuery.isLoading ? "Sprawdzam" : "Konfiguracja"}
          </span>
        </div>
        <ChevronDown size={16} className="provider-chevron" aria-hidden="true" />
      </summary>

      <div className="provider-body">
        <label className="field-label">
          Ścieżka do binarki
          <div className="inline-control">
            <Terminal size={16} aria-hidden="true" />
            <input
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder="codex"
              title="Komenda lub ścieżka do Codex CLI, np. codex albo pełna ścieżka do binarki."
            />
            <Button
              variant="icon"
              onClick={handleCheck}
              title="Sprawdź Codex CLI i odśwież katalog modeli"
              aria-label="Sprawdź Codex CLI"
            >
              <RefreshCw size={16} />
            </Button>
          </div>
        </label>

        <label className="field-label">
          Model
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            title="Model używany przez codex exec przy generowaniu treści pól."
          >
            {modelOptions.map((option) => (
              <option value={option.value} key={option.value} title={option.title}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Stopień rozumowania
          <div className="reasoning-control">
            <input
              type="range"
              min={0}
              max={reasoningLevels.length - 1}
              step={1}
              value={reasoningIndex}
              onChange={(event) => updateReasoning(Number(event.target.value))}
              title={reasoningLevels[reasoningIndex]?.hint}
            />
            <div className="reasoning-labels" aria-hidden="true">
              {reasoningLevels.map((level) => (
                <span
                  key={level.value}
                  className={level.value === reasoningEffort ? "active" : ""}
                  title={level.hint}
                >
                  {level.label}
                </span>
              ))}
            </div>
          </div>
        </label>

        {status?.version ? (
          <p className="muted-text">Wersja: {status.version}</p>
        ) : null}

        {modelQuery.data?.fallback ? (
          <p className="muted-text">{modelQuery.data.errorMessage}</p>
        ) : null}

        {statusQuery.isError ? (
          <p className="warning-text">
            Backend Tauri nie jest dostępny w tym widoku albo komenda nie mogła
            zostać wykonana.
          </p>
        ) : null}

        {status?.message ? <p className="muted-text">{status.message}</p> : null}

        {!compact && unavailable ? (
          <p className="help-text">
            Uruchom `codex` w terminalu i zaloguj się oficjalną metodą Codex CLI.
            StoryForge2 nie zapisuje tokenów ani danych logowania.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function reasoningLabel(reasoningEffort: ReasoningEffort): string {
  return (
    reasoningLevels.find((level) => level.value === reasoningEffort)?.label ??
    "Medium"
  );
}
