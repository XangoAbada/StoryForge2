import { Check, Clock3, FileJson, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { coverImageSource } from "../../shared/api/assets";
import { isTauriRuntime } from "../../shared/api/browserDevCommands";
import {
  acceptGeneratedBookCover,
  generateBookCover,
  generateNewProjectTitle,
  getBookPlan,
  runCodexPrompt,
  saveStoryStructure,
  upsertAct,
  upsertBeat,
  upsertChapter,
  upsertPlotThread,
  updateBookConcept
} from "../../shared/api/commands";
import type {
  BookConceptInput,
  CoverGenerationProgressEvent
} from "../../shared/api/types";
import { parseConceptFieldSuggestion } from "./conceptFieldSuggestion";
import { useCodexSettingsStore } from "./codexSettingsStore";
import { parsePremiseDevelopment } from "./premiseDevelopment";
import {
  conceptFieldConfigs,
  ConceptFieldKey,
  longConceptFields
} from "./promptPackage";
import { planFieldConfigs, PlanFieldKey } from "./planPromptPackage";
import { applyPlanProposalPayload } from "./planProposalApplication";
import {
  ActiveAiProposal,
  BOOK_COVER_FIELD,
  ParsedAiProposal,
  useProposalStore
} from "./proposalStore";
import { CoverImageLightbox } from "./CoverImageLightbox";

type AiProposalPanelProps = {
  projectId: string;
  onAcceptValue?: (value: string) => void | Promise<void>;
};

export function AiProposalPanel({
  projectId,
  onAcceptValue
}: AiProposalPanelProps) {
  useAiQueueRunner();
  useCoverGenerationProgressListener();

  const queryClient = useQueryClient();
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const proposals = useProposalStore((state) => state.proposals);
  const setEditableValue = useProposalStore((state) => state.setEditableValue);
  const setEditableField = useProposalStore((state) => state.setEditableField);
  const toggleSelectedField = useProposalStore((state) => state.toggleSelectedField);
  const clearProposal = useProposalStore((state) => state.clearProposal);
  const retryProposal = useProposalStore((state) => state.retryProposal);
  const visibleProposals = proposals
    .filter((proposal) => proposal.projectId === projectId)
    .sort(compareProposalsForPanel);

  const acceptMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      const proposal = useProposalStore
        .getState()
        .proposals.find((item) => item.id === proposalId);

      if (!proposal || proposal.status !== "success") {
        return null;
      }

      if (proposal.scope === "newProject") {
        const value = proposal.editableValue.trim();
        if (!onAcceptValue) {
          throw new Error("Brak obslugi akceptacji propozycji nowego projektu.");
        }

        await onAcceptValue(value);
        return null;
      }

      if (isBookCoverProposal(proposal)) {
        const imagePath = (proposal.coverImagePath || proposal.editableValue).trim();
        if (!imagePath || !proposal.coverPrompt || !proposal.coverGeneratedAt) {
          throw new Error("Brak kompletnej propozycji okładki do akceptacji.");
        }

        return acceptGeneratedBookCover({
          bookId: proposal.bookId,
          imagePath,
          coverPrompt: proposal.coverPrompt,
          coverNegativePrompt: proposal.coverNegativePrompt ?? "",
          generatedAt: proposal.coverGeneratedAt
        });
      }

      if (proposal.scope === "bookPlan") {
        const plan = await getBookPlan(proposal.bookId);
        const payload = planPayloadFromEditableValue(proposal);
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};

        await applyPlanProposalPayload(
          payload,
          proposal.field as PlanFieldKey,
          packageContext,
          {
            bookId: proposal.bookId,
            plan,
            saveStructure: saveStoryStructure,
            saveAct: upsertAct,
            saveBeat: upsertBeat,
            saveThread: upsertPlotThread,
            saveChapter: upsertChapter
          }
        );
        return null;
      }

      if (isPremiseDevelopment(proposal.parsed)) {
        const input = proposalInputFromFields(
          proposal.editableFields,
          proposal.selectedFields
        );
        return updateBookConcept(proposal.bookId, input);
      }

      const value = proposal.editableValue.trim();
      return updateBookConcept(
        proposal.bookId,
        proposalInputFromValue(value, { field: proposal.field as ConceptFieldKey })
      );
    },
    onSuccess: async (_payload, proposalId) => {
      const proposal = useProposalStore
        .getState()
        .proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        return;
      }

      clearProposal(proposalId);
      if (proposal.scope !== "newProject") {
        await queryClient.invalidateQueries({ queryKey: ["book-plan", proposal.bookId] });
        await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
    }
  });

  if (visibleProposals.length === 0) {
    return (
      <section className="context-section compact">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Propozycje</p>
            <h2>Panel AI</h2>
          </div>
          <FileJson size={18} aria-hidden="true" />
        </div>
        <p className="muted-text">
          Wyniki AI pojawią się tutaj od razu po kliknięciu przycisku pola.
        </p>
      </section>
    );
  }

  return (
    <section className="context-section compact proposal-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Codex CLI</p>
          <h2>Kolejka AI</h2>
        </div>
        <span className="status-pill">
          <Clock3 size={14} aria-hidden="true" />
          {visibleProposals.length}
        </span>
      </div>

      <div className="proposal-queue-list">
        {visibleProposals.map((proposal) => (
          <ProposalQueueItem
            key={proposal.id}
            proposal={proposal}
            accepting={acceptMutation.isPending && acceptMutation.variables === proposal.id}
            retrying={proposal.status === "queued"}
            onAccept={() => acceptMutation.mutate(proposal.id)}
            onClear={() => clearProposal(proposal.id)}
            onRetry={() => retryProposal(proposal.id)}
            onPreview={(src, alt) => setPreviewImage({ src, alt })}
            onEditableValueChange={(value) => setEditableValue(proposal.id, value)}
            onEditableFieldChange={(field, value) =>
              setEditableField(proposal.id, field, value)
            }
            onToggleField={(field) => toggleSelectedField(proposal.id, field)}
          />
        ))}
      </div>

      {acceptMutation.isError ? (
        <p className="warning-text">Nie udało się zapisać propozycji.</p>
      ) : null}

      <CoverImageLightbox
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </section>
  );
}

