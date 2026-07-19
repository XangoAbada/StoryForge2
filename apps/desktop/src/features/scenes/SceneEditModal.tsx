import {
  BookOpen,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Eye,
  GitBranch,
  Loader2,
  Map,
  MapPin,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Users,
  X
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Button, Field, Modal, StatusPill } from "../../shared/ui";
import type {
  Beat,
  BookPlan,
  Chapter,
  CharacterWorkspace,
  PlotThread,
  Scene,
  SetSceneRelationsInput,
  UpsertSceneInput,
  WorldWorkspace
} from "../../shared/api/types";
import {
  planFieldConfigs,
  type PlanFieldKey,
  planPromptContextSource
} from "../ai/planPromptPackage";
import {
  registerPlanDraftFieldTarget,
  unregisterPlanDraftFieldTarget
} from "../ai/planDraftFieldTargets";
import { useAiPromptContextStore } from "../ai/aiPromptContextStore";
import { useBrainstormField } from "../ai/useBrainstormField";
import { pendingProposalStatus, useProposalStore } from "../ai/proposalStore";

export type SceneModalState =
  | { mode: "create"; chapterId?: string | null }
  | { mode: "edit"; sceneId: string };

export type SceneRelationKind = "characters" | "threads" | "elements" | "rules";
export type ScenePromptEntity = Scene | Chapter;

type SceneEditModalProps = {
  state: SceneModalState | null;
  bookId: string;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  saving: boolean;
  selectedScene?: Scene | null;
  onClose: () => void;
  onSave: (
    input: UpsertSceneInput,
    relations: Omit<SetSceneRelationsInput, "bookId" | "sceneId">
  ) => void | Promise<void>;
  onDelete: (sceneId: string) => void;
  onGenerate: (
    field: PlanFieldKey,
    targetEntity?: ScenePromptEntity,
    draftOverride?: UpsertSceneInput
  ) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: ScenePromptEntity) => void;
  onLinkThreadToChapter?: (threadId: string, chapterId: string) => void | Promise<void>;
  /**
   * Zapisuje scenę do bazy i zwraca zapisaną encję. Wywoływane przed generacją
   * pola AI dla jeszcze niezapisanej sceny, żeby propozycja miała realny cel
   * (akceptacja z bocznego panelu zapisuje pole do bazy po zamknięciu modala).
   */
  onEnsureSaved?: (draft: UpsertSceneInput) => Promise<Scene>;
};

const sceneTextFields: Array<{
  field: PlanFieldKey;
  labelKey: string;
  key: "title" | "summary" | "goal" | "conflict" | "outcome";
  rows: number;
}> = [
  { field: "sceneTitle", labelKey: "scenes.fieldTitle", key: "title", rows: 1 },
  { field: "sceneSummary", labelKey: "scenes.fieldSummary", key: "summary", rows: 4 },
  { field: "sceneGoal", labelKey: "scenes.fieldGoal", key: "goal", rows: 2 },
  { field: "sceneConflict", labelKey: "scenes.fieldConflict", key: "conflict", rows: 2 },
  { field: "sceneOutcome", labelKey: "scenes.fieldOutcome", key: "outcome", rows: 2 }
];

const relationKinds: SceneRelationKind[] = ["characters", "threads", "elements", "rules"];

