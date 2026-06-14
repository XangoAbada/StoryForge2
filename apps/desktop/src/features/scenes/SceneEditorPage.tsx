import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  GitBranch,
  History,
  Image,
  Link2,
  List,
  Loader2,
  MapPin,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Target,
  Trash2,
  Users,
  X
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteChapter,
  deleteScene,
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  setSceneRelations,
  upsertChapter,
  upsertChapterThreadRelation,
  upsertScene
} from "../../shared/api/commands";
import type {
  BookPlan,
  Chapter,
  CharacterWorkspace,
  Scene,
  SetSceneRelationsInput,
  UpsertSceneInput,
  WorldWorkspace
} from "../../shared/api/types";
import { buildScenePromptContext } from "../ai/scenePromptContext";
import {
  buildSceneEditorPromptPackage,
  renderSceneEditorPromptPackage,
  SceneEditorFieldKey
} from "../ai/sceneEditorPromptPackage";
import {
  registerSceneEditorProposalTarget,
  SceneEditorInsertMode,
  unregisterSceneEditorProposalTarget
} from "../ai/sceneEditorProposalTargets";
import {
  buildPlanPromptPackage,
  planFieldConfigs,
  planPromptContextSource,
  planStoryBibleContext,
  PlanFieldKey,
  renderPlanPromptPackage
} from "../ai/planPromptPackage";
import {
  createPlanPromptContextTarget,
  planPromptContextTargetId,
  promptContextControlForActiveTarget,
  promptContextControlForTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import type { PromptContextSource } from "../ai/promptPackage";
import { pendingProposalStatus, useProposalStore } from "../ai/proposalStore";
import { ChapterEditModal, type ChapterModalState } from "../book/ChapterEditModal";
import { SceneEditModal as SharedSceneEditModal } from "./SceneEditModal";

type SceneEditorPageProps = {
  projectId: string;
};

type SceneVariant = {
  id: string;
  mode: SceneEditorInsertMode;
  text: string;
  createdAt: string;
};

type SceneModalState =
  | { mode: "create"; chapterId?: string | null }
  | { mode: "edit"; sceneId: string };

type SceneRelationKind = "characters" | "threads" | "elements" | "rules";
type PlanPromptEntity = Scene | Chapter;

const sceneTextFields: Array<{
  field: PlanFieldKey;
  label: string;
  key: "title" | "summary" | "goal" | "conflict" | "outcome";
  rows?: number;
}> = [
  { field: "sceneTitle", label: "Tytuł", key: "title", rows: 1 },
  { field: "sceneSummary", label: "Streszczenie", key: "summary", rows: 4 },
  { field: "sceneGoal", label: "Cel sceny", key: "goal", rows: 2 },
  { field: "sceneConflict", label: "Konflikt / napięcie", key: "conflict", rows: 2 },
  { field: "sceneOutcome", label: "Wynik sceny", key: "outcome", rows: 2 }
];

const relationKinds: SceneRelationKind[] = ["characters", "threads", "elements", "rules"];

export function SceneEditorPage({ projectId }: SceneEditorPageProps) {
  const queryClient = useQueryClient();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore((state) => state.activateTarget);
  const closePromptContextTarget = useAiPromptContextStore((state) => state.closeTarget);
  const activePromptContextTarget = useAiPromptContextStore((state) =>
    state.activeTargetId ? state.targets[state.activeTargetId] : null
  );
  const addContextSourceToActiveTarget = useAiPromptContextStore((state) => state.addContextSourceToActiveTarget);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<UpsertSceneInput | null>(null);
  const [sceneModal, setSceneModal] = useState<SceneModalState | null>(null);
  const [chapterModal, setChapterModal] = useState<ChapterModalState | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [insertMode, setInsertMode] = useState<SceneEditorInsertMode>("append_to_scene");
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [statusText, setStatusText] = useState("Wybierz scenę");
  const [variants, setVariants] = useState<SceneVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const lastSavedSignature = useRef("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const bookId = projectQuery.data?.book.id;
  const planQuery = useQuery({
    queryKey: ["book-plan", bookId],
    queryFn: () => getBookPlan(bookId ?? ""),
    enabled: Boolean(bookId),
    retry: 0
  });
  const characterQuery = useQuery({
    queryKey: ["character-workspace", projectId],
    queryFn: () => getCharacterWorkspace(projectId),
    retry: 0
  });
  const worldQuery = useQuery({
    queryKey: ["world-workspace", projectId],
    queryFn: () => getWorldWorkspace(projectId),
    retry: 0
  });

  const plan = planQuery.data ?? emptyPlan();
  const characters = characterQuery.data ?? emptyCharacterWorkspace();
  const world = worldQuery.data ?? emptyWorldWorkspace();
  const chapters = orderedChaptersForPlan(plan);
  const selectedScene = selectedSceneId
    ? plan.scenes.find((scene) => scene.id === selectedSceneId) ?? null
    : null;
  const activeChapterId = selectedScene?.chapterId ?? selectedChapterId ?? null;
  const selectedChapter = activeChapterId
    ? plan.chapters.find((chapter) => chapter.id === activeChapterId) ?? null
    : null;
  const chapterScenes = orderedScenes(
    plan.scenes.filter((scene) => (scene.chapterId ?? null) === activeChapterId)
  );
  const selectedChapterIndex = selectedChapter
    ? chapters.findIndex((chapter) => chapter.id === selectedChapter.id)
    : -1;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Pisz scenę tutaj..."
      })
    ],
    content: selectedScene?.manuscriptContent || "",
    editorProps: {
      attributes: {
        class: "scene-tiptap-surface"
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              manuscriptContent: currentEditor.getHTML(),
              actualWordCount: countWords(currentEditor.getText())
            }
          : current
      );
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      setSelectionText(selectedTextFromEditor(currentEditor));
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (input: UpsertSceneInput) => upsertScene(input),
    onSuccess: async (scene) => {
      setSelectedSceneId(scene.id);
      setStatusText(`Zapisano ${new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`);
      await invalidatePlan();
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const sceneDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteScene(id),
    onSuccess: async () => {
      setSceneModal(null);
      setSelectedSceneId(null);
      setDraft(null);
      setStatusText("Usunięto scenę");
      await invalidatePlan();
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const chapterMutation = useMutation({
    mutationFn: upsertChapter,
    onSuccess: async (chapter) => {
      setSelectedChapterId(chapter.id);
      setChapterModal(null);
      setStatusText("Zapisano ustawienia rozdziału");
      await invalidatePlan();
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const chapterDeleteMutation = useMutation({
    mutationFn: deleteChapter,
    onSuccess: async () => {
      setSelectedChapterId(null);
      setSelectedSceneId(null);
      setChapterModal(null);
      setStatusText("Usunięto rozdział");
      await invalidatePlan();
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  async function invalidatePlan() {
    await queryClient.invalidateQueries({ queryKey: ["book-plan", bookId] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  useEffect(() => {
    if (!selectedSceneId && selectedChapterId === undefined && plan.scenes[0]) {
      setSelectedSceneId(plan.scenes[0].id);
    }
  }, [plan.scenes, selectedChapterId, selectedSceneId]);

  useEffect(() => {
    if (selectedScene) {
      setSelectedChapterId(selectedScene.chapterId ?? null);
    }
  }, [selectedScene]);

  useEffect(() => {
    if (!selectedScene) {
      setDraft(null);
      editor?.commands.setContent("");
      return;
    }

    const nextDraft = sceneToInput(selectedScene);
    setDraft(nextDraft);
    lastSavedSignature.current = signature(nextDraft);
    editor?.commands.setContent(selectedScene.manuscriptContent || "", { emitUpdate: false });
    setSelectionText("");
    setVariants(loadVariants(selectedScene.id));
    setSelectedVariantId(null);
    setStatusText("Scena gotowa");
  }, [editor, selectedScene?.id]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    const nextSignature = signature(draft);
    if (nextSignature === lastSavedSignature.current) {
      return;
    }

    setStatusText("Autosave...");
    const timeoutId = window.setTimeout(() => {
      lastSavedSignature.current = nextSignature;
      saveMutation.mutate(draft);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [draft, saveMutation]);

  useEffect(() => {
    if (!draft?.id || !editor) {
      return;
    }

    registerSceneEditorProposalTarget(draft.id, async (value, mode) => {
      if (mode === "save_as_variant") {
        const nextVariants = [
          { id: createLocalId(), mode, text: value, createdAt: new Date().toISOString() },
          ...variants
        ];
        setVariants(nextVariants);
        saveVariants(draft.id ?? "", nextVariants);
        return;
      }

      if (mode === "replace_selection" && selectionText) {
        editor.chain().focus().insertContent(value).run();
      } else if (mode === "insert_after_selection" && selectionText) {
        editor.chain().focus().insertContent(`${selectionText}\n\n${value}`).run();
      } else {
        editor.chain().focus().setTextSelection(editor.state.doc.content.size).insertContent(`\n\n${value}`).run();
      }
    });

    return () => unregisterSceneEditorProposalTarget(draft.id ?? "");
  }, [draft?.id, editor, selectionText, variants]);

  const currentWordCount = draft?.actualWordCount ?? countWords(editor?.getText() ?? "");
  const targetWordCount = draft?.targetWordCount ?? selectedChapter?.targetWordCount ?? null;
  const pendingEditorStatus = selectedScene
    ? pendingProposalStatus(proposals, {
        projectId,
        bookId,
        scope: "sceneEditor",
        targetEntityId: selectedScene.id
      })
    : null;

  function openCreateSceneModal(chapterId?: string | null) {
    setSceneModal({ mode: "create", chapterId: chapterId ?? activeChapterId ?? chapters[0]?.id ?? null });
  }

  function openPreviousChapter() {
    const previous = chapters[selectedChapterIndex - 1];
    if (!previous) {
      return;
    }
    setSelectedChapterId(previous.id);
    setSelectedSceneId(orderedScenes(plan.scenes.filter((scene) => scene.chapterId === previous.id))[0]?.id ?? null);
  }

  function openNextChapter() {
    const next = chapters[selectedChapterIndex + 1];
    if (!next) {
      return;
    }
    setSelectedChapterId(next.id);
    setSelectedSceneId(orderedScenes(plan.scenes.filter((scene) => scene.chapterId === next.id))[0]?.id ?? null);
  }

  function selectChapter(chapterId: string | null) {
    const nextScene = orderedScenes(
      plan.scenes.filter((scene) => (scene.chapterId ?? null) === chapterId)
    )[0];
    setSelectedChapterId(chapterId);
    setSelectedSceneId(nextScene?.id ?? null);
    setChapterPickerOpen(false);
  }

  function updateDraft(patch: Partial<UpsertSceneInput>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function activatePlanPromptContext(field: PlanFieldKey, targetEntity?: PlanPromptEntity) {
    activatePromptContextTarget(
      createPlanPromptContextTarget(projectId, field, targetEntity ? planPromptEntityId(targetEntity) : undefined, {
        submitLabel: "Wygeneruj",
        submitDisabled: !projectQuery.data || !bookId,
        submitDisabledReason: "Najpierw wczytaj dane projektu.",
        onSubmit: () => queueSceneField(field, targetEntity)
      })
    );
  }

  function activateSceneEditorPromptContext(
    field: SceneEditorFieldKey = "continueScene",
    mode: SceneEditorInsertMode = "append_to_scene"
  ) {
    if (!selectedScene) {
      return;
    }
    const targetId = sceneEditorPromptContextTargetId(projectId, selectedScene.id);
    const sources = sceneEditorPromptContextSources(selectedScene, selectedChapter);

    activatePromptContextTarget({
      targetId,
      projectId,
      title: "Pisanie sceny",
      subtitle: selectedScene.title || "Aktywna scena",
      sources,
      defaultSources: sources,
      submitLabel: "AI",
      submitDisabled: !projectQuery.data || !bookId || Boolean(pendingEditorStatus),
      submitDisabledReason: pendingEditorStatus ? "AI już pracuje nad tą sceną." : "Najpierw wczytaj dane projektu.",
      onSubmit: () => queueEditorAction(field, mode)
    });
  }

  function addSceneEditorContextSource(source: PromptContextSource) {
    addContextSourceToActiveTarget(source);
  }

  function queueSceneField(field: PlanFieldKey, targetEntity?: PlanPromptEntity, draftOverride?: UpsertSceneInput) {
    if (!projectQuery.data || !bookId) {
      return;
    }
    const baseScene = targetEntity && "manuscriptContent" in targetEntity ? targetEntity : selectedScene;
    const sourceDraft = draftOverride ?? draft;
    if (!targetEntity && !baseScene && !sourceDraft) {
      return;
    }

    const planEntity =
      targetEntity && !("manuscriptContent" in targetEntity)
        ? targetEntity
        : sourceDraft && baseScene
          ? draftToScene(baseScene, sourceDraft)
          : baseScene ?? sceneDraftPromptEntity(sourceDraft as UpsertSceneInput);
    const targetId = planPromptContextTargetId(projectId, field, planEntity.id);
    const promptPackage = buildPlanPromptPackage(
      projectQuery.data.project,
      projectQuery.data.book,
      "manuscriptContent" in planEntity
        ? { ...plan, scenes: plan.scenes.map((scene) => (scene.id === planEntity.id ? planEntity : scene)) }
        : plan,
      field,
      planEntity,
      promptContextControlForActiveTarget(targetId),
      planStoryBibleContext(characters, world)
    );

    enqueueProposal({
      scope: "bookPlan",
      projectId,
      bookId,
      field,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderPlanPromptPackage(promptPackage)
    });
    closePromptContextTarget(targetId);
  }

  function activateSceneFieldPromptContext(
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity,
    draftOverride?: UpsertSceneInput
  ) {
    const baseScene = targetEntity && "manuscriptContent" in targetEntity ? targetEntity : selectedScene;
    const sourceDraft = draftOverride ?? draft;
    const planEntity =
      targetEntity && !("manuscriptContent" in targetEntity)
        ? targetEntity
        : sourceDraft && baseScene
          ? draftToScene(baseScene, sourceDraft)
          : baseScene ?? (sourceDraft ? sceneDraftPromptEntity(sourceDraft) : undefined);

    activatePlanPromptContext(field, planEntity);
  }

  function queueEditorAction(field: SceneEditorFieldKey, mode: SceneEditorInsertMode = insertMode) {
    if (!projectQuery.data || !bookId || !selectedScene || !editor) {
      return;
    }
    const targetId = sceneEditorPromptContextTargetId(projectId, selectedScene.id);
    const contextControl =
      promptContextControlForTarget(targetId) ??
      sceneEditorDefaultContextControl(sceneEditorPromptContextSources(selectedScene, selectedChapter));
    const sceneContext = buildScenePromptContext({
      book: projectQuery.data.book,
      plan,
      characters,
      world,
      sceneId: selectedScene.id
    });
    if (!sceneContext) {
      return;
    }
    const promptPackage = buildSceneEditorPromptPackage({
      project: projectQuery.data.project,
      book: projectQuery.data.book,
      scene: selectedScene,
      sceneContext,
      characters,
      world,
      field,
      selectedText: selectionText,
      currentText: editor.getText(),
      customInstruction,
      insertMode: mode,
      targetWordCount: draft?.targetWordCount ?? selectedScene.targetWordCount ?? selectedChapter?.targetWordCount ?? null,
      manualContextSnippets: sceneEditorManualContextSnippets(plan, contextControl),
      contextControl
    });

    enqueueProposal({
      scope: "sceneEditor",
      projectId,
      bookId,
      field,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderSceneEditorPromptPackage(promptPackage)
    });
    closePromptContextTarget(targetId);
  }

  async function saveSceneFromModal(input: UpsertSceneInput, relations: Omit<SetSceneRelationsInput, "bookId" | "sceneId">) {
    if (!bookId) {
      return;
    }
    const savedScene = await upsertScene(input);
    await setSceneRelations({
      bookId,
      sceneId: savedScene.id,
      ...relations
    });
    setSelectedSceneId(savedScene.id);
    setSelectedChapterId(savedScene.chapterId ?? null);
    setSceneModal(null);
    setStatusText("Zapisano ustawienia sceny");
    await invalidatePlan();
  }

  return (
    <div className="scene-editor-page redesigned">
      <aside className="scene-chapter-rail" aria-label="Rozdziały i sceny">
        <div className="scene-rail-navigation">
          <button
            type="button"
            className="icon-button"
            title="Poprzedni rozdział"
            aria-label="Poprzedni rozdział"
            onClick={openPreviousChapter}
            disabled={selectedChapterIndex <= 0}
          >
            <ChevronLeft size={17} />
          </button>
          <div className="scene-chapter-picker">
            <button
              type="button"
              className="scene-chapter-select-card"
              onClick={() => setChapterPickerOpen((current) => !current)}
              aria-expanded={chapterPickerOpen}
              aria-haspopup="listbox"
              title="Wybierz rozdział"
            >
              <span>{selectedChapter ? `Rozdział ${selectedChapter.number}` : "Bez rozdziału"}</span>
              <strong>{selectedChapter?.workingTitle || selectedScene?.title || "Nowa scena"}</strong>
            </button>
            {chapterPickerOpen ? (
              <div className="scene-chapter-picker-menu" role="listbox" aria-label="Wybierz rozdział">
                {chapters.map((chapter) => {
                  const scenesInChapter = orderedScenes(plan.scenes.filter((scene) => scene.chapterId === chapter.id));
                  return (
                    <button
                      type="button"
                      key={chapter.id}
                      className={chapter.id === selectedChapter?.id ? "active" : ""}
                      onClick={() => selectChapter(chapter.id)}
                      role="option"
                      aria-selected={chapter.id === selectedChapter?.id}
                    >
                      <span>Rozdział {chapter.number}</span>
                      <strong>{chapter.workingTitle || "Bez tytułu"}</strong>
                      <small>{scenesInChapter.length} scen</small>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={!selectedChapter ? "active" : ""}
                  onClick={() => selectChapter(null)}
                  role="option"
                  aria-selected={!selectedChapter}
                >
                  <span>Bez rozdziału</span>
                  <strong>Sceny robocze</strong>
                  <small>{orderedScenes(plan.scenes.filter((scene) => !scene.chapterId)).length} scen</small>
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            title="Następny rozdział"
            aria-label="Następny rozdział"
            onClick={openNextChapter}
            disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <button
          type="button"
          className="ghost-button scene-chapter-settings-button"
          onClick={() => selectedChapter && setChapterModal({ mode: "edit", chapterId: selectedChapter.id })}
          disabled={!selectedChapter}
        >
          <FileText size={16} />
          Ustawienia rozdziału
        </button>

        <button
          type="button"
          className="icon-button scene-context-add-rail-button"
          onClick={() => selectedChapter && addSceneEditorContextSource(chapterPromptContextSource(selectedChapter))}
          disabled={!selectedChapter || !activePromptContextTarget || (selectedChapter ? contextSourceAlreadyAdded(activePromptContextTarget.sources, chapterPromptContextSource(selectedChapter).key) : true)}
          title="Dodaj rozdział do aktywnego kontekstu AI"
          aria-label="Dodaj rozdział do aktywnego kontekstu AI"
        >
          <Plus size={15} />
        </button>

        <div className="scene-chapter-list">
          <p className="scene-list-heading">Sceny w rozdziale</p>
          {chapterScenes.map((scene, index) => (
            <div className="scene-list-row" key={scene.id}>
            <button
              type="button"
              className={scene.id === selectedScene?.id ? "scene-list-item active" : "scene-list-item"}
              onClick={() => {
                setSelectedChapterId(scene.chapterId ?? null);
                setSelectedSceneId(scene.id);
              }}
            >
              <strong>Scena {index + 1}</strong>
              <span>{scene.title || "Scena bez tytułu"}</span>
              <small>{sceneStatusLabel(scene.status)} · {scene.actualWordCount || countWords(htmlToText(scene.manuscriptContent))} / {scene.targetWordCount ?? "?"} słów</small>
            </button>
              <button
                type="button"
                className="icon-button scene-context-add-button"
                onClick={(event) => {
                  event.stopPropagation();
                  addSceneEditorContextSource(scenePromptContextSource(scene));
                }}
                disabled={!activePromptContextTarget || contextSourceAlreadyAdded(activePromptContextTarget.sources, scenePromptContextSource(scene).key)}
                title={`Dodaj scenę do aktywnego kontekstu AI: ${scene.title || "Scena bez tytułu"}`}
                aria-label={`Dodaj scenę do aktywnego kontekstu AI: ${scene.title || "Scena bez tytułu"}`}
              >
                <Plus size={14} />
              </button>
            </div>
          ))}
          {chapterScenes.length === 0 ? <span className="scene-empty-note">Brak scen w tej sekcji.</span> : null}
        </div>

        <button type="button" className="ghost-button scene-new-button bottom" onClick={() => openCreateSceneModal()}>
          <Plus size={16} />
          Dodaj scenę
        </button>
      </aside>

      <main className="scene-editor-workbench">
        {draft && selectedScene ? (
          <section className="scene-editor-card">
            <header className="scene-editor-header">
              <div>
                <h2>{draft.title || "Scena bez tytułu"}</h2>
                <span className="chapter-status-pill ready">
                  <Circle size={10} />
                  {sceneStatusLabel(draft.status)}
                </span>
              </div>
              <div className="scene-header-actions">
                <span className="scene-editor-stat"><FileText size={14} /> {currentWordCount.toLocaleString("pl-PL")} słów</span>
                <span className="scene-editor-stat"><Target size={14} /> Cel: {targetWordCount ? targetWordCount.toLocaleString("pl-PL") : "brak"}</span>
                <span className="scene-editor-stat"><CheckCircle2 size={14} /> {pendingEditorStatus ? "AI pracuje" : "Gotowe na AI"}</span>
                <button
                  type="button"
                  className="secondary-button scene-ai-icon-button"
                  onClick={() => activateSceneEditorPromptContext("continueScene", "append_to_scene")}
                  title="AI"
                  aria-label="AI: kontynuuj scenę"
                  disabled={Boolean(pendingEditorStatus)}
                >
                  {pendingEditorStatus ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}
                </button>
              </div>
            </header>

            <nav className="scene-editor-tabs" aria-label="Widoki sceny">
              <button type="button" className="active"><FileText size={16} /> Treść</button>
              <button type="button" onClick={() => setSceneModal({ mode: "edit", sceneId: selectedScene.id })}><FileText size={16} /> Ustawienia sceny</button>
              <button type="button" disabled><PenLine size={16} /> Notatki</button>
              <button type="button" disabled><History size={16} /> Historia zmian</button>
            </nav>

            <div className="scene-writing-layout">
              <section className="scene-writing-main">
                <div className="scene-editor-frame">
                  <EditorToolbar editor={editor} />
                  {selectionText ? (
                    <div className="scene-selection-popover" role="toolbar" aria-label="AI dla zaznaczenia">
                      <span>{countWords(selectionText)} słów zaznaczenia</span>
                      <button type="button" onClick={() => activateSceneEditorPromptContext("rewriteSelection", "replace_selection")}>Przepisz</button>
                      <button type="button" onClick={() => activateSceneEditorPromptContext("expandSelection", "insert_after_selection")}>Rozwiń</button>
                      <button type="button" onClick={() => activateSceneEditorPromptContext("rewriteSelection", "replace_selection")}>Popraw dialog</button>
                      <button type="button" onClick={() => activateSceneEditorPromptContext("expandSelection", "insert_after_selection")}>Dodaj napięcie</button>
                    </div>
                  ) : null}
                  <EditorContent
                    editor={editor}
                    className="scene-editor-scroll"
                    onFocusCapture={() => activateSceneEditorPromptContext()}
                    onClick={() => activateSceneEditorPromptContext()}
                  />
                  <span className="scene-editor-word-corner">{currentWordCount.toLocaleString("pl-PL")} słów</span>
                </div>
              </section>
            </div>

            <footer className="scene-editor-actions">
              <button type="button" className="primary-button" onClick={() => draft && saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                Zapisz scenę
              </button>
              <details className="scene-variants-menu">
                <summary className="ghost-button">
                  <Sparkles size={16} />
                  {selectedVariantLabel(variants, selectedVariantId)}
                </summary>
                <div className="scene-variants-popover">
                  {variants.map((variant) => (
                    <button
                      type="button"
                      className="scene-variant-item"
                      key={variant.id}
                      onClick={() => {
                        setSelectedVariantId(variant.id);
                        editor?.chain().focus().setTextSelection(editor.state.doc.content.size).insertContent(`\n\n${variant.text}`).run();
                      }}
                    >
                      <span>{new Date(variant.createdAt).toLocaleString("pl-PL")}</span>
                      <strong>{variant.mode}</strong>
                    </button>
                  ))}
                  {variants.length === 0 ? <p>Brak zapisanych wariantów dla tej sceny.</p> : null}
                </div>
              </details>
              {false ? (
                <>
              <label className="scene-insert-mode">
                Tryb AI
                <select value={insertMode} onChange={(event) => setInsertMode(event.target.value as SceneEditorInsertMode)}>
                  <option value="replace_selection">Zastąp zaznaczenie</option>
                  <option value="insert_after_selection">Wstaw po zaznaczeniu</option>
                  <option value="append_to_scene">Dodaj na końcu sceny</option>
                  <option value="save_as_variant">Zapisz jako wariant</option>
                </select>
              </label>
              <input value={customInstruction} onChange={(event) => setCustomInstruction(event.target.value)} placeholder="Własna instrukcja dla AI" />
                </>
              ) : null}
              <span className="autosave-status">
                {saveMutation.isPending ? <Loader2 size={16} className="spin-icon" /> : <CheckCircle2 size={16} />}
                {statusText}
              </span>
            </footer>
          </section>
        ) : (
          <section className="scene-empty-workbench">
            <h2>Brak sceny do edycji</h2>
            <p>Dodaj pierwszą scenę z listy rozdziałów, żeby rozpocząć pisanie.</p>
            <button type="button" className="primary-button" onClick={() => openCreateSceneModal(chapters[0]?.id ?? null)}>
              <Plus size={16} />
              Dodaj scenę
            </button>
          </section>
        )}
      </main>

      {sceneModal ? (
        <SharedSceneEditModal
          state={sceneModal}
          bookId={bookId ?? ""}
          plan={plan}
          characters={characters}
          world={world}
          saving={saveMutation.isPending}
          selectedScene={selectedScene}
          onClose={() => setSceneModal(null)}
          onSave={saveSceneFromModal}
          onDelete={(sceneId) => sceneDeleteMutation.mutate(sceneId)}
          onGenerate={activateSceneFieldPromptContext}
          onActivatePrompt={activatePlanPromptContext}
          onLinkThreadToChapter={(threadId, chapterId) =>
            upsertChapterThreadRelation({
              bookId: bookId ?? "",
              threadId,
              chapterId,
              description: chapterThreadRelation(plan, threadId, chapterId)?.description ?? ""
            })
          }
        />
      ) : null}

      <ChapterEditModal
        state={chapterModal}
        bookId={bookId ?? ""}
        plan={plan}
        saving={chapterMutation.isPending || chapterDeleteMutation.isPending}
        onClose={() => setChapterModal(null)}
        onSave={(input) => chapterMutation.mutate(input)}
        onDelete={(chapterId) => chapterDeleteMutation.mutate(chapterId)}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />

    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  return (
    <div className="scene-editor-format-toolbar" aria-label="Formatowanie sceny">
      <select title="Styl akapitu" aria-label="Styl akapitu" defaultValue="paragraph">
        <option value="paragraph">Akapit</option>
      </select>
      <button type="button" className={editor?.isActive("bold") ? "active" : ""} onClick={() => editor?.chain().focus().toggleBold().run()} title="Pogrubienie">
        B
      </button>
      <button type="button" className={editor?.isActive("italic") ? "active" : ""} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Kursywa">
        I
      </button>
      <button type="button" className={editor?.isActive("bulletList") ? "active" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Lista">
        <List size={15} />
      </button>
      <button type="button" onClick={() => editor?.chain().focus().setParagraph().run()} title="Wyrównanie tekstu">
        <AlignLeft size={15} />
      </button>
      <button type="button" disabled title="Link">
        <Link2 size={15} />
      </button>
      <button type="button" disabled title="Obraz">
        <Image size={15} />
      </button>
    </div>
  );
}

function SceneEditModal({
  state,
  bookId,
  plan,
  characters,
  world,
  saving,
  projectId,
  selectedScene,
  onClose,
  onSave,
  onDelete,
  onGenerate,
  onActivatePrompt
}: {
  state: SceneModalState;
  bookId: string;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  saving: boolean;
  projectId: string;
  selectedScene: Scene | null;
  onClose: () => void;
  onSave: (input: UpsertSceneInput, relations: Omit<SetSceneRelationsInput, "bookId" | "sceneId">) => Promise<void>;
  onDelete: (sceneId: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity, draftOverride?: UpsertSceneInput) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  const scene = state.mode === "edit" ? plan.scenes.find((item) => item.id === state.sceneId) ?? selectedScene : null;
  const [draft, setDraft] = useState<UpsertSceneInput>(() =>
    scene ? sceneToInput(scene) : newSceneInput(bookId, plan, state.mode === "create" ? state.chapterId ?? null : null)
  );
  const [characterIds, setCharacterIds] = useState<string[]>(() => (scene ? sceneCharacterIds(plan, scene.id) : []));
  const [threadIds, setThreadIds] = useState<string[]>(() => (scene ? sceneThreadIds(plan, scene.id) : []));
  const [elementIds, setElementIds] = useState<string[]>(() => (scene ? sceneElementIds(plan, scene.id) : []));
  const [ruleIds, setRuleIds] = useState<string[]>(() => (scene ? sceneRuleIds(plan, scene.id) : []));
  const [relationPicker, setRelationPicker] = useState<SceneRelationKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const modalTitle = scene ? "Edytuj scenę" : "Nowa scena";
  const scenePromptEntity = scene ?? sceneDraftPromptEntity(draft);
  const completedItems = [draft.title, draft.summary, draft.goal, draft.conflict, draft.outcome].filter((item) => item.trim()).length;
  const isSaving = saving || submitting;

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
      await onSave(draft, { characterIds, threadIds, elementIds, ruleIds });
    } finally {
      setSubmitting(false);
    }
  }

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
    <div className="chapter-edit-modal scene-edit-modal" role="dialog" aria-modal="true" aria-labelledby="scene-modal-title">
      <button type="button" className="chapter-edit-backdrop" onClick={onClose} aria-label="Zamknij edycję sceny" />
      <div className="chapter-edit-shell scene-edit-shell">
        <header className="chapter-edit-header">
          <div>
            <p className="eyebrow">Projektowanie sceny</p>
            <h3 id="scene-modal-title">{modalTitle}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Zamknij" aria-label="Zamknij">
            <X size={18} />
          </button>
        </header>

        <div className="chapter-edit-body">
          <form className="chapter-edit-form scene-edit-form" onSubmit={submit}>
            <div className="chapter-edit-metrics" aria-label="Najważniejsze informacje o scenie">
              <span className="chapter-edit-metric"><FileText size={16} /><strong>{draft.title || "Scena bez tytułu"}</strong></span>
              <span className="chapter-edit-metric"><Target size={16} /><strong>{draft.targetWordCount ? `${draft.targetWordCount.toLocaleString("pl-PL")} słów` : "Brak celu słów"}</strong></span>
              <span className="chapter-edit-metric"><Users size={16} /><strong>{characterIds.length} postaci</strong></span>
              <span className="chapter-status-pill ready"><Circle size={10} /> {sceneStatusLabel(draft.status)}</span>
            </div>

            <div className="chapter-edit-content-grid scene-edit-content-grid">
              <main className="chapter-edit-main">
                <section className="chapter-edit-section">
                  <div className="chapter-section-heading">
                    <FileText size={17} />
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
                        rows={item.rows ?? 3}
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
                    <label className="field-label">
                      Rozdział
                      <select value={draft.chapterId ?? ""} onChange={(event) => setDraft({ ...draft, chapterId: event.target.value || null })}>
                        <option value="">Bez rozdziału</option>
                        {orderedChaptersForPlan(plan).map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>Rozdział {chapter.number}: {chapter.workingTitle || "Bez tytułu"}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      POV
                      <select value={draft.povCharacterId ?? ""} onChange={(event) => setDraft({ ...draft, povCharacterId: event.target.value || null })}>
                        <option value="">Brak</option>
                        {characters.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      Lokacja
                      <select value={draft.locationId ?? ""} onChange={(event) => setDraft({ ...draft, locationId: event.target.value || null })}>
                        <option value="">Brak</option>
                        {world.elements.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      Cel słów
                      <input type="number" min={0} value={draft.targetWordCount ?? ""} onChange={(event) => setDraft({ ...draft, targetWordCount: parseOptionalInt(event.target.value) })} />
                    </label>
                    <label className="field-label">
                      Status
                      <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Scene["status"] })}>
                        <option value="planned">Planowana</option>
                        <option value="draft">Szkic</option>
                        <option value="written">Napisana</option>
                        <option value="revision">Do redakcji</option>
                      </select>
                    </label>
                  </div>
                </section>
              </main>

              <aside className="chapter-edit-sidebar" aria-label="Powiązania sceny">
                {relationKinds.map((kind) => (
                  <SceneRelationSection
                    key={kind}
                    title={sceneRelationTitle(kind)}
                    kind={kind}
                    items={sceneRelationOptions(kind, plan, characters, world).filter((item) => currentRelationIds(kind).includes(item.id))}
                    emptyText={`Brak: ${sceneRelationTitle(kind).toLowerCase()}`}
                    onOpenPicker={setRelationPicker}
                    onRemove={(id) => setCurrentRelationIds(kind, currentRelationIds(kind).filter((item) => item !== id))}
                  />
                ))}
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
                  setCurrentRelationIds(relationPicker, uniqueOrderedIds([...currentRelationIds(relationPicker), ...ids]));
                  setRelationPicker(null);
                }}
              />
            ) : null}

            <footer className="chapter-edit-footer">
              <div className="chapter-footer-status">
                <CheckCircle2 size={16} />
                <span>{completedItems} / 5 pól sceny uzupełnionych</span>
              </div>
              <div className="chapter-footer-actions">
                {scene ? (
                  <button type="button" className="ghost-button chapter-delete-button" onClick={() => onDelete(scene.id)} disabled={isSaving}>
                    <Trash2 size={16} />
                    Usuń
                  </button>
                ) : null}
                <button type="button" className="ghost-button" onClick={onClose}>Anuluj</button>
                <button type="submit" className="primary-button" disabled={isSaving || !bookId}>
                  {isSaving ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                  {isSaving ? "Zapisuję" : "Zapisz scenę"}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
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
  targetEntity?: PlanPromptEntity;
  rows: number;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onActivatePrompt: () => void;
}) {
  return (
    <label className="field-label plan-inline-field scene-inline-field">
      <span className="plan-inline-label-row">
        {label}
        <SceneFieldAiActions field={field} targetEntity={targetEntity} onGenerate={onGenerate} onActivatePrompt={onActivatePrompt} />
      </span>
      {rows === 1 ? (
        <input value={value} onFocus={onActivatePrompt} onClick={onActivatePrompt} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <textarea value={value} rows={rows} onFocus={onActivatePrompt} onClick={onActivatePrompt} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function SceneFieldAiActions({
  field,
  targetEntity,
  onGenerate
}: {
  field: PlanFieldKey;
  targetEntity?: PlanPromptEntity;
  onGenerate: () => void;
  onActivatePrompt: () => void;
}) {
  const activeTargetId = useAiPromptContextStore((state) => state.activeTargetId);
  const activeTarget = useAiPromptContextStore((state) => (activeTargetId ? state.targets[activeTargetId] : null));
  const addContextSourceToActiveTarget = useAiPromptContextStore((state) => state.addContextSourceToActiveTarget);
  const proposals = useProposalStore((state) => state.proposals);
  const targetEntityId = targetEntity ? planPromptEntityId(targetEntity) : undefined;
  const loading = pendingProposalStatus(proposals, {
    field,
    scope: "bookPlan",
    targetEntityId
  });
  const running = loading === "running";
  const queued = loading === "queued";
  const promptContextSource = planPromptContextSource(field, targetEntity);
  const fieldAlreadyInContext = Boolean(
    activeTarget?.sources.some((source) => source.key === field || source.key === promptContextSource.key)
  );

  return (
    <span className="ai-field-actions plan-ai-actions">
      <button
        type="button"
        className="icon-button ai-field-button"
        onClick={onGenerate}
        disabled={queued || running || (targetEntity === undefined && isEntityField(field))}
        title={`Generuj ${planFieldConfigs[field].label} z AI`}
        aria-label={`Generuj ${planFieldConfigs[field].label} z AI`}
      >
        {running ? <Loader2 size={15} className="spin-icon" /> : queued ? <Clock3 size={15} /> : <Sparkles size={15} />}
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
            <span className={`chapter-side-chip ${sceneRelationDotClass(kind)}`} key={item.id} title={item.description}>
              {item.label}
              <button type="button" className="chapter-side-chip-remove" onClick={() => onRemove(item.id)} aria-label={`Odepnij relację: ${item.label}`} title={`Odepnij relację: ${item.label}`}>
                -
              </button>
            </span>
          ))
        ) : (
          <span className="chapter-side-empty">{emptyText}</span>
        )}
      </div>
      <button type="button" className="icon-button chapter-relation-add-button" onClick={() => onOpenPicker(kind)} title={`Dodaj: ${title.toLowerCase()}`} aria-label={`Dodaj relację sceny: ${title}`}>
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
  const options = sceneRelationOptions(kind, plan, characters, world).filter((item) => !selectedIds.includes(item.id));
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
    <div className="world-relation-modal scene-relation-picker-modal" role="dialog" aria-modal="true" aria-labelledby="scene-relation-picker-title">
      <button type="button" className="world-relation-backdrop" onClick={onClose} aria-label="Zamknij wybór relacji" />
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
          {options.length === 0 ? <p className="muted-text">Wszystkie elementy z tej grupy są już przypisane do sceny.</p> : null}
        </div>
        <footer className="scene-relation-picker-footer">
          <button type="button" className="ghost-button" onClick={onClose}>Anuluj</button>
          <button type="button" className="primary-button" onClick={() => onAdd(checkedIds)} disabled={checkedIds.length === 0}>
            <Plus size={16} />
            Dodaj wybrane
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function chapterLanes(plan: BookPlan): Array<{ chapter: Chapter | null; scenes: Scene[] }> {
  return [
    ...orderedChaptersForPlan(plan).map((chapter) => ({
      chapter,
      scenes: orderedScenes(plan.scenes.filter((scene) => scene.chapterId === chapter.id))
    })),
    {
      chapter: null,
      scenes: orderedScenes(plan.scenes.filter((scene) => !scene.chapterId))
    }
  ];
}

function orderedChaptersForPlan(plan: BookPlan): Chapter[] {
  return [...plan.chapters].sort((left, right) => left.orderIndex - right.orderIndex || left.number - right.number);
}

function orderedScenes(scenes: Scene[]): Scene[] {
  return [...scenes].sort((left, right) => left.orderIndex - right.orderIndex || left.title.localeCompare(right.title, "pl-PL"));
}

function newSceneInput(bookId: string, plan: BookPlan, chapterId: string | null): UpsertSceneInput {
  const chapter = chapterId ? plan.chapters.find((item) => item.id === chapterId) ?? null : null;
  return {
    bookId,
    chapterId,
    orderIndex: orderedScenes(plan.scenes.filter((scene) => (scene.chapterId ?? null) === chapterId)).length,
    title: "Nowa scena",
    summary: "",
    goal: "",
    conflict: "",
    outcome: "",
    povCharacterId: null,
    locationId: null,
    targetWordCount: chapter?.targetWordCount ?? 1200,
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
    povCharacterId: scene.povCharacterId,
    locationId: scene.locationId,
    targetWordCount: scene.targetWordCount,
    actualWordCount: scene.actualWordCount,
    manuscriptContent: scene.manuscriptContent,
    status: scene.status
  };
}

function draftToScene(scene: Scene, draft: UpsertSceneInput): Scene {
  return {
    ...scene,
    chapterId: draft.chapterId ?? null,
    title: draft.title,
    summary: draft.summary,
    goal: draft.goal,
    conflict: draft.conflict,
    outcome: draft.outcome,
    povCharacterId: draft.povCharacterId ?? null,
    locationId: draft.locationId ?? null,
    targetWordCount: draft.targetWordCount ?? null,
    actualWordCount: draft.actualWordCount ?? null,
    manuscriptContent: draft.manuscriptContent ?? "",
    status: draft.status
  };
}

function sceneDraftPromptEntity(draft: UpsertSceneInput): Scene {
  const now = new Date().toISOString();
  return {
    id: draft.id ?? "new-scene",
    bookId: draft.bookId,
    planVersionId: "",
    chapterId: draft.chapterId ?? null,
    orderIndex: draft.orderIndex,
    title: draft.title,
    summary: draft.summary,
    goal: draft.goal,
    conflict: draft.conflict,
    outcome: draft.outcome,
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

function sceneRelationIds(plan: BookPlan, sceneId: string, kind: SceneRelationKind): string[] {
  if (kind === "characters") return sceneCharacterIds(plan, sceneId);
  if (kind === "threads") return sceneThreadIds(plan, sceneId);
  if (kind === "elements") return sceneElementIds(plan, sceneId);
  return sceneRuleIds(plan, sceneId);
}

function chapterThreadRelation(plan: BookPlan, threadId: string, chapterId: string) {
  return plan.chapterThreads.find(
    (relation) => relation.threadId === threadId && relation.chapterId === chapterId
  );
}

function sceneRelationInputKey(kind: SceneRelationKind): keyof Omit<SetSceneRelationsInput, "bookId" | "sceneId"> {
  if (kind === "characters") return "characterIds";
  if (kind === "threads") return "threadIds";
  if (kind === "elements") return "elementIds";
  return "ruleIds";
}

function sceneRelationOptions(kind: SceneRelationKind, plan: BookPlan, characters: CharacterWorkspace, world: WorldWorkspace): Array<{ id: string; label: string; description: string }> {
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

function sceneStatusLabel(status: Scene["status"]): string {
  if (status === "written") return "Napisana";
  if (status === "draft") return "Szkic";
  if (status === "revision") return "Do redakcji";
  return "Planowana";
}

function planPromptEntityId(entity: PlanPromptEntity): string {
  return entity.id;
}

function sceneEditorPromptContextTargetId(projectId: string, sceneId: string): string {
  return `project:${projectId}:scene-editor:continueScene:${sceneId}`;
}

function sceneEditorPromptContextSources(scene: Scene, chapter: Chapter | null): PromptContextSource[] {
  return [
    { key: "sceneEditor:continueScene", label: "Kontynuacja sceny", required: true },
    { key: "sceneEditor:bookCore", label: "Książka i styl", required: false },
    { key: `sceneEditor:activeScene:${scene.id}`, label: `Aktywna scena: ${scene.title || "bez tytułu"}`, required: true },
    ...(chapter ? [{ key: `sceneEditor:activeChapter:${chapter.id}`, label: `Rozdział ${chapter.number}: ${chapter.workingTitle || "bez tytułu"}`, required: false }] : []),
    { key: "sceneEditor:relations", label: "Powiązane postacie, wątki i świat", required: false }
  ];
}

function scenePromptContextSource(scene: Scene): PromptContextSource {
  return {
    key: `scene-context:${scene.id}`,
    label: `Scena: ${scene.title || "bez tytułu"}`,
    required: false
  };
}

function chapterPromptContextSource(chapter: Chapter): PromptContextSource {
  return {
    key: `chapter-context:${chapter.id}`,
    label: `Rozdział ${chapter.number}: ${chapter.workingTitle || "bez tytułu"}`,
    required: false
  };
}

function contextSourceAlreadyAdded(sources: PromptContextSource[], key: string): boolean {
  return sources.some((source) => source.key === key);
}

function sceneEditorDefaultContextControl(sources: PromptContextSource[]) {
  return {
    includedContextKeys: sources.map((source) => source.key),
    authorPriorityComment: "",
    contextSources: sources
  };
}

function sceneEditorManualContextSnippets(
  plan: BookPlan,
  contextControl: ReturnType<typeof promptContextControlForTarget>
): Array<{ key: string; label: string; content: string }> {
  if (!contextControl) {
    return [];
  }

  return contextControl.contextSources
    .filter((source) => contextControl.includedContextKeys.includes(source.key))
    .map((source) => {
      if (source.key.startsWith("scene-context:")) {
        const sceneId = source.key.replace("scene-context:", "");
        const scene = plan.scenes.find((item) => item.id === sceneId);
        return scene
          ? {
              key: source.key,
              label: source.label,
              content: [
                `Tytuł: ${scene.title || "bez tytułu"}`,
                `Streszczenie: ${scene.summary || "(brak)"}`,
                `Cel: ${scene.goal || "(brak)"}`,
                `Konflikt: ${scene.conflict || "(brak)"}`,
                `Wynik: ${scene.outcome || "(brak)"}`,
                `Tekst: ${compactText(htmlToText(scene.manuscriptContent), 900)}`
              ].join("\n")
            }
          : null;
      }

      if (source.key.startsWith("chapter-context:")) {
        const chapterId = source.key.replace("chapter-context:", "");
        const chapter = plan.chapters.find((item) => item.id === chapterId);
        const scenes = orderedScenes(plan.scenes.filter((scene) => scene.chapterId === chapterId));
        return chapter
          ? {
              key: source.key,
              label: source.label,
              content: [
                `Tytuł: ${chapter.workingTitle || "bez tytułu"}`,
                `Streszczenie: ${chapter.summary || "(brak)"}`,
                `Cel: ${chapter.purpose || "(brak)"}`,
                `Konflikt: ${chapter.conflict || "(brak)"}`,
                `Punkt zwrotny: ${chapter.turningPoint || "(brak)"}`,
                `Sceny: ${scenes.map((scene) => `${scene.title || "bez tytułu"} - ${compactText(scene.summary || htmlToText(scene.manuscriptContent), 220)}`).join(" | ")}`
              ].join("\n")
            }
          : null;
      }

      return null;
    })
    .filter((snippet): snippet is { key: string; label: string; content: string } => Boolean(snippet));
}

function selectedVariantLabel(variants: SceneVariant[], selectedVariantId: string | null): string {
  const selected = selectedVariantId ? variants.find((variant) => variant.id === selectedVariantId) : null;
  return selected ? `Wariant: ${new Date(selected.createdAt).toLocaleString("pl-PL")}` : "Warianty AI";
}

function isEntityField(field: PlanFieldKey): boolean {
  return [
    "sceneTitle",
    "sceneSummary",
    "sceneGoal",
    "sceneConflict",
    "sceneOutcome",
    "sceneRelationSuggestions"
  ].includes(field);
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function uniqueOrderedIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function selectedTextFromEditor(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  return empty ? "" : editor.state.doc.textBetween(from, to, "\n").trim();
}

function parseOptionalInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function signature(input: UpsertSceneInput): string {
  return JSON.stringify(input);
}

function createLocalId(): string {
  return "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
}

function variantsKey(sceneId: string): string {
  return `storyforge2:scene-variants:${sceneId}`;
}

function loadVariants(sceneId: string): SceneVariant[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(variantsKey(sceneId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSceneVariant) : [];
  } catch {
    return [];
  }
}

function saveVariants(sceneId: string, variants: SceneVariant[]) {
  window.localStorage.setItem(variantsKey(sceneId), JSON.stringify(variants.slice(0, 12)));
}

function isSceneVariant(value: unknown): value is SceneVariant {
  return Boolean(value && typeof value === "object" && "text" in value && "createdAt" in value);
}

function emptyPlan(): BookPlan {
  const now = new Date().toISOString();
  const planVersion = {
    id: "",
    bookId: "",
    name: "Plan główny",
    description: "",
    isActive: true,
    createdAt: now,
    updatedAt: now
  };
  return {
    planVersion,
    planVersions: [planVersion],
    structure: null,
    acts: [],
    beats: [],
    threads: [],
    chapters: [],
    chapterThreads: [],
    chapterBeats: [],
    scenes: [],
    sceneCharacters: [],
    sceneThreads: [],
    sceneWorldElements: [],
    sceneWorldRules: []
  };
}

function emptyCharacterWorkspace(): CharacterWorkspace {
  return { characters: [], relations: [], memories: [], memoryLinks: [], visualAssets: [] };
}

function emptyWorldWorkspace(): WorldWorkspace {
  return {
    elements: [],
    rules: [],
    elementCharacters: [],
    elementThreads: [],
    elementChapters: [],
    elementScenes: [],
    elementRules: [],
    ruleThreads: [],
    ruleChapters: [],
    ruleScenes: [],
    visualAssets: []
  };
}