type ProposalQueueItemProps = {
  proposal: ActiveAiProposal;
  accepting: boolean;
  retrying: boolean;
  onAccept: () => void;
  onClear: () => void;
  onRetry: () => void;
  onPreview: (src: string, alt: string) => void;
  onEditableValueChange: (value: string) => void;
  onEditableFieldChange: (field: ConceptFieldKey, value: string) => void;
  onToggleField: (field: ConceptFieldKey) => void;
};

function ProposalQueueItem({
  proposal,
  accepting,
  retrying,
  onAccept,
  onClear,
  onRetry,
  onPreview,
  onEditableValueChange,
  onEditableFieldChange,
  onToggleField
}: ProposalQueueItemProps) {
  const coverProposal = isBookCoverProposal(proposal);
  const planProposal = proposal.scope === "bookPlan";
  const label = coverProposal
    ? "Okładka"
    : planProposal
      ? planFieldConfigs[proposal.field as PlanFieldKey]?.label ?? "Plan"
      : conceptFieldConfigs[proposal.field as ConceptFieldKey].label;
  const running = proposal.status === "running";
  const queued = proposal.status === "queued";
  const success = proposal.status === "success";
  const error = proposal.status === "error";
  const premiseProposal = isPremiseDevelopment(proposal.parsed)
    ? proposal.parsed
    : null;
  const structured = premiseProposal !== null;
  const proposalRows =
    !coverProposal &&
    !planProposal &&
    (longConceptFields.includes(proposal.field as ConceptFieldKey) || structured)
      ? 8
      : 3;
  const canAccept = coverProposal
    ? Boolean((proposal.coverImagePath || proposal.editableValue).trim())
    : planProposal
      ? proposal.editableValue.trim().length > 0
      : structured
        ? hasSelectedEditableField(proposal)
        : proposal.editableValue.trim().length > 0;

  return (
    <article className={`proposal-queue-item ${proposal.status}`}>
      <div className="proposal-queue-heading">
        <div>
          <p className="eyebrow">
            {coverProposal
              ? "Okładka"
              : proposal.scope === "newProject"
                ? "Nowy projekt"
                : planProposal
                  ? "Plan"
                  : "Pole"}
          </p>
          <h3>{label}</h3>
        </div>
        <span className={statusClassName(proposal.status)}>
          {running ? <Loader2 size={14} className="spin-icon" /> : null}
          {statusLabel(proposal.status)}
        </span>
      </div>

      {proposal.parsed?.summary ? (
        <p className="muted-text">{proposal.parsed.summary}</p>
      ) : null}

      {queued ? (
        <p className="muted-text">
          Zadanie czeka, aż poprzednia generacja w kolejce się zakończy.
        </p>
      ) : null}

      {running ? (
        <p className="muted-text">
          {coverProposal
            ? proposal.progressMessage ?? "Codex CLI generuje okładkę."
            : "Codex CLI generuje wynik. Propozycja nie zapisze się bez akceptacji."}
        </p>
      ) : null}

      {coverProposal && proposal.progressMessage && !running ? (
        <p className="muted-text">{proposal.progressMessage}</p>
      ) : null}

      {coverProposal && (proposal.partialImageDataUrl || proposal.coverImagePath) ? (
        <button
          type="button"
          className="proposal-cover-preview proposal-cover-preview-button"
          onClick={() =>
            onPreview(
              coverImageSource(
                proposal.partialImageDataUrl || proposal.coverImagePath
              ),
              "Podgląd okładki z AI"
            )
          }
          title="Otwórz okładkę w pełnym podglądzie"
        >
          <img
            src={coverImageSource(
              proposal.partialImageDataUrl || proposal.coverImagePath
            )}
            alt="Podgląd okładki z AI"
          />
        </button>
      ) : null}

      {coverProposal && running ? (
        <div className="cover-progress active" role="status" aria-live="polite">
          <div className="cover-progress-track" aria-hidden="true">
            <span />
          </div>
        </div>
      ) : null}

      {coverProposal && success ? (
        <p className="success-text">
          Okładka jest gotowa do akceptacji.
        </p>
      ) : null}

      {success && premiseProposal ? (
        <div className="proposal-field-list">
          {premiseProposal.fieldValues.map((item) => {
            const selected = proposal.selectedFields[item.field] !== false;
            const rows = longConceptFields.includes(item.field) ? 5 : 3;
            return (
              <div className="proposal-field-item" key={item.field}>
                <label className="proposal-field-toggle">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleField(item.field)}
                  />
                  <span>{item.label}</span>
                </label>
                <textarea
                  aria-label={`Edytuj ${item.label}`}
                  value={proposal.editableFields[item.field] ?? item.value}
                  onChange={(event) =>
                    onEditableFieldChange(item.field, event.target.value)
                  }
                  rows={rows}
                  disabled={!selected}
                  title={`Możesz poprawić propozycję dla pola ${item.label} przed zapisem.`}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {success && !structured && !coverProposal ? (
        <label className="field-label">
          {planProposal
            ? "Propozycja do zastosowania w widoku Plan"
            : "Propozycja do akceptacji"}
          <textarea
            value={proposal.editableValue}
            onChange={(event) => onEditableValueChange(event.target.value)}
            rows={planProposal ? 8 : proposalRows}
            title={`Możesz poprawić propozycję dla pola ${label} przed zapisem.`}
          />
        </label>
      ) : null}

      {planProposal && success ? (
        <p className="muted-text">
          Akceptacja zapisze tylko zakres tego widoku planu. Pozostałe sekcje z
          odpowiedzi AI zostaną pominięte.
        </p>
      ) : null}

      {proposal.parsed && "rationale" in proposal.parsed && proposal.parsed.rationale ? (
        <p className="muted-text">{proposal.parsed.rationale}</p>
      ) : null}

      {proposal.errorMessage ? (
        <p className="warning-text">{proposal.errorMessage}</p>
      ) : null}

      {proposal.parsed && proposal.parsed.warnings.length > 0 ? (
        <div className="warning-box">
          {proposal.parsed.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {premiseProposal && premiseProposal.questionsForAuthor.length > 0 ? (
        <details className="raw-output">
          <summary>Pytania dla autora</summary>
          <ul>
            {premiseProposal.questionsForAuthor.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {proposal.rawOutput ? (
        <details className="raw-output">
          <summary>Surowy wynik</summary>
          <pre>{proposal.rawOutput}</pre>
        </details>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          onClick={onAccept}
          disabled={accepting || running || queued || error || !canAccept}
        >
          <Check size={16} />
          {accepting ? "Zapisuję" : "Akceptuj"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={onClear}
          disabled={accepting || running}
        >
          <X size={16} />
          Odrzuć
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={onRetry}
          disabled={running || queued || accepting || retrying}
          title="Ponownie uruchom ten sam prompt z zapisanym snapshotem kontekstu."
        >
          <RotateCcw size={16} />
          Ponów
        </button>
      </div>
    </article>
  );
}

function useAiQueueRunner() {
  const queuedProposal = useProposalStore((state) =>
    state.proposals.find((proposal) => proposal.status === "queued")
  );
  const hasRunningProposal = useProposalStore((state) =>
    state.proposals.some((proposal) => proposal.status === "running")
  );
  const startQueuedProposal = useProposalStore((state) => state.startQueuedProposal);
  const finishProposal = useProposalStore((state) => state.finishProposal);
  const failProposal = useProposalStore((state) => state.failProposal);
  const updateProposalProgress = useProposalStore(
    (state) => state.updateProposalProgress
  );
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const model = useCodexSettingsStore((state) => state.model);
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );

  useEffect(() => {
    if (!queuedProposal || hasRunningProposal) {
      return;
    }

    const proposalId = queuedProposal.id;
    startQueuedProposal(proposalId);

    async function runQueuedProposal() {
      const snapshot = useProposalStore
        .getState()
        .proposals.find((proposal) => proposal.id === proposalId);
      if (!snapshot) {
        return;
      }

      try {
        if (isBookCoverProposal(snapshot)) {
          updateProposalProgress(proposalId, {
            progressMessage: "Przygotowuję prompt okładki..."
          });

          if (!snapshot.coverPrompt || !snapshot.coverNegativePrompt) {
            throw new QueueRunError("Brak promptu okładki w zadaniu kolejki.");
          }

          const result = await generateBookCover({
            projectId: snapshot.projectId,
            bookId: snapshot.bookId,
            promptPackageId: snapshot.promptPackageId,
            promptPackageJson: snapshot.promptPackageJson,
            prompt: snapshot.prompt,
            coverPrompt: snapshot.coverPrompt,
            coverNegativePrompt: snapshot.coverNegativePrompt,
            codexPath,
            timeoutSeconds,
            model,
            reasoningEffort
          });

          if (result.aiRun.status !== "success") {
            throw new QueueRunError(
              result.aiRun.errorMessage || "Nie udało się utworzyć okładki.",
              result.aiRun.rawOutput ?? ""
            );
          }

          finishProposal(proposalId, {
            aiRunId: result.aiRun.id,
            rawOutput: result.aiRun.rawOutput ?? "",
            editableValue: result.imagePath,
            durationMs: result.aiRun.durationMs,
            coverImagePath: result.imagePath,
            coverGeneratedAt: result.generatedAt,
            progressMessage: "Okładka gotowa do akceptacji.",
            progress: 100,
            partialImageDataUrl: null
          });
          return;
        }

        const result =
          snapshot.scope === "newProject"
            ? await generateNewProjectTitle({
                action: "generate_working_title",
                promptPackageId: snapshot.promptPackageId,
                promptPackageJson: snapshot.promptPackageJson,
                prompt: snapshot.prompt,
                codexPath,
                timeoutSeconds,
                model,
                reasoningEffort
              })
            : await runCodexPrompt({
                projectId: snapshot.projectId,
                action: snapshot.action,
                promptPackageId: snapshot.promptPackageId,
                promptPackageJson: snapshot.promptPackageJson,
                prompt: snapshot.prompt,
                codexPath,
                timeoutSeconds,
                model,
                reasoningEffort
              });

        if (result.status !== "success" || !result.rawOutput) {
          throw new QueueRunError(
            result.errorMessage || "Codex CLI nie zwrócił wyniku.",
            result.rawOutput ?? ""
          );
        }

        const parsed = parseProposalResult(
          result.rawOutput,
          snapshot.field as ConceptFieldKey,
          snapshot.action
        );
        finishProposal(proposalId, {
          aiRunId: result.id,
          rawOutput: result.rawOutput ?? "",
          parsed,
          editableValue: parsed.textValue,
          editableFields: editableFieldsFromParsed(parsed),
          selectedFields: selectedFieldsFromParsed(parsed),
          durationMs: result.durationMs
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rawOutput = error instanceof QueueRunError ? error.rawOutput : "";
        failProposal(proposalId, message, rawOutput);
      }
    }

    void runQueuedProposal();
  }, [
    queuedProposal?.id,
    hasRunningProposal,
    startQueuedProposal,
    finishProposal,
    failProposal,
    updateProposalProgress,
    codexPath,
    timeoutSeconds,
    model,
    reasoningEffort
  ]);
}

function useCoverGenerationProgressListener() {
  const updateProposalProgress = useProposalStore(
    (state) => state.updateProposalProgress
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<CoverGenerationProgressEvent>(
      "cover-generation-progress",
      (event) => {
        const payload = event.payload;
        const proposal = useProposalStore
          .getState()
          .proposals.find(
            (item) =>
              isBookCoverProposal(item) &&
              item.projectId === payload.projectId &&
              item.bookId === payload.bookId &&
              (item.status === "running" ||
                item.status === "queued" ||
                item.aiRunId === payload.aiRunId)
          );

        if (!proposal) {
          return;
        }

        updateProposalProgress(proposal.id, {
          progressMessage: payload.message,
          progress: payload.progress ?? null,
          ...(payload.partialImageDataUrl
            ? { partialImageDataUrl: payload.partialImageDataUrl }
            : {})
        });
      }
    );

    return () => {
      cancelled = true;
      unlistenPromise
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          }
        })
        .catch(() => undefined);
    };
  }, [updateProposalProgress]);
}

export function parseProposalResult(
  rawOutput: string,
  expectedField: ConceptFieldKey,
  action: string
): ParsedAiProposal {
  if (isPlanAction(action)) {
    return parsePlanSuggestion(rawOutput, expectedField as PlanFieldKey);
  }

  if (action === "expand_premise") {
    return parsePremiseDevelopment(rawOutput);
  }

  return parseConceptFieldSuggestion(rawOutput, expectedField);
}

function parsePlanSuggestion(
  rawOutput: string,
  expectedField: PlanFieldKey
): ParsedAiProposal {
  const parsed = JSON.parse(rawOutput) as unknown;
  const value =
    parsed && typeof parsed === "object"
      ? parsed
      : {
          version: 1,
          kind: "book_plan_suggestion",
          value: String(parsed ?? "")
        };
  const record = value as {
    structure?: unknown;
    summary?: unknown;
    value?: unknown;
    warnings?: unknown;
  };
  const textValue = planProposalTextValue(value, expectedField);

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja planu",
    textValue,
    value,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function planProposalTextValue(value: unknown, field: PlanFieldKey): string {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  if (isPlanTextField(field) && typeof record.value === "string") {
    return record.value;
  }

  if (field === "storyStructure" && record.structure && typeof record.structure === "object") {
    const structure = record.structure as Record<string, unknown>;
    if (typeof structure.structureType === "string") {
      return structure.structureType;
    }
  }

  return JSON.stringify(value, null, 2);
}

function planPayloadFromEditableValue(proposal: ActiveAiProposal): unknown {
  const field = proposal.field as PlanFieldKey;
  const editableValue = proposal.editableValue.trim();

  if (isPlanTextField(field)) {
    return {
      version: 1,
      kind: "book_plan_suggestion",
      field,
      value: editableValue
    };
  }

  if (field === "storyStructure" && !editableValue.startsWith("{")) {
    return {
      version: 1,
      kind: "book_plan_suggestion",
      field,
      structure: {
        structureType: editableValue
      }
    };
  }

  return JSON.parse(editableValue || proposal.rawOutput);
}

function isPlanTextField(field: PlanFieldKey): boolean {
  return [
    "storyStructureDescription",
    "storyStructureNotes",
    "actPurpose",
    "actSummary",
    "chapterSummary",
    "chapterPurpose",
    "chapterConflict",
    "chapterTurningPoint"
  ].includes(field);
}

function isPlanAction(action: string): boolean {
  return [
    "suggest_story_structure",
    "generate_acts",
    "generate_act_field",
    "generate_beat_sheet",
    "generate_plot_threads",
    "generate_chapter_plan",
    "generate_chapter_field",
    "suggest_chapter_relations",
    "find_plan_gaps"
  ].includes(action);
}

export function editableFieldsFromParsed(
  parsed: ParsedAiProposal
): Partial<Record<ConceptFieldKey, string>> {
  if (!isPremiseDevelopment(parsed)) {
    return {};
  }

  return Object.fromEntries(
    parsed.fieldValues.map((item) => [item.field, item.value])
  ) as Partial<Record<ConceptFieldKey, string>>;
}

export function selectedFieldsFromParsed(
  parsed: ParsedAiProposal
): Partial<Record<ConceptFieldKey, boolean>> {
  if (!isPremiseDevelopment(parsed)) {
    return {};
  }

  return Object.fromEntries(
    parsed.fieldValues.map((item) => [item.field, true])
  ) as Partial<Record<ConceptFieldKey, boolean>>;
}

export function proposalInputFromValue(
  value: string,
  proposal: { field: ConceptFieldKey }
): BookConceptInput {
  return proposalInputForField(proposal.field, value);
}

export function proposalInputFromFields(
  editableFields: Partial<Record<ConceptFieldKey, string>>,
  selectedFields: Partial<Record<ConceptFieldKey, boolean>>
): BookConceptInput {
  const input: BookConceptInput = {};

  for (const [field, selected] of Object.entries(selectedFields)) {
    if (!selected) {
      continue;
    }

    Object.assign(
      input,
      proposalInputForField(
        field as ConceptFieldKey,
        editableFields[field as ConceptFieldKey] ?? ""
      )
    );
  }

  if (Object.keys(input).length === 0) {
    throw new Error("Wybierz co najmniej jedno pole do zapisania.");
  }

  return input;
}

function proposalInputForField(
  field: ConceptFieldKey,
  value: string
): BookConceptInput {
  switch (field) {
    case "title":
      return { title: value };
    case "workingTitle":
      return { workingTitle: value };
    case "premise":
      return { premise: value };
    case "protagonistSummary":
      return { protagonistSummary: value };
    case "protagonistGoal":
      return { protagonistGoal: value };
    case "expandedPremise":
      return { expandedPremise: value };
    case "logline":
      return { logline: value };
    case "centralConflict":
      return { centralConflict: value };
    case "antagonistForce":
      return { antagonistForce: value };
    case "stakes":
      return { stakes: value };
    case "settingSketch":
      return { settingSketch: value };
    case "endingDirection":
      return { endingDirection: value };
    case "genre":
      return { genre: value };
    case "subgenre":
      return { subgenre: value };
    case "targetAudience":
      return { targetAudience: value };
    case "tone":
      return { tone: value };
    case "pointOfView":
      return { pointOfView: value };
    case "targetWordCount":
      return { targetWordCount: parseTargetWordCount(value) };
    case "themesJson":
      return { themesJson: serializeListValue(value) };
    case "unwantedThemes":
      return { unwantedThemes: value };
    case "alternativeTitlesJson":
      return { alternativeTitlesJson: serializeListValue(value) };
    case "styleGuide":
      return { styleGuide: value };
  }
}

function isPremiseDevelopment(
  parsed: ParsedAiProposal | undefined
): parsed is Extract<ParsedAiProposal, { kind: "premise_development" }> {
  return parsed?.kind === "premise_development";
}

function isBookCoverProposal(
  proposal: Pick<ActiveAiProposal, "field" | "scope">
): boolean {
  return proposal.scope === "bookCover" || proposal.field === BOOK_COVER_FIELD;
}

function hasSelectedEditableField(proposal: ActiveAiProposal): boolean {
  return Object.entries(proposal.selectedFields).some(([field, selected]) => {
    const value = proposal.editableFields[field as ConceptFieldKey] ?? "";
    return selected && value.trim().length > 0;
  });
}

function parseTargetWordCount(value: string): number | null {
  const normalized = value.replace(/\s+/g, "");
  const match = normalized.match(/\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function serializeListValue(value: string): string {
  const items = value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return JSON.stringify([...new Set(items)]);
}

function statusLabel(status: ActiveAiProposal["status"]): string {
  switch (status) {
    case "queued":
      return "W kolejce";
    case "running":
      return "Generuje";
    case "success":
      return "Gotowe";
    case "error":
      return "Błąd";
  }
}

function statusClassName(status: ActiveAiProposal["status"]): string {
  if (status === "success") {
    return "status-pill ready";
  }

  if (status === "error") {
    return "status-pill muted";
  }

  return "status-pill";
}

function compareProposalsForPanel(
  left: ActiveAiProposal,
  right: ActiveAiProposal
): number {
  const statusDiff = statusRank(left.status) - statusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function statusRank(status: ActiveAiProposal["status"]): number {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "success":
      return 2;
    case "error":
      return 3;
  }
}

class QueueRunError extends Error {
  rawOutput: string;

  constructor(message: string, rawOutput = "") {
    super(message);
    this.name = "QueueRunError";
    this.rawOutput = rawOutput;
  }
}