export function SceneEditModal({
  state,
  bookId,
  plan,
  characters,
  world,
  saving,
  selectedScene = null,
  onClose,
  onSave,
  onDelete,
  onGenerate,
  onActivatePrompt,
  onLinkThreadToChapter,
  onEnsureSaved
}: SceneEditModalProps) {
  const { t } = useTranslation();
  const scene =
    state?.mode === "edit"
      ? plan.scenes.find((item) => item.id === state.sceneId) ?? selectedScene ?? null
      : null;
  const [draft, setDraft] = useState<UpsertSceneInput>(() =>
    scene
      ? sceneToInput(scene)
      : newSceneInput(bookId, plan, state?.mode === "create" ? state.chapterId ?? null : null)
  );
  const [characterIds, setCharacterIds] = useState<string[]>(() =>
    scene ? sceneCharacterIds(plan, scene.id) : []
  );
  const [threadIds, setThreadIds] = useState<string[]>(() =>
    scene ? sceneThreadIds(plan, scene.id) : []
  );
  const [elementIds, setElementIds] = useState<string[]>(() =>
    scene ? sceneElementIds(plan, scene.id) : []
  );
  const [ruleIds, setRuleIds] = useState<string[]>(() =>
    scene ? sceneRuleIds(plan, scene.id) : []
  );
  const [draftTargetId, setDraftTargetId] = useState("");
  const [relationPicker, setRelationPicker] = useState<SceneRelationKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkThreadsToChapter, setLinkThreadsToChapter] = useState(false);

  useEffect(() => {
    if (!state) {
      return;
    }

    const current =
      state.mode === "edit"
        ? plan.scenes.find((item) => item.id === state.sceneId) ?? selectedScene ?? undefined
        : undefined;
    setDraft(
      current
        ? sceneToInput(current)
        : newSceneInput(bookId, plan, state.mode === "create" ? state.chapterId ?? null : null)
    );
    setCharacterIds(current ? sceneCharacterIds(plan, current.id) : []);
    setThreadIds(current ? sceneThreadIds(plan, current.id) : []);
    setElementIds(current ? sceneElementIds(plan, current.id) : []);
    setRuleIds(current ? sceneRuleIds(plan, current.id) : []);
    setDraftTargetId(
      current?.id ??
        `draft-scene:${state.mode === "create" ? state.chapterId ?? "none" : "none"}:${Date.now().toString(36)}`
    );
    setRelationPicker(null);
    setLinkThreadsToChapter(false);
  }, [bookId, plan, selectedScene, state]);

  useEffect(() => {
    if (!state || !draftTargetId) {
      return;
    }

    registerPlanDraftFieldTarget(draftTargetId, (field, value) => {
      setDraft((current) => applySceneDraftField(current, field, value));
    });
    return () => unregisterPlanDraftFieldTarget(draftTargetId);
  }, [draftTargetId, state]);

  const selectedChapter = draft.chapterId
    ? plan.chapters.find((chapter) => chapter.id === draft.chapterId) ?? null
    : null;
  const selectedPov = characters.characters.find((character) => character.id === draft.povCharacterId);
  const selectedLocation = world.elements.find((element) => element.id === draft.locationId);
  const selectedChapterThreadIds = selectedChapter
    ? chapterThreadIdsForChapter(plan, selectedChapter.id)
    : [];
  const selectedChapterBeatIds = selectedChapter
    ? chapterBeatIdsForChapter(plan, selectedChapter.id)
    : [];
  const inheritedThreadSuggestions = selectedChapterThreadIds.filter((id) => !threadIds.includes(id));
  const externalSceneThreadIds = selectedChapter
    ? threadIds.filter((id) => !selectedChapterThreadIds.includes(id))
    : [];
  const chapterBeats = selectedChapterBeatIds
    .map((id) => plan.beats.find((beat) => beat.id === id))
    .filter((beat): beat is Beat => Boolean(beat));
  const scenePromptEntity = draftTargetId ? sceneDraftPromptEntity(draft, draftTargetId) : undefined;
  const canSuggestRelations = Boolean(scene?.id && scenePromptEntity);
  const completedItems = [
    { label: t("scenes.completeTitle"), complete: Boolean(draft.title.trim()) },
    { label: t("scenes.completeSummary"), complete: Boolean(draft.summary.trim()) },
    { label: t("scenes.completeGoal"), complete: Boolean(draft.goal.trim()) },
    { label: t("scenes.completeConflict"), complete: Boolean(draft.conflict.trim()) },
    { label: t("scenes.completeOutcome"), complete: Boolean(draft.outcome.trim()) },
    { label: t("scenes.completePov"), complete: Boolean(draft.povCharacterId) },
    { label: t("scenes.completeLocation"), complete: Boolean(draft.locationId) },
    { label: t("scenes.completeCharacters"), complete: characterIds.length > 0 },
    { label: t("scenes.completeThreads"), complete: threadIds.length > 0 }
  ];
  const completedCount = completedItems.filter((item) => item.complete).length;
  const completionPercent = Math.round((completedCount / completedItems.length) * 100);
  const visualStatus =
    completionPercent >= 85
      ? t("scenes.visualStatusReady")
      : completionPercent >= 45
        ? t("scenes.visualStatusInProgress")
        : t("scenes.visualStatusDraft");
  const isSaving = saving || submitting;
  const modalTitle = scene ? draft.title || t("scenes.modalTitleEdit") : t("scenes.modalTitleNew");

  function currentRelationIds(kind: SceneRelationKind): string[] {
    if (kind === "characters") return characterIds;
    if (kind === "threads") return threadIds;
    if (kind === "elements") return elementIds;
    return ruleIds;
  }

  function setCurrentRelationIds(kind: SceneRelationKind, ids: string[]) {
    if (kind === "characters") setCharacterIds(ids);
    if (kind === "threads") setThreadIds(ids);
    if (kind === "elements") setElementIds(ids);
    if (kind === "rules") setRuleIds(ids);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (selectedChapter && linkThreadsToChapter && onLinkThreadToChapter) {
        for (const threadId of externalSceneThreadIds) {
          await onLinkThreadToChapter(threadId, selectedChapter.id);
        }
      }

      await onSave(draft, { characterIds, threadIds, elementIds, ruleIds });
    } finally {
      setSubmitting(false);
    }
  }

  // Dla niezapisanej sceny zapisz ją najpierw, żeby generacja pola AI miała
  // realny cel — inaczej akceptacja propozycji (po zamknięciu modala) nie ma
  // czego zaktualizować w bazie.
  async function ensureSceneSavedEntity(): Promise<ScenePromptEntity | undefined> {
    if (!scenePromptEntity) {
      return undefined;
    }
    if (draft.id || !onEnsureSaved) {
      return scenePromptEntity;
    }
    const saved = await onEnsureSaved(draft);
    setDraft((current) => ({ ...current, id: saved.id }));
    setDraftTargetId(saved.id);
    return saved;
  }

  async function generateSceneField(field: PlanFieldKey) {
    const entity = await ensureSceneSavedEntity();
    if (!entity) {
      return;
    }
    onGenerate(field, entity, { ...draft, id: entity.id });
  }

  if (!state) {
    return null;
  }

  return (
    <Modal
      title={modalTitle}
      onClose={onClose}
      size="xl"
      footer={
        <>
          {scene ? (
            <Button
              variant="danger"
              onClick={() => onDelete(scene.id)}
              disabled={isSaving}
            >
              <Trash2 size={15} aria-hidden />
              {t("scenes.deleteButton")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("scenes.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="scene-edit-form"
            busy={isSaving}
            disabled={!bookId}
          >
            {isSaving ? t("scenes.saving") : t("scenes.saveScene")}
          </Button>
        </>
      }
    >
      <form id="scene-edit-form" className="chapter-edit-form scene-edit-form" onSubmit={submit}>
        <div className="chapter-edit-metrics" aria-label={t("scenes.modalMetricsAria")}>
              <span className="chapter-edit-metric">
                <BookOpen size={16} />
                <span>{t("scenes.metricChapter")}</span>
                <strong>
                  {selectedChapter
                    ? `${dynamicChapterNumber(plan, selectedChapter.id)}. ${selectedChapter.workingTitle || t("scenes.untitled")}`
                    : t("scenes.noChapter")}
                </strong>
              </span>
              <span className="chapter-edit-metric">
                <Eye size={16} />
                <span>{t("scenes.metricPov")}</span>
                <strong>{selectedPov?.name ?? t("scenes.none")}</strong>
              </span>
              <span className="chapter-edit-metric">
                <Map size={16} />
                <span>{t("scenes.metricLocation")}</span>
                <strong>{selectedLocation?.name ?? t("scenes.none")}</strong>
              </span>
              <span className="chapter-edit-metric">
                <CheckCircle2 size={16} />
                <span>{t("scenes.metricCompleted")}</span>
                <strong>
                  {completedCount} / {completedItems.length}
                </strong>
              </span>
              <StatusPill
                tone={completionPercent >= 85 ? "success" : completionPercent >= 45 ? "accent" : "muted"}
              >
                {visualStatus}
              </StatusPill>
            </div>

            <div className="chapter-edit-content-grid scene-edit-content-grid">
              <main className="chapter-edit-main">
                <section className="chapter-edit-section">
                  <div className="chapter-section-heading">
                    <ClipboardList size={17} />
                    <h4>{t("scenes.sceneContentHeading")}</h4>
                  </div>
                  <div className="chapter-field-stack">
                    {sceneTextFields.map((item) => (
                      <SceneTextField
                        key={item.field}
                        field={item.field}
                        label={t(item.labelKey)}
                        value={String(draft[item.key] ?? "")}
                        targetEntity={scenePromptEntity}
                        rows={item.rows}
                        onChange={(value) => setDraft({ ...draft, [item.key]: value })}
                        onGenerate={() => void generateSceneField(item.field)}
                        onActivatePrompt={() => onActivatePrompt(item.field, scenePromptEntity)}
                      />
                    ))}
                  </div>
                </section>

                <section className="chapter-edit-section scene-settings-section">
                  <div className="chapter-section-heading">
                    <Target size={17} />
                    <h4>{t("scenes.sceneSettingsHeading")}</h4>
                  </div>
                  <div className="scene-settings-grid">
                    <Field label={t("scenes.fieldChapter")}>
                      <select
                        value={draft.chapterId ?? ""}
                        onChange={(event) => {
                          setDraft({ ...draft, chapterId: event.target.value || null });
                          setLinkThreadsToChapter(false);
                        }}
                      >
                        <option value="">{t("scenes.noChapter")}</option>
                        {orderedChaptersForPlan(plan).map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {t("scenes.chapterOption", {
                              number: dynamicChapterNumber(plan, chapter.id),
                              title: chapter.workingTitle || t("scenes.untitled")
                            })}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("scenes.fieldPov")}>
                      <select
                        value={draft.povCharacterId ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, povCharacterId: event.target.value || null })
                        }
                      >
                        <option value="">{t("scenes.none")}</option>
                        {characters.characters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("scenes.fieldLocation")}>
                      <select
                        value={draft.locationId ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, locationId: event.target.value || null })
                        }
                      >
                        <option value="">{t("scenes.none")}</option>
                        {world.elements.map((element) => (
                          <option key={element.id} value={element.id}>
                            {element.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("scenes.fieldTimeMarker")}>
                      <input
                        type="text"
                        placeholder={t("scenes.timeMarkerPlaceholder")}
                        value={draft.timeMarker ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, timeMarker: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("scenes.fieldWordTarget")}>
                      <input
                        type="number"
                        min={0}
                        value={draft.targetWordCount ?? ""}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            targetWordCount: parseOptionalPositiveInt(event.target.value)
                          })
                        }
                      />
                    </Field>
                    <Field label={t("scenes.fieldStatus")}>
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          setDraft({ ...draft, status: event.target.value as Scene["status"] })
                        }
                      >
                        <option value="planned">{t("scenes.statusPlanned")}</option>
                        <option value="draft">{t("scenes.statusDraft")}</option>
                        <option value="written">{t("scenes.statusWritten")}</option>
                        <option value="revision">{t("scenes.statusRevision")}</option>
                      </select>
                    </Field>
                  </div>
                </section>
              </main>

              <aside className="chapter-edit-sidebar" aria-label={t("scenes.sceneRelationsAria")}>
                {selectedChapter ? (
                  <ChapterContextInheritance
                    plan={plan}
                    chapter={selectedChapter}
                    threadIds={threadIds}
                    inheritedThreadSuggestions={inheritedThreadSuggestions}
                    chapterBeats={chapterBeats}
                    canSuggestRelations={canSuggestRelations}
                    targetEntity={scenePromptEntity}
                    onUseThread={(threadId) =>
                      setThreadIds((current) => uniqueOrderedIds([...current, threadId]))
                    }
                    onGenerateRelations={() => {
                      if (scenePromptEntity) {
                        onGenerate("sceneRelationSuggestions", scenePromptEntity, draft);
                      }
                    }}
                    onActivateRelations={() => {
                      if (scenePromptEntity) {
                        onActivatePrompt("sceneRelationSuggestions", scenePromptEntity);
                      }
                    }}
                  />
                ) : null}

                {relationKinds.map((kind) => {
                  const relationTitle = t(sceneRelationTitleKey(kind));
                  return (
                  <SceneRelationSection
                    key={kind}
                    title={relationTitle}
                    kind={kind}
                    items={sceneRelationOptions(kind, plan, characters, world, t).filter((item) =>
                      currentRelationIds(kind).includes(item.id)
                    )}
                    emptyText={t("scenes.emptyRelation", { title: relationTitle.toLowerCase() })}
                    onOpenPicker={setRelationPicker}
                    onRemove={(id) =>
                      setCurrentRelationIds(
                        kind,
                        currentRelationIds(kind).filter((item) => item !== id)
                      )
                    }
                  />
                  );
                })}

                {selectedChapter && externalSceneThreadIds.length > 0 ? (
                  <label className="scene-thread-chapter-sync-option">
                    <input
                      type="checkbox"
                      checked={linkThreadsToChapter}
                      onChange={(event) => setLinkThreadsToChapter(event.target.checked)}
                    />
                    <span>{t("scenes.linkThreadsToChapter")}</span>
                  </label>
                ) : null}
              </aside>
            </div>

            {relationPicker ? (
              <SceneRelationPickerModal
                kind={relationPicker}
                plan={plan}
                characters={characters}
                world={world}
                selectedIds={currentRelationIds(relationPicker)}
                onClose={() => setRelationPicker(null)}
                onAdd={(ids) => {
                  setCurrentRelationIds(
                    relationPicker,
                    uniqueOrderedIds([...currentRelationIds(relationPicker), ...ids])
                  );
                  if (relationPicker === "threads" && selectedChapter) {
                    const hasExternalThread = ids.some(
                      (id) => !selectedChapterThreadIds.includes(id)
                    );
                    if (hasExternalThread) {
                      setLinkThreadsToChapter(false);
                    }
                  }
                  setRelationPicker(null);
                }}
              />
            ) : null}

      </form>
    </Modal>
  );
}

