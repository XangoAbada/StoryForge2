import { Check, Clock3, FileJson, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { coverImageSource } from "../../shared/api/assets";
import { isTauriRuntime } from "../../shared/api/browserDevCommands";
import {
  acceptGeneratedBookCover,
  acceptGeneratedCharacterImage,
  generateBookCover,
  generateCharacterImage,
  generateNewProjectTitle,
  getBookPlan,
  moveBeatToChapter,
  runCodexPrompt,
  saveStoryStructure,
  upsertAct,
  upsertBeat,
  upsertChapter,
  upsertCharacterMemory,
  upsertCharacterRelation,
  upsertChapterThreadRelation,
  upsertPlotThread,
  upsertWorldElement,
  upsertWorldRule,
  updateBookConcept
} from "../../shared/api/commands";
import type {
  BookConceptInput,
  CoverGenerationProgressEvent,
  UpsertCharacterMemoryInput,
  UpsertCharacterRelationInput,
  UpsertWorldElementInput,
  UpsertWorldRuleInput
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
import { applyPlanDraftField } from "./planDraftFieldTargets";
import { applyPlanProposalPayload } from "./planProposalApplication";
import {
  characterFieldConfigs,
  CharacterFieldKey
} from "./characterPromptPackage";
import { applyCharacterDraftField } from "./characterDraftFieldTargets";
import {
  worldFieldConfigs,
  WorldFieldKey
} from "./worldPromptPackage";
import { applyWorldDraftField } from "./worldDraftFieldTargets";
import {
  ActiveAiProposal,
  BOOK_COVER_FIELD,
  CHARACTER_IMAGE_FIELD,
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

      if (isCharacterImageProposal(proposal)) {
        const imagePath = (
          proposal.characterImagePath ||
          proposal.coverImagePath ||
          proposal.editableValue
        ).trim();
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const characterId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        if (!imagePath || !characterId || !proposal.coverPrompt || !proposal.characterGeneratedAt) {
          throw new Error("Brak kompletnej propozycji obrazu postaci do akceptacji.");
        }

        return acceptGeneratedCharacterImage({
          projectId: proposal.projectId,
          characterId,
          imagePath,
          imagePrompt: proposal.coverPrompt,
          negativePrompt: proposal.coverNegativePrompt ?? "",
          generatedAt: proposal.characterGeneratedAt
        });
      }

      if (proposal.scope === "bookPlan") {
        const plan = await getBookPlan(proposal.bookId);
        const payload = planPayloadFromEditableValue(proposal);
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const planField = proposal.field as PlanFieldKey;

        if (isBeatDraftField(planField) && isDraftAcceptance(scopedPackageContext)) {
          const targetEntityId =
            typeof scopedPackageContext.targetEntityId === "string"
              ? scopedPackageContext.targetEntityId
              : "";
          const value = planPayloadTextValue(payload);
          if (targetEntityId && applyPlanDraftField(targetEntityId, planField, value)) {
            return null;
          }

          if (!targetEntityId || targetEntityId.startsWith("draft-beat:")) {
            throw new Error(
              "Nie ma już otwartego formularza beatu dla tej propozycji AI."
            );
          }
        }

        await applyPlanProposalPayload(
          payload,
          planField,
          packageContext,
          {
            bookId: proposal.bookId,
            plan,
            saveStructure: saveStoryStructure,
            saveAct: upsertAct,
            saveBeat: upsertBeat,
            moveBeatToChapter,
            saveThread: upsertPlotThread,
            saveChapter: upsertChapter,
            saveChapterThreadRelation: upsertChapterThreadRelation
          }
        );
        return null;
      }

      if (proposal.scope === "characters") {
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const targetEntityId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        const value = proposal.editableValue.trim();
        if (
          targetEntityId &&
          applyCharacterDraftField(targetEntityId, proposal.field as CharacterFieldKey, value)
        ) {
          return null;
        }

        if (proposal.field === "characterRelation") {
          return upsertCharacterRelation(
            characterRelationInputFromProposal(proposal, scopedPackageContext)
          );
        }

        if (proposal.field === "characterMemory") {
          return upsertCharacterMemory(
            characterMemoryInputFromProposal(proposal, scopedPackageContext)
          );
        }

        throw new Error("Nie ma już otwartego formularza dla tej propozycji postaci.");
      }

      if (proposal.scope === "world") {
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const targetEntityId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        const value = proposal.editableValue.trim();
        if (
          targetEntityId &&
          applyWorldDraftField(targetEntityId, proposal.field as WorldFieldKey, value)
        ) {
          return null;
        }

        if (proposal.field === "worldElement") {
          return upsertWorldElement(worldElementInputFromProposal(proposal, scopedPackageContext));
        }

        if (proposal.field === "worldRule") {
          return upsertWorldRule(worldRuleInputFromProposal(proposal, scopedPackageContext));
        }

        if (proposal.field === "worldRuleAnalysis") {
          return null;
        }

        throw new Error("Nie ma już otwartego formularza dla tej propozycji świata.");
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
        await queryClient.invalidateQueries({ queryKey: ["character-workspace", projectId] });
        await queryClient.invalidateQueries({ queryKey: ["world-workspace", projectId] });
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
  const characterImageProposal = isCharacterImageProposal(proposal);
  const planProposal = proposal.scope === "bookPlan";
  const characterProposal = proposal.scope === "characters";
  const worldProposal = proposal.scope === "world";
  const label = coverProposal
    ? "Okładka"
    : planProposal
      ? planFieldConfigs[proposal.field as PlanFieldKey]?.label ?? "Plan"
        : characterImageProposal
          ? "Obraz postaci"
        : characterProposal
          ? characterFieldConfigs[proposal.field as CharacterFieldKey]?.label ?? "Postać"
          : worldProposal
            ? worldFieldConfigs[proposal.field as WorldFieldKey]?.label ?? "Świat"
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
    !characterProposal &&
    !worldProposal &&
    !planProposal &&
    (longConceptFields.includes(proposal.field as ConceptFieldKey) || structured)
      ? 8
      : 3;
  const canAccept = coverProposal
    ? Boolean((proposal.coverImagePath || proposal.editableValue).trim())
    : characterImageProposal
      ? Boolean((proposal.characterImagePath || proposal.coverImagePath || proposal.editableValue).trim())
    : planProposal
      ? proposal.editableValue.trim().length > 0
      : characterProposal
        ? proposal.editableValue.trim().length > 0
      : worldProposal
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
                  : characterProposal
                    ? "Postacie"
                    : worldProposal
                      ? "Świat"
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

      {(coverProposal || characterImageProposal) &&
      (proposal.partialImageDataUrl || proposal.coverImagePath || proposal.characterImagePath) ? (
        <button
          type="button"
          className="proposal-cover-preview proposal-cover-preview-button"
          onClick={() =>
            onPreview(
              coverImageSource(
                proposal.partialImageDataUrl ||
                  proposal.coverImagePath ||
                  proposal.characterImagePath
              ),
              "Podgląd okładki z AI"
            )
          }
          title="Otwórz okładkę w pełnym podglądzie"
        >
          <img
            src={coverImageSource(
              proposal.partialImageDataUrl ||
                proposal.coverImagePath ||
                proposal.characterImagePath
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

      {(coverProposal || characterImageProposal) && success ? (
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

      {success && !structured && !coverProposal && !characterImageProposal ? (
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

        if (isCharacterImageProposal(snapshot)) {
          updateProposalProgress(proposalId, {
            progressMessage: "Przygotowuję prompt obrazu postaci..."
          });

          if (!snapshot.coverPrompt || !snapshot.coverNegativePrompt) {
            throw new QueueRunError("Brak promptu obrazu postaci w zadaniu kolejki.");
          }

          const context =
            "context" in snapshot.promptPackageJson
              ? snapshot.promptPackageJson.context
              : {};
          const scopedContext =
            context && typeof context === "object"
              ? (context as Record<string, unknown>)
              : {};
          const characterId =
            typeof scopedContext.targetEntityId === "string"
              ? scopedContext.targetEntityId
              : "";
          if (!characterId) {
            throw new QueueRunError("Brak docelowej postaci dla obrazu.");
          }

          const result = await generateCharacterImage({
            projectId: snapshot.projectId,
            characterId,
            promptPackageId: snapshot.promptPackageId,
            promptPackageJson: snapshot.promptPackageJson,
            prompt: snapshot.prompt,
            imagePrompt: snapshot.coverPrompt,
            negativePrompt: snapshot.coverNegativePrompt,
            codexPath,
            timeoutSeconds,
            model,
            reasoningEffort
          });

          if (result.aiRun.status !== "success") {
            throw new QueueRunError(
              result.aiRun.errorMessage || "Nie udało się utworzyć obrazu postaci.",
              result.aiRun.rawOutput ?? ""
            );
          }

          finishProposal(proposalId, {
            aiRunId: result.aiRun.id,
            rawOutput: result.aiRun.rawOutput ?? "",
            editableValue: result.imagePath,
            durationMs: result.aiRun.durationMs,
            coverImagePath: result.imagePath,
            characterImagePath: result.imagePath,
            characterGeneratedAt: result.generatedAt,
            progressMessage: "Obraz postaci gotowy do akceptacji.",
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
          snapshot.field as ConceptFieldKey | PlanFieldKey | CharacterFieldKey | WorldFieldKey,
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
  expectedField: ConceptFieldKey | PlanFieldKey | CharacterFieldKey | WorldFieldKey,
  action: string
): ParsedAiProposal {
  if (isPlanAction(action)) {
    return parsePlanSuggestion(rawOutput, expectedField as PlanFieldKey);
  }

  if (isCharacterAction(action)) {
    return parseCharacterSuggestion(rawOutput, expectedField as CharacterFieldKey);
  }

  if (isWorldAction(action)) {
    return parseWorldSuggestion(rawOutput, expectedField as WorldFieldKey);
  }

  if (action === "expand_premise") {
    return parsePremiseDevelopment(rawOutput);
  }

  return parseConceptFieldSuggestion(rawOutput, expectedField as ConceptFieldKey);
}

function parseCharacterSuggestion(
  rawOutput: string,
  expectedField: CharacterFieldKey
): ParsedAiProposal {
  const parsed = JSON.parse(rawOutput) as unknown;
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (expectedField === "characterProfile" && record.kind === "character_profile") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowa postać",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (expectedField === "characterRelation" && record.kind === "character_relation") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowa relacja",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (expectedField === "characterMemory" && record.kind === "character_memory") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowe wspomnienie",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (record.kind !== "character_field_suggestion") {
    throw new Error("AI zwróciło nieprawidłowy typ propozycji postaci.");
  }
  if (record.field !== expectedField) {
    throw new Error("AI zwróciło propozycję dla innego pola postaci.");
  }
  const rawValue = record.value;
  const textValue = Array.isArray(rawValue)
    ? JSON.stringify(rawValue.filter((item) => typeof item === "string"))
    : typeof rawValue === "string"
      ? rawValue
      : String(rawValue ?? "");

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja postaci",
    textValue,
    value: parsed,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function parseWorldSuggestion(
  rawOutput: string,
  expectedField: WorldFieldKey
): ParsedAiProposal {
  const parsed = JSON.parse(rawOutput) as unknown;
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  if (
    (expectedField === "worldElement" && record.kind === "world_element") ||
    (expectedField === "worldRule" && record.kind === "world_rule") ||
    (expectedField === "worldRuleAnalysis" && record.kind === "world_rule_analysis")
  ) {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string"
        ? record.summary
        : typeof record.ruleName === "string"
          ? record.ruleName
          : "Propozycja świata",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (record.kind !== "world_field_suggestion") {
    throw new Error("AI zwróciło nieprawidłowy typ propozycji świata.");
  }
  if (record.field !== expectedField) {
    throw new Error("AI zwróciło propozycję dla innego pola świata.");
  }

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja świata",
    textValue: typeof record.value === "string" ? record.value : String(record.value ?? ""),
    value: parsed,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function characterRelationInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertCharacterRelationInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const relation = recordValue(parsed.relation);
  const projectId = stringRecordValue(snapshot.projectId);
  const fromCharacterId = stringRecordValue(snapshot.fromCharacterId);
  const toCharacterId = stringRecordValue(snapshot.toCharacterId);

  if (!projectId || !fromCharacterId || !toCharacterId) {
    throw new Error("Brak danych postaci dla zapisu relacji AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-relation"),
    projectId,
    fromCharacterId,
    toCharacterId,
    relationType: stringRecordValue(relation.relationType, stringRecordValue(snapshot.relationType, "inne")),
    description: stringRecordValue(relation.description, stringRecordValue(snapshot.description)),
    history: stringRecordValue(relation.history, stringRecordValue(snapshot.history)),
    conflict: stringRecordValue(relation.conflict, stringRecordValue(snapshot.conflict)),
    opinion: stringRecordValue(relation.opinion, stringRecordValue(snapshot.opinion)),
    trustLevel: boundedNumberRecordValue(relation.trustLevel, boundedNumberRecordValue(snapshot.trustLevel, 50)),
    secret: stringRecordValue(relation.secret, stringRecordValue(snapshot.secret)),
    changeOverTime: stringRecordValue(relation.changeOverTime, stringRecordValue(snapshot.changeOverTime)),
    status: stringRecordValue(snapshot.status, "draft")
  };
}

function characterMemoryInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertCharacterMemoryInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const memory = recordValue(parsed.memory);
  const projectId = stringRecordValue(snapshot.projectId);
  const characterId = stringRecordValue(snapshot.characterId);

  if (!projectId || !characterId) {
    throw new Error("Brak danych postaci dla zapisu wspomnienia AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-memory"),
    projectId,
    characterId,
    title: stringRecordValue(memory.title, stringRecordValue(snapshot.title)),
    summary: stringRecordValue(memory.summary, stringRecordValue(snapshot.summary)),
    details: stringRecordValue(memory.details, stringRecordValue(snapshot.details)),
    memoryType: stringRecordValue(memory.memoryType, stringRecordValue(snapshot.memoryType, "wydarzenie")),
    subject: stringRecordValue(memory.subject, stringRecordValue(snapshot.subject)),
    emotion: stringRecordValue(memory.emotion, stringRecordValue(snapshot.emotion)),
    importance: boundedNumberRecordValue(memory.importance, boundedNumberRecordValue(snapshot.importance, 50)),
    status: stringRecordValue(snapshot.status, "draft")
  };
}

function worldElementInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertWorldElementInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const projectId = stringRecordValue(snapshot.projectId, proposal.projectId);

  if (!projectId) {
    throw new Error("Brak projektu dla zapisu elementu świata AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-world-element"),
    projectId,
    elementType: stringRecordValue(parsed.type, stringRecordValue(snapshot.elementType, "location")),
    name: stringRecordValue(parsed.name, stringRecordValue(snapshot.name, "Nowy element świata")),
    summary: stringRecordValue(parsed.summary, stringRecordValue(snapshot.summary)),
    details: stringRecordValue(parsed.details, stringRecordValue(snapshot.details)),
    storyPurpose: stringRecordValue(parsed.storyPurpose, stringRecordValue(snapshot.storyPurpose)),
    constraints: stringRecordValue(parsed.constraints, stringRecordValue(snapshot.constraints)),
    visualPrompt: stringRecordValue(parsed.visualPrompt, stringRecordValue(snapshot.visualPrompt)),
    imageAssetId: stringRecordValue(snapshot.imageAssetId) || null,
    status: stringRecordValue(snapshot.status, "draft"),
    orderIndex: boundedNumberRecordValue(snapshot.orderIndex, 0)
  };
}

function worldRuleInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertWorldRuleInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const projectId = stringRecordValue(snapshot.projectId, proposal.projectId);

  if (!projectId) {
    throw new Error("Brak projektu dla zapisu reguły świata AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-world-rule"),
    projectId,
    name: stringRecordValue(parsed.name, stringRecordValue(snapshot.name, "Nowa reguła świata")),
    description: stringRecordValue(parsed.description, stringRecordValue(snapshot.description)),
    scope: stringRecordValue(parsed.scope, stringRecordValue(snapshot.scope)),
    cost: stringRecordValue(parsed.cost, stringRecordValue(snapshot.cost)),
    limitation: stringRecordValue(parsed.limitation, stringRecordValue(snapshot.limitation)),
    exceptions: stringRecordValue(parsed.exceptions, stringRecordValue(snapshot.exceptions)),
    violationConsequences: stringRecordValue(parsed.violationConsequences, stringRecordValue(snapshot.violationConsequences)),
    sceneExamples: stringRecordValue(parsed.sceneExamples, stringRecordValue(snapshot.sceneExamples)),
    status: stringRecordValue(snapshot.status, "draft"),
    orderIndex: boundedNumberRecordValue(snapshot.orderIndex, 0)
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringRecordValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStringRecordValue(value: unknown, ignoredValue: string): string | undefined {
  const parsed = stringRecordValue(value);
  return parsed && parsed !== ignoredValue ? parsed : undefined;
}

function boundedNumberRecordValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
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
    "chapterTurningPoint",
    "beatName",
    "beatRole",
    "beatDescription",
    "threadDescription",
    "threadChapterDescription"
  ].includes(field);
}

function isPlanAction(action: string): boolean {
  return [
    "suggest_story_structure",
    "generate_acts",
    "generate_act_field",
    "generate_beat_sheet",
    "generate_beat_field",
    "generate_plot_threads",
    "generate_thread_chapter_field",
    "generate_chapter_plan",
    "generate_chapter_field",
    "suggest_chapter_relations",
    "find_plan_gaps"
  ].includes(action);
}

function isCharacterAction(action: string): boolean {
  return [
    "generate_character_field",
    "generate_character_relation_field",
    "generate_character_memory_field"
  ].includes(action);
}

function isWorldAction(action: string): boolean {
  return [
    "generate_world_element_field",
    "generate_world_rule_field",
    "generate_world_rule_analysis"
  ].includes(action);
}

function isBeatDraftField(field: PlanFieldKey): boolean {
  return ["beatName", "beatRole", "beatDescription"].includes(field);
}

function planPayloadTextValue(payload: unknown): string {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  return typeof record.value === "string" ? record.value : "";
}

function isDraftAcceptance(packageContext: Record<string, unknown>): boolean {
  const snapshot = packageContext.targetEntitySnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false;
  }

  return (snapshot as Record<string, unknown>).draftAcceptance === true;
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

function isCharacterImageProposal(
  proposal: Pick<ActiveAiProposal, "field" | "scope">
): boolean {
  return proposal.scope === "characters" && proposal.field === CHARACTER_IMAGE_FIELD;
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
