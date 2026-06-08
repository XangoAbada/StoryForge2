import { FileJson, History, Loader2 } from "lucide-react";
import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAiRuns } from "../../shared/api/commands";
import type { AiLogEntry } from "../../shared/api/types";
import { formatLocalDateTime } from "../../shared/date";
import { conceptFieldConfigs, ConceptFieldKey } from "./promptPackage";
import { planFieldConfigs, PlanFieldKey } from "./planPromptPackage";
import { extractJsonCandidate } from "./titleSuggestions";

type AiLogPageProps = {
  projectId: string;
};

export function AiLogPage({ projectId }: AiLogPageProps) {
  const logQuery = useQuery({
    queryKey: ["ai-runs", projectId],
    queryFn: () => listAiRuns(projectId),
    retry: 0
  });

  return (
    <section className="content-panel ai-log-page">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">AI</p>
          <h2>Log promptów i odpowiedzi</h2>
        </div>
        <History size={20} aria-hidden="true" />
      </div>

      {logQuery.isLoading ? (
        <p className="muted-text ai-log-loading">
          <Loader2 size={15} className="spin-icon" />
          Ładuję log AI...
        </p>
      ) : null}

      {logQuery.isError ? (
        <div className="empty-state">
          <h3>Nie można wczytać loga AI</h3>
          <p>Sprawdź, czy backend Tauri ma dostęp do lokalnej bazy SQLite.</p>
        </div>
      ) : null}

      {logQuery.data?.length === 0 ? (
        <div className="empty-state">
          <FileJson size={24} aria-hidden="true" />
          <h3>Brak wpisów</h3>
          <p>Prompt i odpowiedź pojawią się tutaj po pierwszej generacji AI w projekcie.</p>
        </div>
      ) : null}

      <div className="ai-log-list">
        {logQuery.data?.map((entry) => (
          <AiLogEntryDetails entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}

function AiLogEntryDetails({ entry }: { entry: AiLogEntry }) {
  const summary = requestSummary(entry);

  return (
    <details className="ai-log-entry">
      <summary>
        <span>
          <strong>{summary.title}</strong>
          <small>{formatLocalDateTime(entry.createdAt)}</small>
        </span>
        <span className={entry.status === "success" ? "status-pill ready" : "status-pill muted"}>
          {entry.status}
        </span>
      </summary>

      <div className="ai-log-entry-body">
        <section className="ai-log-readable-block">
          <h3>Request</h3>
          <dl className="ai-log-meta">
            <div>
              <dt>Akcja</dt>
              <dd>{entry.action}</dd>
            </div>
            {summary.fieldLabel ? (
              <div>
                <dt>Pole</dt>
                <dd>{summary.fieldLabel}</dd>
              </div>
            ) : null}
            {summary.mode ? (
              <div>
                <dt>Tryb</dt>
                <dd>{summary.mode === "expand" ? "Rozwijanie" : "Generowanie"}</dd>
              </div>
            ) : null}
            <div>
              <dt>Provider</dt>
              <dd>{entry.providerId}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{entry.model?.trim() || "Nie zapisano"}</dd>
            </div>
            <div>
              <dt>Reasoning</dt>
              <dd>{reasoningLabel(entry.reasoningEffort)}</dd>
            </div>
          </dl>
          <div className="ai-log-prompt">
            <h4>Prompt</h4>
            <pre>{entry.prompt || "Brak zapisanego promptu dla starszego wpisu."}</pre>
          </div>
        </section>

        <section className="ai-log-readable-block">
          <h3>Response</h3>
          {entry.errorMessage ? (
            <p className="warning-text">{entry.errorMessage}</p>
          ) : null}
          <ReadableResponse rawOutput={entry.rawOutput} />
        </section>
      </div>
    </details>
  );
}

function ReadableResponse({ rawOutput }: { rawOutput?: string | null }) {
  if (!rawOutput?.trim()) {
    return <p className="muted-text">Brak odpowiedzi.</p>;
  }

  const parsed = parseResponse(rawOutput);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return <pre className="ai-log-text-response">{rawOutput}</pre>;
  }

  return (
    <dl className="ai-log-response-fields">
      {Object.entries(parsed).map(([key, value]) => (
        <div key={key}>
          <dt>{responseLabel(key)}</dt>
          <dd>{renderReadableValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function requestSummary(entry: AiLogEntry): {
  title: string;
  fieldLabel: string;
  mode: string;
} {
  const promptPackage = entry.promptPackageJson;
  if (!promptPackage || typeof promptPackage !== "object") {
    return { title: entry.action, fieldLabel: "", mode: "" };
  }

  const context = "context" in promptPackage ? promptPackage.context : undefined;
  const targetField =
    context && typeof context === "object" && "targetField" in context
      ? String(context.targetField)
      : "";
  const mode =
    context && typeof context === "object" && "generationMode" in context
      ? String(context.generationMode)
      : "";
  const fieldLabel = isConceptFieldKey(targetField)
    ? conceptFieldConfigs[targetField].label
    : isPlanFieldKey(targetField)
      ? planFieldConfigs[targetField].label
      : "";

  return {
    title: fieldLabel || entry.action,
    fieldLabel,
    mode
  };
}

function parseResponse(rawOutput: string): unknown {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function renderReadableValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="muted-text">Brak</span>;
    }

    return (
      <ul>
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>{renderReadableValue(item)}</li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === "object") {
    return (
      <dl className="ai-log-nested-fields">
        {Object.entries(value).map(([key, nestedValue]) => (
          <div key={key}>
            <dt>{responseLabel(key)}</dt>
            <dd>{renderReadableValue(nestedValue)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (typeof value === "boolean") {
    return value ? "Tak" : "Nie";
  }

  if (value === null || value === undefined || value === "") {
    return <span className="muted-text">Brak</span>;
  }

  return String(value);
}

function responseLabel(key: string): string {
  const labels: Record<string, string> = {
    version: "Wersja",
    kind: "Typ",
    field: "Pole",
    summary: "Podsumowanie",
    value: "Wartość",
    values: "Elementy",
    rationale: "Uzasadnienie",
    warnings: "Ostrzeżenia",
    imagePath: "Ścieżka obrazu",
    risks: "Ryzyka",
    questionsForAuthor: "Pytania dla autora"
  };

  return labels[key] ?? key;
}

function reasoningLabel(reasoningEffort?: string | null): string {
  const labels: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh"
  };
  const normalized = reasoningEffort?.trim();

  if (!normalized) {
    return "Nie zapisano";
  }

  return labels[normalized] ?? normalized;
}

function isConceptFieldKey(value: string): value is ConceptFieldKey {
  return value in conceptFieldConfigs;
}

function isPlanFieldKey(value: string): value is PlanFieldKey {
  return value in planFieldConfigs;
}
