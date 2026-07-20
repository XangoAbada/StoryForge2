import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { FileText, List, PanelLeftClose, PanelLeftOpen, PenLine, Pilcrow, Plus, Redo2, Save, Sparkles, Star, StretchHorizontal, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSceneSnapshot,
  deleteChapter,
  deleteScene,
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getSceneSnapshot,
  getWorldWorkspace,
  listSceneSnapshots,
  restoreSceneSnapshot,
  setSceneRelations,
  setSceneStyleReference,
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
  refreshSceneAutoSummary,
  refreshStaleContinuity,
  scheduleSceneAutoSummary
} from "../ai/continuitySummaryService";
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
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
  buildSceneCritiquePromptPackage,
  renderSceneCritiquePromptPackage,
  SCENE_CRITIQUE_FIELD
} from "../ai/sceneCritiquePromptPackage";
import {
  registerCritiqueApplyTarget,
  unregisterCritiqueApplyTarget,
  type SceneCritiqueReportFinding
} from "../ai/sceneCritiqueStore";
import { findQuoteRangeInDoc } from "./sceneDocSearch";
import { proseToEditorHtml } from "./sceneProseHtml";
import {
  buildPlanPromptPackage,
  planStoryBibleContext,
  PlanFieldKey,
  renderPlanPromptPackage
} from "../ai/planPromptPackage";
import { Button, Chip, EmptyState, Field, Segmented, StatusPill } from "../../shared/ui";
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

const relationKinds: SceneRelationKind[] = ["characters", "threads", "elements", "rules"];

const insertModeIds: ReadonlyArray<{ id: SceneEditorInsertMode; labelKey: string }> = [
  { id: "append_to_scene", labelKey: "scenes.insertModeAppend" },
  { id: "replace_selection", labelKey: "scenes.insertModeReplace" },
  { id: "insert_after_selection", labelKey: "scenes.insertModeAfter" },
  { id: "save_as_variant", labelKey: "scenes.insertModeVariant" }
];