function ChapterContextInheritance({
  plan,
  chapter,
  inheritedThreadSuggestions,
  chapterBeats,
  canSuggestRelations,
  targetEntity,
  onUseThread,
  onGenerateRelations,
  onActivateRelations
}: {
  plan: BookPlan;
  chapter: Chapter;
  threadIds: string[];
  inheritedThreadSuggestions: string[];
  chapterBeats: Beat[];
  canSuggestRelations: boolean;
  targetEntity?: ScenePromptEntity;
  onUseThread: (threadId: string) => void;
  onGenerateRelations: () => void;
  onActivateRelations: () => void;
}) {
  const { t } = useTranslation();
  const chapterThreads = inheritedThreadSuggestions
    .map((id) => plan.threads.find((thread) => thread.id === id))
    .filter((thread): thread is PlotThread => Boolean(thread));

  return (
    <section className="chapter-side-section scene-side-section chapter-inheritance-section">
      <div className="chapter-side-heading">
        <BookOpen size={16} />
        <h4>{t("scenes.chapterContext")}</h4>
      </div>
      <div className="scene-inheritance-block">
        <span className="scene-inheritance-label">{t("scenes.threadsToUse")}</span>
        <div className="chapter-side-chip-list">
          {chapterThreads.length > 0 ? (
            chapterThreads.map((thread) => (
              <button
                type="button"
                className="chapter-side-chip scene-inherited-chip thread"
                key={thread.id}
                onClick={() => onUseThread(thread.id)}
                title={t("scenes.useThreadInScene", { name: thread.name })}
              >
                <Plus size={12} />
                {thread.name}
              </button>
            ))
          ) : (
            <span className="chapter-side-empty">{t("scenes.sceneUsesChapterThreads")}</span>
          )}
        </div>
      </div>
      <div className="scene-inheritance-block">
        <span className="scene-inheritance-label">{t("scenes.chapterBeats")}</span>
        <div className="chapter-side-chip-list">
          {chapterBeats.length > 0 ? (
            chapterBeats.map((beat) => (
              <span className="chapter-side-chip beat" key={beat.id} title={beatPreviewText(beat)}>
                {beat.name}
              </span>
            ))
          ) : (
            <span className="chapter-side-empty">{t("scenes.noBeatsInContract")}</span>
          )}
        </div>
      </div>
      {canSuggestRelations ? (
        <SceneFieldAiActions
          field="sceneRelationSuggestions"
          targetEntity={targetEntity}
          onGenerate={onGenerateRelations}
          onActivatePrompt={onActivateRelations}
        />
      ) : (
        <span className="chapter-side-empty">
          {t("scenes.saveSceneForRelations")}
        </span>
      )}
      <span className="scene-inheritance-footnote">
        {t("scenes.inheritanceFootnote", {
          number: dynamicChapterNumber(plan, chapter.id),
          title: chapter.workingTitle || t("scenes.untitled")
        })}
      </span>
    </section>
  );
}

