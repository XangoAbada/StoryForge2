import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Hash,
  LayoutList,
  Link2,
  Loader2,
  Plus,
  Route,
  Sparkles,
  Target,
  Trash2,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Beat, BookPlan, Chapter, UpsertChapterInput } from "../../shared/api/types";
import { Button, Field, Modal, StatusPill } from "../../shared/ui";
import {
  planFieldConfigs,
  type PlanFieldKey,
  planPromptContextSource
} from "../ai/planPromptPackage";
import { useAiPromptContextStore } from "../ai/aiPromptContextStore";
import { pendingProposalStatus, useProposalStore } from "../ai/proposalStore";

export type ChapterModalState =
  | { mode: "create"; actId?: string | null }
  | { mode: "edit"; chapterId: string };

type ChapterRelationKind = "threads" | "beats";
type ChapterPromptEntity = Chapter;

const chapterFormId = "chapter-edit-form";

export function ChapterEditModal({
  state,
  bookId,
  plan,
  saving,
  onClose,
  onSave,
  onDelete,
  onGenerate,
  onActivatePrompt
}: {
  state: ChapterModalState | null;
  bookId: string;
  plan: BookPlan;
  saving: boolean;
  onClose: () => void;
  onSave: (input: UpsertChapterInput) => void;
  onDelete?: (chapterId: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
}) {
  const { t } = useTranslation();
  const chapter =
    state?.mode === "edit"
      ? plan.chapters.find((candidate) => candidate.id === state.chapterId)
      : undefined;

  if (!state) {
    return null;
  }

  const modalTitle =
    state.mode === "edit" && chapter
      ? t("book.chapterModalTitle", {
          number: dynamicChapterNumber(plan, chapter.id),
          title: chapter.workingTitle
        })
      : t("book.chapterModalNewTitle");

  return (
    <Modal
      title={modalTitle}
      onClose={onClose}
      size="xl"
      footer={
        <>
          {chapter && onDelete ? (
            <Button variant="danger" onClick={() => onDelete(chapter.id)} disabled={saving}>
              <Trash2 size={15} aria-hidden />
              {t("book.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("book.cancel")}
          </Button>
          <Button variant="primary" type="submit" form={chapterFormId} busy={saving}>
            {saving ? t("book.saving") : t("book.saveChangesShort")}
          </Button>
        </>
      }
    >
      <ChapterForm
        bookId={bookId}
        chapter={chapter}
        plan={plan}
        saving={saving}
        orderIndex={plan.chapters.length}
        initialActId={state.mode === "create" ? state.actId : undefined}
        onSave={onSave}
        onGenerate={(field) => onGenerate(field, chapter)}
        onActivatePrompt={(field) => onActivatePrompt(field, chapter)}
      />
    </Modal>
  );
}

function ChapterForm({
  bookId,
  chapter,
  plan,
  orderIndex = 0,
  initialActId,
  saving,
  onSave,
  onGenerate,
  onActivatePrompt
}: {
  bookId: string;
  chapter?: Chapter;
  plan: BookPlan;
  orderIndex?: number;
  initialActId?: string | null;
  saving: boolean;
  onSave: (input: UpsertChapterInput) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
}) {
  const { t } = useTranslation();
  const chapterThreadIds = chapter ? chapterThreadIdsForChapter(plan, chapter.id) : [];
  const chapterBeatIds = chapter ? chapterBeatIdsForChapter(plan, chapter.id) : [];
  const defaultActId = defaultChapterActId(initialActId, plan);
  const dynamicNumber = chapter
    ? dynamicChapterNumber(plan, chapter.id)
    : orderedChaptersForPlan(plan).length + 1;
  const [workingTitle, setWorkingTitle] = useState(
    chapter?.workingTitle ?? `Rozdział ${orderIndex + 1}`
  );
  const [summary, setSummary] = useState(chapter?.summary ?? "");
  const [purpose, setPurpose] = useState(chapter?.purpose ?? "");
  const [conflict, setConflict] = useState(chapter?.conflict ?? "");
  const [turningPoint, setTurningPoint] = useState(chapter?.turningPoint ?? "");
  const [targetWordCount, setTargetWordCount] = useState(
    chapter?.targetWordCount?.toString() ?? ""
  );
  const [actId, setActId] = useState(chapter?.actId ?? defaultActId);
  const [threadIds, setThreadIds] = useState(chapterThreadIds);
  const [beatIds, setBeatIds] = useState(chapterBeatIds);
  const [relationPicker, setRelationPicker] = useState<ChapterRelationKind | null>(null);

  useEffect(() => {
    setWorkingTitle(chapter?.workingTitle ?? `Rozdział ${orderIndex + 1}`);
    setSummary(chapter?.summary ?? "");
    setPurpose(chapter?.purpose ?? "");
    setConflict(chapter?.conflict ?? "");
    setTurningPoint(chapter?.turningPoint ?? "");
    setTargetWordCount(chapter?.targetWordCount?.toString() ?? "");
    setActId(chapter?.actId ?? defaultChapterActId(initialActId, plan));
    setThreadIds(chapterThreadIds);
    setBeatIds(chapterBeatIds);
    setRelationPicker(null);
  }, [
    chapter?.workingTitle,
    chapter?.summary,
    chapter?.purpose,
    chapter?.conflict,
    chapter?.turningPoint,
    chapter?.targetWordCount,
    chapter?.actId,
    plan,
    initialActId,
    chapterThreadIds.join("|"),
    chapterBeatIds.join("|"),
    orderIndex
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: chapter?.id,
      bookId,
      actId: actId || null,
      number: dynamicNumber,
      workingTitle,
      summary,
      purpose,
      conflict,
      turningPoint,
      targetWordCount: parseOptionalPositiveInt(targetWordCount),
      orderIndex: chapter?.orderIndex ?? orderIndex,
      threadIds,
      beatIds
    });
  }

  const selectedAct = plan.acts.find((act) => act.id === actId);
  const selectedThreads = plan.threads.filter((thread) => threadIds.includes(thread.id));
  const selectedBeats = plan.beats.filter((beat) => beatIds.includes(beat.id));
  const targetWords = parseOptionalPositiveInt(targetWordCount);
  const skeletonItems = [
    { label: "Tytuł roboczy", complete: Boolean(workingTitle.trim()) },
    { label: "Akt", complete: Boolean(actId) },
    { label: "Cel wstępny", complete: Boolean(purpose.trim()) }
  ];
  const contractItems = [
    { label: "Streszczenie", complete: Boolean(summary.trim()) },
    { label: "Konflikt", complete: Boolean(conflict.trim()) },
    { label: "Punkt zwrotny", complete: Boolean(turningPoint.trim()) },
    { label: "Cel słów", complete: Boolean(targetWords) },
    { label: "Beaty", complete: beatIds.length > 0 },
    { label: "Wątki", complete: threadIds.length > 0 }
  ];
  const completionItems = [...skeletonItems, ...contractItems];
  const completedItems = completionItems.filter((item) => item.complete).length;
  const skeletonComplete = skeletonItems.every((item) => item.complete);
  const contractComplete = contractItems.every((item) => item.complete);
  const visualStatus = !skeletonComplete
    ? t("book.chapterStatusSkeletonDraft")
    : contractComplete
      ? t("book.chapterStatusContractReady")
      : t("book.chapterStatusSkeletonReady");
  const visualTone = contractComplete ? "success" : skeletonComplete ? "accent" : "muted";

  return (
    <form id={chapterFormId} className="chapter-edit-form" onSubmit={submit}>
      <div className="chapter-edit-metrics" aria-label={t("book.chapterMetricsAria")}>
        <span className="chapter-edit-metric">
          <BookOpen size={16} />
          <span>{t("book.chapterMetricAct")}</span>
          <strong>{selectedAct?.name ?? t("book.chapterMetricNoAct")}</strong>
        </span>
        <span className="chapter-edit-metric">
          <Hash size={16} />
          <span>{t("book.chapterMetricNumber")}</span>
          <strong>{dynamicNumber}</strong>
        </span>
        <span className="chapter-edit-metric">
          <Target size={16} />
          <span>{t("book.chapterMetricWordGoal")}</span>
          <strong>{targetWords ? targetWords.toLocaleString("pl-PL") : t("book.chapterMetricNoGoal")}</strong>
        </span>
        <span className="chapter-edit-metric">
          <CheckCircle2 size={16} />
          <span>{t("book.chapterMetricCompleted")}</span>
          <strong>
            {completedItems} / {completionItems.length}
          </strong>
        </span>
        <StatusPill tone={visualTone}>{visualStatus}</StatusPill>
      </div>

      <div className="chapter-edit-content-grid">
        <main className="chapter-edit-main">
          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <LayoutList size={17} />
              <h4>{t("book.chapterSectionSkeletonHeading")}</h4>
            </div>
            <div className="chapter-field-stack">
              <PlanInlineField
                label={t("book.chapterFieldWorkingTitle")}
                value={workingTitle}
                rows={1}
                field="chapterSummary"
                entity={chapter}
                onChange={setWorkingTitle}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label={t("book.chapterFieldSummary")}
                value={summary}
                rows={4}
                field="chapterSummary"
                entity={chapter}
                onChange={setSummary}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label={t("book.chapterFieldPurpose")}
                value={purpose}
                rows={3}
                field="chapterPurpose"
                entity={chapter}
                onChange={setPurpose}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label={t("book.chapterFieldConflict")}
                value={conflict}
                rows={3}
                field="chapterConflict"
                entity={chapter}
                onChange={setConflict}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label={t("book.chapterFieldTurningPoint")}
                value={turningPoint}
                rows={3}
                field="chapterTurningPoint"
                entity={chapter}
                onChange={setTurningPoint}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
            </div>
          </section>

          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <Target size={17} />
              <h4>{t("book.chapterSectionSettingsHeading")}</h4>
            </div>
            <div className="scene-settings-grid">
              <Field label={t("book.chapterFieldAct")}>
                <select value={actId} onChange={(event) => setActId(event.target.value)}>
                  <option value="">{t("book.chapterFieldNoAct")}</option>
                  {plan.acts.map((act) => (
                    <option key={act.id} value={act.id}>{act.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("book.chapterFieldWordGoal")}>
                <input
                  type="number"
                  min={0}
                  value={targetWordCount}
                  onChange={(event) => setTargetWordCount(event.target.value)}
                />
              </Field>
            </div>
          </section>
        </main>

        <aside className="chapter-edit-sidebar" aria-label={t("book.chapterSidebarAria")}>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Link2 size={16} />
              <h4>{t("book.chapterLinkedThreads")}</h4>
              <ChapterRelationActions
                field="chapterThreadSuggestions"
                chapter={chapter}
                onGenerate={() => onGenerate("chapterThreadSuggestions", chapter)}
                onOpenPicker={() => setRelationPicker("threads")}
              />
            </div>
            <div className="chapter-side-chip-list">
              {selectedThreads.length > 0 ? (
                selectedThreads.map((thread) => (
                  <span className="chapter-side-chip thread" key={thread.id} title={thread.description || t("book.chapterNoThreadDescription")}>
                    {thread.name}
                    <button
                      type="button"
                      className="chapter-side-chip-remove"
                      onClick={() => setThreadIds((currentIds) => currentIds.filter((threadId) => threadId !== thread.id))}
                      aria-label={t("book.chapterUnpinThread", { name: thread.name })}
                      title={t("book.chapterUnpinThread", { name: thread.name })}
                    >
                      -
                    </button>
                  </span>
                ))
              ) : (
                <span className="chapter-side-empty">{t("book.chapterNoLinkedThreads")}</span>
              )}
            </div>
          </section>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Route size={16} />
              <h4>{t("book.chapterLinkedBeats")}</h4>
              <ChapterRelationActions
                field="chapterBeatSuggestions"
                chapter={chapter}
                onGenerate={() => onGenerate("chapterBeatSuggestions", chapter)}
                onOpenPicker={() => setRelationPicker("beats")}
              />
            </div>
            <div className="chapter-side-chip-list">
              {selectedBeats.length > 0 ? (
                selectedBeats.map((beat) => (
                  <span className="chapter-side-chip beat" key={beat.id} title={beatPreviewText(beat)}>
                    {beat.name}
                    <button
                      type="button"
                      className="chapter-side-chip-remove"
                      onClick={() => setBeatIds((currentIds) => currentIds.filter((beatId) => beatId !== beat.id))}
                      aria-label={t("book.chapterUnpinBeat", { name: beat.name })}
                      title={t("book.chapterUnpinBeat", { name: beat.name })}
                    >
                      -
                    </button>
                  </span>
                ))
              ) : (
                <span className="chapter-side-empty">{t("book.chapterNoLinkedBeats")}</span>
              )}
            </div>
          </section>
        </aside>
      </div>

      {relationPicker ? (
        <ChapterRelationPickerModal
          kind={relationPicker}
          plan={plan}
          selectedIds={relationPicker === "threads" ? threadIds : beatIds}
          onClose={() => setRelationPicker(null)}
          onAdd={(ids) => {
            if (relationPicker === "threads") {
              setThreadIds((currentIds) => uniqueOrderedIds([...currentIds, ...ids]));
            } else {
              setBeatIds((currentIds) => uniqueOrderedIds([...currentIds, ...ids]));
            }
            setRelationPicker(null);
          }}
        />
      ) : null}
    </form>
  );
}

function PlanInlineField({
  label,
  value,
  rows,
  field,
  entity,
  onChange,
  onGenerate,
  onActivatePrompt
}: {
  label: string;
  value: string;
  rows: number;
  field: PlanFieldKey;
  entity?: ChapterPromptEntity;
  onChange: (value: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: ChapterPromptEntity) => void;
}) {
  const activate = () => onActivatePrompt(field, entity);
  return (
    <Field
      label={label}
      actions={
        <PlanAiActions
          field={field}
          targetEntity={entity}
          onGenerate={() => onGenerate(field, entity)}
        />
      }
    >
      {rows === 1 ? (
        <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={activate} onClick={activate} />
      ) : (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} onFocus={activate} onClick={activate} rows={rows} />
      )}
    </Field>
  );
}

function PlanAiActions({
  field,
  targetEntity,
  onGenerate
}: {
  field: PlanFieldKey;
  targetEntity?: ChapterPromptEntity;
  onGenerate: () => void;
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
  const targetEntityId = targetEntity?.id;
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
        disabled={queued || running || (targetEntity === undefined && isEntityField(field))}
        title={t("book.planAiGenerateTitle", { label: planFieldConfigs[field].label })}
        aria-label={t("book.planAiGenerateTitle", { label: planFieldConfigs[field].label })}
      >
        {running ? <Loader2 size={15} className="spin-icon" /> : queued ? <Clock3 size={15} /> : <Sparkles size={15} />}
        <span>{running ? t("book.aiFieldGenerating") : queued ? t("book.aiFieldQueued") : t("book.aiFieldIdle")}</span>
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
        title={t("book.planAiContextAddTitle")}
        aria-label={t("book.planAiContextAddAria", { label: planFieldConfigs[field].label })}
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

function ChapterRelationActions({
  field,
  chapter,
  onGenerate,
  onOpenPicker
}: {
  field: PlanFieldKey;
  chapter?: Chapter;
  onGenerate: () => void;
  onOpenPicker: () => void;
}) {
  const { t } = useTranslation();
  const proposals = useProposalStore((state) => state.proposals);
  const loading = pendingProposalStatus(proposals, {
    field,
    scope: "bookPlan",
    targetEntityId: chapter?.id
  });
  const running = loading === "running";
  const queued = loading === "queued";
  const label = planFieldConfigs[field].label.toLowerCase();

  return (
    <span className="chapter-relation-actions">
      <button
        type="button"
        className="icon-button ai-field-button chapter-relation-ai-button"
        onClick={onGenerate}
        disabled={running || queued || !chapter}
        title={t("book.planRelationGenerateTitle", { label })}
        aria-label={t("book.planRelationGenerateTitle", { label })}
      >
        {running ? <Loader2 size={15} className="spin-icon" /> : queued ? <Clock3 size={15} /> : <Sparkles size={15} />}
        <span>{running ? t("book.aiFieldGenerating") : queued ? t("book.aiFieldQueued") : t("book.aiFieldIdle")}</span>
      </button>
      <button
        type="button"
        className="icon-button chapter-relation-add-button"
        onClick={onOpenPicker}
        title={t("book.planRelationAddTitle", { label })}
        aria-label={t("book.planRelationAddTitle", { label })}
      >
        <Plus size={15} />
      </button>
    </span>
  );
}

function ChapterRelationPickerModal({
  kind,
  plan,
  selectedIds,
  onClose,
  onAdd
}: {
  kind: ChapterRelationKind;
  plan: BookPlan;
  selectedIds: string[];
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const selectedSet = new Set(selectedIds);
  const items =
    kind === "threads"
      ? plan.threads.filter((thread) => !selectedSet.has(thread.id))
      : plan.beats.filter((beat) => !selectedSet.has(beat.id));
  const title = kind === "threads" ? t("book.relationModalAddThreads") : t("book.relationModalAddBeats");
  const emptyText =
    kind === "threads"
      ? t("book.relationModalThreadsAllPinned")
      : t("book.relationModalBeatsAllPinned");

  function toggle(id: string) {
    setCheckedIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id]
    );
  }

  return (
    <Modal
      title={title}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("book.cancel")}
          </Button>
          <Button variant="primary" disabled={checkedIds.length === 0} onClick={() => onAdd(checkedIds)}>
            <Plus size={15} aria-hidden />
            {t("book.relationModalAddSelected")}
          </Button>
        </>
      }
    >
      <div className="chapter-relation-list">
        {items.length === 0 ? (
          <p className="chapter-relation-empty">{emptyText}</p>
        ) : (
          items.map((item) => {
            const checked = checkedIds.includes(item.id);
            const description = kind === "threads" ? item.description : beatPreviewText(item as Beat);
            return (
              <button
                type="button"
                className={checked ? "chapter-relation-option selected" : "chapter-relation-option"}
                key={item.id}
                onClick={() => toggle(item.id)}
                title={description}
                aria-pressed={checked}
              >
                <span className={kind === "threads" ? "relation-dot thread" : "relation-dot beat"} />
                <span>
                  <strong>{item.name}</strong>
                  <em>{description || t("book.relationModalNoDescription")}</em>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function orderedChaptersForPlan(plan: BookPlan): Chapter[] {
  return [...plan.chapters].sort((left, right) => left.orderIndex - right.orderIndex || left.number - right.number);
}

function dynamicChapterNumber(plan: BookPlan, chapterId: string): number {
  return new Map(orderedChaptersForPlan(plan).map((chapter, index) => [chapter.id, index + 1])).get(chapterId) ?? 1;
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

function defaultChapterActId(initialActId: string | null | undefined, plan: BookPlan): string {
  if (initialActId !== undefined) {
    return initialActId ?? "";
  }

  return plan.acts[0]?.id ?? "";
}

// ponytail: module-level tooltip helper; "Rola:"/"Brak opisu beatu." left untranslated (tooltip-only, no React context here). Thread `t` through if these tooltips need i18n.
function beatPreviewText(beat: Beat): string {
  return [beat.description, beat.role ? `Rola: ${beat.role}` : ""]
    .filter(Boolean)
    .join("\n") || "Brak opisu beatu.";
}

function uniqueOrderedIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed.replace(/\s+/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isEntityField(field: PlanFieldKey): boolean {
  return [
    "actPurpose",
    "actSummary",
    "beatName",
    "beatRole",
    "beatDescription",
    "threadDescription",
    "chapterSummary",
    "chapterPurpose",
    "chapterConflict",
    "chapterTurningPoint",
    "sceneDraft",
    "sceneTitle",
    "sceneSummary",
    "sceneGoal",
    "sceneConflict",
    "sceneOutcome",
    "threadChapterDescription",
    "chapterThreadSuggestions",
    "chapterBeatSuggestions"
  ].includes(field);
}