export function SceneEditorPage({ projectId }: SceneEditorPageProps) {
  const { t } = useTranslation();
  const insertModeItems = insertModeIds.map((item) => ({ id: item.id, label: t(item.labelKey) }));
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
  const [statusText, setStatusText] = useState(t("scenes.statusSelectScene"));
  const [variants, setVariants] = useState<SceneVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<{ id: string; text: string } | null>(null);
  const [editorWidth, setEditorWidth] = useState<"narrow" | "wide">(
    () => (localStorage.getItem("storyforge2.ui.editorWidth") === "wide" ? "wide" : "narrow")
  );
  const toggleEditorWidth = () =>
    setEditorWidth((current) => {
      const next = current === "wide" ? "narrow" : "wide";
      localStorage.setItem("storyforge2.ui.editorWidth", next);
      return next;
    });
  const [railOpen, setRailOpen] = useState<boolean>(
    () => localStorage.getItem("storyforge2.ui.sceneRailOpen") !== "false"
  );
  const toggleRail = () =>
    setRailOpen((current) => {
      const next = !current;
      localStorage.setItem("storyforge2.ui.sceneRailOpen", String(next));
      return next;
    });
  const lastSavedSignature = useRef("");
  const critiqueApplyHandlerRef = useRef<(finding: SceneCritiqueReportFinding) => boolean>(
    () => false
  );

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
  const searchSceneId = useProjectNavigationStore(
    (state) => state.viewState[projectId]?.searchSceneId
  );
  const clearProjectViewState = useProjectNavigationStore(
    (state) => state.clearProjectViewState
  );

  useEffect(() => {
    if (!searchSceneId) {
      return;
    }
    const scene = plan.scenes.find((item) => item.id === searchSceneId);
    if (scene) {
      setSelectedSceneId(scene.id);
      setSelectedChapterId(scene.chapterId ?? null);
      clearProjectViewState(projectId, "searchSceneId");
    }
  }, [clearProjectViewState, plan.scenes, projectId, searchSceneId]);
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
  const selectedSceneIndex = selectedScene
    ? chapterScenes.findIndex((scene) => scene.id === selectedScene.id)
    : -1;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t("scenes.editorPlaceholder")
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

  const snapshotsQuery = useQuery({
    queryKey: ["scene-snapshots", selectedSceneId],
    queryFn: () => listSceneSnapshots(selectedSceneId ?? ""),
    enabled: Boolean(selectedSceneId),
    retry: 0
  });

  const snapshotMutation = useMutation({
    mutationFn: () => createSceneSnapshot(selectedSceneId ?? "", "manual"),
    onSuccess: async (snapshot) => {
      setStatusText(snapshot ? t("scenes.snapshotSaved") : t("scenes.snapshotEmptyScene"));
      await queryClient.invalidateQueries({ queryKey: ["scene-snapshots", selectedSceneId] });
    },
    onError: (error) => setStatusText(error instanceof Error ? error.message : t("scenes.snapshotError"))
  });

  const restoreSnapshotMutation = useMutation({
    mutationFn: (snapshotId: string) => restoreSceneSnapshot(snapshotId),
    onSuccess: async (scene) => {
      editor?.commands.setContent(scene.manuscriptContent || "", { emitUpdate: false });
      setDraft((current) => {
        if (!current) {
          return current;
        }
        const next = {
          ...current,
          manuscriptContent: scene.manuscriptContent,
          actualWordCount: scene.actualWordCount
        };
        lastSavedSignature.current = signature(next);
        return next;
      });
      setSnapshotPreview(null);
      setStatusText(t("scenes.snapshotRestored"));
      await invalidatePlan();
      await queryClient.invalidateQueries({ queryKey: ["scene-snapshots", selectedSceneId] });
    },
    onError: (error) => setStatusText(error instanceof Error ? error.message : t("scenes.restoreError"))
  });

  const saveMutation = useMutation({
    mutationFn: async (input: UpsertSceneInput) => upsertScene(input),
    onSuccess: async (scene) => {
      setSelectedSceneId(scene.id);
      setStatusText(t("scenes.savedAt", { time: new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) }));
      await invalidatePlan();
      // Streszczenie ciągłości odświeża się w tle po pauzie w pisaniu.
      if (bookId) {
        scheduleSceneAutoSummary(projectId, bookId, scene.id, {
          onSaved: invalidatePlan,
          onStatus: setStatusText
        });
      }
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
      setStatusText(t("scenes.sceneDeleted"));
      await invalidatePlan();
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const styleReferenceMutation = useMutation({
    mutationFn: setSceneStyleReference,
    onSuccess: async (scene) => {
      setStatusText(
        scene.isStyleReference
          ? t("scenes.styleReferenceMarked")
          : t("scenes.styleReferenceUnmarked")
      );
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
      setStatusText(t("scenes.chapterSettingsSaved"));
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
      setStatusText(t("scenes.chapterDeleted"));
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

  // Wejście do edytora domyka w tle nieaktualne streszczenia rozdziałów
  // i story so far (świeży kontekst ciągłości przed pisaniem).
  useEffect(() => {
    if (bookId) {
      void refreshStaleContinuity(projectId, bookId, { onSaved: invalidatePlan });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, bookId]);

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
    setStatusText(t("scenes.sceneReady"));
  }, [editor, selectedScene?.id]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    const nextSignature = signature(draft);
    if (nextSignature === lastSavedSignature.current) {
      return;
    }

    setStatusText(t("scenes.autosave"));
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

    registerSceneEditorProposalTarget(draft.id, async (value, mode, selectedText) => {
      if (mode === "save_as_variant") {
        const nextVariants = [
          { id: createLocalId(), mode, text: value, createdAt: new Date().toISOString() },
          ...variants
        ];
        setVariants(nextVariants);
        saveVariants(draft.id ?? "", nextVariants);
        return;
      }

      // Migawka bieżącego tekstu, zanim propozycja AI go zmieni.
      if (draft.id) {
        void createSceneSnapshot(draft.id, "ai_replace")
          .then(() => queryClient.invalidateQueries({ queryKey: ["scene-snapshots", draft.id] }))
          .catch(() => undefined);
      }

      // Zaznaczenie lokalizujemy po tekście z propozycji (żywe zaznaczenie ProseMirror
      // ginie przy zmianie widoku), a prozę AI wstawiamy jako HTML z akapitami.
      const html = proseToEditorHtml(value);
      const range = selectedText ? findQuoteRangeInDoc(editor.state.doc, selectedText) : null;

      if (mode === "replace_selection" && range) {
        editor.chain().focus().insertContentAt(range, html).run();
      } else if (mode === "insert_after_selection" && range) {
        editor.chain().focus().insertContentAt(range.to, html).run();
      } else {
        editor.chain().focus().setTextSelection(editor.state.doc.content.size).insertContent(html).run();
        if (mode !== "append_to_scene" && selectedText) {
          setStatusText(t("scenes.quoteNotFoundAppended"));
        }
      }
    });

    return () => unregisterSceneEditorProposalTarget(draft.id ?? "");
  }, [draft?.id, editor, variants]);

  // Handler "Zastosuj" z panelu krytyki — świeża wersja co render (domknięcia
  // nad draft/planem), rejestracja w registrze tylko przy zmianie sceny.
  critiqueApplyHandlerRef.current = (finding) => {
    if (!editor) {
      return false;
    }
    const range = findQuoteRangeInDoc(editor.state.doc, finding.quote);
    if (!range) {
      setStatusText(t("scenes.quoteNotFoundInScene"));
      return false;
    }
    editor.chain().focus().setTextSelection(range).run();
    const selectedText = editor.state.doc.textBetween(range.from, range.to, "\n");
    const instruction = [finding.title, finding.description, finding.suggestion]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    queueEditorAction("rewriteSelection", "replace_selection", {
      selectedText,
      customInstruction: instruction
    });
    setStatusText(t("scenes.fragmentSelectedQueued"));
    return true;
  };

  useEffect(() => {
    if (!draft?.id || !editor) {
      return;
    }
    const sceneId = draft.id;
    registerCritiqueApplyTarget(sceneId, (finding) => critiqueApplyHandlerRef.current(finding));
    return () => unregisterCritiqueApplyTarget(sceneId);
  }, [draft?.id, editor]);

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
  const pendingCritiqueStatus = selectedScene
    ? pendingProposalStatus(proposals, {
        projectId,
        bookId,
        scope: "sceneEditor",
        field: SCENE_CRITIQUE_FIELD,
        targetEntityId: selectedScene.id
      })
    : null;

  function openCreateSceneModal(chapterId?: string | null) {
    setSceneModal({ mode: "create", chapterId: chapterId ?? activeChapterId ?? chapters[0]?.id ?? null });
  }

  function selectChapter(chapterId: string | null) {
    const nextScene = orderedScenes(
      plan.scenes.filter((scene) => (scene.chapterId ?? null) === chapterId)
    )[0];
    setSelectedChapterId(chapterId);
    setSelectedSceneId(nextScene?.id ?? null);
  }

  function updateDraft(patch: Partial<UpsertSceneInput>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function activatePlanPromptContext(field: PlanFieldKey, targetEntity?: PlanPromptEntity) {
    activatePromptContextTarget(
      createPlanPromptContextTarget(projectId, field, targetEntity ? planPromptEntityId(targetEntity) : undefined, {
        submitLabel: t("scenes.generate"),
        submitDisabled: !projectQuery.data || !bookId,
        submitDisabledReason: t("scenes.loadProjectFirst"),
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
      title: t("scenes.sceneWriting"),
      subtitle: selectedScene.title || t("scenes.activeScene"),
      sources,
      defaultSources: sources,
      submitLabel: t("scenes.aiButton"),
      submitDisabled: !projectQuery.data || !bookId || Boolean(pendingEditorStatus),
      submitDisabledReason: pendingEditorStatus ? t("scenes.aiAlreadyWorking") : t("scenes.loadProjectFirst"),
      onSubmit: () => queueEditorAction(field, mode),
      renderPrompt: () => renderSceneEditorPrompt(field, mode)
    });
  }

  function renderSceneEditorPrompt(field: SceneEditorFieldKey, mode: SceneEditorInsertMode): string {
    if (!projectQuery.data || !bookId || !selectedScene || !editor) {
      return "";
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
      return "";
    }
    return renderSceneEditorPromptPackage(
      buildSceneEditorPromptPackage({
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
      })
    );
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

  function queueEditorAction(
    field: SceneEditorFieldKey,
    mode: SceneEditorInsertMode = insertMode,
    // Stany React aktualizują się asynchronicznie — przy programowym zaznaczeniu
    // (np. "Zastosuj" z krytyki) selekcję i instrukcję trzeba podać wprost.
    overrides?: { selectedText?: string; customInstruction?: string }
  ) {
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
      selectedText: overrides?.selectedText ?? selectionText,
      currentText: editor.getText(),
      customInstruction: overrides?.customInstruction ?? customInstruction,
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

  function queueSceneCritique() {
    if (!projectQuery.data || !bookId || !selectedScene || !editor) {
      return;
    }
    const sceneText = editor.getText();
    if (!sceneText.trim()) {
      setStatusText(t("scenes.sceneNoTextForCritique"));
      return;
    }
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
    const promptPackage = buildSceneCritiquePromptPackage({
      project: projectQuery.data.project,
      book: projectQuery.data.book,
      scene: selectedScene,
      sceneContext,
      sceneText
    });

    enqueueProposal({
      scope: "sceneEditor",
      projectId,
      bookId,
      field: SCENE_CRITIQUE_FIELD,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderSceneCritiquePromptPackage(promptPackage)
    });
    setStatusText(t("scenes.editorReadingScene"));
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
    setStatusText(t("scenes.sceneSettingsSaved"));
    await invalidatePlan();
  }

  return (
    <div className="scene-editor-page" data-rail={railOpen ? "open" : "closed"}>
      <aside className="scene-rail" aria-label={t("scenes.railAriaLabel")}>
        <Button
          variant="icon"
          className="scene-rail-toggle"
          onClick={toggleRail}
          aria-expanded={railOpen}
          title={railOpen ? t("scenes.railCollapse") : t("scenes.railExpand")}
          aria-label={railOpen ? t("scenes.railCollapse") : t("scenes.railExpand")}
        >
          {railOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </Button>
        <Field label={t("scenes.chapter")}>
          <select value={activeChapterId ?? ""} onChange={(event) => selectChapter(event.target.value || null)}>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.number} — {chapter.workingTitle || t("scenes.untitled")}
              </option>
            ))}
            <option value="">{t("scenes.noChapter")}</option>
          </select>
        </Field>

        <div className="scene-rail-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectedChapter && setChapterModal({ mode: "edit", chapterId: selectedChapter.id })}
            disabled={!selectedChapter}
          >
            <FileText size={15} />
            {t("scenes.chapterSettings")}
          </Button>
          <Button
            variant="icon"
            className="scene-context-add-rail-button"
            onClick={() => selectedChapter && addSceneEditorContextSource(chapterPromptContextSource(selectedChapter))}
            disabled={!selectedChapter || !activePromptContextTarget || (selectedChapter ? contextSourceAlreadyAdded(activePromptContextTarget.sources, chapterPromptContextSource(selectedChapter).key) : true)}
            title={t("scenes.addChapterToContext")}
            aria-label={t("scenes.addChapterToContext")}
          >
            <Plus size={15} />
          </Button>
        </div>

        <div className="scene-rail-list">
          <span className="ui-field-label">{t("scenes.scenesLabel")}</span>
          <ul className="scene-list">
            {chapterScenes.map((scene) => {
              const words = scene.actualWordCount || countWords(htmlToText(scene.manuscriptContent));
              return (
                <li className="scene-list-row" key={scene.id}>
                  <button
                    type="button"
                    className={scene.id === selectedScene?.id ? "scene-item active" : "scene-item"}
                    onClick={() => {
                      setSelectedChapterId(scene.chapterId ?? null);
                      setSelectedSceneId(scene.id);
                    }}
                  >
                    <span className="t">{scene.title || t("scenes.sceneUntitled")}</span>
                    <span className="m">
                      <StatusPill tone={sceneStatusTone(scene.status)}>{t(sceneStatusLabelKey(scene.status))}</StatusPill>
                      <span>{words > 0 ? t("scenes.wordsCount", { count: words }) : "—"}</span>
                    </span>
                  </button>
                  <div className="scene-row-actions">
                    <Button
                      variant="icon"
                      className={scene.isStyleReference ? "scene-style-reference-button active" : "scene-style-reference-button"}
                      onClick={() =>
                        styleReferenceMutation.mutate({
                          sceneId: scene.id,
                          isStyleReference: scene.isStyleReference ? 0 : 1
                        })
                      }
                      disabled={styleReferenceMutation.isPending}
                      title={
                        scene.isStyleReference
                          ? t("scenes.styleReferenceActiveTitle")
                          : t("scenes.styleReferenceMarkTitle")
                      }
                      aria-label={t("scenes.styleReferenceAria", { title: scene.title || t("scenes.sceneUntitled") })}
                      aria-pressed={Boolean(scene.isStyleReference)}
                    >
                      <Star size={14} fill={scene.isStyleReference ? "currentColor" : "none"} />
                    </Button>
                    <Button
                      variant="icon"
                      className="scene-context-add-button"
                      onClick={() => addSceneEditorContextSource(scenePromptContextSource(scene))}
                      disabled={!activePromptContextTarget || contextSourceAlreadyAdded(activePromptContextTarget.sources, scenePromptContextSource(scene).key)}
                      title={t("scenes.addSceneToContext", { title: scene.title || t("scenes.sceneUntitled") })}
                      aria-label={t("scenes.addSceneToContext", { title: scene.title || t("scenes.sceneUntitled") })}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {chapterScenes.length === 0 ? <span className="scene-empty-note">{t("scenes.noScenesInSection")}</span> : null}
        </div>

        <Button block onClick={() => openCreateSceneModal()}>
          <Plus size={15} />
          {t("scenes.newScene")}
        </Button>
      </aside>

      <main className="manuscript-wrap" data-width={editorWidth}>
        {draft && selectedScene ? (
          <>
            <EditorToolbar editor={editor} width={editorWidth} onToggleWidth={toggleEditorWidth} />

            {selectionText ? (
              <div className="scene-selection-popover" role="toolbar" aria-label={t("scenes.aiForSelection")}>
                <span>{t("scenes.wordsSelected", { count: countWords(selectionText) })}</span>
                <Button variant="ai" size="sm" onClick={() => activateSceneEditorPromptContext("rewriteSelection", "replace_selection")}>{t("scenes.rewrite")}</Button>
                <Button variant="ai" size="sm" onClick={() => activateSceneEditorPromptContext("expandSelection", "insert_after_selection")}>{t("scenes.expand")}</Button>
                <Button variant="ai" size="sm" onClick={() => activateSceneEditorPromptContext("rewriteSelection", "replace_selection")}>{t("scenes.fixDialogue")}</Button>
                <Button variant="ai" size="sm" onClick={() => activateSceneEditorPromptContext("expandSelection", "insert_after_selection")}>{t("scenes.addTension")}</Button>
              </div>
            ) : null}

            <article className="manuscript">
              <div className="scene-no">
                {selectedChapter ? t("scenes.chapterLabel", { number: selectedChapter.number }) : t("scenes.draftScenes")}
                {selectedSceneIndex >= 0 ? t("scenes.sceneNumber", { number: selectedSceneIndex + 1 }) : ""}
              </div>
              <h2>{draft.title || t("scenes.sceneUntitled")}</h2>
              <EditorContent
                editor={editor}
                onFocusCapture={() => activateSceneEditorPromptContext()}
                onClick={() => activateSceneEditorPromptContext()}
              />
              <div className="ms-count">
                {t("scenes.sceneWordCount", { count: currentWordCount })}
                {targetWordCount ? t("scenes.sceneTarget", { target: targetWordCount.toLocaleString("pl-PL") }) : ""}
              </div>
            </article>

            <div className="scene-meta-row">
              <StatusPill tone={sceneStatusTone(draft.status)}>{t(sceneStatusLabelKey(draft.status))}</StatusPill>
              {relationKinds.flatMap((kind) =>
                sceneRelationOptions(kind, plan, characters, world, t)
                  .filter((item) => sceneRelationIds(plan, selectedScene.id, kind).includes(item.id))
                  .map((item) => (
                    <Chip
                      key={`${kind}:${item.id}`}
                      tone={kind === "threads" ? "accent" : kind === "rules" ? "ai" : "plain"}
                      title={item.description}
                    >
                      {item.label}
                    </Chip>
                  ))
              )}
              <Chip onClick={() => setSceneModal({ mode: "edit", sceneId: selectedScene.id })}>{t("scenes.linkRelation")}</Chip>
            </div>

            <section className="scene-ai-panel" aria-label={t("scenes.aiWritingPanel")}>
              <h3><Sparkles size={14} aria-hidden /> {t("scenes.aiWritingPanel")}</h3>
              <Field label={t("scenes.customInstruction")}>
                <input
                  value={customInstruction}
                  onChange={(event) => setCustomInstruction(event.target.value)}
                  placeholder={t("scenes.customInstructionPlaceholder")}
                />
              </Field>
              <div className="scene-ai-mode">
                <span className="ui-field-label">{t("scenes.insertMode")}</span>
                <Segmented
                  ariaLabel={t("scenes.insertMode")}
                  items={insertModeItems}
                  value={insertMode}
                  onChange={(mode) => setInsertMode(mode)}
                />
              </div>
              <div className="scene-ai-actions">
                <Button
                  variant="ai"
                  busy={Boolean(pendingEditorStatus)}
                  onClick={() => activateSceneEditorPromptContext("continueScene", insertMode)}
                >
                  <Sparkles size={15} />
                  {pendingEditorStatus ? t("scenes.aiWorking") : t("scenes.generateContinuation")}
                </Button>
                <Button
                  variant="ghost"
                  busy={Boolean(pendingCritiqueStatus)}
                  title={t("scenes.editorTitle")}
                  onClick={() => queueSceneCritique()}
                >
                  <PenLine size={15} />
                  {pendingCritiqueStatus ? t("scenes.editorReading") : t("scenes.editorButton")}
                </Button>
                <details className="scene-variants-menu">
                  <summary>
                    <Sparkles size={15} aria-hidden />
                    {selectedVariantLabel(t, variants, selectedVariantId)}
                  </summary>
                  <div className="scene-variants-popover">
                    {variants.map((variant) => (
                      <button
                        type="button"
                        className="scene-variant-item"
                        key={variant.id}
                        onClick={() => {
                          setSelectedVariantId(variant.id);
                          editor?.chain().focus().setTextSelection(editor.state.doc.content.size).insertContent(proseToEditorHtml(variant.text)).run();
                        }}
                      >
                        <span>{new Date(variant.createdAt).toLocaleString("pl-PL")}</span>
                        <strong>{variant.mode}</strong>
                      </button>
                    ))}
                    {variants.length === 0 ? <p>{t("scenes.noSavedVariants")}</p> : null}
                  </div>
                </details>
                <details className="scene-variants-menu scene-history-menu">
                  <summary>
                    <Undo2 size={15} aria-hidden />
                    {t("scenes.history", { count: snapshotsQuery.data?.length ?? 0 })}
                  </summary>
                  <div className="scene-variants-popover">
                    <Button
                      variant="ghost"
                      busy={snapshotMutation.isPending}
                      onClick={() => snapshotMutation.mutate()}
                    >
                      <Save size={14} />
                      {t("scenes.saveSnapshotNow")}
                    </Button>
                    <Button
                      variant="ghost"
                      title={t("scenes.refreshSceneSummaryTitle")}
                      onClick={() => {
                        if (bookId && selectedSceneId) {
                          setStatusText(t("scenes.refreshingSceneSummary"));
                          void refreshSceneAutoSummary(
                            projectId,
                            bookId,
                            selectedSceneId,
                            { onSaved: invalidatePlan, onStatus: setStatusText },
                            true
                          );
                        }
                      }}
                    >
                      <Sparkles size={14} />
                      {t("scenes.refreshSceneSummary")}
                    </Button>
                    {(snapshotsQuery.data ?? []).map((snapshot) => (
                      <div className="scene-snapshot-item" key={snapshot.id}>
                        <button
                          type="button"
                          className="scene-variant-item"
                          title={t("scenes.snapshotPreviewTitle")}
                          onClick={() => {
                            if (snapshotPreview?.id === snapshot.id) {
                              setSnapshotPreview(null);
                              return;
                            }
                            void getSceneSnapshot(snapshot.id).then((full) =>
                              setSnapshotPreview({
                                id: snapshot.id,
                                text: `${full.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400)}…`
                              })
                            );
                          }}
                        >
                          <span>{new Date(snapshot.createdAt).toLocaleString("pl-PL")}</span>
                          <strong>
                            {t("scenes.snapshotWords", { source: t(snapshotSourceLabelKey(snapshot.source)), count: snapshot.wordCount })}
                          </strong>
                        </button>
                        {snapshotPreview?.id === snapshot.id ? (
                          <p className="scene-snapshot-preview">{snapshotPreview.text}</p>
                        ) : null}
                        <Button
                          variant="ghost"
                          busy={restoreSnapshotMutation.isPending}
                          onClick={() => restoreSnapshotMutation.mutate(snapshot.id)}
                        >
                          {t("scenes.restore")}
                        </Button>
                      </div>
                    ))}
                    {(snapshotsQuery.data ?? []).length === 0 ? (
                      <p>{t("scenes.noSnapshots")}</p>
                    ) : null}
                  </div>
                </details>
              </div>
            </section>

            <footer className="scene-save-row">
              <Button variant="primary" busy={saveMutation.isPending} onClick={() => draft && saveMutation.mutate(draft)}>
                <Save size={15} />
                {t("scenes.saveScene")}
              </Button>
              <Button variant="ghost" onClick={() => setSceneModal({ mode: "edit", sceneId: selectedScene.id })}>
                <FileText size={15} />
                {t("scenes.sceneSettings")}
              </Button>
              <span className="scene-autosave">{statusText}</span>
            </footer>
          </>
        ) : (
          <EmptyState
            icon={<PenLine size={28} aria-hidden />}
            title={t("scenes.noSceneTitle")}
            description={t("scenes.noSceneDescription")}
            action={
              <Button variant="primary" onClick={() => openCreateSceneModal(chapters[0]?.id ?? null)}>
                <Plus size={15} />
                {t("scenes.addScene")}
              </Button>
            }
          />
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
          onEnsureSaved={(input) => upsertScene(input)}
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

function EditorToolbar({
  editor,
  width,
  onToggleWidth
}: {
  editor: Editor | null;
  width: "narrow" | "wide";
  onToggleWidth: () => void;
}) {
  const { t } = useTranslation();
  const widthLabel = width === "wide" ? t("scenes.editorWidthNarrow") : t("scenes.editorWidthWide");
  return (
    <div className="ms-toolbar" role="toolbar" aria-label={t("scenes.formatToolbarAria")}>
      <Button
        variant="icon"
        className={editor?.isActive("bold") ? "active" : ""}
        onClick={() => editor?.chain().focus().toggleBold().run()}
        title={t("scenes.bold")}
        aria-label={t("scenes.bold")}
      >
        <b>B</b>
      </Button>
      <Button
        variant="icon"
        className={editor?.isActive("italic") ? "active" : ""}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        title={t("scenes.italic")}
        aria-label={t("scenes.italic")}
      >
        <i>I</i>
      </Button>
      <span className="sep" aria-hidden />
      <Button
        variant="icon"
        className={editor?.isActive("bulletList") ? "active" : ""}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        title={t("scenes.list")}
        aria-label={t("scenes.list")}
      >
        <List size={15} />
      </Button>
      <Button
        variant="icon"
        onClick={() => editor?.chain().focus().setParagraph().run()}
        title={t("scenes.paragraph")}
        aria-label={t("scenes.paragraph")}
      >
        <Pilcrow size={15} />
      </Button>
      <span className="sep" aria-hidden />
      <Button variant="icon" onClick={() => editor?.chain().focus().undo().run()} title={t("scenes.undo")} aria-label={t("scenes.undo")}>
        <Undo2 size={15} />
      </Button>
      <Button variant="icon" onClick={() => editor?.chain().focus().redo().run()} title={t("scenes.redo")} aria-label={t("scenes.redo")}>
        <Redo2 size={15} />
      </Button>
      <span className="sep" aria-hidden />
      <Button
        variant="icon"
        className={width === "wide" ? "active" : ""}
        onClick={onToggleWidth}
        title={widthLabel}
        aria-label={widthLabel}
      >
        <StretchHorizontal size={15} />
      </Button>
    </div>
  );
}

function orderedChaptersForPlan(plan: BookPlan): Chapter[] {
  return [...plan.chapters].sort((left, right) => left.orderIndex - right.orderIndex || left.number - right.number);
}

function orderedScenes(scenes: Scene[]): Scene[] {
  return [...scenes].sort((left, right) => left.orderIndex - right.orderIndex || left.title.localeCompare(right.title, "pl-PL"));
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

function sceneStatusLabelKey(status: Scene["status"]): string {
  if (status === "written") return "scenes.statusWritten";
  if (status === "draft") return "scenes.statusDraft";
  if (status === "revision") return "scenes.statusRevision";
  return "scenes.statusPlanned";
}

function sceneStatusTone(status: Scene["status"]): "success" | "warn" | "muted" | "accent" {
  if (status === "written") return "success";
  if (status === "draft") return "warn";
  if (status === "revision") return "accent";
  return "muted";
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

function selectedVariantLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  variants: SceneVariant[],
  selectedVariantId: string | null
): string {
  const selected = selectedVariantId ? variants.find((variant) => variant.id === selectedVariantId) : null;
  return selected
    ? t("scenes.variantLabel", { date: new Date(selected.createdAt).toLocaleString("pl-PL") })
    : t("scenes.aiVariants");
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


function signature(input: UpsertSceneInput): string {
  return JSON.stringify(input);
}

function createLocalId(): string {
  return "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
}

function variantsKey(sceneId: string): string {
  return `storyforge2:scene-variants:${sceneId}`;
}

function snapshotSourceLabelKey(source: string): string {
  if (source === "ai_replace") {
    return "scenes.snapshotSourceBeforeAi";
  }
  if (source === "restore") {
    return "scenes.snapshotSourceBeforeRestore";
  }
  return "scenes.snapshotSourceManual";
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