function SceneTextField({
  field,
  label,
  value,
  targetEntity,
  rows,
  onChange,
  onGenerate,
  onActivatePrompt
}: {
  field: PlanFieldKey;
  label: string;
  value: string;
  targetEntity?: ScenePromptEntity;
  rows: number;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onActivatePrompt: () => void;
}) {
  const goToBrainstorm = useBrainstormField();
  return (
    <Field
      label={label}
      actions={
        <SceneFieldAiActions
          field={field}
          targetEntity={targetEntity}
          onGenerate={onGenerate}
          onBrainstorm={() =>
            goToBrainstorm({
              fieldLabel: label,
              entityName: (targetEntity as { title?: string; workingTitle?: string } | undefined)?.title,
              value
            })
          }
          onActivatePrompt={onActivatePrompt}
        />
      }
    >
      {rows === 1 ? (
        <input
          value={value}
          onFocus={onActivatePrompt}
          onClick={onActivatePrompt}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <textarea
          value={value}
          rows={rows}
          onFocus={onActivatePrompt}
          onClick={onActivatePrompt}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function SceneFieldAiActions({
  field,
  targetEntity,
  onGenerate,
  onBrainstorm,
  onActivatePrompt
}: {
  field: PlanFieldKey;
  targetEntity?: ScenePromptEntity;
  onGenerate: () => void;
  onBrainstorm?: () => void;
  onActivatePrompt: () => void;
}) {
  const { t } = useTranslation();
  const activeTargetId = useAiPromptContextStore((state) => state.activeTargetId);
  const activeTarget = useAiPromptContextStore((state) =>
    activeTargetId ? state.targets[activeTargetId] : null
  );
  const addContextSourceToActiveTarget = useAiPromptContextStore(
    (state) => state.addContextSourceToActiveTarget
  );
  const proposals = useProposalStore((state) => state.proposals);
  const targetEntityId = targetEntity ? targetEntity.id : undefined;
  const loading = pendingProposalStatus(proposals, {
    field,
    scope: "bookPlan",
    targetEntityId
  });
  const running = loading === "running";
  const queued = loading === "queued";
  const promptContextSource = planPromptContextSource(field, targetEntity);
  const fieldAlreadyInContext = Boolean(
    activeTarget?.sources.some(
      (source) => source.key === field || source.key === promptContextSource.key
    )
  );

  return (
    <span className="ai-field-actions plan-ai-actions">
      <button
        type="button"
        className="icon-button ai-field-button"
        onClick={onBrainstorm ?? onGenerate}
        disabled={queued || running || !targetEntity}
        title={t("scenes.generateFieldAiTitle", { field: planFieldConfigs[field].label })}
        aria-label={t("scenes.generateFieldAiTitle", { field: planFieldConfigs[field].label })}
      >
        {running ? (
          <Loader2 size={15} className="spin-icon" />
        ) : queued ? (
          <Clock3 size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        <span>{running ? t("scenes.generating") : queued ? t("scenes.queued") : t("scenes.aiButton")}</span>
      </button>
      <button
        type="button"
        className="icon-button ai-context-add-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          addContextSourceToActiveTarget(promptContextSource);
        }}
        disabled={!activeTarget || fieldAlreadyInContext}
        title={t("scenes.addFieldToContext")}
        aria-label={t("scenes.addFieldToContextAria", { field: planFieldConfigs[field].label })}
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

function SceneRelationSection({
  title,
  kind,
  items,
  emptyText,
  onOpenPicker,
  onRemove
}: {
  title: string;
  kind: SceneRelationKind;
  items: Array<{ id: string; label: string; description: string }>;
  emptyText: string;
  onOpenPicker: (kind: SceneRelationKind) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="chapter-side-section scene-side-section">
      <div className="chapter-side-heading">
        {sceneRelationIcon(kind)}
        <h4>{title}</h4>
      </div>
      <div className="chapter-side-chip-list">
        {items.length > 0 ? (
          items.map((item) => (
            <span
              className={`chapter-side-chip ${sceneRelationDotClass(kind)}`}
              key={item.id}
              title={item.description}
            >
              {item.label}
              <button
                type="button"
                className="chapter-side-chip-remove"
                onClick={() => onRemove(item.id)}
                aria-label={t("scenes.unlinkRelation", { label: item.label })}
                title={t("scenes.unlinkRelation", { label: item.label })}
              >
                -
              </button>
            </span>
          ))
        ) : (
          <span className="chapter-side-empty">{emptyText}</span>
        )}
      </div>
      <button
        type="button"
        className="icon-button chapter-relation-add-button"
        onClick={() => onOpenPicker(kind)}
        title={t("scenes.addRelation", { title: title.toLowerCase() })}
        aria-label={t("scenes.addSceneRelationAria", { title })}
      >
        <Plus size={15} />
      </button>
    </section>
  );
}

function SceneRelationPickerModal({
  kind,
  plan,
  characters,
  world,
  selectedIds,
  onClose,
  onAdd
}: {
  kind: SceneRelationKind;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  selectedIds: string[];
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const options = useMemo(
    () =>
      sceneRelationOptions(kind, plan, characters, world, t).filter(
        (item) => !selectedIds.includes(item.id)
      ),
    [characters, kind, plan, selectedIds, world, t]
  );
  const title = t("scenes.addRelation", { title: t(sceneRelationTitleKey(kind)).toLowerCase() });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const content = (
    <div
      className="world-relation-modal scene-relation-picker-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scene-relation-picker-title"
    >
      <button
        type="button"
        className="world-relation-backdrop"
        onClick={onClose}
        aria-label={t("scenes.closeRelationPicker")}
      />
      <div className="world-relation-shell">
        <header className="world-relation-header">
          <div>
            <p className="eyebrow">{t("scenes.sceneRelationsEyebrow")}</p>
            <h3 id="scene-relation-picker-title">{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <X size={17} />
          </button>
        </header>
        <div className="world-relation-list">
          {options.map((item) => {
            const checked = checkedIds.includes(item.id);
            return (
              <button
                type="button"
                key={item.id}
                className={checked ? "world-relation-option selected" : "world-relation-option"}
                onClick={() => setCheckedIds((current) => toggleId(current, item.id))}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            );
          })}
          {options.length === 0 ? (
            <p className="muted-text">{t("scenes.allAssignedToScene")}</p>
          ) : null}
        </div>
        <footer className="scene-relation-picker-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("scenes.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onAdd(checkedIds)}
            disabled={checkedIds.length === 0}
          >
            <Plus size={16} />
            {t("scenes.addSelected")}
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function newSceneInput(bookId: string, plan: BookPlan, chapterId: string | null): UpsertSceneInput {
  const chapter = chapterId ? plan.chapters.find((item) => item.id === chapterId) ?? null : null;
  const existingScenes = orderedScenesForChapter(plan, chapterId);
  const chapterTarget = chapter?.targetWordCount ?? null;
  const suggestedSceneTarget = chapterTarget
    ? Math.max(500, Math.round(chapterTarget / Math.max(existingScenes.length + 1, 2)))
    : 1200;

  return {
    bookId,
    chapterId,
    orderIndex: existingScenes.length,
    title: "Nowa scena",
    summary: "",
    goal: "",
    conflict: "",
    outcome: "",
    timeMarker: "",
    povCharacterId: null,
    locationId: null,
    targetWordCount: suggestedSceneTarget,
    actualWordCount: 0,
    manuscriptContent: "",
    status: "planned"
  };
}

function sceneToInput(scene: Scene): UpsertSceneInput {
  return {
    id: scene.id,
    bookId: scene.bookId,
    chapterId: scene.chapterId,
    orderIndex: scene.orderIndex,
    title: scene.title,
    summary: scene.summary,
    goal: scene.goal,
    conflict: scene.conflict,
    outcome: scene.outcome,
    timeMarker: scene.timeMarker,
    povCharacterId: scene.povCharacterId,
    locationId: scene.locationId,
    targetWordCount: scene.targetWordCount,
    actualWordCount: scene.actualWordCount,
    manuscriptContent: scene.manuscriptContent,
    status: scene.status
  };
}

function sceneDraftPromptEntity(draft: UpsertSceneInput, id: string): Scene {
  const now = new Date().toISOString();
  return {
    id,
    bookId: draft.bookId,
    planVersionId: "",
    chapterId: draft.chapterId ?? null,
    orderIndex: draft.orderIndex,
    title: draft.title,
    summary: draft.summary,
    goal: draft.goal,
    conflict: draft.conflict,
    outcome: draft.outcome,
    timeMarker: draft.timeMarker ?? "",
    povCharacterId: draft.povCharacterId ?? null,
    locationId: draft.locationId ?? null,
    targetWordCount: draft.targetWordCount ?? null,
    actualWordCount: draft.actualWordCount ?? null,
    manuscriptContent: draft.manuscriptContent ?? "",
    autoSummary: "",
    autoSummarySourceHash: "",
    isStyleReference: 0,
    status: draft.status,
    createdAt: now,
    updatedAt: now
  };
}

function applySceneDraftField(draft: UpsertSceneInput, field: PlanFieldKey, value: string): UpsertSceneInput {
  if (field === "sceneTitle") return { ...draft, title: value };
  if (field === "sceneSummary") return { ...draft, summary: value };
  if (field === "sceneGoal") return { ...draft, goal: value };
  if (field === "sceneConflict") return { ...draft, conflict: value };
  if (field === "sceneOutcome") return { ...draft, outcome: value };
  return draft;
}

function orderedScenesForChapter(plan: BookPlan, chapterId: string | null): Scene[] {
  return plan.scenes
    .filter((scene) => (scene.chapterId ?? null) === chapterId)
    .sort((left, right) => left.orderIndex - right.orderIndex || left.title.localeCompare(right.title, "pl-PL"));
}

function orderedChaptersForPlan(plan: BookPlan): Chapter[] {
  return [...plan.chapters].sort((left, right) => left.orderIndex - right.orderIndex || left.number - right.number);
}

function dynamicChapterNumber(plan: BookPlan, chapterId: string): number {
  return orderedChaptersForPlan(plan).findIndex((chapter) => chapter.id === chapterId) + 1 || 1;
}

function sceneCharacterIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneCharacters.filter((item) => item.sceneId === sceneId).map((item) => item.characterId);
}

function sceneThreadIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneThreads.filter((item) => item.sceneId === sceneId).map((item) => item.threadId);
}

function sceneElementIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneWorldElements.filter((item) => item.sceneId === sceneId).map((item) => item.elementId);
}

function sceneRuleIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneWorldRules.filter((item) => item.sceneId === sceneId).map((item) => item.ruleId);
}

function chapterThreadIdsForChapter(plan: BookPlan, chapterId: string): string[] {
  return plan.chapterThreads
    .filter((relation) => relation.chapterId === chapterId)
    .map((relation) => relation.threadId);
}

function chapterBeatIdsForChapter(plan: BookPlan, chapterId: string): string[] {
  return plan.chapterBeats
    .filter((relation) => relation.chapterId === chapterId)
    .map((relation) => relation.beatId);
}

function sceneRelationOptions(
  kind: SceneRelationKind,
  plan: BookPlan,
  characters: CharacterWorkspace,
  world: WorldWorkspace,
  t: (key: string) => string
): Array<{ id: string; label: string; description: string }> {
  if (kind === "characters") {
    return characters.characters.map((character) => ({
      id: character.id,
      label: character.name || t("scenes.characterNoName"),
      description: character.shortDescription || character.background || character.role || t("scenes.noCharacterDescription")
    }));
  }

  if (kind === "threads") {
    return plan.threads.map((thread) => ({
      id: thread.id,
      label: thread.name || t("scenes.threadNoName"),
      description: thread.description || thread.status || t("scenes.noThreadDescription")
    }));
  }

  if (kind === "elements") {
    return world.elements.map((element) => ({
      id: element.id,
      label: element.name || t("scenes.elementNoName"),
      description: element.summary || element.details || element.elementType || t("scenes.noElementDescription")
    }));
  }

  return world.rules.map((rule) => ({
    id: rule.id,
    label: rule.name || t("scenes.ruleNoName"),
    description: rule.description || t("scenes.noRuleDescription")
  }));
}

function sceneRelationTitleKey(kind: SceneRelationKind): string {
  if (kind === "characters") return "scenes.relationCharacters";
  if (kind === "threads") return "scenes.relationThreads";
  if (kind === "elements") return "scenes.relationElements";
  return "scenes.relationRules";
}

function sceneRelationDotClass(kind: SceneRelationKind): string {
  if (kind === "characters") return "character";
  if (kind === "threads") return "thread";
  if (kind === "elements") return "element";
  return "rule";
}

function sceneRelationIcon(kind: SceneRelationKind): ReactNode {
  if (kind === "characters") return <Users size={16} />;
  if (kind === "threads") return <GitBranch size={16} />;
  if (kind === "elements") return <MapPin size={16} />;
  return <Target size={16} />;
}

function beatPreviewText(beat: Beat): string {
  return [beat.role, beat.description].filter(Boolean).join(" — ") || beat.name;
}

function uniqueOrderedIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
