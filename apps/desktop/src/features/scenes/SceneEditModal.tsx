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
};

const sceneTextFields: Array<{
  field: PlanFieldKey;
  label: string;
  key: "title" | "summary" | "goal" | "conflict" | "outcome";
  rows: number;
}> = [
  { field: "sceneTitle", label: "Tytuł", key: "title", rows: 1 },
  { field: "sceneSummary", label: "Streszczenie", key: "summary", rows: 4 },
  { field: "sceneGoal", label: "Cel sceny", key: "goal", rows: 2 },
  { field: "sceneConflict", label: "Konflikt / napięcie", key: "conflict", rows: 2 },
  { field: "sceneOutcome", label: "Wynik sceny", key: "outcome", rows: 2 }
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
  onLinkThreadToChapter
}: SceneEditModalProps) {
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
    { label: "Tytuł", complete: Boolean(draft.title.trim()) },
    { label: "Streszczenie", complete: Boolean(draft.summary.trim()) },
    { label: "Cel", complete: Boolean(draft.goal.trim()) },
    { label: "Konflikt", complete: Boolean(draft.conflict.trim()) },
    { label: "Wynik", complete: Boolean(draft.outcome.trim()) },
    { label: "POV", complete: Boolean(draft.povCharacterId) },
    { label: "Lokacja", complete: Boolean(draft.locationId) },
    { label: "Postacie", complete: characterIds.length > 0 },
    { label: "Wątki", complete: threadIds.length > 0 }
  ];
  const completedCount = completedItems.filter((item) => item.complete).length;
  const completionPercent = Math.round((completedCount / completedItems.length) * 100);
  const visualStatus =
    completionPercent >= 85
      ? "Gotowa do pisania"
      : completionPercent >= 45
        ? "W trakcie"
        : "Szkic";
  const isSaving = saving || submitting;
  const modalTitle = scene ? draft.title || "Edytuj scenę" : "Nowa scena";

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
              Usuń
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="scene-edit-form"
            busy={isSaving}
            disabled={!bookId}
          >
            {isSaving ? "Zapisuję" : "Zapisz scenę"}
          </Button>
        </>
      }
    >
      <form id="scene-edit-form" className="chapter-edit-form scene-edit-form" onSubmit={submit}>
        <div className="chapter-edit-metrics" aria-label="Najważniejsze informacje o scenie">
              <span className="chapter-edit-metric">
                <BookOpen size={16} />
                <span>Rozdział:</span>
                <strong>
                  {selectedChapter
                    ? `${dynamicChapterNumber(plan, selectedChapter.id)}. ${selectedChapter.workingTitle || "Bez tytułu"}`
                    : "Bez rozdziału"}
                </strong>
              </span>
              <span className="chapter-edit-metric">
                <Eye size={16} />
                <span>POV:</span>
                <strong>{selectedPov?.name ?? "Brak"}</strong>
              </span>
              <span className="chapter-edit-metric">
                <Map size={16} />
                <span>Lokacja:</span>
                <strong>{selectedLocation?.name ?? "Brak"}</strong>
              </span>
              <span className="chapter-edit-metric">
                <CheckCircle2 size={16} />
                <span>Uzupełnione:</span>
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
                    <h4>Treść sceny</h4>
                  </div>
                  <div className="chapter-field-stack">
                    {sceneTextFields.map((item) => (
                      <SceneTextField
                        key={item.field}
                        field={item.field}
                        label={item.label}
                        value={String(draft[item.key] ?? "")}
                        targetEntity={scenePromptEntity}
                        rows={item.rows}
                        onChange={(value) => setDraft({ ...draft, [item.key]: value })}
                        onGenerate={() => onGenerate(item.field, scenePromptEntity, draft)}
                        onActivatePrompt={() => onActivatePrompt(item.field, scenePromptEntity)}
                      />
                    ))}
                  </div>
                </section>

                <section className="chapter-edit-section scene-settings-section">
                  <div className="chapter-section-heading">
                    <Target size={17} />
                    <h4>Ustawienia sceny</h4>
                  </div>
                  <div className="scene-settings-grid">
                    <Field label="Rozdział">
                      <select
                        value={draft.chapterId ?? ""}
                        onChange={(event) => {
                          setDraft({ ...draft, chapterId: event.target.value || null });
                          setLinkThreadsToChapter(false);
                        }}
                      >
                        <option value="">Bez rozdziału</option>
                        {orderedChaptersForPlan(plan).map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            Rozdział {dynamicChapterNumber(plan, chapter.id)}:{" "}
                            {chapter.workingTitle || "Bez tytułu"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="POV">
                      <select
                        value={draft.povCharacterId ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, povCharacterId: event.target.value || null })
                        }
                      >
                        <option value="">Brak</option>
                        {characters.characters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Lokacja">
                      <select
                        value={draft.locationId ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, locationId: event.target.value || null })
                        }
                      >
                        <option value="">Brak</option>
                        {world.elements.map((element) => (
                          <option key={element.id} value={element.id}>
                            {element.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Kiedy (znacznik czasu)">
                      <input
                        type="text"
                        placeholder="np. następnego ranka, 3 dni później"
                        value={draft.timeMarker ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, timeMarker: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Cel słów">
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
                    <Field label="Status">
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          setDraft({ ...draft, status: event.target.value as Scene["status"] })
                        }
                      >
                        <option value="planned">Planowana</option>
                        <option value="draft">Szkic</option>
                        <option value="written">Napisana</option>
                        <option value="revision">Do redakcji</option>
                      </select>
                    </Field>
                  </div>
                </section>
              </main>

              <aside className="chapter-edit-sidebar" aria-label="Powiązania sceny">
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

                {relationKinds.map((kind) => (
                  <SceneRelationSection
                    key={kind}
                    title={sceneRelationTitle(kind)}
                    kind={kind}
                    items={sceneRelationOptions(kind, plan, characters, world).filter((item) =>
                      currentRelationIds(kind).includes(item.id)
                    )}
                    emptyText={`Brak: ${sceneRelationTitle(kind).toLowerCase()}`}
                    onOpenPicker={setRelationPicker}
                    onRemove={(id) =>
                      setCurrentRelationIds(
                        kind,
                        currentRelationIds(kind).filter((item) => item !== id)
                      )
                    }
                  />
                ))}

                {selectedChapter && externalSceneThreadIds.length > 0 ? (
                  <label className="scene-thread-chapter-sync-option">
                    <input
                      type="checkbox"
                      checked={linkThreadsToChapter}
                      onChange={(event) => setLinkThreadsToChapter(event.target.checked)}
                    />
                    <span>Dopiąć wątki sceny także do rozdziału?</span>
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
  const chapterThreads = inheritedThreadSuggestions
    .map((id) => plan.threads.find((thread) => thread.id === id))
    .filter((thread): thread is PlotThread => Boolean(thread));

  return (
    <section className="chapter-side-section scene-side-section chapter-inheritance-section">
      <div className="chapter-side-heading">
        <BookOpen size={16} />
        <h4>Kontekst rozdziału</h4>
      </div>
      <div className="scene-inheritance-block">
        <span className="scene-inheritance-label">Wątki do użycia w scenie</span>
        <div className="chapter-side-chip-list">
          {chapterThreads.length > 0 ? (
            chapterThreads.map((thread) => (
              <button
                type="button"
                className="chapter-side-chip scene-inherited-chip thread"
                key={thread.id}
                onClick={() => onUseThread(thread.id)}
                title={`Użyj wątku w scenie: ${thread.name}`}
              >
                <Plus size={12} />
                {thread.name}
              </button>
            ))
          ) : (
            <span className="chapter-side-empty">Scena używa już wątków rozdziału.</span>
          )}
        </div>
      </div>
      <div className="scene-inheritance-block">
        <span className="scene-inheritance-label">Beaty rozdziału</span>
        <div className="chapter-side-chip-list">
          {chapterBeats.length > 0 ? (
            chapterBeats.map((beat) => (
              <span className="chapter-side-chip beat" key={beat.id} title={beatPreviewText(beat)}>
                {beat.name}
              </span>
            ))
          ) : (
            <span className="chapter-side-empty">Brak beatów w kontrakcie rozdziału.</span>
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
          Zapisz scenę, żeby AI mogło zasugerować powiązania z istniejącą Story Bible.
        </span>
      )}
      <span className="scene-inheritance-footnote">
        Rozdział: {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle || "Bez tytułu"}
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
  return (
    <Field
      label={label}
      actions={
        <SceneFieldAiActions
          field={field}
          targetEntity={targetEntity}
          onGenerate={onGenerate}
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
  onActivatePrompt
}: {
  field: PlanFieldKey;
  targetEntity?: ScenePromptEntity;
  onGenerate: () => void;
  onActivatePrompt: () => void;
}) {
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
        onClick={onGenerate}
        disabled={queued || running || !targetEntity}
        title={`Generuj ${planFieldConfigs[field].label} z AI`}
        aria-label={`Generuj ${planFieldConfigs[field].label} z AI`}
      >
        {running ? (
          <Loader2 size={15} className="spin-icon" />
        ) : queued ? (
          <Clock3 size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        <span>{running ? "Generuje" : queued ? "W kolejce" : "AI"}</span>
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
        title="Dodaj pole do aktywnego kontekstu promptu."
        aria-label={`Dodaj ${planFieldConfigs[field].label} do kontekstu promptu`}
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
                aria-label={`Odepnij relację: ${item.label}`}
                title={`Odepnij relację: ${item.label}`}
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
        title={`Dodaj: ${title.toLowerCase()}`}
        aria-label={`Dodaj relację sceny: ${title}`}
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
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const options = useMemo(
    () =>
      sceneRelationOptions(kind, plan, characters, world).filter(
        (item) => !selectedIds.includes(item.id)
      ),
    [characters, kind, plan, selectedIds, world]
  );
  const title = `Dodaj: ${sceneRelationTitle(kind).toLowerCase()}`;

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
        aria-label="Zamknij wybór relacji"
      />
      <div className="world-relation-shell">
        <header className="world-relation-header">
          <div>
            <p className="eyebrow">Powiązania sceny</p>
            <h3 id="scene-relation-picker-title">{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Zamknij" aria-label="Zamknij">
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
            <p className="muted-text">Wszystkie elementy z tej grupy są już przypisane do sceny.</p>
          ) : null}
        </div>
        <footer className="scene-relation-picker-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onAdd(checkedIds)}
            disabled={checkedIds.length === 0}
          >
            <Plus size={16} />
            Dodaj wybrane
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
  world: WorldWorkspace
): Array<{ id: string; label: string; description: string }> {
  if (kind === "characters") {
    return characters.characters.map((character) => ({
      id: character.id,
      label: character.name || "Postać bez imienia",
      description: character.shortDescription || character.arcSummary || character.role || "Brak opisu postaci."
    }));
  }

  if (kind === "threads") {
    return plan.threads.map((thread) => ({
      id: thread.id,
      label: thread.name || "Wątek bez nazwy",
      description: thread.description || thread.status || "Brak opisu wątku."
    }));
  }

  if (kind === "elements") {
    return world.elements.map((element) => ({
      id: element.id,
      label: element.name || "Element świata bez nazwy",
      description: element.summary || element.details || element.elementType || "Brak opisu elementu świata."
    }));
  }

  return world.rules.map((rule) => ({
    id: rule.id,
    label: rule.name || "Reguła bez nazwy",
    description: rule.description || "Brak opisu reguły świata."
  }));
}

function sceneRelationTitle(kind: SceneRelationKind): string {
  if (kind === "characters") return "Postacie";
  if (kind === "threads") return "Wątki";
  if (kind === "elements") return "Elementy świata";
  return "Reguły świata";
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
