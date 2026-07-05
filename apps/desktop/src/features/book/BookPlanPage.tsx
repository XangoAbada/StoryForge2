import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ClipboardList,
  Eye,
  FileText,
  Flag,
  GitBranch,
  GripVertical,
  LayoutList,
  Link2,
  Loader2,
  Map,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Route,
  Save,
  Search,
  Sparkles,
  Star,
  Target,
  Trash2,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  FormEvent,
  Fragment,
  MouseEvent,
  PointerEvent,
  ReactNode,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAct,
  deleteBeat,
  deleteChapter,
  deletePlanVersion,
  deleteScene,
  deletePlotThread,
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  moveBeatToChapter,
  createPlanVersionFromActive,
  saveStoryStructure,
  setActivePlanVersion,
  setSceneRelations,
  setSceneStyleReference,
  upsertAct,
  upsertBeat,
  upsertChapter,
  upsertChapterThreadRelation,
  upsertScene,
  upsertPlotThread
} from "../../shared/api/commands";
import type {
  Act,
  Beat,
  BookPlan,
  Chapter,
  ChapterThread,
  CharacterWorkspace,
  MoveBeatToChapterInput,
  PlotThread,
  Scene,
  SetSceneRelationsInput,
  SaveStoryStructureInput,
  UpsertActInput,
  UpsertBeatInput,
  UpsertChapterInput,
  UpsertChapterThreadInput,
  UpsertPlotThreadInput,
  UpsertSceneInput,
  WorldWorkspace
} from "../../shared/api/types";
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
import { Button, Chip, Field, Modal, Segmented, StatusPill } from "../../shared/ui";
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
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import {
  registerPlanDraftFieldTarget,
  unregisterPlanDraftFieldTarget
} from "../ai/planDraftFieldTargets";
import { pendingProposalStatus, useProposalStore } from "../ai/proposalStore";
import { ChapterEditModal, type ChapterModalState } from "./ChapterEditModal";
import { SceneEditModal as SharedSceneEditModal } from "../scenes/SceneEditModal";

type BookPlanPageProps = {
  projectId: string;
};

type PlanStep = "structure" | "acts" | "threads" | "beats" | "chapters" | "scenes";
type PlanMode = "wizard" | "preview";
type SelectedPlanItem =
  | { type: "structure"; id: string }
  | { type: "act"; id: string }
  | { type: "beat"; id: string }
  | { type: "thread"; id: string }
  | { type: "chapter"; id: string };
type BeatModalState =
  | { mode: "create"; chapterId?: string | null }
  | { mode: "edit"; beatId: string };
type SceneModalState =
  | { mode: "create"; chapterId?: string | null }
  | { mode: "edit"; sceneId: string };
type DeleteTarget =
  | { kind: "beat"; id: string; title: string; chapterCount: number }
  | { kind: "thread"; id: string; title: string; chapterCount: number; sceneCount: number }
  | { kind: "chapter"; id: string; title: string; sceneCount: number }
  | { kind: "scene"; id: string; title: string };
type ChapterRelationKind = "threads" | "beats";
type SceneRelationKind = "characters" | "threads" | "elements" | "rules";
type BeatSortMode = "order" | "name" | "role";
type ThreadViewMode = "map" | "list" | "table";
type ThreadSortMode = "order" | "name" | "status";
type ChapterReadiness = {
  percent: number;
  label: string;
  missing: string[];
  tone: "draft" | "active" | "ready";
};
type ThreadEditTarget = "new" | string | null;
type BulkChapterGenerationField = "allChapterSceneDrafts" | "allChapterThreadSuggestions";
type BeatBoardLane = {
  id: string;
  actId?: string | null;
  chapterId?: string;
  number?: number;
  name: string;
  color: string;
  rangeLabel?: string;
  summary?: string;
  beats: Beat[];
};
type BeatSaveInput = UpsertBeatInput & {
  chapterId?: string | null;
};
type PlanPromptEntity = Act | Beat | PlotThread | Chapter | ChapterThread | Scene;

const planSteps: Array<{ key: PlanStep; label: string }> = [
  { key: "structure", label: "Struktura" },
  { key: "acts", label: "Akty" },
  { key: "chapters", label: "Rozdziały" },
  { key: "threads", label: "Wątki" },
  { key: "beats", label: "Beaty" },
  { key: "scenes", label: "Sceny" }
];

const actColors = ["#3f8f6b", "#4f8fd9", "#8b5cf6", "#f59e42", "#d94f8f"];

type StructureActTemplate = {
  name: string;
  purpose: string;
  summary: string;
  startPercent: number;
  endPercent: number;
  color: string;
};

type SaveStoryStructureWithSkeletonInput = SaveStoryStructureInput & {
  actTemplates?: StructureActTemplate[];
};

type StructureOption = {
  value: string;
  label: string;
  icon: typeof Map;
  bestFor: string;
  organizes: string;
  result: string;
  actTemplates: StructureActTemplate[];
};

const structureOptions: StructureOption[] = [
  {
    value: "three_act",
    label: "Trzy akty",
    icon: Link2,
    bestFor: "Uniwersalne powieści, gdy potrzebujesz prostego kręgosłupa historii.",
    organizes: "Ustawia początek, konfrontację i rozwiązanie w czytelnych proporcjach.",
    result: "Doda 3 akty: Początek, Konfrontacja, Rozwiązanie.",
    actTemplates: [
      {
        name: "Początek",
        purpose: "Przedstawić bohatera, świat, pragnienie i zdarzenie uruchamiające fabułę.",
        summary: "",
        startPercent: 0,
        endPercent: 25,
        color: actColors[0]
      },
      {
        name: "Konfrontacja",
        purpose: "Rozwijać konflikt, komplikacje, próby i punkt zwrotny w środku historii.",
        summary: "",
        startPercent: 25,
        endPercent: 75,
        color: actColors[1]
      },
      {
        name: "Rozwiązanie",
        purpose: "Doprowadzić konflikt do finału i pokazać konsekwencje wyborów bohatera.",
        summary: "",
        startPercent: 75,
        endPercent: 100,
        color: actColors[2]
      }
    ]
  },
  {
    value: "save_the_cat",
    label: "Save the Cat",
    icon: BookOpen,
    bestFor: "Historie komercyjne, gatunkowe i mocno rytmiczne.",
    organizes: "Prowadzi przez obietnicę historii, zabawę gatunkiem, kryzys i finał.",
    result: "Doda 3 akty: Setup, Fun and Games / Bad Guys Close In, Finale.",
    actTemplates: [
      {
        name: "Setup",
        purpose: "Ustawić świat, bohatera, temat, katalizator i decyzję wejścia w historię.",
        summary: "",
        startPercent: 0,
        endPercent: 25,
        color: actColors[0]
      },
      {
        name: "Fun and Games / Bad Guys Close In",
        purpose: "Rozwinąć obietnicę gatunku, midpoint, presję przeciwnika i najgłębszy kryzys.",
        summary: "",
        startPercent: 25,
        endPercent: 75,
        color: actColors[1]
      },
      {
        name: "Finale",
        purpose: "Pozwolić bohaterowi użyć lekcji historii i rozwiązać główny konflikt.",
        summary: "",
        startPercent: 75,
        endPercent: 100,
        color: actColors[2]
      }
    ]
  },
  {
    value: "heros_journey",
    label: "Hero's Journey",
    icon: Map,
    bestFor: "Przemianę bohatera, fantasy, przygodę albo opowieść inicjacyjną.",
    organizes: "Dzieli historię na wezwanie, próby i powrót z przemianą.",
    result: "Doda 3 akty: Ordinary World / Call, Trials and Transformation, Return.",
    actTemplates: [
      {
        name: "Ordinary World / Call",
        purpose: "Pokazać zwykły świat, brak bohatera, wezwanie i przekroczenie progu.",
        summary: "",
        startPercent: 0,
        endPercent: 25,
        color: actColors[0]
      },
      {
        name: "Trials and Transformation",
        purpose: "Przeprowadzić bohatera przez próby, sojuszników, kryzys i wewnętrzną zmianę.",
        summary: "",
        startPercent: 25,
        endPercent: 75,
        color: actColors[1]
      },
      {
        name: "Return",
        purpose: "Doprowadzić do powrotu, konfrontacji i nowej równowagi po przemianie.",
        summary: "",
        startPercent: 75,
        endPercent: 100,
        color: actColors[2]
      }
    ]
  },
  {
    value: "mystery_outline",
    label: "Mystery outline",
    icon: Eye,
    bestFor: "Kryminał, thriller śledczy i fabuły oparte na pytaniu: co naprawdę zaszło?",
    organizes: "Porządkuje zbrodnię, śledztwo, fałszywe tropy oraz ujawnienie prawdy.",
    result: "Doda 4 akty: Zbrodnia i pytanie, Śledztwo, Komplikacje i fałszywe tropy, Ujawnienie i konsekwencje.",
    actTemplates: [
      {
        name: "Zbrodnia i pytanie",
        purpose: "Ustawić tajemnicę, stawkę, podejrzanych i pytanie napędzające śledztwo.",
        summary: "",
        startPercent: 0,
        endPercent: 20,
        color: actColors[0]
      },
      {
        name: "Śledztwo",
        purpose: "Zbierać wskazówki, budować hipotezy i poszerzać krąg podejrzeń.",
        summary: "",
        startPercent: 20,
        endPercent: 50,
        color: actColors[1]
      },
      {
        name: "Komplikacje i fałszywe tropy",
        purpose: "Zwiększać presję, podważać dowody i prowadzić do błędnych wniosków.",
        summary: "",
        startPercent: 50,
        endPercent: 80,
        color: actColors[2]
      },
      {
        name: "Ujawnienie i konsekwencje",
        purpose: "Odsłonić prawdę, skonfrontować winnego i pokazać koszt rozwiązania.",
        summary: "",
        startPercent: 80,
        endPercent: 100,
        color: actColors[3]
      }
    ]
  },
  {
    value: "custom",
    label: "Custom",
    icon: Pencil,
    bestFor: "Eksperymentalną albo autorską konstrukcję bez narzuconych etapów.",
    organizes: "Zostawia pełną swobodę w definiowaniu aktów, beatów i proporcji.",
    result: "Nie doda aktów automatycznie.",
    actTemplates: []
  }
];

export function BookPlanPage({ projectId }: BookPlanPageProps) {
  const queryClient = useQueryClient();
  const activeStep = normalizePlanStep(
    useProjectNavigationStore((state) => state.viewState[projectId]?.planStep)
  );
  const storedMode = useProjectNavigationStore(
    (state) => state.viewState[projectId]?.planMode
  );
  const setProjectViewState = useProjectNavigationStore(
    (state) => state.setProjectViewState
  );
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore(
    (state) => state.activateTarget
  );
  const closePromptContextTarget = useAiPromptContextStore(
    (state) => state.closeTarget
  );
  const [selectedItem, setSelectedItem] = useState<SelectedPlanItem | null>(null);
  const [chapterModal, setChapterModal] = useState<ChapterModalState | null>(null);
  const [beatModal, setBeatModal] = useState<BeatModalState | null>(null);
  const [sceneModal, setSceneModal] = useState<SceneModalState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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
  const mode: PlanMode =
    storedMode === "preview" && isPlanReady(plan) ? "preview" : "wizard";

  const invalidatePlan = async () => {
    await queryClient.invalidateQueries({ queryKey: ["book-plan", bookId] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const structureMutation = useMutation({
    mutationFn: async (input: SaveStoryStructureWithSkeletonInput) => {
      const { actTemplates, ...structureInput } = input;
      const structure = await saveStoryStructure(structureInput);

      if (actTemplates?.length) {
        for (const [index, act] of actTemplates.entries()) {
          await upsertAct({
            bookId: structureInput.bookId,
            name: act.name,
            purpose: act.purpose,
            summary: act.summary,
            startPercent: act.startPercent,
            endPercent: act.endPercent,
            color: act.color,
            orderIndex: index
          });
        }
      }

      return structure;
    },
    onSuccess: async (_structure, variables) => {
      setMessage(
        variables.actTemplates?.length
          ? "Zapisano strukturę planu i przygotowano akty."
          : "Zapisano strukturę planu."
      );
      await invalidatePlan();
    },
    onError: showError
  });
  const actMutation = useMutation({
    mutationFn: (input: UpsertActInput) => upsertAct(input),
    onSuccess: async (act) => {
      setSelectedItem({ type: "act", id: act.id });
      setMessage("Zapisano akt.");
      await invalidatePlan();
    },
    onError: showError
  });
  const beatMutation = useMutation({
    mutationFn: async (input: BeatSaveInput) => {
      const { chapterId, ...beatInput } = input;
      const beat = await upsertBeat(beatInput);

      if (chapterId !== undefined) {
        await moveBeatToChapter({
          bookId: beat.bookId,
          beatId: beat.id,
          chapterId,
          orderIndex: beat.orderIndex
        });
      }

      return beat;
    },
    onSuccess: async (beat) => {
      setSelectedItem({ type: "beat", id: beat.id });
      setMessage("Zapisano beat.");
      await invalidatePlan();
    },
    onError: showError
  });
  const beatMoveMutation = useMutation({
    mutationFn: (input: MoveBeatToChapterInput) => moveBeatToChapter(input),
    onSuccess: async () => {
      setMessage("Przeniesiono beat.");
      await invalidatePlan();
    },
    onError: showError
  });
  const threadMutation = useMutation({
    mutationFn: (input: UpsertPlotThreadInput) => upsertPlotThread(input),
    onSuccess: async (thread) => {
      setSelectedItem({ type: "thread", id: thread.id });
      setMessage("Zapisano wątek.");
      await invalidatePlan();
    },
    onError: showError
  });
  const chapterMutation = useMutation({
    mutationFn: (input: UpsertChapterInput) => upsertChapter(input),
    onSuccess: async (chapter) => {
      setSelectedItem({ type: "chapter", id: chapter.id });
      setMessage("Zapisano rozdział.");
      await invalidatePlan();
    },
    onError: showError
  });
  const chapterThreadMutation = useMutation({
    mutationFn: (input: UpsertChapterThreadInput) => upsertChapterThreadRelation(input),
    onSuccess: async () => {
      setMessage("Zapisano przebieg wątku w rozdziale.");
      await invalidatePlan();
    },
    onError: showError
  });
  const chapterReorderMutation = useMutation({
    mutationFn: async (inputs: UpsertChapterInput[]) => {
      for (const input of inputs) {
        await upsertChapter(input);
      }
    },
    onSuccess: async () => {
      setMessage("Zapisano kolejność rozdziałów.");
      await invalidatePlan();
    },
    onError: showError
  });
  const deleteMutation = useMutation({
    mutationFn: async (item: SelectedPlanItem) => {
      if (item.type === "act") {
        await deleteAct(item.id);
      }
      if (item.type === "beat") {
        await deleteBeat(item.id);
      }
      if (item.type === "thread") {
        await deletePlotThread(item.id);
      }
      if (item.type === "chapter") {
        await deleteChapter(item.id);
      }
    },
    onSuccess: async () => {
      setSelectedItem(null);
      setDeleteTarget(null);
      setMessage("Usunięto element planu.");
      await invalidatePlan();
    },
    onError: showError
  });
  const sceneMutation = useMutation({
    mutationFn: (input: UpsertSceneInput) => upsertScene(input),
    onSuccess: async (scene) => {
      setMessage("Zapisano scenę.");
      await invalidatePlan();
      return scene;
    },
    onError: showError
  });
  const sceneDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteScene(id),
    onSuccess: async () => {
      setSceneModal(null);
      setDeleteTarget(null);
      setMessage("Usunięto scenę.");
      await invalidatePlan();
    },
    onError: showError
  });
  const deletePending = deleteMutation.isPending || sceneDeleteMutation.isPending;

  function requestDelete(target: DeleteTarget) {
    if (deletePending) {
      return;
    }

    setErrorMessage("");
    setDeleteTarget(target);
  }

  function confirmDeleteTarget() {
    if (!deleteTarget || deletePending) {
      return;
    }

    if (deleteTarget.kind === "scene") {
      sceneDeleteMutation.mutate(deleteTarget.id);
      return;
    }

    deleteMutation.mutate(
      { type: deleteTarget.kind, id: deleteTarget.id },
      {
        onSuccess: () => {
          if (deleteTarget.kind === "chapter") {
            setChapterModal(null);
          }
          if (deleteTarget.kind === "beat") {
            setBeatModal(null);
          }
        }
      }
    );
  }

  const sceneRelationsMutation = useMutation({
    mutationFn: (input: SetSceneRelationsInput) => setSceneRelations(input),
    onSuccess: invalidatePlan,
    onError: showError
  });
  const styleReferenceMutation = useMutation({
    mutationFn: setSceneStyleReference,
    onSuccess: async (scene) => {
      setMessage(
        scene.isStyleReference
          ? "Oznaczono scenę jako wzorzec stylu dla AI."
          : "Usunięto oznaczenie wzorca stylu."
      );
      await invalidatePlan();
    },
    onError: showError
  });
  const duplicatePlanMutation = useMutation({
    mutationFn: () =>
      createPlanVersionFromActive({
        bookId: bookId ?? "",
        name: `Wariant ${plan.planVersions.length + 1}`,
        description: "Duplikat aktywnego planu."
      }),
    onSuccess: async () => {
      setMessage("Utworzono wariant planu.");
      await invalidatePlan();
    },
    onError: showError
  });
  const activePlanMutation = useMutation({
    mutationFn: (planVersionId: string) =>
      setActivePlanVersion({ bookId: bookId ?? "", planVersionId }),
    onSuccess: async () => {
      setMessage("Zmieniono aktywny wariant planu.");
      await invalidatePlan();
    },
    onError: showError
  });
  const deletePlanVersionMutation = useMutation({
    mutationFn: (planVersionId: string) =>
      deletePlanVersion({ bookId: bookId ?? "", planVersionId }),
    onSuccess: async () => {
      setMessage("Usunięto wariant planu.");
      await invalidatePlan();
    },
    onError: showError
  });

  function showError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  function selectStep(step: PlanStep) {
    setProjectViewState(projectId, "planStep", step);
    setProjectViewState(projectId, "planMode", "wizard");
  }

  function selectMode(nextMode: PlanMode) {
    setProjectViewState(projectId, "planMode", nextMode);
  }

  function queuePlanGeneration(
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity,
    options: { useActivePromptContext?: boolean } = {}
  ) {
    setErrorMessage("");
    if (!projectQuery.data || !bookId) {
      setErrorMessage("Brak danych projektu.");
      return;
    }

    const targetId = planPromptContextTargetId(
      projectId,
      field,
      targetEntity ? planPromptEntityId(targetEntity) : undefined
    );
    const useActivePromptContext = options.useActivePromptContext ?? true;
    const contextControl = useActivePromptContext
      ? promptContextControlForActiveTarget(targetId)
      : undefined;
    const usedPromptContext = Boolean(contextControl);
    const promptPackage = buildPlanPromptPackage(
      projectQuery.data.project,
      projectQuery.data.book,
      plan,
      field,
      targetEntity,
      contextControl,
      planStoryBibleContext(characters, world)
    );
    const prompt = renderPlanPromptPackage(promptPackage);

    enqueueProposal({
      scope: "bookPlan",
      projectId,
      bookId,
      field,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt
    });

    if (usedPromptContext) {
      closePromptContextTarget(targetId);
    }
  }

  function queueBulkChapterGeneration(field: BulkChapterGenerationField) {
    setErrorMessage("");

    if (!projectQuery.data || !bookId) {
      setErrorMessage("Brak danych projektu.");
      return;
    }

    const chapters = orderedChaptersForPlan(plan);
    if (chapters.length === 0) {
      setErrorMessage("Najpierw dodaj rozdziały.");
      return;
    }

    if (field === "allChapterThreadSuggestions" && plan.threads.length === 0) {
      setErrorMessage("Najpierw dodaj wątki.");
      return;
    }

    const pendingBulkStatus = pendingProposalStatus(proposals, {
      projectId,
      bookId,
      field,
      scope: "bookPlan"
    });

    if (pendingBulkStatus) {
      setErrorMessage(
        field === "allChapterSceneDrafts"
          ? "Generowanie scen dla rozdziałów jest już w kolejce."
          : "Przypisywanie wątków do rozdziałów jest już w kolejce."
      );
      return;
    }

    queuePlanGeneration(field, undefined, { useActivePromptContext: false });

    setMessage(
      field === "allChapterSceneDrafts"
        ? "Dodano do kolejki jedno zbiorcze generowanie scen dla rozdziałów."
        : "Dodano do kolejki jedno zbiorcze przypisywanie wątków do rozdziałów."
    );
  }

  function activatePlanPromptContext(
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity
  ) {
    const targetId = planPromptContextTargetId(
      projectId,
      field,
      targetEntity ? planPromptEntityId(targetEntity) : undefined
    );
    const loading = pendingProposalStatus(proposals, {
      projectId,
      bookId,
      field,
      scope: "bookPlan"
    });

    activatePromptContextTarget(
      createPlanPromptContextTarget(projectId, field, targetEntity ? planPromptEntityId(targetEntity) : undefined, {
        submitLabel: "Wyślij do AI",
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading
          ? `Pole "${planFieldConfigs[field].label}" jest już w kolejce AI.`
          : undefined,
        onSubmit: () => queuePlanGeneration(field, targetEntity)
      })
    );
  }

  function openChapterModal(chapter: Chapter) {
    setSelectedItem({ type: "chapter", id: chapter.id });
    setChapterModal({ mode: "edit", chapterId: chapter.id });
  }

  function openNewChapterModal(actId?: string | null) {
    setSelectedItem(null);
    setChapterModal({ mode: "create", actId });
  }

  function openBeatModal(beat: Beat) {
    setSelectedItem({ type: "beat", id: beat.id });
    setBeatModal({ mode: "edit", beatId: beat.id });
  }

  function openNewBeatModal(chapterId?: string | null) {
    setSelectedItem(null);
    setBeatModal({ mode: "create", chapterId });
  }

  if (projectQuery.isLoading || planQuery.isLoading) {
    return (
      <section className="plan-page">
        <p className="muted-text">Ładuję plan...</p>
      </section>
    );
  }

  if (projectQuery.isError || planQuery.isError || !projectQuery.data || !bookId) {
    return (
      <section className="plan-page">
        <p className="warning-text">Nie można wczytać danych planu.</p>
      </section>
    );
  }

  const wizardContent =
    activeStep === "structure" ? (
      <StructureStep
        bookId={bookId}
        plan={plan}
        saving={structureMutation.isPending}
        onSave={(input) => structureMutation.mutate(input)}
        onGenerate={(field) => activatePlanPromptContext(field)}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : activeStep === "acts" ? (
      <ActsStep
        bookId={bookId}
        plan={plan}
        saving={actMutation.isPending}
        onSave={(input) => actMutation.mutate(input)}
        onDelete={(item) => deleteMutation.mutate(item)}
        onSelect={setSelectedItem}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : activeStep === "chapters" ? (
      <ChaptersStep
        bookId={bookId}
        plan={plan}
        characters={characters}
        world={world}
        saving={chapterMutation.isPending || chapterReorderMutation.isPending || deletePending}
        onOpenChapter={openChapterModal}
        onCreateChapter={openNewChapterModal}
        onCreateScene={(chapterId) => setSceneModal({ mode: "create", chapterId })}
        onEditScene={(sceneId) => setSceneModal({ mode: "edit", sceneId })}
        onRequestDelete={requestDelete}
        onSaveChapter={(input) => chapterMutation.mutate(input)}
        onSetSceneRelations={(input) => sceneRelationsMutation.mutate(input)}
        onReorderChapters={(inputs) => chapterReorderMutation.mutate(inputs)}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : activeStep === "threads" ? (
      <ThreadsStep
        bookId={bookId}
        plan={plan}
        saving={threadMutation.isPending || chapterMutation.isPending || chapterThreadMutation.isPending || deletePending}
        onSave={(input) => threadMutation.mutate(input)}
        onSaveChapter={(input) => chapterMutation.mutate(input)}
        onSaveChapterThreadRelation={(input) => chapterThreadMutation.mutate(input)}
        onRequestDelete={requestDelete}
        onSelect={setSelectedItem}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
        onSuggestThreadsForAllChapters={() => queueBulkChapterGeneration("allChapterThreadSuggestions")}
      />
    ) : activeStep === "beats" ? (
      <BeatsStep
        bookId={bookId}
        plan={plan}
        saving={beatMutation.isPending || beatMoveMutation.isPending || deletePending}
        onSave={(input) => beatMutation.mutate(input)}
        onMoveBeat={(input) => beatMoveMutation.mutate(input)}
        onRequestDelete={requestDelete}
        onOpenBeat={openBeatModal}
        onCreateBeat={openNewBeatModal}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : (
      <ScenesStep
        bookId={bookId}
        plan={plan}
        characters={characters}
        world={world}
        saving={
          sceneMutation.isPending ||
          sceneRelationsMutation.isPending ||
          duplicatePlanMutation.isPending ||
          activePlanMutation.isPending ||
          deletePlanVersionMutation.isPending ||
          sceneDeleteMutation.isPending
        }
        onCreateScene={(chapterId) => setSceneModal({ mode: "create", chapterId })}
        onEditScene={(sceneId) => setSceneModal({ mode: "edit", sceneId })}
        onRequestDelete={requestDelete}
        onSetRelations={(input) => sceneRelationsMutation.mutate(input)}
        onToggleStyleReference={(scene) =>
          styleReferenceMutation.mutate({
            sceneId: scene.id,
            isStyleReference: scene.isStyleReference ? 0 : 1
          })
        }
        onDuplicatePlan={() => duplicatePlanMutation.mutate()}
        onSetActivePlan={(planVersionId) => activePlanMutation.mutate(planVersionId)}
        onDeletePlanVersion={(planVersionId) => deletePlanVersionMutation.mutate(planVersionId)}
        onGenerate={activatePlanPromptContext}
        onGenerateForAllChapters={() => queueBulkChapterGeneration("allChapterSceneDrafts")}
      />
    );

  return (
    <section className="plan-page">
      <header className="plan-page-header">
        <div>
          <p className="eyebrow">Plan powieści</p>
          <h2>Od struktury do scen</h2>
          <p>
            Najpierw ułóż akty i roboczy szkielet rozdziałów, potem rozpisz przez
            niego wątki, beaty i sceny.
          </p>
        </div>
        <span
          title={
            isPlanReady(plan)
              ? "Przełącz tryb planu."
              : "Dodaj akty i rozdziały, aby odblokować podgląd."
          }
        >
          <Segmented
            ariaLabel="Tryb planu"
            items={[
              { id: "wizard", label: "Kreator" },
              { id: "preview", label: "Podgląd" }
            ]}
            value={mode}
            onChange={(nextMode) => selectMode(nextMode as PlanMode)}
          />
        </span>
      </header>

      {message ? <p className="success-text">{message}</p> : null}
      {errorMessage ? <p className="warning-text">{errorMessage}</p> : null}

      <PlanStageNavigation
        activeStep={activeStep}
        onSelectStep={selectStep}
      />

      {mode === "preview" ? (
        <PlanPreview
          plan={plan}
          selectedItem={selectedItem}
          onSelect={setSelectedItem}
        />
      ) : (
        <div className="plan-workspace">
          <div className="plan-builder">{wizardContent}</div>
        </div>
      )}
      <ChapterEditModal
        state={chapterModal}
        bookId={bookId}
        plan={plan}
        saving={chapterMutation.isPending || deletePending}
        onClose={() => setChapterModal(null)}
        onSave={(input) =>
          chapterMutation.mutate(input, {
            onSuccess: () => setChapterModal(null)
          })
        }
        onDelete={(chapterId) => {
          const chapter = plan.chapters.find((item) => item.id === chapterId);
          if (chapter) {
            requestDelete(chapterDeleteTarget(plan, chapter));
          }
        }}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />
      <BeatEditModal
        state={beatModal}
        bookId={bookId}
        plan={plan}
        saving={beatMutation.isPending || deletePending}
        onClose={() => setBeatModal(null)}
        onSave={(input) =>
          beatMutation.mutate(input, {
            onSuccess: () => setBeatModal(null)
          })
        }
        onDelete={(item) => {
          if (item.type !== "beat") {
            return;
          }

          const beat = plan.beats.find((candidate) => candidate.id === item.id);
          if (beat) {
            requestDelete(beatDeleteTarget(plan, beat));
          }
        }}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
      />
      <SharedSceneEditModal
        state={sceneModal}
        bookId={bookId}
        plan={plan}
        characters={characters}
        world={world}
        saving={sceneMutation.isPending || sceneDeleteMutation.isPending}
        onClose={() => setSceneModal(null)}
        onSave={(input, relations) =>
          sceneMutation.mutate(input, {
            onSuccess: (scene) => {
              sceneRelationsMutation.mutate({
                ...relations,
                bookId,
                sceneId: scene.id
              });
              setSceneModal(null);
            }
          })
        }
        onDelete={(sceneId) => {
          const scene = plan.scenes.find((item) => item.id === sceneId);
          if (scene) {
            requestDelete(sceneDeleteTarget(plan, scene));
          }
        }}
        onGenerate={activatePlanPromptContext}
        onActivatePrompt={activatePlanPromptContext}
        onEnsureSaved={(input) => upsertScene(input)}
        onLinkThreadToChapter={(threadId, chapterId) =>
          chapterThreadMutation.mutate({
            bookId,
            threadId,
            chapterId,
            description: chapterThreadRelation(plan, threadId, chapterId)?.description ?? ""
          })
        }
      />
      <ConfirmDeleteModal
        target={deleteTarget}
        deleting={deletePending}
        onClose={() => {
          if (!deletePending) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={confirmDeleteTarget}
      />
    </section>
  );
}

function ConfirmDeleteModal({
  target,
  deleting,
  onClose,
  onConfirm
}: {
  target: DeleteTarget | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!target) {
    return null;
  }

  const copy = deleteTargetCopy(target);

  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="danger" onClick={onConfirm} busy={deleting}>
            {deleting ? null : <Trash2 size={15} aria-hidden />}
            Usuń
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Anuluj
          </Button>
        </>
      }
    >
      <div className="confirm-delete-body">
        <strong>{target.title}</strong>
        <p>{copy.description}</p>
        <p className="warning-text">Tej operacji nie można cofnąć.</p>
      </div>
    </Modal>
  );
}

function deleteTargetCopy(target: DeleteTarget): { title: string; description: string } {
  if (target.kind === "beat") {
    return {
      title: "Usunąć beat?",
      description: `Usuniesz beat i jego przypięcia do rozdziałów. Liczba przypięć: ${target.chapterCount}.`
    };
  }

  if (target.kind === "thread") {
    return {
      title: "Usunąć wątek?",
      description: `Usuniesz wątek oraz jego powiązania z rozdziałami i scenami. Rozdziały: ${target.chapterCount}. Sceny: ${target.sceneCount}.`
    };
  }

  if (target.kind === "chapter") {
    return {
      title: "Usunąć rozdział?",
      description: `Usuniesz rozdział i jego relacje. Sceny z tego rozdziału przejdą do sekcji „Bez rozdziału”. Sceny: ${target.sceneCount}.`
    };
  }

  return {
    title: "Usunąć scenę?",
    description: "Usuniesz scenę wraz z treścią i relacjami planu."
  };
}

function beatDeleteTarget(plan: BookPlan, beat: Beat): DeleteTarget {
  return {
    kind: "beat",
    id: beat.id,
    title: beat.name || "Beat bez nazwy",
    chapterCount: plan.chapterBeats.filter((relation) => relation.beatId === beat.id).length
  };
}

function threadDeleteTarget(plan: BookPlan, thread: PlotThread): DeleteTarget {
  return {
    kind: "thread",
    id: thread.id,
    title: thread.name || "Wątek bez nazwy",
    chapterCount: chaptersForThread(plan, thread).length,
    sceneCount: plan.sceneThreads.filter((relation) => relation.threadId === thread.id).length
  };
}

function chapterDeleteTarget(plan: BookPlan, chapter: Chapter): DeleteTarget {
  return {
    kind: "chapter",
    id: chapter.id,
    title: `Rozdział ${dynamicChapterNumber(plan, chapter.id)}: ${chapter.workingTitle || "Bez tytułu"}`,
    sceneCount: orderedScenesForChapter(plan, chapter.id).length
  };
}

function sceneDeleteTarget(plan: BookPlan, scene: Scene): DeleteTarget {
  const chapter = scene.chapterId
    ? plan.chapters.find((item) => item.id === scene.chapterId)
    : undefined;
  const prefix = chapter ? `Rozdział ${dynamicChapterNumber(plan, chapter.id)} · ` : "";

  return {
    kind: "scene",
    id: scene.id,
    title: `${prefix}${scene.title || "Scena bez tytułu"}`
  };
}

type StepProps = {
  bookId: string;
  plan: BookPlan;
  saving: boolean;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity
  ) => void;
};

function ScenesStep({
  bookId,
  plan,
  characters,
  world,
  saving,
  onCreateScene,
  onEditScene,
  onRequestDelete,
  onSetRelations,
  onToggleStyleReference,
  onDuplicatePlan,
  onSetActivePlan,
  onDeletePlanVersion,
  onGenerate,
  onGenerateForAllChapters
}: {
  bookId: string;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  saving: boolean;
  onCreateScene: (chapterId?: string | null) => void;
  onEditScene: (sceneId: string) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onSetRelations: (input: SetSceneRelationsInput) => void;
  onToggleStyleReference: (scene: Scene) => void;
  onDuplicatePlan: () => void;
  onSetActivePlan: (planVersionId: string) => void;
  onDeletePlanVersion: (planVersionId: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onGenerateForAllChapters: () => void;
}) {
  const chapters = orderedChaptersForPlan(plan);
  const proposals = useProposalStore((state) => state.proposals);
  const lanes = [...chapters, null].map((chapter) => ({
    chapter,
    scenes: orderedScenesForChapter(plan, chapter?.id ?? null)
  }));
  const [relationPicker, setRelationPicker] = useState<{
    sceneId: string;
    kind: SceneRelationKind;
  } | null>(null);
  const pickerScene = relationPicker
    ? plan.scenes.find((scene) => scene.id === relationPicker.sceneId)
    : undefined;
  const bulkSceneGenerationPending = Boolean(
    pendingProposalStatus(proposals, {
      bookId,
      field: "allChapterSceneDrafts",
      scope: "bookPlan"
    })
  );

  return (
    <div className="scenes-step plan-grid-list">
      <PlanCard
        title="Warianty planu"
        icon={<GitBranch size={18} />}
        action={
          <span className="scene-add-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onGenerateForAllChapters}
              disabled={saving || chapters.length === 0 || bulkSceneGenerationPending}
              title={
                chapters.length === 0
                  ? "Dodaj rozdziały, aby wygenerować sceny."
                  : bulkSceneGenerationPending
                    ? "Generowanie scen dla rozdziałów jest już w kolejce."
                    : "Wygeneruj propozycje scen dla wszystkich rozdziałów."
              }
            >
              <Sparkles size={15} />
              Generuj sceny dla rozdziałów
            </button>
            <button type="button" className="secondary-button" onClick={onDuplicatePlan} disabled={saving}>
              <Plus size={15} />
              Duplikuj aktywny plan
            </button>
          </span>
        }
      >
        <div className="plan-chip-row">
          {plan.planVersions.map((version) => {
            const canDelete = !version.isActive && plan.planVersions.length > 1;
            return (
              <span
                key={version.id}
                className={version.isActive ? "scene-version-chip active" : "scene-version-chip"}
              >
                <button
                  type="button"
                  onClick={() => !version.isActive && onSetActivePlan(version.id)}
                  disabled={version.isActive || saving}
                  title={version.isActive ? "Aktywny wariant planu" : "Ustaw jako aktywny wariant"}
                >
                  {version.name}
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    className="scene-version-delete"
                    onClick={() => {
                      if (confirm(`Usunąć wariant planu "${version.name}"?`)) {
                        onDeletePlanVersion(version.id);
                      }
                    }}
                    disabled={saving}
                    title={`Usuń wariant planu: ${version.name}`}
                    aria-label={`Usuń wariant planu: ${version.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      </PlanCard>

      {lanes.map(({ chapter, scenes }) => (
        <PlanCard
          key={chapter?.id ?? "no-chapter"}
          title={chapter ? `Rozdział ${chapter.number}: ${chapter.workingTitle || "Bez tytułu"}` : "Sceny bez rozdziału"}
          icon={<ClipboardList size={18} />}
          action={
            <AddSceneActions
              chapter={chapter}
              onCreateScene={onCreateScene}
              onGenerate={onGenerate}
            />
          }
        >
          <div className="scene-card-list">
            {scenes.map((scene) => (
              <div
                className="chapter-board-card plan-scene-card"
                key={scene.id}
                role="button"
                tabIndex={0}
                onClick={() => onEditScene(scene.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onEditScene(scene.id);
                  }
                }}
              >
                <span className="chapter-card-topline">
                  <span className="chapter-number-badge">{scene.orderIndex + 1}</span>
                  <span>{sceneStatusLabel(scene.status)}</span>
                  <button
                    type="button"
                    className={scene.isStyleReference ? "scene-style-reference-icon active" : "scene-style-reference-icon"}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleStyleReference(scene);
                    }}
                    disabled={saving}
                    title={
                      scene.isStyleReference
                        ? "Scena wzorcowa stylu — AI naśladuje jej prozę (kliknij, by odznaczyć)"
                        : "Oznacz jako scenę wzorcową stylu dla AI"
                    }
                    aria-label={`Wzorzec stylu: ${scene.title || "Scena bez tytułu"}`}
                    aria-pressed={Boolean(scene.isStyleReference)}
                  >
                    <Star size={14} fill={scene.isStyleReference ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    className="plan-card-delete-icon"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRequestDelete(sceneDeleteTarget(plan, scene));
                    }}
                    disabled={saving}
                    title={`Usuń scenę: ${scene.title || "Scena bez tytułu"}`}
                    aria-label={`Usuń scenę: ${scene.title || "Scena bez tytułu"}`}
                  >
                    <Trash2 size={14} />
                  </button>
                  <span>{scene.targetWordCount ? `${scene.targetWordCount.toLocaleString("pl-PL")} słów` : "Brak celu"}</span>
                </span>
                <strong>{scene.title || "Scena bez tytułu"}</strong>
                <p>{scene.summary || "Brak streszczenia sceny."}</p>
                <span className="chapter-card-field">
                  <b>Cel</b>
                  <span>{scene.goal || "Nie opisano"}</span>
                </span>
                <span className="chapter-card-field">
                  <b>Konflikt</b>
                  <span>{scene.conflict || "Nie opisano"}</span>
                </span>
                <span className="chapter-card-field">
                  <b>Wynik</b>
                  <span>{scene.outcome || "Nie opisano"}</span>
                </span>
                <SceneRelationChips
                  bookId={bookId}
                  scene={scene}
                  plan={plan}
                  characters={characters}
                  world={world}
                  onSetRelations={onSetRelations}
                  onOpenPicker={(kind) => setRelationPicker({ sceneId: scene.id, kind })}
                />
              </div>
            ))}
            {scenes.length === 0 ? <p className="muted-text">Brak scen w tej sekcji.</p> : null}
          </div>
        </PlanCard>
      ))}

      {relationPicker && pickerScene ? (
        <SceneRelationPickerModal
          kind={relationPicker.kind}
          plan={plan}
          characters={characters}
          world={world}
          selectedIds={sceneRelationIds(plan, pickerScene.id, relationPicker.kind)}
          onClose={() => setRelationPicker(null)}
          onAdd={(ids) => {
            const current = sceneRelationSnapshot(plan, pickerScene.id);
            const nextIds = uniqueOrderedIds([
              ...sceneRelationIds(plan, pickerScene.id, relationPicker.kind),
              ...ids
            ]);
            onSetRelations({
              bookId,
              sceneId: pickerScene.id,
              ...current,
              [sceneRelationInputKey(relationPicker.kind)]: nextIds
            });
            setRelationPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AddSceneActions({
  chapter,
  onCreateScene,
  onGenerate
}: {
  chapter: Chapter | null;
  onCreateScene: (chapterId?: string | null) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  return (
    <span className="scene-add-actions">
      <PlanAiActions
        field="sceneDraft"
        targetEntity={chapter ?? undefined}
        onGenerate={() => onGenerate("sceneDraft", chapter ?? undefined)}
        onActivatePrompt={() => undefined}
      />
      <button type="button" className="secondary-button" onClick={() => onCreateScene(chapter?.id ?? null)}>
        <Plus size={15} />
        Dodaj scenę
      </button>
    </span>
  );
}

function SceneRelationChips({ bookId, scene, plan, characters, world, onSetRelations, onOpenPicker }: {
  bookId: string;
  scene: Scene;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  onSetRelations: (input: SetSceneRelationsInput) => void;
  onOpenPicker: (kind: SceneRelationKind) => void;
}) {
  const characterIds = sceneCharacterIds(plan, scene.id);
  const threadIds = sceneThreadIds(plan, scene.id);
  const elementIds = sceneElementIds(plan, scene.id);
  const ruleIds = sceneRuleIds(plan, scene.id);
  const update = (next: Partial<Omit<SetSceneRelationsInput, "bookId" | "sceneId">>) =>
    onSetRelations({ bookId, sceneId: scene.id, characterIds, threadIds, elementIds, ruleIds, ...next });

  return (
    <div className="chapter-chip-row scene-card-relations" onClick={(event) => event.stopPropagation()}>
      {characterIds.map((id) => (
        <RelationMiniChip
          key={id}
          label={characterLabel(characters, id)}
          onRemove={() => update({ characterIds: characterIds.filter((item) => item !== id) })}
        />
      ))}
      {threadIds.map((id) => (
        <RelationMiniChip
          key={id}
          label={plan.threads.find((item) => item.id === id)?.name ?? "Wątek"}
          onRemove={() => update({ threadIds: threadIds.filter((item) => item !== id) })}
        />
      ))}
      {elementIds.map((id) => (
        <RelationMiniChip
          key={id}
          label={worldElementLabel(world, id)}
          onRemove={() => update({ elementIds: elementIds.filter((item) => item !== id) })}
        />
      ))}
      {ruleIds.map((id) => (
        <RelationMiniChip
          key={id}
          label={world.rules.find((item) => item.id === id)?.name ?? "Reguła"}
          onRemove={() => update({ ruleIds: ruleIds.filter((item) => item !== id) })}
        />
      ))}
      {(["characters", "threads", "elements", "rules"] as SceneRelationKind[]).map((kind) => (
        <button
          type="button"
          key={kind}
          className="chapter-card-relation-add-button scene-card-relation-add-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenPicker(kind);
          }}
          title={`Dodaj: ${sceneRelationTitle(kind).toLowerCase()}`}
          aria-label={`Dodaj relację sceny: ${sceneRelationTitle(kind)}`}
        >
          <Plus size={13} />
          <span>{sceneRelationShortLabel(kind)}</span>
        </button>
      ))}
    </div>
  );
}

function RelationMiniChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chapter-chip scene-relation-chip">
      {label}
      <button
        type="button"
        className="chapter-chip-remove"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        title={`Odłącz relację: ${label}`}
        aria-label={`Odłącz relację: ${label}`}
      >
        <X size={11} />
      </button>
    </span>
  );
}

function sceneStatusLabel(status: Scene["status"]): string {
  if (status === "written") {
    return "Napisana";
  }
  if (status === "draft") {
    return "Szkic";
  }
  return "Planowana";
}

function sceneRelationShortLabel(kind: SceneRelationKind): string {
  switch (kind) {
    case "characters":
      return "Postać";
    case "threads":
      return "Wątek";
    case "elements":
      return "Świat";
    case "rules":
      return "Reguła";
  }
}

function sceneRelationTitle(kind: SceneRelationKind): string {
  switch (kind) {
    case "characters":
      return "Postacie";
    case "threads":
      return "Wątki";
    case "elements":
      return "Elementy świata";
    case "rules":
      return "Reguły świata";
  }
}

function PlanStageNavigation({
  activeStep,
  onSelectStep
}: {
  activeStep: PlanStep;
  onSelectStep: (step: PlanStep) => void;
}) {
  const activeIndex = planSteps.findIndex((step) => step.key === activeStep);

  return (
    <nav className="plan-steps" aria-label="Kroki planu powieści">
      {planSteps.map((step, index) => {
        const active = activeStep === step.key;
        const done = index < activeIndex;
        const className = ["plan-step", active ? "active" : "", done ? "done" : ""]
          .filter(Boolean)
          .join(" ");

        return (
          <Fragment key={step.key}>
            {index > 0 ? <span className="plan-step-sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className={className}
              onClick={() => onSelectStep(step.key)}
              aria-current={active ? "step" : undefined}
            >
              <span className="plan-step-n" aria-hidden="true">
                {done ? "✓" : index + 1}
              </span>
              {step.label}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

function StructureStep({
  bookId,
  plan,
  saving,
  onSave,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onSave: (input: SaveStoryStructureWithSkeletonInput) => void;
}) {
  const [structureType, setStructureType] = useState(
    plan.structure?.structureType ?? "three_act"
  );
  const [description, setDescription] = useState(plan.structure?.description ?? "");
  const [notes, setNotes] = useState(plan.structure?.notes ?? "");
  const selectedOption =
    structureOptions.find((option) => option.value === structureType) ??
    structureOptions[0];
  const shouldCreateActSkeleton =
    plan.acts.length === 0 && selectedOption.actTemplates.length > 0;

  useEffect(() => {
    setStructureType(plan.structure?.structureType ?? "three_act");
    setDescription(plan.structure?.description ?? "");
    setNotes(plan.structure?.notes ?? "");
  }, [
    plan.structure?.structureType,
    plan.structure?.description,
    plan.structure?.notes
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: plan.structure?.id,
      bookId,
      structureType,
      description,
      notes,
      status: "draft",
      ...(shouldCreateActSkeleton
        ? { actTemplates: selectedOption.actTemplates }
        : {})
    });
  }

  return (
    <PlanCard
      title="Struktura fabuły"
      icon={<Map size={18} />}
      action={
        <PlanAiActions
          field="storyStructure"
          onGenerate={() => onGenerate("storyStructure")}
          onActivatePrompt={() => onActivatePrompt("storyStructure")}
        />
      }
    >
      <form className="plan-form structure-builder-form" onSubmit={submit}>
        <fieldset className="structure-choice-grid">
          <legend>Typ struktury</legend>
          {structureOptions.map((option) => {
            const selected = option.value === structureType;
            const createsActs = plan.acts.length === 0 && option.actTemplates.length > 0;
            const Icon = option.icon;

            return (
              <label
                className={selected ? "structure-choice active" : "structure-choice"}
                key={option.value}
              >
                <input
                  type="radio"
                  name="structureType"
                  value={option.value}
                  checked={selected}
                  onChange={() => setStructureType(option.value)}
                />
                <span className="structure-choice-heading">
                  <span className="structure-choice-title">
                    <Icon size={24} />
                    <strong>{option.label}</strong>
                  </span>
                  <em>{option.actTemplates.length ? `${option.actTemplates.length} akty` : "Dowolna"}</em>
                </span>
                <span className="structure-choice-copy">
                  <b>Najlepsze dla</b>
                  {option.bestFor}
                </span>
                <span className="structure-choice-copy">
                  <b>Porządkuje</b>
                  {option.organizes}
                </span>
                <span className={createsActs ? "structure-choice-result ready" : "structure-choice-result"}>
                  {plan.acts.length > 0 && option.actTemplates.length > 0
                    ? "Akty już istnieją, więc wybór nie nadpisze szkieletu."
                    : option.result}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="structure-act-preview">
          <div>
            <p className="eyebrow">Szkielet aktów</p>
            <h4>{selectedOption.label}</h4>
          </div>
          {selectedOption.actTemplates.length > 0 ? (
            <ol className="structure-act-card-list">
              {selectedOption.actTemplates.map((act, index) => (
                <li key={act.name}>
                  <div className="structure-act-card-heading">
                    <span style={{ background: act.color }}>{index + 1}</span>
                    <strong>{act.name}</strong>
                    <small>{act.startPercent}-{act.endPercent}%</small>
                  </div>
                  <div className="structure-act-percent-track" aria-hidden="true">
                    <span
                      style={{
                        marginLeft: `${act.startPercent}%`,
                        width: `${Math.max(act.endPercent - act.startPercent, 4)}%`,
                        background: act.color
                      }}
                    />
                  </div>
                  <p>{act.purpose}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted-text">
              Struktura własna nie tworzy aktów automatycznie.
            </p>
          )}
          <p className={shouldCreateActSkeleton ? "success-text" : "muted-text"}>
            {shouldCreateActSkeleton
              ? "Po zapisie aplikacja przygotuje te akty."
              : plan.acts.length > 0
                ? "Istniejące akty pozostaną bez zmian."
                : "Ten wybór nie doda aktów automatycznie."}
          </p>
        </div>
        <div className="structure-notes-grid">
          <PlanInlineField
            label="Opis struktury"
            value={description}
            rows={5}
            field="storyStructureDescription"
            onChange={setDescription}
            onGenerate={onGenerate}
            onActivatePrompt={onActivatePrompt}
          />
          <PlanInlineField
            label="Notatki do planu"
            value={notes}
            rows={5}
            field="storyStructureNotes"
            onChange={setNotes}
            onGenerate={onGenerate}
            onActivatePrompt={onActivatePrompt}
          />
        </div>
        <div className="structure-form-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={16} />
            {saving ? "Zapisuję" : "Zapisz strukturę"}
          </button>
        </div>
      </form>
    </PlanCard>
  );
}

function ActsStep({
  bookId,
  plan,
  saving,
  onSave,
  onDelete,
  onSelect,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onSave: (input: UpsertActInput) => void;
  onDelete: (item: SelectedPlanItem) => void;
  onSelect: (item: SelectedPlanItem) => void;
}) {
  return (
    <PlanCard
      title="Akty"
      icon={<Flag size={18} />}
      action={
        <PlanAiActions
          field="acts"
          onGenerate={() => onGenerate("acts")}
          onActivatePrompt={() => onActivatePrompt("acts")}
        />
      }
    >
      <p className="muted-text">
        Po ustawieniu aktów utwórz szkielet rozdziałów: robocze kontenery, do których
        później przypniesz wątki i beaty.
      </p>
      <div className="plan-grid-list">
        {plan.acts.map((act) => (
          <ActForm
            key={act.id}
            bookId={bookId}
            act={act}
            saving={saving}
            onSave={onSave}
            onDelete={() => onDelete({ type: "act", id: act.id })}
            onSelect={() => onSelect({ type: "act", id: act.id })}
            onGenerate={(field) => onGenerate(field, act)}
            onActivatePrompt={(field) => onActivatePrompt(field, act)}
          />
        ))}
        <ActForm
          bookId={bookId}
          saving={saving}
          orderIndex={plan.acts.length}
          onSave={onSave}
          onDelete={undefined}
          onSelect={undefined}
          onGenerate={onGenerate}
          onActivatePrompt={onActivatePrompt}
        />
      </div>
    </PlanCard>
  );
}

function ActForm({
  bookId,
  act,
  orderIndex = 0,
  saving,
  onSave,
  onDelete,
  onSelect,
  onGenerate,
  onActivatePrompt
}: {
  bookId: string;
  act?: Act;
  orderIndex?: number;
  saving: boolean;
  onSave: (input: UpsertActInput) => void;
  onDelete?: () => void;
  onSelect?: () => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity
  ) => void;
}) {
  const [name, setName] = useState(act?.name ?? `Akt ${orderIndex + 1}`);
  const [purpose, setPurpose] = useState(act?.purpose ?? "");
  const [summary, setSummary] = useState(act?.summary ?? "");
  const [startPercent, setStartPercent] = useState(act?.startPercent ?? orderIndex * 25);
  const [endPercent, setEndPercent] = useState(act?.endPercent ?? (orderIndex + 1) * 25);
  const [color, setColor] = useState(act?.color ?? actColors[orderIndex % actColors.length]);

  useEffect(() => {
    setName(act?.name ?? `Akt ${orderIndex + 1}`);
    setPurpose(act?.purpose ?? "");
    setSummary(act?.summary ?? "");
    setStartPercent(act?.startPercent ?? orderIndex * 25);
    setEndPercent(act?.endPercent ?? (orderIndex + 1) * 25);
    setColor(act?.color ?? actColors[orderIndex % actColors.length]);
  }, [
    act?.name,
    act?.purpose,
    act?.summary,
    act?.startPercent,
    act?.endPercent,
    act?.color,
    orderIndex
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: act?.id,
      bookId,
      name,
      purpose,
      summary,
      startPercent,
      endPercent,
      orderIndex: act?.orderIndex ?? orderIndex,
      color
    });
  }

  return (
    <form className="plan-entity-card" onSubmit={submit}>
      <button
        type="button"
        className="plan-link-title"
        onClick={onSelect}
        disabled={!act}
        aria-label={act ? `Otwórz akt ${act.name}` : "Nowy akt"}
      >
        <span style={{ background: color }} />
        {act ? act.name : "Nowy akt"}
      </button>
      <label className="field-label">
        Nazwa
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <PlanInlineField
        label="Cel aktu"
        value={purpose}
        rows={3}
        field="actPurpose"
        entity={act}
        onChange={setPurpose}
        onGenerate={onGenerate}
        onActivatePrompt={onActivatePrompt}
      />
      <PlanInlineField
        label="Streszczenie aktu"
        value={summary}
        rows={4}
        field="actSummary"
        entity={act}
        onChange={setSummary}
        onGenerate={onGenerate}
        onActivatePrompt={onActivatePrompt}
      />
      <div className="plan-form-row">
        <label className="field-label">
          Start %
          <input
            type="number"
            min={0}
            max={100}
            value={startPercent}
            onChange={(event) => setStartPercent(Number(event.target.value))}
          />
        </label>
        <label className="field-label">
          Koniec %
          <input
            type="number"
            min={0}
            max={100}
            value={endPercent}
            onChange={(event) => setEndPercent(Number(event.target.value))}
          />
        </label>
        <label className="field-label">
          Kolor
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="Kolor aktu"
          />
        </label>
      </div>
      <EntityActions saving={saving} onDelete={onDelete} />
    </form>
  );
}

function BeatsStep({
  bookId,
  plan,
  saving,
  onSave,
  onMoveBeat,
  onRequestDelete,
  onOpenBeat,
  onCreateBeat,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onSave: (input: BeatSaveInput) => void;
  onMoveBeat: (input: MoveBeatToChapterInput) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onOpenBeat: (beat: Beat) => void;
  onCreateBeat: (chapterId?: string | null) => void;
}) {
  const beatChapterRailRef = useRef<HTMLDivElement>(null);
  const beatBoardRef = useRef<HTMLDivElement>(null);
  const beatDragRef = useRef<BeatPointerDrag | null>(null);
  const suppressBeatOpenRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<BeatSortMode>("order");
  const [beatDrag, setBeatDrag] = useState<BeatPointerDrag | null>(null);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("pl-PL");
  const visibleBeats = plan.beats
    .filter((beat) => {
      const chapter = chapterForBeat(plan, beat);
      const searchable = `${beat.name} ${beat.description} ${beat.role} ${chapter?.workingTitle ?? ""}`
        .toLocaleLowerCase("pl-PL");
      return !normalizedSearch || searchable.includes(normalizedSearch);
    })
    .sort((first, second) => {
      if (sortMode === "name") {
        return first.name.localeCompare(second.name, "pl-PL");
      }
      if (sortMode === "role") {
        return (
          first.role.localeCompare(second.role, "pl-PL") ||
          first.orderIndex - second.orderIndex
        );
      }
      return first.orderIndex - second.orderIndex;
    });
  const lanes = beatChapterLanesForPlan(plan, visibleBeats);
  const unassignedBeats = beatsWithoutChapter(plan, visibleBeats);
  const draggedBeatId = beatDrag?.beatId ?? null;
  const dropTarget = beatDrag?.dropTarget ?? null;

  function scrollChapterRail(direction: -1 | 1) {
    const rail = beatChapterRailRef.current;
    const board = beatBoardRef.current;

    if (!rail && !board) {
      return;
    }

    const source = board ?? rail;
    const scrollAmount = Math.max((source?.clientWidth ?? 0) - 96, 180);

    scrollElementBy(rail, direction * scrollAmount);
    scrollElementBy(board, direction * scrollAmount);
  }

  function scrollToLane(index: number) {
    const board = beatBoardRef.current;
    const rail = beatChapterRailRef.current;
    const target = board?.children[index] as HTMLElement | undefined;
    const tab = rail?.children[index] as HTMLElement | undefined;

    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  function handleBeatPointerDown(event: PointerEvent<HTMLElement>, beatId: string) {
    if (saving || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const drag: BeatPointerDrag = {
      beatId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      isDragging: false,
      dropTarget: null
    };
    beatDragRef.current = drag;
    setBeatDrag(drag);
  }

  function handleBeatPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = beatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || saving) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const isDragging = drag.isDragging || distance >= beatDragActivationDistance;
    const nextDrag: BeatPointerDrag = {
      ...drag,
      currentX: event.clientX,
      currentY: event.clientY,
      isDragging,
      dropTarget: isDragging ? beatDropTargetFromPoint(event.clientX, event.clientY) : null
    };
    beatDragRef.current = nextDrag;
    setBeatDrag(nextDrag);
  }

  function handleBeatPointerUp(event: PointerEvent<HTMLElement>) {
    const drag = beatDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (drag.isDragging && drag.dropTarget) {
      onMoveBeat({
        bookId,
        beatId: drag.beatId,
        chapterId: drag.dropTarget.chapterId,
        orderIndex: beatOrderIndexAfterDrop(
          plan,
          lanes,
          unassignedBeats,
          drag.beatId,
          drag.dropTarget
        )
      });
      suppressBeatOpenRef.current = true;
    }

    clearBeatDrag();
  }

  function handleBeatPointerCancel(event: PointerEvent<HTMLElement>) {
    if (beatDragRef.current?.pointerId === event.pointerId) {
      clearBeatDrag();
    }
  }

  function clearBeatDrag() {
    beatDragRef.current = null;
    setBeatDrag(null);
  }

  useEffect(() => {
    if (!beatDrag) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        clearBeatDrag();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [beatDrag]);

  return (
    <section className="chapter-board-workspace beat-chapter-workspace">
      <div className="chapter-board-shell beat-chapter-shell">
        <div className="chapter-board-toolbar">
          <div className="chapter-board-heading">
            <span className="stage-heading-icon">
              <Target size={18} />
            </span>
            <div>
              <p className="eyebrow">Beaty</p>
              <h3>Dopnij beaty do rozdziałów</h3>
              <p>
                Mapa beatów porządkuje obowiązki strukturalne. Główna decyzja o
                kontrakcie nadal dzieje się w kokpicie rozdziału.
              </p>
            </div>
          </div>
          <div className="chapter-board-actions beat-board-actions">
            <label className="beat-board-search">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Szukaj beatu..."
                aria-label="Szukaj beatu"
              />
            </label>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as BeatSortMode)}
              aria-label="Sortuj beaty"
            >
              <option value="order">Sortuj: Kolejność</option>
              <option value="name">Sortuj: Nazwa</option>
              <option value="role">Sortuj: Rola</option>
            </select>
            <button type="button" className="primary-button" onClick={() => onCreateBeat(null)}>
              <Plus size={16} />
              Dodaj beat
            </button>
            <PlanAiActions
              field="beatSheet"
              generateLabel="Dopnij beaty"
              generateTitle="Wygeneruj beat sheet przypisany do roboczych rozdziałów"
              onGenerate={() => onGenerate("beatSheet")}
              onActivatePrompt={() => onActivatePrompt("beatSheet")}
            />
          </div>
        </div>

        <section
          className={
            dropTarget?.chapterId === null
              ? "beat-unassigned-section drop-active"
              : "beat-unassigned-section"
          }
          data-drop-zone="beat-lane"
          data-lane-id={withoutChapterBeatLaneId}
          data-chapter-id=""
        >
          <div className="beat-unassigned-header">
            <div>
              <span className="chapter-act-dot" />
              <h4>Nieprzypisane beaty</h4>
            </div>
            <span>{unassignedBeats.length} beatów</span>
          </div>
          <div className="beat-card-stack">
            {unassignedBeats.length > 0 ? (
              unassignedBeats.map((beat) => (
                <BeatBoardCard
                  key={beat.id}
                  beat={beat}
                  chapter={null}
                  dragging={draggedBeatId === beat.id}
                  dropPosition={dropTarget?.beatId === beat.id ? dropTarget.position : null}
                  dragDisabled={saving}
                  onPointerDown={(event) => handleBeatPointerDown(event, beat.id)}
                  onPointerMove={handleBeatPointerMove}
                  onPointerUp={handleBeatPointerUp}
                  onPointerCancel={handleBeatPointerCancel}
                  onLostPointerCapture={() => clearBeatDrag()}
                  onHandleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onOpen={() => onOpenBeat(beat)}
                  onRequestDelete={() => onRequestDelete(beatDeleteTarget(plan, beat))}
                  onSuppressOpen={() => {
                    if (!suppressBeatOpenRef.current) {
                      return false;
                    }

                    suppressBeatOpenRef.current = false;
                    return true;
                  }}
                />
              ))
            ) : (
              <p className="muted-text chapter-empty-note">
                Wszystkie widoczne beaty są przypisane do rozdziałów.
              </p>
            )}
          </div>
        </section>
        <div className="chapter-act-rail-card">
          <button
            type="button"
            className="chapter-rail-scroll-button previous"
            onClick={() => scrollChapterRail(-1)}
            aria-label="Pokaż wcześniejsze rozdziały"
            title="Pokaż wcześniejsze rozdziały"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            ref={beatChapterRailRef}
            className="chapter-act-rail"
            role="tablist"
            aria-label="Rozdziały w planie beatów"
          >
            {lanes.map((lane, index) => (
              <button
                key={lane.id}
                type="button"
                role="tab"
                aria-selected="false"
                className="chapter-act-tab"
                onClick={() => scrollToLane(index)}
              >
                <span className="chapter-act-dot" style={{ background: lane.color }} />
                <span className="stage-copy">
                  <strong>
                    {lane.number}. {lane.name}
                  </strong>
                  <span>{lane.beats.length} beatów</span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="chapter-rail-scroll-button next"
            onClick={() => scrollChapterRail(1)}
            aria-label="Pokaż kolejne rozdziały"
            title="Pokaż kolejne rozdziały"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div ref={beatBoardRef} className="chapter-act-columns beat-chapter-columns">
          {lanes.map((lane) => {
            const chapterId = lane.chapterId ?? "";
            const chapter = plan.chapters.find((item) => item.id === chapterId) ?? null;

            return (
              <section
                className={
                  dropTarget?.chapterId === chapterId
                    ? "chapter-act-column beat-chapter-column drop-active"
                    : "chapter-act-column beat-chapter-column"
                }
                key={lane.id}
                data-chapter-id={chapterId}
                data-drop-zone="beat-lane"
                data-lane-id={lane.id}
              >
                <div className="chapter-act-column-header">
                  <div>
                    <span className="chapter-act-dot" style={{ background: lane.color }} />
                    <h4>
                      {lane.number}. {lane.name}
                    </h4>
                  </div>
                  <span>{lane.beats.length} beatów</span>
                </div>
                <p className="chapter-act-purpose">
                  {lane.summary || "Rozdział bez streszczenia."}
                </p>
                <div className="beat-card-stack">
                  {lane.beats.length > 0 ? (
                    lane.beats.map((beat) => (
                      <BeatBoardCard
                        key={beat.id}
                        beat={beat}
                        chapter={chapter}
                        dragging={draggedBeatId === beat.id}
                        dropPosition={dropTarget?.beatId === beat.id ? dropTarget.position : null}
                        dragDisabled={saving}
                        onPointerDown={(event) => handleBeatPointerDown(event, beat.id)}
                        onPointerMove={handleBeatPointerMove}
                        onPointerUp={handleBeatPointerUp}
                        onPointerCancel={handleBeatPointerCancel}
                        onLostPointerCapture={() => clearBeatDrag()}
                        onHandleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onOpen={() => onOpenBeat(beat)}
                        onRequestDelete={() => onRequestDelete(beatDeleteTarget(plan, beat))}
                        onSuppressOpen={() => {
                          if (!suppressBeatOpenRef.current) {
                            return false;
                          }

                          suppressBeatOpenRef.current = false;
                          return true;
                        }}
                      />
                    ))
                  ) : (
                    <p
                      className={
                        dropTarget?.chapterId === chapterId
                          ? "muted-text chapter-empty-note drop-active"
                          : "muted-text chapter-empty-note"
                      }
                    >
                      Ten rozdział nie ma jeszcze beatów.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost-button chapter-column-add"
                  onClick={() => onCreateBeat(chapterId)}
                >
                  <Plus size={16} />
                  Dodaj beat
                </button>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BeatBoardCard({
  beat,
  chapter,
  dragging,
  dropPosition,
  dragDisabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onHandleClick,
  onSuppressOpen,
  onOpen,
  onRequestDelete
}: {
  beat: Beat;
  chapter: Chapter | null;
  dragging: boolean;
  dropPosition: BeatDropTarget["position"] | null;
  dragDisabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: () => void;
  onHandleClick: (event: MouseEvent<HTMLElement>) => void;
  onSuppressOpen: () => boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
}) {
  const className = [
    "chapter-board-card",
    "beat-board-card",
    dragging ? "dragging" : "",
    dropPosition === "before" ? "drop-before" : "",
    dropPosition === "after" ? "drop-after" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      role="button"
      tabIndex={0}
      className={className}
      data-beat-id={beat.id}
      onClick={() => {
        if (onSuppressOpen()) {
          return;
        }

        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Otwórz beat ${beat.name}`}
    >
      <span className="chapter-card-topline">
        <span className="chapter-number-badge beat-number-badge">
          {beat.orderIndex + 1}
        </span>
        <span
          className="chapter-drag-handle"
          aria-hidden="true"
          data-drag-handle="beat"
          onClick={onHandleClick}
          onPointerCancel={onPointerCancel}
          onPointerDown={dragDisabled ? undefined : onPointerDown}
          onPointerMove={dragDisabled ? undefined : onPointerMove}
          onPointerUp={dragDisabled ? undefined : onPointerUp}
          onLostPointerCapture={onLostPointerCapture}
        >
          <GripVertical size={15} />
        </span>
        <span>{chapter ? `Rozdz. ${chapter.number}` : "Nieprzypisany"}</span>
        <button
          type="button"
          className="plan-card-delete-icon"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete();
          }}
          disabled={dragDisabled}
          title={`Usuń beat: ${beat.name}`}
          aria-label={`Usuń beat: ${beat.name}`}
        >
          <Trash2 size={14} />
        </button>
      </span>
      <strong>{beat.name}</strong>
      <p>{beat.description || "Brak opisu beatu."}</p>
      <span className="chapter-card-field">
        <b>Rola</b>
        {beat.role || "Brak"}
      </span>
    </article>
  );
}

function BeatForm({
  bookId,
  beat,
  plan,
  orderIndex = 0,
  initialChapterId,
  onSave,
  onGenerate,
  onActivatePrompt
}: {
  bookId: string;
  beat?: Beat;
  plan: BookPlan;
  orderIndex?: number;
  initialChapterId?: string | null;
  saving: boolean;
  onSave: (input: BeatSaveInput) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity
  ) => void;
}) {
  const assignedChapterId = beat ? chapterIdForBeat(plan, beat.id) : initialChapterId ?? null;
  const [name, setName] = useState(beat?.name ?? `Beat ${orderIndex + 1}`);
  const [description, setDescription] = useState(beat?.description ?? "");
  const [role, setRole] = useState(beat?.role ?? "");
  const [chapterId, setChapterId] = useState(assignedChapterId ?? "");
  const targetId = beat?.id ?? `draft-beat:${bookId}:${initialChapterId ?? "unassigned"}`;

  useEffect(() => {
    setName(beat?.name ?? `Beat ${orderIndex + 1}`);
    setDescription(beat?.description ?? "");
    setRole(beat?.role ?? "");
    setChapterId(assignedChapterId ?? "");
  }, [beat?.name, beat?.description, beat?.role, assignedChapterId, orderIndex]);

  useEffect(() => {
    registerPlanDraftFieldTarget(targetId, (field, value) => {
      if (field === "beatName") {
        setName(value);
      }
      if (field === "beatRole") {
        setRole(value);
      }
      if (field === "beatDescription") {
        setDescription(value);
      }
    });

    return () => unregisterPlanDraftFieldTarget(targetId);
  }, [targetId]);

  const draftBeat = (): Beat & {
    chapterId?: string | null;
    draftAcceptance: true;
  } => ({
    id: targetId,
    bookId,
    name,
    description,
    role,
    orderIndex: beat?.orderIndex ?? orderIndex,
    createdAt: beat?.createdAt ?? "",
    updatedAt: beat?.updatedAt ?? "",
    chapterId: chapterId || null,
    draftAcceptance: true
  });

  function generateBeatField(
    field: Extract<PlanFieldKey, "beatName" | "beatRole" | "beatDescription">
  ) {
    onGenerate(field, draftBeat());
  }

  function activateBeatPrompt(
    field: Extract<PlanFieldKey, "beatName" | "beatRole" | "beatDescription">
  ) {
    onActivatePrompt(field, draftBeat());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: beat?.id,
      bookId,
      name,
      description,
      role,
      orderIndex: beat?.orderIndex ?? orderIndex,
      chapterId: chapterId || null
    });
  }

  const selectedChapter = plan.chapters.find((chapter) => chapter.id === chapterId);
  const completionItems = [
    { label: "Nazwa", complete: Boolean(name.trim()) },
    { label: "Rola", complete: Boolean(role.trim()) },
    { label: "Opis", complete: Boolean(description.trim()) },
    { label: "Rozdział", complete: Boolean(chapterId) }
  ];
  const completedItems = completionItems.filter((item) => item.complete).length;
  const completionPercent = Math.round((completedItems / completionItems.length) * 100);

  return (
    <form id="beat-edit-form" className="chapter-edit-form beat-edit-form" onSubmit={submit}>
      <div className="chapter-edit-metrics" aria-label="Najważniejsze informacje o beacie">
        <span className="chapter-edit-metric">
          <Target size={16} />
          <span>Rola:</span>
          <strong>{role || "Bez roli"}</strong>
        </span>
        <span className="chapter-edit-metric">
          <FileText size={16} />
          <span>Rozdział</span>
          <strong>
            {selectedChapter
              ? `${dynamicChapterNumber(plan, selectedChapter.id)}. ${selectedChapter.workingTitle}`
              : "Nieprzypisany"}
          </strong>
        </span>
        <span className="chapter-edit-metric">
          <CheckCircle2 size={16} />
          <span>Uzupełnione:</span>
          <strong>
            {completedItems} / {completionItems.length}
          </strong>
        </span>
        <StatusPill
          tone={completionPercent >= 100 ? "success" : completionPercent >= 50 ? "accent" : "muted"}
        >
          {completionPercent >= 100 ? "Gotowy" : completionPercent >= 50 ? "W trakcie" : "Szkic"}
        </StatusPill>
      </div>

      <div className="chapter-edit-content-grid beat-edit-content-grid">
        <main className="chapter-edit-main">
          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <LayoutList size={17} />
              <h4>Treść beatu</h4>
            </div>
            <div className="chapter-field-stack">
              <BeatInlineField
                label="Nazwa"
                value={name}
                field="beatName"
                onChange={setName}
                onGenerate={generateBeatField}
                onActivatePrompt={activateBeatPrompt}
              />
              <BeatInlineField
                label="Rola"
                value={role}
                field="beatRole"
                onChange={setRole}
                onGenerate={generateBeatField}
                onActivatePrompt={activateBeatPrompt}
              />
              <BeatInlineField
                label="Opis"
                value={description}
                field="beatDescription"
                rows={6}
                onChange={setDescription}
                onGenerate={generateBeatField}
                onActivatePrompt={activateBeatPrompt}
              />
            </div>
          </section>
        </main>

        <aside className="chapter-edit-sidebar" aria-label="Przypisanie beatu">
          <section className="chapter-side-section beat-chapter-picker-section">
            <div className="chapter-side-heading">
              <Route size={16} />
              <h4>Rozdział</h4>
            </div>
            <Field
              label="Przypisz do"
              hint="Beat może być przypisany tylko do jednego rozdziału. Zmiana tutaj przeniesie go z poprzedniego miejsca."
            >
              <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                <option value="">Nieprzypisany</option>
                {orderedChaptersForPlan(plan).map((chapter) => (
                  <option value={chapter.id} key={chapter.id}>
                    {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        </aside>
      </div>
    </form>
  );
}

function BeatInlineField({
  label,
  value,
  field,
  rows,
  onChange,
  onGenerate,
  onActivatePrompt
}: {
  label: string;
  value: string;
  field: Extract<PlanFieldKey, "beatName" | "beatRole" | "beatDescription">;
  rows?: number;
  onChange: (value: string) => void;
  onGenerate: (
    field: Extract<PlanFieldKey, "beatName" | "beatRole" | "beatDescription">
  ) => void;
  onActivatePrompt: (
    field: Extract<PlanFieldKey, "beatName" | "beatRole" | "beatDescription">
  ) => void;
}) {
  return (
    <Field
      label={label}
      actions={
        <PlanAiActions
          field={field}
          targetEntity={{} as Beat}
          onGenerate={() => onGenerate(field)}
          onActivatePrompt={() => onActivatePrompt(field)}
        />
      }
    >
      {rows ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => onActivatePrompt(field)}
          rows={rows}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => onActivatePrompt(field)}
        />
      )}
    </Field>
  );
}

function BeatEditModal({
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
  state: BeatModalState | null;
  bookId: string;
  plan: BookPlan;
  saving: boolean;
  onClose: () => void;
  onSave: (input: BeatSaveInput) => void;
  onDelete: (item: SelectedPlanItem) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: PlanPromptEntity
  ) => void;
}) {
  const beat =
    state?.mode === "edit"
      ? plan.beats.find((candidate) => candidate.id === state.beatId)
      : undefined;

  if (!state) {
    return null;
  }

  const modalTitle = state.mode === "edit" && beat ? beat.name : "Nowy beat";

  return (
    <Modal
      title={modalTitle}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {beat ? (
            <Button
              variant="danger"
              onClick={() => onDelete({ type: "beat", id: beat.id })}
              disabled={saving}
            >
              <Trash2 size={15} aria-hidden />
              Usuń
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" type="submit" form="beat-edit-form" busy={saving}>
            {saving ? "Zapisuję" : "Zapisz zmiany"}
          </Button>
        </>
      }
    >
      <BeatForm
        bookId={bookId}
        beat={beat}
        plan={plan}
        saving={saving}
        orderIndex={plan.beats.length}
        initialChapterId={state.mode === "create" ? state.chapterId : undefined}
        onSave={onSave}
        onGenerate={onGenerate}
        onActivatePrompt={onActivatePrompt}
      />
    </Modal>
  );
}

function ThreadsStep({
  bookId,
  plan,
  saving,
  onSave,
  onSaveChapter,
  onSaveChapterThreadRelation,
  onRequestDelete,
  onSelect,
  onGenerate,
  onActivatePrompt,
  onSuggestThreadsForAllChapters
}: StepProps & {
  onSave: (input: UpsertPlotThreadInput) => void;
  onSaveChapter: (input: UpsertChapterInput) => void;
  onSaveChapterThreadRelation: (input: UpsertChapterThreadInput) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onSelect: (item: SelectedPlanItem) => void;
  onSuggestThreadsForAllChapters: () => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<ThreadSortMode>("order");
  const [viewMode, setViewMode] = useState<ThreadViewMode>("map");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    plan.threads[0]?.id ?? null
  );
  const [editingThreadId, setEditingThreadId] = useState<ThreadEditTarget>(null);
  const threadIdsKey = plan.threads.map((thread) => thread.id).join("|");
  const proposals = useProposalStore((state) => state.proposals);
  const chapters = orderedChaptersForPlan(plan);
  const bulkThreadSuggestionsPending = Boolean(
    pendingProposalStatus(proposals, {
      bookId,
      field: "allChapterThreadSuggestions",
      scope: "bookPlan"
    })
  );

  useEffect(() => {
    if (plan.threads.length === 0) {
      setSelectedThreadId(null);
      setEditingThreadId((current) => (current === "new" ? current : null));
      return;
    }

    if (!selectedThreadId || !plan.threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(plan.threads[0].id);
    }
  }, [plan.threads, selectedThreadId, threadIdsKey]);

  const normalizedQuery = query.trim().toLocaleLowerCase("pl-PL");
  const visibleThreads = plan.threads
    .filter((thread) => {
      const matchesStatus = statusFilter === "all" || thread.status === statusFilter;
      const searchable = `${thread.name} ${thread.description} ${threadStatusLabel(thread.status)}`
        .toLocaleLowerCase("pl-PL");

      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    })
    .sort((left, right) => {
      if (sortMode === "name") {
        return left.name.localeCompare(right.name, "pl");
      }

      if (sortMode === "status") {
        return threadStatusRank(left.status) - threadStatusRank(right.status);
      }

      return left.orderIndex - right.orderIndex;
    });
  const selectedThread =
    plan.threads.find((thread) => thread.id === selectedThreadId) ??
    visibleThreads[0] ??
    plan.threads[0] ??
    null;
  const linkedChapterCount = plan.chapterThreads.filter((relation) =>
    plan.threads.some((thread) => thread.id === relation.threadId)
  ).length;

  function selectThread(thread: PlotThread) {
    setSelectedThreadId(thread.id);
    setEditingThreadId(null);
    onSelect({ type: "thread", id: thread.id });
  }

  function startNewThread() {
    setSelectedThreadId(null);
    setEditingThreadId("new");
  }

  function finishEdit(input: UpsertPlotThreadInput) {
    onSave(input);
    setEditingThreadId(null);
  }

  function removeThreadFromChapter(thread: PlotThread, chapter: Chapter) {
    onSaveChapter(
      chapterUpsertInputWithRelations(
        plan,
        chapter,
        chapterThreadIdsForChapter(plan, chapter.id).filter((threadId) => threadId !== thread.id),
        chapterBeatIdsForChapter(plan, chapter.id)
      )
    );
  }

  function addThreadToChapter(thread: PlotThread, chapter: Chapter) {
    onSaveChapterThreadRelation({
      bookId,
      threadId: thread.id,
      chapterId: chapter.id,
      description: chapterThreadRelation(plan, thread.id, chapter.id)?.description ?? ""
    });
  }

  return (
    <section className="thread-workspace-shell">
      <header className="thread-workspace-header">
        <div>
          <div className="thread-title-row">
            <span className="thread-title-icon">
              <GitBranch size={18} />
            </span>
            <h3>Wątki</h3>
            <span className="thread-count-badge">{plan.threads.length}</span>
          </div>
          <p>
            Rozpisz łuki i napięcia przez roboczy szkielet rozdziałów. Ten ekran jest
            mapą przebiegu, a szczegóły kontraktu wracają do kokpitu rozdziału.
          </p>
        </div>
        <div className="thread-header-actions">
          <PlanAiActions
            field="plotThreads"
            onGenerate={() => onGenerate("plotThreads")}
            onActivatePrompt={() => onActivatePrompt("plotThreads")}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={onSuggestThreadsForAllChapters}
            disabled={
              saving ||
              chapters.length === 0 ||
              plan.threads.length === 0 ||
              bulkThreadSuggestionsPending
            }
            title={
              chapters.length === 0
                ? "Dodaj rozdziały, aby przypisać wątki."
                : plan.threads.length === 0
                  ? "Dodaj wątki, aby przypisać je do rozdziałów."
                  : bulkThreadSuggestionsPending
                    ? "Przypisywanie wątków do rozdziałów jest już w kolejce."
                    : "Wygeneruj propozycje przebiegu wątków przez wszystkie rozdziały."
            }
          >
            <Sparkles size={16} />
            Rozpisz wątki przez rozdziały
          </button>
          <button type="button" className="primary-button" onClick={startNewThread}>
            <Plus size={16} />
            Dodaj wątek
          </button>
        </div>
      </header>

      <div className="thread-toolbar">
        <label className="thread-search-control">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj wątku..."
          />
        </label>
        <label className="thread-select-control">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Wszystkie</option>
            <option value="planned">Planowany</option>
            <option value="active">Aktywny</option>
            <option value="resolved">Domknięty</option>
          </select>
        </label>
        <label className="thread-select-control">
          <span>Sortuj</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as ThreadSortMode)}
          >
            <option value="order">Kolejność</option>
            <option value="name">Nazwa</option>
            <option value="status">Status</option>
          </select>
        </label>
        <div className="thread-view-toggle" role="group" aria-label="Widok wątków">
          <button
            type="button"
            className={viewMode === "map" ? "active" : ""}
            onClick={() => setViewMode("map")}
          >
            <Map size={15} />
            Mapa
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
          >
            <LayoutList size={15} />
            Lista
          </button>
          <button
            type="button"
            className={viewMode === "table" ? "active" : ""}
            onClick={() => setViewMode("table")}
          >
            <ClipboardList size={15} />
            Tabela
          </button>
        </div>
      </div>

      <div className="thread-content-grid">
        <div className="thread-main-panel">
          <ThreadFlowMap
            plan={plan}
            threads={visibleThreads}
            selectedThreadId={selectedThread?.id ?? null}
            onSelect={selectThread}
            onAddRelation={addThreadToChapter}
          />

          <div className="thread-view-panel">
            <div className="thread-view-summary">
              <span>{visibleThreads.length} widocznych</span>
              <span>{linkedChapterCount} powiązań z rozdziałami</span>
            </div>

            {viewMode === "table" ? (
              <ThreadTable
                plan={plan}
                threads={visibleThreads}
                selectedThreadId={selectedThread?.id ?? null}
                onSelect={selectThread}
              />
            ) : (
              <div className={viewMode === "list" ? "thread-card-list list" : "thread-card-list"}>
                {visibleThreads.map((thread) => (
                  <ThreadSummaryCard
                    key={thread.id}
                    plan={plan}
                    thread={thread}
                    active={selectedThread?.id === thread.id}
                    saving={saving}
                    onSelect={() => {
                      setSelectedThreadId(thread.id);
                      setEditingThreadId(thread.id);
                      onSelect({ type: "thread", id: thread.id });
                    }}
                    onAddChapter={(chapter) => addThreadToChapter(thread, chapter)}
                    onRemoveChapter={(chapter) => removeThreadFromChapter(thread, chapter)}
                    onRequestDelete={() => onRequestDelete(threadDeleteTarget(plan, thread))}
                  />
                ))}
                {visibleThreads.length === 0 ? (
                  <div className="thread-empty-state">
                    <GitBranch size={20} />
                    <strong>Brak wątków dla tych filtrów</strong>
                    <p>Zmień kryteria albo dodaj nowy wątek fabularny.</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

      </div>
      <ThreadEditModal
        state={editingThreadId}
        bookId={bookId}
        plan={plan}
        saving={saving}
        onClose={() => setEditingThreadId(null)}
        onSave={finishEdit}
        onSaveChapter={onSaveChapter}
        onSaveChapterThreadRelation={onSaveChapterThreadRelation}
        onDelete={(thread) => onRequestDelete(threadDeleteTarget(plan, thread))}
        onGenerate={onGenerate}
        onActivatePrompt={onActivatePrompt}
      />
    </section>
  );
}

function ThreadEditModal({
  state,
  bookId,
  plan,
  saving,
  onClose,
  onSave,
  onSaveChapter,
  onSaveChapterThreadRelation,
  onDelete,
  onGenerate,
  onActivatePrompt
}: {
  state: ThreadEditTarget;
  bookId: string;
  plan: BookPlan;
  saving: boolean;
  onClose: () => void;
  onSave: (input: UpsertPlotThreadInput) => void;
  onSaveChapter: (input: UpsertChapterInput) => void;
  onSaveChapterThreadRelation: (input: UpsertChapterThreadInput) => void;
  onDelete: (thread: PlotThread) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  if (!state) {
    return null;
  }

  const thread = state === "new" ? undefined : plan.threads.find((item) => item.id === state);
  if (state !== "new" && !thread) {
    return null;
  }

  const modalTitle = thread ? thread.name : "Nowy wątek";
  const modal = (
    <div className="chapter-edit-modal" role="dialog" aria-modal="true" aria-labelledby="thread-edit-title">
      <button
        type="button"
        className="chapter-edit-backdrop"
        onClick={onClose}
        aria-label="Zamknij edycję wątku"
      />
      <div className="chapter-edit-shell">
        <header className="chapter-edit-header">
          <div>
            <p className="eyebrow">Edycja wątku</p>
            <h3 id="thread-edit-title">{modalTitle}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Zamknij edycję wątku" title="Zamknij">
            <X size={18} />
          </button>
        </header>
        <div className="chapter-edit-body">
          <ThreadEditor
            bookId={bookId}
            thread={thread}
            plan={plan}
            orderIndex={plan.threads.length}
            saving={saving}
            onSave={onSave}
            onSaveChapter={onSaveChapter}
            onSaveChapterThreadRelation={onSaveChapterThreadRelation}
            onDelete={thread ? () => onDelete(thread) : undefined}
            onCancel={onClose}
            onGenerate={onGenerate}
            onActivatePrompt={onActivatePrompt}
          />
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modal;
  }

  return createPortal(modal, document.body);
}

function ThreadEditor({
  bookId,
  thread,
  plan,
  orderIndex = 0,
  saving,
  onSave,
  onSaveChapter,
  onSaveChapterThreadRelation,
  onDelete,
  onCancel,
  onGenerate,
  onActivatePrompt
}: {
  bookId: string;
  thread?: PlotThread;
  plan: BookPlan;
  orderIndex?: number;
  saving: boolean;
  onSave: (input: UpsertPlotThreadInput) => void;
  onSaveChapter: (input: UpsertChapterInput) => void;
  onSaveChapterThreadRelation: (input: UpsertChapterThreadInput) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  const [name, setName] = useState(thread?.name ?? `Wątek ${orderIndex + 1}`);
  const [description, setDescription] = useState(thread?.description ?? "");
  const [resolution, setResolution] = useState(thread?.resolution ?? "");
  const [color, setColor] = useState(thread?.color ?? actColors[orderIndex % actColors.length]);
  const [status, setStatus] = useState(thread?.status ?? "planned");
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [relationDescriptions, setRelationDescriptions] = useState<Record<string, string>>({});
  const relations = thread ? chapterThreadRelationsForThread(plan, thread.id) : [];
  const chapters = thread ? chaptersForThread(plan, thread) : [];
  const availableChapters = thread
    ? orderedChaptersForPlan(plan).filter(
        (chapter) => !relations.some((relation) => relation.chapterId === chapter.id)
      )
    : [];

  useEffect(() => {
    setName(thread?.name ?? `Wątek ${orderIndex + 1}`);
    setDescription(thread?.description ?? "");
    setResolution(thread?.resolution ?? "");
    setColor(thread?.color ?? actColors[orderIndex % actColors.length]);
    setStatus(thread?.status ?? "planned");
    setRelationDescriptions(
      Object.fromEntries(relations.map((relation) => [relation.chapterId, relation.description ?? ""]))
    );
  }, [thread?.id, thread?.name, thread?.description, thread?.resolution, thread?.color, thread?.status, orderIndex, relations.map((relation) => `${relation.chapterId}:${relation.description}`).join("|")]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: thread?.id,
      bookId,
      name,
      description,
      resolution,
      color,
      status,
      orderIndex: thread?.orderIndex ?? orderIndex
    });

    if (thread) {
      for (const relation of relations) {
        onSaveChapterThreadRelation({
          bookId,
          threadId: thread.id,
          chapterId: relation.chapterId,
          description: relationDescriptions[relation.chapterId] ?? ""
        });
      }
    }
  }

  return (
    <form className="thread-editor-form chapter-edit-form" onSubmit={submit}>
      <div className="chapter-edit-content-grid thread-edit-content-grid">
        <main className="chapter-edit-main">
          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <GitBranch size={17} />
              <h4>Dane wątku</h4>
            </div>
            <div className="chapter-field-stack">
              <label className="field-label">
                Nazwa
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <PlanInlineField
                label="Opis"
                value={description}
                rows={4}
                field="threadDescription"
                entity={thread}
                onChange={setDescription}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <label className="field-label">
                Planowane rozwiązanie
                <textarea
                  value={resolution}
                  rows={3}
                  placeholder="Jak wątek ma się domknąć w finale — AI sieje zapowiedzi w scenach"
                  onChange={(event) => setResolution(event.target.value)}
                />
              </label>
              <div className="plan-form-row">
                <label className="field-label">
                  Status
                  <select value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="planned">Planowany</option>
                    <option value="active">Aktywny</option>
                    <option value="resolved">Domknięty</option>
                  </select>
                </label>
                <label className="field-label">
                  Kolor
                  <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
                </label>
              </div>
            </div>
          </section>

          <section className="chapter-edit-section thread-chapter-flow-section">
            <div className="chapter-side-heading">
              <FileText size={16} />
              <h4>Przebieg w rozdziałach</h4>
              {thread && availableChapters.length > 0 ? (
                <button type="button" className="icon-button chapter-relation-add-button" onClick={() => setChapterPickerOpen(true)} title="Dodaj rozdział" aria-label="Dodaj rozdział">
                  <Plus size={15} />
                </button>
              ) : null}
            </div>
            <div className="chapter-field-stack">
              {thread && chapters.length > 0 ? (
                chapters.map((chapter) => {
                  const relation = chapterThreadRelation(plan, thread.id, chapter.id);
                  if (!relation) {
                    return null;
                  }

                  return (
                    <div className="thread-detail-section" key={chapter.id}>
                      <div className="chapter-side-heading">
                        <h4>{dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}</h4>
                        <button
                          type="button"
                          className="chapter-side-chip-remove"
                          onClick={() =>
                            onSaveChapter(
                              chapterUpsertInputWithRelations(
                                plan,
                                chapter,
                                chapterThreadIdsForChapter(plan, chapter.id).filter((threadId) => threadId !== thread.id),
                                chapterBeatIdsForChapter(plan, chapter.id)
                              )
                            )
                          }
                          aria-label={`Odepnij rozdział ${chapter.workingTitle}`}
                          title={`Odepnij rozdział ${chapter.workingTitle}`}
                        >
                          -
                        </button>
                      </div>
                      <PlanInlineField
                        label="Co dzieje się z wątkiem"
                        value={relationDescriptions[chapter.id] ?? relation.description ?? ""}
                        rows={3}
                        field="threadChapterDescription"
                        entity={relation}
                        onChange={(value) =>
                          setRelationDescriptions((current) => ({ ...current, [chapter.id]: value }))
                        }
                        onGenerate={onGenerate}
                        onActivatePrompt={onActivatePrompt}
                      />
                    </div>
                  );
                })
              ) : (
                <span className="chapter-side-empty">
                  {thread ? "Brak przypiętych rozdziałów" : "Zapisz wątek, aby przypiąć rozdziały."}
                </span>
              )}
            </div>
          </section>
        </main>
      </div>

      {chapterPickerOpen && thread ? (
        <ThreadChapterPickerModal
          plan={plan}
          thread={thread}
          availableChapters={availableChapters}
          onClose={() => setChapterPickerOpen(false)}
          onAdd={(chapter) => {
            onSaveChapterThreadRelation({
              bookId,
              threadId: thread.id,
              chapterId: chapter.id,
              description: ""
            });
            setChapterPickerOpen(false);
          }}
        />
      ) : null}

      <footer className="chapter-edit-footer">
        <div className="chapter-footer-status">
          <CheckCircle2 size={16} />
          <span>{thread ? `${relations.length} przypięć do rozdziałów` : "Nowy wątek"}</span>
        </div>
        <div className="chapter-footer-actions">
          {onDelete ? (
            <button type="button" className="ghost-button chapter-delete-button" onClick={onDelete} disabled={saving}>
              <Trash2 size={16} />
              Usuń
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" className="ghost-button" onClick={onCancel}>
              Anuluj
            </button>
          ) : null}
          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={16} />
            {saving ? "Zapisuję" : "Zapisz zmiany"}
          </button>
        </div>
      </footer>
    </form>
  );
}
function ThreadFlowMap({
  plan,
  threads,
  selectedThreadId,
  onSelect,
  onAddRelation
}: {
  plan: BookPlan;
  threads: PlotThread[];
  selectedThreadId: string | null;
  onSelect: (thread: PlotThread) => void;
  onAddRelation: (thread: PlotThread, chapter: Chapter) => void;
}) {
  if (plan.chapters.length === 0) {
    return (
      <section className="thread-map-card">
        <div className="thread-section-heading">
          <div>
            <p className="eyebrow">Mapa powiązań</p>
            <h4>Dodaj rozdziały, aby zobaczyć przebieg wątków</h4>
          </div>
        </div>
        <p className="muted-text">
          Mapa powstanie automatycznie z relacji między wątkami i rozdziałami.
        </p>
      </section>
    );
  }

  const orderedChapters = orderedChaptersForPlan(plan);

  return (
    <section className="thread-map-card">
      <div className="thread-section-heading">
        <div>
          <p className="eyebrow">Mapa powiązań wątków w całej historii</p>
          <h4>Przebieg przez rozdziały</h4>
        </div>
        <span>{plan.chapters.length} rozdz.</span>
      </div>
      <div className="thread-map-board">
        <div
          className="thread-map-axis"
          style={{
            gridTemplateColumns: `minmax(150px, 180px) repeat(${orderedChapters.length}, minmax(48px, 1fr))`
          }}
        >
          <span />
          {orderedChapters.map((chapter) => (
            <button
              type="button"
              key={chapter.id}
              title={chapter.workingTitle}
              aria-label={`Rozdział ${dynamicChapterNumber(plan, chapter.id)}: ${chapter.workingTitle}`}
            >
              <strong>{dynamicChapterNumber(plan, chapter.id)}</strong>
              <small>{plan.acts.find((act) => act.id === chapter.actId)?.name ?? "Bez aktu"}</small>
            </button>
          ))}
        </div>
        {threads.map((thread) => {
          const linkedChapterIds = new Set(
            plan.chapterThreads
              .filter((relation) => relation.threadId === thread.id)
              .map((relation) => relation.chapterId)
          );

          return (
            <div
              className={
                selectedThreadId === thread.id ? "thread-map-track active" : "thread-map-track"
              }
              style={{
                gridTemplateColumns: `minmax(150px, 180px) repeat(${orderedChapters.length}, minmax(48px, 1fr))`
              }}
              key={thread.id}
            >
              <button type="button" onClick={() => onSelect(thread)}>
                <span style={{ background: thread.color }} />
                {thread.name}
              </button>
              <div className="thread-map-nodes">
                {orderedChapters.map((chapter) => {
                  const linked = linkedChapterIds.has(chapter.id);

                  return (
                    <button
                      type="button"
                      key={chapter.id}
                      className={linked ? "linked" : ""}
                      style={linked ? { borderColor: thread.color, background: thread.color } : {}}
                      onClick={() => {
                        onSelect(thread);
                        if (!linked) {
                          onAddRelation(thread, chapter);
                        }
                      }}
                      title={`${thread.name}: rozdział ${dynamicChapterNumber(plan, chapter.id)}`}
                      aria-label={`${thread.name} w rozdziale ${dynamicChapterNumber(plan, chapter.id)}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ThreadSummaryCard({
  plan,
  thread,
  active,
  saving,
  onSelect,
  onAddChapter,
  onRemoveChapter,
  onRequestDelete
}: {
  plan: BookPlan;
  thread: PlotThread;
  active: boolean;
  saving: boolean;
  onSelect: () => void;
  onAddChapter: (chapter: Chapter) => void;
  onRemoveChapter: (chapter: Chapter) => void;
  onRequestDelete: () => void;
}) {
  const chapters = chaptersForThread(plan, thread);
  const acts = actsForThread(plan, thread);
  const coverage = threadCoveragePercent(plan, thread);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const availableChapters = orderedChaptersForPlan(plan).filter(
    (chapter) => !chapters.some((linkedChapter) => linkedChapter.id === chapter.id)
  );

  function openFromCard(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [role='dialog']")) {
      return;
    }

    onSelect();
  }

  function openFromKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onSelect();
  }

  return (
    <article
      className={active ? "thread-summary-card active" : "thread-summary-card"}
      role="button"
      tabIndex={0}
      onClick={openFromCard}
      onKeyDown={openFromKeyboard}
      aria-label={`Edytuj wątek ${thread.name}`}
    >
      <div className="thread-summary-hitarea">
        <span className="thread-color-dot" style={{ background: thread.color }} />
        <span>
          <strong>{thread.name}</strong>
          <em className={`thread-status-chip ${thread.status}`}>
            {threadStatusLabel(thread.status)}
          </em>
        </span>
      </div>
      <button
        type="button"
        className="plan-card-delete-icon thread-card-delete-icon"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRequestDelete();
        }}
        disabled={saving}
        title={`Usuń wątek: ${thread.name}`}
        aria-label={`Usuń wątek: ${thread.name}`}
      >
        <Trash2 size={14} />
      </button>
      <p>{thread.description || "Ten wątek nie ma jeszcze opisu."}</p>
      <div className="thread-card-metrics">
        <span>
          <b>Akty</b>
          {acts.length > 0 ? acts.map((act) => act.name).join(", ") : "Brak"}
        </span>
        <span>
          <b>Rozdziały</b>
          {chapterRangeLabel(plan, chapters)}
        </span>
      </div>
      <div className="thread-progress-row">
        <span>
          <i style={{ width: `${coverage}%`, background: thread.color }} />
        </span>
        <em>{coverage}%</em>
      </div>
      <div className="thread-card-tags">
        {chapters.map((chapter) => (
          <span className="thread-chapter-chip" key={chapter.id}>
            {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}
            <button
              type="button"
              className="thread-chip-remove"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemoveChapter(chapter);
              }}
              aria-label={`Odepnij rozdział ${chapter.workingTitle}`}
              title={`Odepnij rozdział ${chapter.workingTitle}`}
            >
              -
            </button>
          </span>
        ))}
        {availableChapters.length > 0 ? (
          <button
            type="button"
            className="thread-card-relation-add-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setChapterPickerOpen(true);
            }}
            aria-label={`Dodaj wątek ${thread.name} do rozdziału`}
            title="Dodaj do rozdziału"
          >
            <Plus size={13} />
            <span>Rozdział</span>
          </button>
        ) : null}
      </div>
      {chapterPickerOpen ? (
        <ThreadChapterPickerModal
          plan={plan}
          thread={thread}
          availableChapters={availableChapters}
          onClose={() => setChapterPickerOpen(false)}
          onAdd={(chapter) => {
            onAddChapter(chapter);
            setChapterPickerOpen(false);
          }}
        />
      ) : null}
    </article>
  );
}

function ThreadTable({
  plan,
  threads,
  selectedThreadId,
  onSelect
}: {
  plan: BookPlan;
  threads: PlotThread[];
  selectedThreadId: string | null;
  onSelect: (thread: PlotThread) => void;
}) {
  return (
    <div className="thread-table-wrap">
      <table className="thread-table">
        <thead>
          <tr>
            <th>Wątek</th>
            <th>Status</th>
            <th>Rozdziały</th>
            <th>Pokrycie</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const coverage = threadCoveragePercent(plan, thread);

            return (
              <tr
                key={thread.id}
                className={selectedThreadId === thread.id ? "active" : ""}
                onClick={() => onSelect(thread)}
              >
                <td>
                  <span style={{ background: thread.color }} />
                  <strong>{thread.name}</strong>
                </td>
                <td>{threadStatusLabel(thread.status)}</td>
                <td>{chapterRangeLabel(plan, chaptersForThread(plan, thread))}</td>
                <td>{coverage}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {threads.length === 0 ? (
        <div className="thread-empty-state table-empty">
          <GitBranch size={20} />
          <strong>Brak wątków do pokazania</strong>
        </div>
      ) : null}
    </div>
  );
}

function ThreadChapterPickerModal({
  plan,
  thread,
  availableChapters,
  onClose,
  onAdd
}: {
  plan: BookPlan;
  thread: PlotThread;
  availableChapters: Chapter[];
  onClose: () => void;
  onAdd: (chapter: Chapter) => void;
}) {
  const modal = (
    <div className="chapter-relation-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="chapter-relation-backdrop"
        onClick={onClose}
        aria-label="Zamknij wybór rozdziału"
      />
      <section className="chapter-relation-shell" aria-label="Dodaj rozdział do wątku">
        <header className="chapter-relation-header">
          <div>
            <p className="eyebrow">Przypięcie wątku</p>
            <h4>Dodaj rozdział do wątku {thread.name}</h4>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Zamknij" title="Zamknij">
            <X size={16} />
          </button>
        </header>
        <div className="chapter-relation-list">
          {availableChapters.length > 0 ? (
            availableChapters.map((chapter) => (
              <button
                type="button"
                className="chapter-relation-option"
                key={chapter.id}
                onClick={() => onAdd(chapter)}
              >
                <span className="relation-dot thread" style={{ background: thread.color }} />
                <span>
                  <strong>
                    {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}
                  </strong>
                  <em>{chapter.summary || "Brak streszczenia rozdziału."}</em>
                </span>
              </button>
            ))
          ) : (
            <p className="chapter-relation-empty">Wątek jest już przypięty do wszystkich rozdziałów.</p>
          )}
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return modal;
  }

  return createPortal(modal, document.body);
}

function ThreadDetailsPanel({
  plan,
  thread,
  onDelete,
  onEdit
}: {
  plan: BookPlan;
  thread: PlotThread | null;
  onDelete: (thread: PlotThread) => void;
  onEdit: (target: ThreadEditTarget) => void;
}) {
  if (!thread) {
    return (
      <aside className="thread-details-panel">
        <div className="thread-detail-empty">
          <GitBranch size={22} />
          <strong>Wybierz wątek</strong>
          <p>Panel pokaże status, rozdziały i przebieg wybranego wątku.</p>
        </div>
      </aside>
    );
  }

  const chapters = chaptersForThread(plan, thread);
  const acts = actsForThread(plan, thread);
  const checklist = [
    { label: "Zdefiniowana rola w historii", complete: Boolean(thread.description.trim()) },
    { label: "Powiązane akty", complete: acts.length > 0 },
    { label: "Powiązane rozdziały", complete: chapters.length > 0 }
  ];

  return (
    <aside className="thread-details-panel">
      <div className="thread-detail-heading">
        <div>
          <p className="eyebrow">Szczegóły wątku</p>
          <h4>
            <span style={{ background: thread.color }} />
            {thread.name}
          </h4>
        </div>
        <em className={`thread-status-chip ${thread.status}`}>
          {threadStatusLabel(thread.status)}
        </em>
      </div>
      <p className="thread-detail-description">
        {thread.description || "Ten wątek nie ma jeszcze opisu."}
      </p>
      <div className="thread-detail-section">
        <strong>Powiązane akty</strong>
        <div className="thread-chip-row">
          {acts.length > 0 ? acts.map((act) => <span key={act.id}>{act.name}</span>) : <em>Brak</em>}
        </div>
      </div>
      <div className="thread-detail-section">
        <strong>Przebieg w rozdziałach</strong>
        <div className="thread-chip-row">
          {chapters.length > 0 ? (
            chapters.map((chapter) => {
              const relation = chapterThreadRelation(plan, thread.id, chapter.id);
              return (
                <span key={chapter.id} title={relation?.description || "Brak opisu przebiegu."}>
                  {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}
                </span>
              );
            })
          ) : (
            <em>Brak</em>
          )}
        </div>
      </div>
      <div className="thread-detail-checklist">
        <strong>Lista kontrolna</strong>
        {checklist.map((item) => (
          <label key={item.label}>
            <input type="checkbox" checked={item.complete} readOnly />
            {item.complete ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span>{item.label}</span>
          </label>
        ))}
      </div>
      <div className="thread-plot-meaning">
        <span>
          <b>{threadCoveragePercent(plan, thread)}%</b>
          Pokrycie
        </span>
        <span>
          <b>{chapters.length}</b>
          Rozdziały
        </span>
      </div>
      <div className="button-row">
        <button type="button" className="primary-button" onClick={() => onEdit(thread.id)}>
          <Pencil size={16} />
          Edytuj
        </button>
        <button type="button" className="ghost-button" onClick={() => onDelete(thread)}>
          <Trash2 size={16} />
          Usuń
        </button>
      </div>
    </aside>
  );
}
function ChaptersStep({
  bookId,
  plan,
  characters,
  world,
  saving,
  onOpenChapter,
  onCreateChapter,
  onCreateScene,
  onEditScene,
  onRequestDelete,
  onSaveChapter,
  onSetSceneRelations,
  onReorderChapters,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  onOpenChapter: (chapter: Chapter) => void;
  onCreateChapter: (actId?: string | null) => void;
  onCreateScene: (chapterId?: string | null) => void;
  onEditScene: (sceneId: string) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onSaveChapter: (input: UpsertChapterInput) => void;
  onSetSceneRelations: (input: SetSceneRelationsInput) => void;
  onReorderChapters: (inputs: UpsertChapterInput[]) => void;
}) {
  const chapterActRailRef = useRef<HTMLDivElement>(null);
  const chapterBoardRef = useRef<HTMLDivElement>(null);
  const chapterDragRef = useRef<ChapterPointerDrag | null>(null);
  const suppressChapterOpenRef = useRef(false);
  const [chapterDrag, setChapterDrag] = useState<ChapterPointerDrag | null>(null);
  const [relationPicker, setRelationPicker] = useState<{
    kind: ChapterRelationKind;
    chapterId: string;
  } | null>(null);
  const [sceneRelationPicker, setSceneRelationPicker] = useState<{
    sceneId: string;
    kind: SceneRelationKind;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"cockpit" | "map">("cockpit");
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    orderedChaptersForPlan(plan)[0]?.id ?? null
  );
  const lanes = chapterLanesForPlan(plan);
  const totalWords = plannedWordsForChapters(plan.chapters);
  const draggedChapterId = chapterDrag?.chapterId ?? null;
  const dropTarget = chapterDrag?.dropTarget ?? null;
  const orderedChapters = orderedChaptersForPlan(plan);
  const activeChapter =
    orderedChapters.find((chapter) => chapter.id === activeChapterId) ??
    orderedChapters[0] ??
    null;
  const pickerScene = sceneRelationPicker
    ? plan.scenes.find((scene) => scene.id === sceneRelationPicker.sceneId)
    : undefined;

  useEffect(() => {
    if (orderedChapters.length === 0) {
      setActiveChapterId(null);
      return;
    }

    if (!activeChapterId || !orderedChapters.some((chapter) => chapter.id === activeChapterId)) {
      setActiveChapterId(orderedChapters[0].id);
    }
  }, [activeChapterId, orderedChapters]);

  function scrollActRail(direction: -1 | 1) {
    const rail = chapterActRailRef.current;
    const board = chapterBoardRef.current;

    if (!rail && !board) {
      return;
    }

    const source = board ?? rail;
    const scrollAmount = Math.max((source?.clientWidth ?? 0) - 96, 180);

    scrollElementBy(rail, direction * scrollAmount);
    scrollElementBy(board, direction * scrollAmount);
  }

  function scrollToLane(index: number) {
    const board = chapterBoardRef.current;
    const rail = chapterActRailRef.current;
    const target = board?.children[index] as HTMLElement | undefined;
    const tab = rail?.children[index] as HTMLElement | undefined;

    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start"
      });
    }

    if (typeof tab?.scrollIntoView === "function") {
      tab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start"
      });
    }
  }

  function handleChapterPointerDown(event: PointerEvent<HTMLElement>, chapterId: string) {
    if (saving || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const drag: ChapterPointerDrag = {
      chapterId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      isDragging: false,
      dropTarget: null
    };
    chapterDragRef.current = drag;
    setChapterDrag(drag);
  }

  function handleChapterPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = chapterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || saving) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const isDragging = drag.isDragging || distance >= chapterDragActivationDistance;
    const nextDrag: ChapterPointerDrag = {
      ...drag,
      currentX: event.clientX,
      currentY: event.clientY,
      isDragging,
      dropTarget: isDragging ? chapterDropTargetFromPoint(event.clientX, event.clientY) : null
    };
    chapterDragRef.current = nextDrag;
    setChapterDrag(nextDrag);
  }

  function handleChapterPointerUp(event: PointerEvent<HTMLElement>) {
    const drag = chapterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (drag.isDragging && drag.dropTarget) {
      const reordered = reorderedChaptersAfterDrop(plan, lanes, drag.chapterId, drag.dropTarget);

      if (reordered.length > 0) {
        onReorderChapters(
          reordered.map((chapter, index) => chapterUpsertInputForPlan(plan, chapter, index))
        );
      }
      suppressChapterOpenRef.current = true;
    }

    clearChapterDrag();
  }

  function handleChapterPointerCancel(event: PointerEvent<HTMLElement>) {
    if (chapterDragRef.current?.pointerId === event.pointerId) {
      clearChapterDrag();
    }
  }

  function clearChapterDrag() {
    chapterDragRef.current = null;
    setChapterDrag(null);
  }

  useEffect(() => {
    if (!chapterDrag) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        clearChapterDrag();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chapterDrag]);

  return (
    <section className="chapter-board-workspace">
      <div className="chapter-board-shell">
        <div className="chapter-board-toolbar">
          <div className="chapter-board-heading">
            <span className="stage-heading-icon">
              <FileText size={18} />
            </span>
            <div>
              <p className="eyebrow">Szkielet rozdziałów</p>
              <h3>Robocze rozdziały i kokpit kontraktu</h3>
              <p>
                {plan.chapters.length} rozdz. / {totalWords.toLocaleString("pl-PL")} słów
                planowanych. Zacznij od roboczych kontenerów, a pełny kontrakt dopnij
                później wątkami i beatami.
              </p>
            </div>
          </div>
          <div className="chapter-board-actions">
            <Segmented
              ariaLabel="Widok rozdziałów"
              items={[
                { id: "cockpit", label: "Kokpit" },
                { id: "map", label: "Mapa aktów" }
              ]}
              value={viewMode}
              onChange={setViewMode}
            />
            <button
              type="button"
              className="primary-button"
              onClick={() => onCreateChapter(plan.acts[0]?.id ?? null)}
            >
              <Plus size={16} />
              Dodaj rozdział
            </button>
            <PlanAiActions
              field="chapterPlan"
              generateLabel="Utwórz szkielet"
              generateTitle="Utwórz roboczy szkielet rozdziałów po aktach"
              onGenerate={() => onGenerate("chapterPlan")}
              onActivatePrompt={() => onActivatePrompt("chapterPlan")}
            />
          </div>
        </div>

        {viewMode === "map" ? (
          <>
        <div className="chapter-act-rail-card">
          <button
            type="button"
            className="chapter-rail-scroll-button previous"
            onClick={() => scrollActRail(-1)}
            aria-label="Pokaż wcześniejsze akty"
            title="Pokaż wcześniejsze akty"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            ref={chapterActRailRef}
            className="chapter-act-rail"
            role="tablist"
            aria-label="Akty w planie rozdziałów"
          >
            {lanes.map((lane, index) => (
              <button
                key={lane.id}
                type="button"
                role="tab"
                aria-selected="false"
                className="chapter-act-tab"
                onClick={() => scrollToLane(index)}
              >
                <span className="chapter-act-dot" style={{ background: lane.color }} />
                <span className="stage-copy">
                  <strong>{lane.name}</strong>
                  <span>
                    {lane.chapters.length} rozdz. /{" "}
                    {plannedWordsForChapters(lane.chapters).toLocaleString("pl-PL")} słów
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="chapter-rail-scroll-button next"
            onClick={() => scrollActRail(1)}
            aria-label="Pokaż kolejne akty"
            title="Pokaż kolejne akty"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div ref={chapterBoardRef} className="chapter-act-columns">
          {lanes.map((lane) => (
            <section
              className={
                dropTarget?.actId === lane.actId
                  ? "chapter-act-column drop-active"
                  : "chapter-act-column"
              }
              key={lane.id}
              data-act-id={lane.actId ?? ""}
              data-drop-zone="chapter-lane"
              data-lane-id={lane.id}
            >
              <div className="chapter-act-column-header">
                <div>
                  <span className="chapter-act-dot" style={{ background: lane.color }} />
                  <h4>{lane.name}</h4>
                </div>
                <span>{lane.rangeLabel}</span>
              </div>
              <div className="chapter-act-column-stats">
                <span>{lane.chapters.length} rozdziały</span>
                <span>
                  {plannedWordsForChapters(lane.chapters).toLocaleString("pl-PL")} słów
                </span>
              </div>
              <p className="chapter-act-purpose">{lane.purpose || "Bez celu aktu."}</p>
              <div className="chapter-card-stack">
                {lane.chapters.length > 0 ? (
                  lane.chapters.map((chapter) => (
                    <ChapterBoardCard
                      key={chapter.id}
                      chapter={chapter}
                      number={dynamicChapterNumber(plan, chapter.id)}
                      plan={plan}
                      dragging={draggedChapterId === chapter.id}
                      dropPosition={
                        dropTarget?.chapterId === chapter.id ? dropTarget.position : null
                      }
                      dragDisabled={saving}
                      onPointerDown={(event) => handleChapterPointerDown(event, chapter.id)}
                      onPointerMove={handleChapterPointerMove}
                      onPointerUp={handleChapterPointerUp}
                      onPointerCancel={handleChapterPointerCancel}
                      onLostPointerCapture={() => clearChapterDrag()}
                      onHandleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onOpen={() => onOpenChapter(chapter)}
                      onRequestDelete={() => onRequestDelete(chapterDeleteTarget(plan, chapter))}
                      onOpenRelationPicker={(kind) =>
                        setRelationPicker({ kind, chapterId: chapter.id })
                      }
                      onUpdateRelations={(threadIds, beatIds) =>
                        onSaveChapter(
                          chapterUpsertInputWithRelations(plan, chapter, threadIds, beatIds)
                        )
                      }
                      onSuppressOpen={() => {
                        if (!suppressChapterOpenRef.current) {
                          return false;
                        }

                        suppressChapterOpenRef.current = false;
                        return true;
                      }}
                    />
                  ))
                ) : (
                  <p
                    className={
                      dropTarget?.actId === lane.actId
                        ? "muted-text chapter-empty-note drop-active"
                        : "muted-text chapter-empty-note"
                    }
                  >
                    Ten akt nie ma jeszcze rozdziałów.
                  </p>
                )}
              </div>
              <button
                type="button"
                className="ghost-button chapter-column-add"
                onClick={() => onCreateChapter(lane.actId)}
              >
                <Plus size={16} />
                Dodaj rozdział
              </button>
            </section>
          ))}
        </div>
          </>
        ) : (
          <ChapterCockpit
            bookId={bookId}
            plan={plan}
            characters={characters}
            world={world}
            activeChapter={activeChapter}
            activeChapterId={activeChapterId}
            saving={saving}
            onSelectChapter={setActiveChapterId}
            onOpenChapter={onOpenChapter}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
            onEditScene={onEditScene}
            onRequestDelete={onRequestDelete}
            onOpenRelationPicker={(kind, chapterId) => setRelationPicker({ kind, chapterId })}
            onUpdateChapterRelations={(chapter, threadIds, beatIds) =>
              onSaveChapter(chapterUpsertInputWithRelations(plan, chapter, threadIds, beatIds))
            }
            onSetSceneRelations={onSetSceneRelations}
            onOpenSceneRelationPicker={(sceneId, kind) =>
              setSceneRelationPicker({ sceneId, kind })
            }
            onGenerate={onGenerate}
            onActivatePrompt={onActivatePrompt}
          />
        )}
      </div>
      {relationPicker ? (
        <ChapterRelationPickerModal
          kind={relationPicker.kind}
          plan={plan}
          selectedIds={
            relationPicker.kind === "threads"
              ? chapterThreadIdsForChapter(plan, relationPicker.chapterId)
              : chapterBeatIdsForChapter(plan, relationPicker.chapterId)
          }
          onClose={() => setRelationPicker(null)}
          onAdd={(ids) => {
            const chapter = plan.chapters.find((item) => item.id === relationPicker.chapterId);
            if (!chapter) {
              setRelationPicker(null);
              return;
            }

            const currentThreadIds = chapterThreadIdsForChapter(plan, chapter.id);
            const currentBeatIds = chapterBeatIdsForChapter(plan, chapter.id);
            onSaveChapter(
              chapterUpsertInputWithRelations(
                plan,
                chapter,
                relationPicker.kind === "threads"
                  ? uniqueOrderedIds([...currentThreadIds, ...ids])
                  : currentThreadIds,
                relationPicker.kind === "beats"
                  ? uniqueOrderedIds([...currentBeatIds, ...ids])
                  : currentBeatIds
              )
            );
            setRelationPicker(null);
          }}
        />
      ) : null}
      {sceneRelationPicker && pickerScene ? (
        <SceneRelationPickerModal
          kind={sceneRelationPicker.kind}
          plan={plan}
          characters={characters}
          world={world}
          selectedIds={sceneRelationIds(plan, pickerScene.id, sceneRelationPicker.kind)}
          onClose={() => setSceneRelationPicker(null)}
          onAdd={(ids) => {
            const current = sceneRelationSnapshot(plan, pickerScene.id);
            const nextIds = uniqueOrderedIds([
              ...sceneRelationIds(plan, pickerScene.id, sceneRelationPicker.kind),
              ...ids
            ]);
            onSetSceneRelations({
              bookId,
              sceneId: pickerScene.id,
              ...current,
              [sceneRelationInputKey(sceneRelationPicker.kind)]: nextIds
            });
            setSceneRelationPicker(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ChapterBoardCard({
  chapter,
  number,
  plan,
  dragging,
  dropPosition,
  dragDisabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onHandleClick,
  onSuppressOpen,
  onOpen,
  onRequestDelete,
  onOpenRelationPicker,
  onUpdateRelations
}: {
  chapter: Chapter;
  number: number;
  plan: BookPlan;
  dragging: boolean;
  dropPosition: ChapterDropTarget["position"] | null;
  dragDisabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: () => void;
  onHandleClick: (event: MouseEvent<HTMLElement>) => void;
  onSuppressOpen: () => boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onOpenRelationPicker: (kind: ChapterRelationKind) => void;
  onUpdateRelations: (threadIds: string[], beatIds: string[]) => void;
}) {
  const beats = beatsForChapter(plan, chapter);
  const threads = threadsForChapter(plan, chapter);
  const beatIds = beats.map((beat) => beat.id);
  const threadIds = threads.map((thread) => thread.id);
  const sceneCount = orderedScenesForChapter(plan, chapter.id).length;
  const readiness = chapterReadiness(plan, chapter);
  const className = [
    "chapter-board-card",
    dragging ? "dragging" : "",
    dropPosition === "before" ? "drop-before" : "",
    dropPosition === "after" ? "drop-after" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      role="button"
      tabIndex={0}
      className={className}
      data-chapter-id={chapter.id}
      onClick={() => {
        if (onSuppressOpen()) {
          return;
        }

        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Otwórz rozdział ${chapter.workingTitle}`}
    >
      <span className="chapter-card-head">
        <span className="chapter-card-roman" aria-hidden="true">
          {romanNumeral(number)}
        </span>
        <strong className="chapter-card-title">{chapter.workingTitle || "Bez tytułu"}</strong>
        <span
          className="chapter-drag-handle"
          aria-hidden="true"
          data-drag-handle="chapter"
          onClick={onHandleClick}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={onLostPointerCapture}
        >
          <GripVertical size={15} />
        </span>
        <button
          type="button"
          className="plan-card-delete-icon"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete();
          }}
          disabled={dragDisabled}
          title={`Usuń rozdział: ${chapter.workingTitle || "Bez tytułu"}`}
          aria-label={`Usuń rozdział: ${chapter.workingTitle || "Bez tytułu"}`}
        >
          <Trash2 size={14} />
        </button>
      </span>
      <p>{chapter.summary || "Brak streszczenia rozdziału."}</p>
      <span
        className="chapter-card-chips"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {threads.map((thread) => (
          <Chip
            key={thread.id}
            tone="accent"
            title={thread.description || "Brak opisu wątku."}
            onRemove={() =>
              onUpdateRelations(
                threadIds.filter((threadId) => threadId !== thread.id),
                beatIds
              )
            }
            removeLabel={`Odepnij wątek ${thread.name}`}
          >
            {thread.name}
          </Chip>
        ))}
        {beats.map((beat) => (
          <Chip
            key={beat.id}
            tone="ai"
            title={beatPreviewText(beat)}
            onRemove={() =>
              onUpdateRelations(
                threadIds,
                beatIds.filter((beatId) => beatId !== beat.id)
              )
            }
            removeLabel={`Odepnij beat ${beat.name}`}
          >
            {beat.name}
          </Chip>
        ))}
        <Chip>{sceneCountLabel(sceneCount)}</Chip>
        <Chip
          onClick={() => onOpenRelationPicker("threads")}
          title={`Dodaj wątek do rozdziału ${chapter.workingTitle}`}
        >
          + Wątek
        </Chip>
        <Chip
          onClick={() => onOpenRelationPicker("beats")}
          title={`Dodaj beat do rozdziału ${chapter.workingTitle}`}
        >
          + Beat
        </Chip>
      </span>
      <span className="chapter-card-foot">
        <span>
          {chapter.targetWordCount
            ? `~${chapter.targetWordCount.toLocaleString("pl-PL")} słów`
            : "—"}
        </span>
        <StatusPill
          tone={readiness.tone === "ready" ? "success" : readiness.tone === "active" ? "warn" : "muted"}
          title={readiness.missing.slice(0, 3).join(" ")}
        >
          {readiness.label}
        </StatusPill>
      </span>
    </article>
  );
}

function romanNumeral(value: number): string {
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let rest = Math.max(1, Math.floor(value));
  let result = "";
  for (const [amount, symbol] of table) {
    while (rest >= amount) {
      result += symbol;
      rest -= amount;
    }
  }
  return result;
}

function sceneCountLabel(count: number): string {
  if (count === 0) {
    return "bez scen";
  }
  if (count === 1) {
    return "1 scena";
  }
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} sceny`;
  }
  return `${count} scen`;
}

function ChapterCockpit({
  bookId,
  plan,
  characters,
  world,
  activeChapter,
  activeChapterId,
  saving,
  onSelectChapter,
  onOpenChapter,
  onCreateChapter,
  onCreateScene,
  onEditScene,
  onRequestDelete,
  onOpenRelationPicker,
  onUpdateChapterRelations,
  onSetSceneRelations,
  onOpenSceneRelationPicker,
  onGenerate,
  onActivatePrompt
}: {
  bookId: string;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  activeChapter: Chapter | null;
  activeChapterId: string | null;
  saving: boolean;
  onSelectChapter: (chapterId: string) => void;
  onOpenChapter: (chapter: Chapter) => void;
  onCreateChapter: (actId?: string | null) => void;
  onCreateScene: (chapterId?: string | null) => void;
  onEditScene: (sceneId: string) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onOpenRelationPicker: (kind: ChapterRelationKind, chapterId: string) => void;
  onUpdateChapterRelations: (chapter: Chapter, threadIds: string[], beatIds: string[]) => void;
  onSetSceneRelations: (input: SetSceneRelationsInput) => void;
  onOpenSceneRelationPicker: (sceneId: string, kind: SceneRelationKind) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  const chapters = orderedChaptersForPlan(plan);

  if (!activeChapter) {
    return (
      <div className="chapter-cockpit-empty">
        <FileText size={22} />
        <strong>Brak rozdziałów w aktywnym planie</strong>
        <p>Dodaj pierwszy roboczy rozdział, żeby mieć kontener dla wątków i beatów.</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => onCreateChapter(plan.acts[0]?.id ?? null)}
        >
          <Plus size={16} />
          Dodaj rozdział
        </button>
      </div>
    );
  }

  const scenes = orderedScenesForChapter(plan, activeChapter.id);
  const beats = beatsForChapter(plan, activeChapter);
  const threads = threadsForChapter(plan, activeChapter);
  const beatIds = beats.map((beat) => beat.id);
  const threadIds = threads.map((thread) => thread.id);
  const readiness = chapterReadiness(plan, activeChapter);
  const storyBibleNeeds = chapterStoryBibleNeeds(plan, scenes);

  return (
    <div className="chapter-cockpit">
      <aside className="chapter-cockpit-rail" aria-label="Mapa rozdziałów">
        <div className="chapter-cockpit-rail-header">
          <span className="stage-heading-icon">
            <FileText size={16} />
          </span>
          <div>
            <p className="eyebrow">Mapa rozdziałów</p>
            <h4>Aktywny rozdział</h4>
          </div>
        </div>
        <div className="chapter-cockpit-chapter-list">
          {chapters.map((chapter) => {
            const chapterScenes = orderedScenesForChapter(plan, chapter.id);
            const chapterBeats = chapterBeatIdsForChapter(plan, chapter.id);
            const chapterThreads = chapterThreadIdsForChapter(plan, chapter.id);
            const status = chapterReadiness(plan, chapter);
            const act = plan.acts.find((item) => item.id === chapter.actId);
            return (
              <button
                type="button"
                key={chapter.id}
                className={
                  chapter.id === activeChapterId
                    ? "chapter-cockpit-rail-item active"
                    : "chapter-cockpit-rail-item"
                }
                onClick={() => onSelectChapter(chapter.id)}
              >
                <span className="chapter-rail-number">{dynamicChapterNumber(plan, chapter.id)}</span>
                <span className="chapter-rail-copy">
                  <strong>{chapter.workingTitle || "Bez tytułu"}</strong>
                  <small>{act?.name ?? "Bez aktu"} · {status.label}</small>
                  <em>
                    {chapterScenes.length} scen · {chapterBeats.length} beatów · {chapterThreads.length} wątków
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="chapter-cockpit-main">
        <section className="chapter-cockpit-hero">
          <div>
            <p className="eyebrow">Kokpit rozdziału</p>
            <h3>
              Rozdział {dynamicChapterNumber(plan, activeChapter.id)}:{" "}
              {activeChapter.workingTitle || "Bez tytułu"}
            </h3>
            <span
              className={
                readiness.tone === "ready"
                  ? "chapter-status-pill ready"
                  : readiness.tone === "active"
                    ? "chapter-status-pill active"
                    : "chapter-status-pill"
              }
            >
              <Circle size={10} />
              {readiness.label}
            </span>
          </div>
          <div className="chapter-cockpit-actions">
            <PlanAiActions
              field="prepareChapterForScenes"
              targetEntity={activeChapter}
              generateLabel="Sprawdź gotowość"
              generateTitle="Sprawdź, czy szkielet rozdziału ma już kontrakt gotowy do scen"
              hideContextButton
              onGenerate={() => onGenerate("prepareChapterForScenes", activeChapter)}
              onActivatePrompt={() => onActivatePrompt("prepareChapterForScenes", activeChapter)}
            />
            <PlanAiActions
              field="chapterSceneBreakdown"
              targetEntity={activeChapter}
              generateLabel="Rozbij rozdział na sceny"
              generateTitle="Wygeneruj 2-5 scen wykonujących kontrakt rozdziału"
              hideContextButton
              onGenerate={() => onGenerate("chapterSceneBreakdown", activeChapter)}
              onActivatePrompt={() => onActivatePrompt("chapterSceneBreakdown", activeChapter)}
            />
            <button type="button" className="secondary-button" onClick={() => onOpenChapter(activeChapter)}>
              <Pencil size={15} />
              Edytuj rozdział
            </button>
            <button
              type="button"
              className="ghost-button chapter-delete-button"
              onClick={() => onRequestDelete(chapterDeleteTarget(plan, activeChapter))}
              disabled={saving}
            >
              <Trash2 size={15} />
              Usuń rozdział
            </button>
          </div>
        </section>

        <section className="chapter-cockpit-contract">
          <ChapterCockpitField label="Cel" value={activeChapter.purpose} />
          <ChapterCockpitField label="Konflikt" value={activeChapter.conflict} />
          <ChapterCockpitField label="Punkt zwrotny" value={activeChapter.turningPoint} />
          <ChapterCockpitField label="Target słów" value={formatWordCount(activeChapter.targetWordCount)} />
        </section>

        <section className="chapter-cockpit-relations">
          <ChapterCockpitRelationGroup
            title="Beaty rozdziału"
            kind="beats"
            items={beats.map((beat) => ({ id: beat.id, label: beat.name, title: beatPreviewText(beat) }))}
            emptyText="Brak beatów przypiętych do rozdziału."
            onAdd={() => onOpenRelationPicker("beats", activeChapter.id)}
            onRemove={(id) =>
              onUpdateChapterRelations(
                activeChapter,
                threadIds,
                beatIds.filter((beatId) => beatId !== id)
              )
            }
          />
          <ChapterCockpitRelationGroup
            title="Wątki rozdziału"
            kind="threads"
            items={threads.map((thread) => ({
              id: thread.id,
              label: thread.name,
              title: chapterThreadRelation(plan, thread.id, activeChapter.id)?.description || thread.description
            }))}
            emptyText="Brak wątków przypiętych do rozdziału."
            onAdd={() => onOpenRelationPicker("threads", activeChapter.id)}
            onRemove={(id) =>
              onUpdateChapterRelations(
                activeChapter,
                threadIds.filter((threadId) => threadId !== id),
                beatIds
              )
            }
          />
        </section>

        <section className="chapter-cockpit-scenes">
          <div className="chapter-cockpit-section-heading">
            <div>
              <p className="eyebrow">Wykonanie rozdziału</p>
              <h4>Sceny</h4>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => onCreateScene(activeChapter.id)}
              disabled={saving}
            >
              <Plus size={16} />
              Dodaj scenę
            </button>
          </div>
          <div className="chapter-cockpit-scene-list">
            {scenes.length > 0 ? (
              scenes.map((scene, index) => (
                <article
                  className="chapter-board-card plan-scene-card chapter-cockpit-scene-card"
                  key={scene.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEditScene(scene.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onEditScene(scene.id);
                    }
                  }}
                >
                  <span className="chapter-card-topline">
                    <span className="chapter-number-badge">{index + 1}</span>
                    <span>{sceneStatusLabel(scene.status)}</span>
                    <button
                      type="button"
                      className="plan-card-delete-icon"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRequestDelete(sceneDeleteTarget(plan, scene));
                      }}
                      disabled={saving}
                      title={`Usuń scenę: ${scene.title || "Scena bez tytułu"}`}
                      aria-label={`Usuń scenę: ${scene.title || "Scena bez tytułu"}`}
                    >
                      <Trash2 size={14} />
                    </button>
                    <span>{scene.targetWordCount ? `${scene.targetWordCount.toLocaleString("pl-PL")} słów` : "Brak celu"}</span>
                  </span>
                  <strong>{scene.title || "Scena bez tytułu"}</strong>
                  <p>{scene.summary || "Brak streszczenia sceny."}</p>
                  <div className="chapter-cockpit-scene-meta">
                    <span><b>POV</b>{characterLabel(characters, scene.povCharacterId)}</span>
                    <span><b>Lokacja</b>{worldElementLabel(world, scene.locationId)}</span>
                    <span><b>Wynik</b>{scene.outcome || "Nie opisano"}</span>
                  </div>
                  <SceneRelationChips
                    bookId={bookId}
                    scene={scene}
                    plan={plan}
                    characters={characters}
                    world={world}
                    onSetRelations={onSetSceneRelations}
                    onOpenPicker={(kind) => onOpenSceneRelationPicker(scene.id, kind)}
                  />
                </article>
              ))
            ) : (
              <p className="muted-text">Rozdział nie ma jeszcze scen. Rozbij go na sceny albo dodaj pierwszą ręcznie.</p>
            )}
          </div>
        </section>
      </main>

      <aside className="chapter-cockpit-sidebar" aria-label="Pokrycie rozdziału">
        <section className="chapter-cockpit-side-panel">
          <div className="chapter-cockpit-section-heading compact">
            <h4>Pokrycie beatów</h4>
            <span>{beats.length}</span>
          </div>
          <div className="chapter-coverage-list">
            {beats.length > 0 ? (
              beats.map((beat) => {
                const covered = chapterBeatLikelyCoveredByScenes(beat, scenes);
                return (
                  <span className={covered ? "chapter-coverage-item covered" : "chapter-coverage-item"} key={beat.id}>
                    <CheckCircle2 size={14} />
                    <b>{beat.name}</b>
                    <em>{covered ? "Widać w scenach" : "Do sprawdzenia w scenach"}</em>
                  </span>
                );
              })
            ) : (
              <p className="muted-text">Brak beatów do pokrycia.</p>
            )}
          </div>
        </section>

        <section className="chapter-cockpit-side-panel">
          <div className="chapter-cockpit-section-heading compact">
            <h4>Przebieg wątków</h4>
            <span>{threads.length}</span>
          </div>
          <div className="chapter-thread-flow-list">
            {threads.length > 0 ? (
              threads.map((thread) => {
                const relation = chapterThreadRelation(plan, thread.id, activeChapter.id);
                return (
                  <div className="chapter-thread-flow-item" key={thread.id}>
                    <strong>{thread.name}</strong>
                    <p>{relation?.description || "Brak opisu przebiegu w tym rozdziale."}</p>
                    {relation ? (
                      <PlanAiActions
                        field="threadChapterDescription"
                        targetEntity={relation}
                        onGenerate={() => onGenerate("threadChapterDescription", relation)}
                        onActivatePrompt={() => onActivatePrompt("threadChapterDescription", relation)}
                      />
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="muted-text">Brak wątków w kontrakcie rozdziału.</p>
            )}
          </div>
        </section>

        <section className="chapter-cockpit-side-panel">
          <div className="chapter-cockpit-section-heading compact">
            <h4>Braki przed pisaniem</h4>
            <span>{storyBibleNeeds.length + readiness.missing.length}</span>
          </div>
          <ul className="chapter-readiness-list">
            {[...readiness.missing, ...storyBibleNeeds].map((item) => (
              <li key={item}>{item}</li>
            ))}
            {readiness.missing.length === 0 && storyBibleNeeds.length === 0 ? (
              <li>Rozdział wygląda gotowo do pisania.</li>
            ) : null}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function ChapterCockpitField({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="chapter-cockpit-field">
      <b>{label}</b>
      <span>{value || "Brak"}</span>
    </div>
  );
}

function ChapterCockpitRelationGroup({
  title,
  kind,
  items,
  emptyText,
  onAdd,
  onRemove
}: {
  title: string;
  kind: ChapterRelationKind;
  items: Array<{ id: string; label: string; title?: string }>;
  emptyText: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="chapter-cockpit-relation-group">
      <div className="chapter-cockpit-section-heading compact">
        <h4>{title}</h4>
        <button
          type="button"
          className="chapter-card-relation-add-button"
          onClick={onAdd}
          aria-label={`Dodaj ${kind === "beats" ? "beat" : "wątek"} do rozdziału`}
          title={`Dodaj ${kind === "beats" ? "beat" : "wątek"}`}
        >
          <Plus size={13} />
          <span>{kind === "beats" ? "Beat" : "Wątek"}</span>
        </button>
      </div>
      <div className="chapter-chip-row">
        {items.length > 0 ? (
          items.map((item) => (
            <span className={`chapter-chip ${kind === "beats" ? "beat" : "thread"}`} key={item.id} title={item.title}>
              {item.label}
              <button
                type="button"
                className="chapter-chip-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item.id);
                }}
                aria-label={`Odepnij ${item.label}`}
                title={`Odepnij ${item.label}`}
              >
                -
              </button>
            </span>
          ))
        ) : (
          <span className="chapter-side-empty">{emptyText}</span>
        )}
      </div>
    </div>
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
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const selectedSet = new Set(selectedIds);
  const items =
    kind === "threads"
      ? plan.threads.filter((thread) => !selectedSet.has(thread.id))
      : plan.beats.filter((beat) => !selectedSet.has(beat.id));
  const title = kind === "threads" ? "Dodaj wątki" : "Dodaj beaty";
  const emptyText =
    kind === "threads"
      ? "Wszystkie wątki są już przypisane do tego rozdziału."
      : "Wszystkie beaty są już przypisane do tego rozdziału.";

  function toggle(id: string) {
    setCheckedIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id]
    );
  }

  return (
    <div className="chapter-relation-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="chapter-relation-backdrop"
        onClick={onClose}
        aria-label="Zamknij wybór powiązań"
      />
      <section className="chapter-relation-shell" aria-label={title}>
        <header className="chapter-relation-header">
          <div>
            <p className="eyebrow">Powiązania rozdziału</p>
            <h4>{title}</h4>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Zamknij wybór powiązań"
            title="Zamknij"
          >
            <X size={16} />
          </button>
        </header>

        <div className="chapter-relation-list">
          {items.length === 0 ? (
            <p className="chapter-relation-empty">{emptyText}</p>
          ) : (
            items.map((item) => {
              const checked = checkedIds.includes(item.id);
              const description =
                kind === "threads" ? item.description : beatPreviewText(item as Beat);
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
                    <em>{description || "Brak opisu."}</em>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <footer className="chapter-relation-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={checkedIds.length === 0}
            onClick={() => onAdd(checkedIds)}
          >
            <Plus size={16} />
            Dodaj wybrane
          </button>
        </footer>
      </section>
    </div>
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
  const selectedSet = new Set(selectedIds);
  const items = sceneRelationOptions(kind, plan, characters, world).filter(
    (item) => !selectedSet.has(item.id)
  );
  const title = `Dodaj: ${sceneRelationTitle(kind).toLowerCase()}`;
  const emptyText = `Wszystkie elementy z grupy "${sceneRelationTitle(kind)}" są już przypisane do tej sceny.`;

  function toggle(id: string) {
    setCheckedIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id]
    );
  }

  return (
    <div className="chapter-relation-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="chapter-relation-backdrop"
        onClick={onClose}
        aria-label="Zamknij wybór powiązań"
      />
      <section className="chapter-relation-shell" aria-label={title}>
        <header className="chapter-relation-header">
          <div>
            <p className="eyebrow">Powiązania sceny</p>
            <h4>{title}</h4>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Zamknij wybór powiązań"
            title="Zamknij"
          >
            <X size={16} />
          </button>
        </header>

        <div className="chapter-relation-list">
          {items.length === 0 ? (
            <p className="chapter-relation-empty">{emptyText}</p>
          ) : (
            items.map((item) => {
              const checked = checkedIds.includes(item.id);
              return (
                <button
                  type="button"
                  className={checked ? "chapter-relation-option selected" : "chapter-relation-option"}
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  title={item.description}
                  aria-pressed={checked}
                >
                  <span className={`relation-dot ${sceneRelationDotClass(kind)}`} />
                  <span>
                    <strong>{item.label}</strong>
                    <em>{item.description || "Brak opisu."}</em>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <footer className="chapter-relation-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={checkedIds.length === 0}
            onClick={() => onAdd(checkedIds)}
          >
            <Plus size={16} />
            Dodaj wybrane
          </button>
        </footer>
      </section>
    </div>
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
  entity?: PlanPromptEntity;
  onChange: (value: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
  onActivatePrompt: (field: PlanFieldKey, targetEntity?: PlanPromptEntity) => void;
}) {
  return (
    <Field
      label={label}
      actions={
        <PlanAiActions
          field={field}
          targetEntity={entity}
          onGenerate={() => onGenerate(field, entity)}
          onActivatePrompt={() => onActivatePrompt(field, entity)}
        />
      }
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onActivatePrompt(field, entity)}
        rows={rows}
      />
    </Field>
  );
}

function PlanAiActions({
  field,
  targetEntity,
  generateLabel,
  generateTitle,
  contextLabel,
  hideContextButton = false,
  onGenerate,
  onActivatePrompt
}: {
  field: PlanFieldKey;
  targetEntity?: PlanPromptEntity;
  generateLabel?: string;
  generateTitle?: string;
  contextLabel?: string;
  hideContextButton?: boolean;
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
    activeTarget?.sources.some(
      (source) => source.key === field || source.key === promptContextSource.key
    )
  );
  const visibleGenerateLabel = running ? "Generuje" : queued ? "W kolejce" : generateLabel ?? "AI";
  const aiButtonClassName = generateLabel ? "icon-button ai-field-button labeled" : "icon-button ai-field-button";
  const contextButtonClassName = contextLabel
    ? "icon-button ai-context-add-button labeled"
    : "icon-button ai-context-add-button";

  return (
    <span className="ai-field-actions plan-ai-actions">
      <button
        type="button"
        className={aiButtonClassName}
        onClick={onGenerate}
        disabled={queued || running || (targetEntity === undefined && isEntityField(field))}
        title={generateTitle ?? `Generuj ${planFieldConfigs[field].label} z AI`}
        aria-label={generateTitle ?? `Generuj ${planFieldConfigs[field].label} z AI`}
      >
        {running ? (
          <Loader2 size={15} className="spin-icon" />
        ) : queued ? (
          <Clock3 size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        <span>{visibleGenerateLabel}</span>
      </button>
      {hideContextButton ? null : (
        <button
          type="button"
          className={contextButtonClassName}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.stopPropagation();
            addContextSourceToActiveTarget(promptContextSource);
          }}
          disabled={!activeTarget || fieldAlreadyInContext}
          title={`Dodaj ${planFieldConfigs[field].label} do aktywnego kontekstu promptu`}
          aria-label={`Dodaj ${planFieldConfigs[field].label} do kontekstu promptu`}
        >
          <Plus size={14} />
          {contextLabel ? <span>{contextLabel}</span> : null}
        </button>
      )}
    </span>
  );
}

function PlanPreview({
  plan,
  selectedItem,
  onSelect
}: {
  plan: BookPlan;
  selectedItem: SelectedPlanItem | null;
  onSelect: (item: SelectedPlanItem) => void;
}) {
  const totalWords = plan.chapters.reduce(
    (sum, chapter) => sum + (chapter.targetWordCount ?? 0),
    0
  );
  const writtenWords = plan.scenes.reduce(
    (sum, scene) => sum + (scene.actualWordCount ?? 0),
    0
  );
  const writtenWordsByChapter: Record<string, number> = {};
  for (const scene of plan.scenes) {
    if (scene.chapterId) {
      writtenWordsByChapter[scene.chapterId] =
        (writtenWordsByChapter[scene.chapterId] ?? 0) + (scene.actualWordCount ?? 0);
    }
  }
  const orderedChapters = orderedChaptersForPlan(plan);

  return (
    <div className="plan-preview-layout">
      <div className="plan-preview-main">
        <section className="plan-preview-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Akty i rozdziały</p>
              <h3>Mapa fabuły</h3>
            </div>
            <MoreHorizontal size={18} />
          </div>
          <div className="act-timeline">
            {plan.acts.map((act) => (
              <button
                type="button"
                key={act.id}
                className={
                  selectedItem?.type === "act" && selectedItem.id === act.id
                    ? "act-timeline-card active"
                    : "act-timeline-card"
                }
                onClick={() => onSelect({ type: "act", id: act.id })}
                aria-label={`Otwórz akt ${act.name}`}
              >
                <span style={{ background: act.color }} />
                <strong>{act.name}</strong>
                <small>{act.startPercent} - {act.endPercent}% fabuły</small>
                <em>{chaptersForAct(plan, act.id).length} rozdz.</em>
              </button>
            ))}
          </div>
        </section>

        <section className="plan-preview-section">
          {plan.acts.map((act) => (
            <div className="act-chapter-band" key={act.id}>
              <button
                type="button"
                className="act-band-heading"
                onClick={() => onSelect({ type: "act", id: act.id })}
                aria-label={`Otwórz akt ${act.name}`}
              >
                <span style={{ background: act.color }} />
                <strong>{act.name}</strong>
                <small>{act.purpose || "Bez celu aktu"}</small>
              </button>
              <div className="chapter-card-row">
                {chaptersForAct(plan, act.id).map((chapter) => (
                  <button
                    type="button"
                    key={chapter.id}
                    className="chapter-preview-card"
                    onClick={() => onSelect({ type: "chapter", id: chapter.id })}
                    aria-label={`Otwórz rozdział ${chapter.workingTitle}`}
                  >
                    <span>Rozdział</span>
                    <strong>{chapter.workingTitle}</strong>
                    <small>
                      {(writtenWordsByChapter[chapter.id] ?? 0).toLocaleString("pl-PL")}
                      {" / "}
                      {(chapter.targetWordCount ?? 0).toLocaleString("pl-PL")} słów
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="plan-preview-section thread-map">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Wątki fabularne</p>
              <h3>Przebieg przez rozdziały</h3>
            </div>
          </div>
          {plan.threads.map((thread) => (
            <div className="thread-map-row" key={thread.id}>
              <button
                type="button"
                className="thread-map-label"
                onClick={() => onSelect({ type: "thread", id: thread.id })}
                aria-label={`Otwórz wątek ${thread.name}`}
              >
                <span style={{ background: thread.color }} />
                {thread.name}
              </button>
              <div className="thread-map-line">
                {orderedChapters.map((chapter) => {
                  const linked = plan.chapterThreads.some(
                    (item) => item.chapterId === chapter.id && item.threadId === thread.id
                  );
                  return (
                    <button
                      type="button"
                      key={chapter.id}
                      className={linked ? "thread-node linked" : "thread-node"}
                      onClick={() => onSelect({ type: "chapter", id: chapter.id })}
                      aria-label={`${thread.name} w rozdziale ${dynamicChapterNumber(plan, chapter.id)}`}
                      title={chapter.workingTitle}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>

      <aside className="plan-preview-sidebar">
        <PlanStat icon={<Flag size={18} />} value={plan.acts.length} label="Akty" />
        <PlanStat icon={<FileText size={18} />} value={plan.chapters.length} label="Rozdziały" />
        <PlanStat icon={<GitBranch size={18} />} value={plan.threads.length} label="Wątki" />
        <PlanStat icon={<Target size={18} />} value={totalWords} label="Słów planowanych" />
        <PlanStat
          icon={<PenLine size={18} />}
          value={writtenWords}
          label={totalWords > 0 ? `Słów napisanych (${Math.round((writtenWords / totalWords) * 100)}%)` : "Słów napisanych"}
        />
        <PlanDetailsPanel details={selectedItemDetails(selectedItem, plan)} plan={plan} compact />
      </aside>
    </div>
  );
}

function PlanDetailsPanel({
  details,
  plan,
  compact = false
}: {
  details: ReturnType<typeof selectedItemDetails>;
  plan: BookPlan;
  compact?: boolean;
}) {
  return (
    <aside className={compact ? "plan-details-panel compact" : "plan-details-panel"}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Szczegóły</p>
          <h3>{details?.title ?? "Wybierz element"}</h3>
        </div>
      </div>
      {details ? (
        <>
          <p>{details.description || "Ten element nie ma jeszcze opisu."}</p>
          {details.meta.length > 0 ? (
            <dl>
              {details.meta.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : (
        <p className="muted-text">
          Kliknij akt, beat, wątek albo rozdział, aby zobaczyć przypisania i
          kontekst.
        </p>
      )}
      {!compact ? (
        <div className="plan-mini-summary">
          <span>{plan.acts.length} aktów</span>
          <span>{plan.beats.length} beatów</span>
          <span>{plan.threads.length} wątków</span>
          <span>{plan.chapters.length} rozdziałów</span>
        </div>
      ) : null}
    </aside>
  );
}

function RelationPicker<T extends { id: string; name?: string; workingTitle?: string }>({
  label,
  items,
  selectedIds,
  onChange
}: {
  label: string;
  items: T[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="relation-picker">
      <legend>{label}</legend>
      {items.length === 0 ? <p className="muted-text">Brak elementów.</p> : null}
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        return (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() =>
                onChange(
                  selected
                    ? selectedIds.filter((id) => id !== item.id)
                    : [...selectedIds, item.id]
                )
              }
            />
            <span>{item.name ?? item.workingTitle}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function EntityActions({
  saving,
  onDelete
}: {
  saving: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="button-row">
      <button type="submit" className="primary-button" disabled={saving}>
        <Save size={16} />
        {saving ? "Zapisuję" : "Zapisz"}
      </button>
      {onDelete ? (
        <button type="button" className="ghost-button" onClick={onDelete} disabled={saving}>
          <Trash2 size={16} />
          Usuń
        </button>
      ) : null}
    </div>
  );
}

function PlanCard({
  title,
  icon,
  action,
  children
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="plan-card">
      <div className="section-title-row">
        <div className="plan-card-title">
          {icon}
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PlanStat({
  icon,
  value,
  label
}: {
  icon: ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="plan-stat">
      {icon}
      <strong>{value.toLocaleString("pl-PL")}</strong>
      <span>{label}</span>
    </div>
  );
}

type ChapterLane = {
  id: string;
  actId: string | null;
  name: string;
  color: string;
  purpose: string;
  rangeLabel: string;
  chapters: Chapter[];
};
type BeatDropTarget = {
  chapterId: string | null;
  beatId?: string;
  position: "before" | "after" | "end";
};
type BeatPointerDrag = {
  beatId: string;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
  dropTarget: BeatDropTarget | null;
};
type ChapterDropTarget = {
  actId: string | null;
  chapterId?: string;
  position: "before" | "after" | "end";
};
type ChapterPointerDrag = {
  chapterId: string;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
  dropTarget: ChapterDropTarget | null;
};

const withoutActLaneId = "without-act";
const withoutChapterBeatLaneId = "without-chapter";
const chapterDragActivationDistance = 6;
const beatDragActivationDistance = 6;

function orderedChaptersForPlan(plan: BookPlan): Chapter[] {
  const originalIndex = new globalThis.Map(
    plan.chapters.map((chapter, index) => [chapter.id, index])
  );

  return [...plan.chapters].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }

    if (left.number !== right.number) {
      return left.number - right.number;
    }

    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
}

function planPromptEntityId(entity: PlanPromptEntity): string {
  if ("chapterId" in entity && "threadId" in entity) {
    return `${entity.threadId}:${entity.chapterId}`;
  }

  return entity.id;
}

function chapterNumberMap(plan: BookPlan): globalThis.Map<string, number> {
  return new globalThis.Map(
    orderedChaptersForPlan(plan).map((chapter, index) => [chapter.id, index + 1])
  );
}

function dynamicChapterNumber(plan: BookPlan, chapterId: string): number {
  return chapterNumberMap(plan).get(chapterId) ?? 1;
}

function chapterLaneKey(actId: string | null): string {
  return actId ?? withoutActLaneId;
}

function chapterDropTargetFromPoint(clientX: number, clientY: number): ChapterDropTarget | null {
  if (typeof document === "undefined") {
    return null;
  }

  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  const chapterElement = element.closest<HTMLElement>("[data-chapter-id]");
  if (chapterElement) {
    const laneElement = chapterElement.closest<HTMLElement>('[data-drop-zone="chapter-lane"]');
    const bounds = chapterElement.getBoundingClientRect();
    return {
      actId: actIdFromLaneElement(laneElement),
      chapterId: chapterElement.dataset.chapterId,
      position: clientY < bounds.top + bounds.height / 2 ? "before" : "after"
    };
  }

  const laneElement = element.closest<HTMLElement>('[data-drop-zone="chapter-lane"]');
  if (!laneElement) {
    return null;
  }

  return {
    actId: actIdFromLaneElement(laneElement),
    position: "end"
  };
}

function beatDropTargetFromPoint(clientX: number, clientY: number): BeatDropTarget | null {
  if (typeof document === "undefined") {
    return null;
  }

  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  const beatElement = element.closest<HTMLElement>("[data-beat-id]");
  if (beatElement) {
    const laneElement = beatElement.closest<HTMLElement>('[data-drop-zone="beat-lane"]');
    const bounds = beatElement.getBoundingClientRect();
    return {
      chapterId: chapterIdFromBeatLaneElement(laneElement),
      beatId: beatElement.dataset.beatId,
      position: clientY < bounds.top + bounds.height / 2 ? "before" : "after"
    };
  }

  const laneElement = element.closest<HTMLElement>('[data-drop-zone="beat-lane"]');
  if (!laneElement) {
    return null;
  }

  return {
    chapterId: chapterIdFromBeatLaneElement(laneElement),
    position: "end"
  };
}

function actIdFromLaneElement(element: HTMLElement | null): string | null {
  if (!element || element.dataset.laneId === withoutActLaneId) {
    return null;
  }

  return element.dataset.actId || null;
}

function chapterIdFromBeatLaneElement(element: HTMLElement | null): string | null {
  if (!element || element.dataset.laneId === withoutChapterBeatLaneId) {
    return null;
  }

  return element.dataset.chapterId || null;
}

function beatOrderIndexAfterDrop(
  plan: BookPlan,
  lanes: BeatBoardLane[],
  unassignedBeats: Beat[],
  draggedBeatId: string,
  target: BeatDropTarget
): number {
  const draggedBeat = plan.beats.find((beat) => beat.id === draggedBeatId);
  if (!draggedBeat || target.beatId === draggedBeatId) {
    return draggedBeat?.orderIndex ?? 0;
  }

  const laneKeys = [
    ...lanes.map((lane) => lane.chapterId ?? ""),
    withoutChapterBeatLaneId
  ];
  const laneMap = new globalThis.Map<string, Beat[]>(
    lanes.map((lane) => [
      lane.chapterId ?? "",
      lane.beats.filter((beat) => beat.id !== draggedBeatId)
    ])
  );
  laneMap.set(
    withoutChapterBeatLaneId,
    unassignedBeats.filter((beat) => beat.id !== draggedBeatId)
  );

  const targetKey = target.chapterId ?? withoutChapterBeatLaneId;
  const targetBeats = laneMap.get(targetKey) ?? [];

  if (!target.beatId || target.position === "end") {
    targetBeats.push(draggedBeat);
  } else {
    const targetIndex = targetBeats.findIndex((beat) => beat.id === target.beatId);
    const insertIndex =
      targetIndex === -1 ? targetBeats.length : targetIndex + (target.position === "after" ? 1 : 0);
    targetBeats.splice(insertIndex, 0, draggedBeat);
  }

  laneMap.set(targetKey, targetBeats);
  const reordered = laneKeys.flatMap((key) => laneMap.get(key) ?? []);
  const index = reordered.findIndex((beat) => beat.id === draggedBeatId);
  return index === -1 ? draggedBeat.orderIndex : index;
}

function reorderedChaptersAfterDrop(
  plan: BookPlan,
  lanes: ChapterLane[],
  draggedChapterId: string,
  target: ChapterDropTarget
): Chapter[] {
  if (target.chapterId === draggedChapterId) {
    return [];
  }

  const draggedChapter = plan.chapters.find((chapter) => chapter.id === draggedChapterId);
  if (!draggedChapter) {
    return [];
  }

  const laneKeys = lanes.map((lane) => chapterLaneKey(lane.actId));
  const laneMap = new globalThis.Map(
    lanes.map((lane) => [
      chapterLaneKey(lane.actId),
      lane.chapters.filter((chapter) => chapter.id !== draggedChapterId)
    ])
  );
  const targetKey = chapterLaneKey(target.actId);

  if (!laneMap.has(targetKey)) {
    laneKeys.push(targetKey);
    laneMap.set(targetKey, []);
  }

  const targetChapters = laneMap.get(targetKey) ?? [];
  const movedChapter = { ...draggedChapter, actId: target.actId };

  if (!target.chapterId || target.position === "end") {
    targetChapters.push(movedChapter);
  } else {
    const targetIndex = targetChapters.findIndex((chapter) => chapter.id === target.chapterId);
    const insertIndex =
      targetIndex === -1 ? targetChapters.length : targetIndex + (target.position === "after" ? 1 : 0);
    targetChapters.splice(insertIndex, 0, movedChapter);
  }

  laneMap.set(targetKey, targetChapters);

  const reordered = laneKeys.flatMap((key) => laneMap.get(key) ?? []);
  const previous = orderedChaptersForPlan(plan);
  const changed =
    reordered.length !== previous.length ||
    reordered.some((chapter, index) => {
      const previousChapter = previous[index];
      return (
        !previousChapter ||
        previousChapter.id !== chapter.id ||
        previousChapter.actId !== chapter.actId ||
        previousChapter.orderIndex !== index ||
        previousChapter.number !== index + 1
      );
    });

  return changed ? reordered : [];
}

function chapterUpsertInputForPlan(
  plan: BookPlan,
  chapter: Chapter,
  index: number
): UpsertChapterInput {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    actId: chapter.actId,
    number: index + 1,
    workingTitle: chapter.workingTitle,
    summary: chapter.summary,
    purpose: chapter.purpose,
    conflict: chapter.conflict,
    turningPoint: chapter.turningPoint,
    targetWordCount: chapter.targetWordCount,
    orderIndex: index,
    threadIds: chapterThreadIdsForChapter(plan, chapter.id),
    beatIds: chapterBeatIdsForChapter(plan, chapter.id)
  };
}

function chapterUpsertInputWithRelations(
  plan: BookPlan,
  chapter: Chapter,
  threadIds: string[],
  beatIds: string[]
): UpsertChapterInput {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    actId: chapter.actId,
    number: dynamicChapterNumber(plan, chapter.id),
    workingTitle: chapter.workingTitle,
    summary: chapter.summary,
    purpose: chapter.purpose,
    conflict: chapter.conflict,
    turningPoint: chapter.turningPoint,
    targetWordCount: chapter.targetWordCount,
    orderIndex: chapter.orderIndex,
    threadIds,
    beatIds
  };
}

function chapterLanesForPlan(plan: BookPlan): ChapterLane[] {
  const lanes: ChapterLane[] = plan.acts.map((act) => ({
    id: act.id,
    actId: act.id,
    name: act.name,
    color: act.color,
    purpose: act.purpose,
    rangeLabel: `${act.startPercent}-${act.endPercent}%`,
    chapters: chaptersForAct(plan, act.id)
  }));
  const unassigned = chaptersWithoutAct(plan);

  lanes.push({
    id: withoutActLaneId,
    actId: null,
    name: "Bez aktu",
    color: "#8a9791",
    purpose: "Rozdziały czekające na przypisanie do aktu.",
    rangeLabel: "Poza aktami",
    chapters: unassigned
  });

  return lanes;
}

function beatChapterLanesForPlan(plan: BookPlan, beats: Beat[]): BeatBoardLane[] {
  const beatIds = new Set(beats.map((beat) => beat.id));

  return orderedChaptersForPlan(plan).map((chapter) => {
    const act = plan.acts.find((item) => item.id === chapter.actId);
    return {
      id: chapter.id,
      chapterId: chapter.id,
      number: dynamicChapterNumber(plan, chapter.id),
      name: chapter.workingTitle,
      color: act?.color ?? "#3f8f6b",
      summary: chapter.summary,
      beats: beatsForChapter(plan, chapter).filter((beat) => beatIds.has(beat.id))
    };
  });
}

function chapterIdForBeat(plan: BookPlan, beatId: string): string | null {
  return plan.chapterBeats.find((relation) => relation.beatId === beatId)?.chapterId ?? null;
}

function chapterForBeat(plan: BookPlan, beat: Beat): Chapter | null {
  const chapterId = chapterIdForBeat(plan, beat.id);
  return chapterId ? plan.chapters.find((chapter) => chapter.id === chapterId) ?? null : null;
}

function beatsWithoutChapter(plan: BookPlan, beats: Beat[]): Beat[] {
  return beats.filter((beat) => !chapterIdForBeat(plan, beat.id));
}

function threadsForBeat(plan: BookPlan, beat: Beat): PlotThread[] {
  const chapter = chapterForBeat(plan, beat);
  return chapter ? threadsForChapter(plan, chapter) : [];
}

function actsForThread(plan: BookPlan, thread: PlotThread): Act[] {
  const actIds = new Set<string>();

  for (const chapter of chaptersForThread(plan, thread)) {
    if (chapter.actId) {
      actIds.add(chapter.actId);
    }
  }

  return plan.acts.filter((act) => actIds.has(act.id));
}

function threadCoveragePercent(plan: BookPlan, thread: PlotThread): number {
  if (plan.chapters.length === 0) {
    return 0;
  }

  return Math.round((chaptersForThread(plan, thread).length / plan.chapters.length) * 100);
}

function chapterRangeLabel(plan: BookPlan, chapters: Chapter[]): string {
  if (chapters.length === 0) {
    return "Brak";
  }

  const numbers = chapters
    .map((chapter) => dynamicChapterNumber(plan, chapter.id))
    .sort((left, right) => left - right);

  if (numbers.length === 1) {
    return String(numbers[0]);
  }

  return `${numbers[0]}-${numbers[numbers.length - 1]}`;
}

function threadStatusLabel(status: string): string {
  if (status === "active") {
    return "W toku";
  }

  if (status === "resolved") {
    return "Domknięty";
  }

  return "Planowany";
}

function threadStatusRank(status: string): number {
  if (status === "active") {
    return 1;
  }

  if (status === "resolved") {
    return 2;
  }

  return 0;
}

function chaptersForBeat(plan: BookPlan, beat: Beat): Chapter[] {
  const chapterIds = new Set(
    plan.chapterBeats
      .filter((relation) => relation.beatId === beat.id)
      .map((relation) => relation.chapterId)
  );

  return orderedChaptersForPlan(plan).filter((chapter) => chapterIds.has(chapter.id));
}

function plannedWordsForChapters(chapters: Chapter[]): number {
  return chapters.reduce((sum, chapter) => sum + (chapter.targetWordCount ?? 0), 0);
}

function scrollElementBy(element: HTMLElement | null, left: number) {
  if (!element) {
    return;
  }

  if (typeof element.scrollBy === "function") {
    element.scrollBy({ left, behavior: "smooth" });
    return;
  }

  element.scrollLeft += left;
}

function beatsForChapter(plan: BookPlan, chapter: Chapter): Beat[] {
  const beatIds = new Set(
    plan.chapterBeats
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.beatId)
  );

  return plan.beats.filter((beat) => beatIds.has(beat.id));
}

function threadsForChapter(plan: BookPlan, chapter: Chapter): PlotThread[] {
  const threadIds = new Set(chapterThreadIdsForChapter(plan, chapter.id));

  return plan.threads.filter((thread) => threadIds.has(thread.id));
}

function chaptersForThread(plan: BookPlan, thread: PlotThread): Chapter[] {
  const chapterIds = new Set(
    plan.chapterThreads
      .filter((relation) => relation.threadId === thread.id)
      .map((relation) => relation.chapterId)
  );

  return orderedChaptersForPlan(plan).filter((chapter) => chapterIds.has(chapter.id));
}

function chapterThreadRelationsForThread(plan: BookPlan, threadId: string): ChapterThread[] {
  const chapterOrder = chapterNumberMap(plan);
  return plan.chapterThreads
    .filter((relation) => relation.threadId === threadId)
    .sort(
      (left, right) =>
        (chapterOrder.get(left.chapterId) ?? 0) - (chapterOrder.get(right.chapterId) ?? 0)
    );
}

function chapterThreadRelation(
  plan: BookPlan,
  threadId: string,
  chapterId: string
): ChapterThread | undefined {
  return plan.chapterThreads.find(
    (relation) => relation.threadId === threadId && relation.chapterId === chapterId
  );
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

function formatWordCount(value: number | null): string {
  return value ? `${value.toLocaleString("pl-PL")} słów` : "Brak celu";
}

function chapterReadiness(plan: BookPlan, chapter: Chapter): ChapterReadiness {
  const hasTitle = Boolean(chapter.workingTitle.trim());
  const hasAct = Boolean(chapter.actId);
  const hasPurpose = Boolean(chapter.purpose.trim());
  const hasConflict = Boolean(chapter.conflict.trim());
  const hasTurningPoint = Boolean(chapter.turningPoint.trim());
  const hasTargetWordCount = Boolean(chapter.targetWordCount && chapter.targetWordCount > 0);
  const hasBeats = chapterBeatIdsForChapter(plan, chapter.id).length > 0;
  const hasThreads = chapterThreadIdsForChapter(plan, chapter.id).length > 0;
  const hasScenes = orderedScenesForChapter(plan, chapter.id).length > 0;
  const skeletonChecks = [
    {
      ok: hasTitle,
      missing: "Nadaj roboczy tytuł rozdziału."
    },
    {
      ok: hasAct,
      missing: "Przypisz rozdział do aktu."
    },
    {
      ok: hasPurpose,
      missing: "Uzupełnij cel rozdziału."
    }
  ];
  const contractChecks = [
    {
      ok: hasConflict,
      missing: "Uzupełnij konflikt rozdziału."
    },
    {
      ok: hasTurningPoint,
      missing: "Uzupełnij punkt zwrotny rozdziału."
    },
    {
      ok: hasTargetWordCount,
      missing: "Ustal target słów dla rozdziału."
    },
    {
      ok: hasThreads,
      missing: "Rozpisz przynajmniej jeden wątek przez rozdział."
    },
    {
      ok: hasBeats,
      missing: "Dopnij przynajmniej jeden beat do rozdziału."
    }
  ];
  const sceneCheck = {
    ok: hasScenes,
    missing: "Rozbij rozdział na sceny."
  };
  const skeletonComplete = skeletonChecks.every((check) => check.ok);
  const contractComplete = contractChecks.every((check) => check.ok);
  const checks = [...skeletonChecks, ...contractChecks, sceneCheck];
  const missing = checks.filter((check) => !check.ok).map((check) => check.missing);
  const percent = Math.round(((checks.length - missing.length) / checks.length) * 100);
  const tone = contractComplete ? "ready" : skeletonComplete ? "active" : "draft";
  const label = !skeletonComplete
    ? "Szkic szkieletu"
    : !contractComplete
      ? "Szkielet gotowy"
      : hasScenes
        ? "Gotowy do pisania"
        : "Gotowy do scen";

  return { percent, label, missing, tone };
}

function chapterStoryBibleNeeds(plan: BookPlan, scenes: Scene[]): string[] {
  const needs: string[] = [];
  const scenesWithoutPov = scenes.filter((scene) => !scene.povCharacterId);
  const scenesWithoutLocation = scenes.filter((scene) => !scene.locationId);
  const scenesWithoutCharacters = scenes.filter((scene) => sceneCharacterIds(plan, scene.id).length === 0);
  const scenesWithoutThreads = scenes.filter((scene) => sceneThreadIds(plan, scene.id).length === 0);

  if (scenesWithoutPov.length > 0) {
    needs.push(`Uzupełnij POV w scenach: ${sceneListPreview(scenesWithoutPov)}.`);
  }

  if (scenesWithoutLocation.length > 0) {
    needs.push(`Uzupełnij lokację w scenach: ${sceneListPreview(scenesWithoutLocation)}.`);
  }

  if (scenesWithoutCharacters.length > 0) {
    needs.push(`Dopnij postacie do scen: ${sceneListPreview(scenesWithoutCharacters)}.`);
  }

  if (scenesWithoutThreads.length > 0) {
    needs.push(`Dopnij wątki do scen: ${sceneListPreview(scenesWithoutThreads)}.`);
  }

  return needs;
}

function sceneListPreview(scenes: Scene[]): string {
  return scenes
    .slice(0, 3)
    .map((scene) => scene.title || "Scena bez tytułu")
    .join(", ") + (scenes.length > 3 ? ` +${scenes.length - 3}` : "");
}

function chapterBeatLikelyCoveredByScenes(beat: Beat, scenes: Scene[]): boolean {
  const sceneText = normalizeSearchText(
    scenes
      .flatMap((scene) => [scene.title, scene.summary, scene.goal, scene.conflict, scene.outcome])
      .join(" ")
  );
  const beatTerms = [beat.name, beat.role, beat.description]
    .flatMap((value) => normalizeSearchText(value).split(/\s+/))
    .filter((value) => value.length >= 4);
  const uniqueTerms = uniqueOrderedIds(beatTerms);

  if (!sceneText || uniqueTerms.length === 0) {
    return false;
  }

  return uniqueTerms.some((term) => sceneText.includes(term));
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultChapterActId(initialActId: string | null | undefined, plan: BookPlan): string {
  if (initialActId !== undefined) {
    return initialActId ?? "";
  }

  return plan.acts[0]?.id ?? "";
}

function selectedItemDetails(item: SelectedPlanItem | null, plan: BookPlan) {
  if (!item) {
    return null;
  }

  if (item.type === "act") {
    const act = plan.acts.find((candidate) => candidate.id === item.id);
    return act
      ? {
          title: act.name,
          description: act.summary || act.purpose,
          meta: [
            { label: "Zakres", value: `${act.startPercent} - ${act.endPercent}%` },
            { label: "Rozdziały", value: String(chaptersForAct(plan, act.id).length) }
          ]
        }
      : null;
  }

  if (item.type === "beat") {
    const beat = plan.beats.find((candidate) => candidate.id === item.id);
    const chapter = beat ? chapterForBeat(plan, beat) : null;
    return beat
      ? {
          title: beat.name,
          description: beat.description,
          meta: [
            { label: "Rola", value: beat.role || "Brak" },
            {
              label: "Rozdział",
              value: chapter
                ? `${dynamicChapterNumber(plan, chapter.id)}. ${chapter.workingTitle}`
                : "Brak"
            }
          ]
        }
      : null;
  }

  if (item.type === "thread") {
    const thread = plan.threads.find((candidate) => candidate.id === item.id);
    return thread
      ? {
          title: thread.name,
          description: thread.description,
          meta: [
            { label: "Status", value: thread.status },
            {
              label: "Rozdziały",
              value: String(
                plan.chapterThreads.filter((relation) => relation.threadId === thread.id)
                  .length
              )
            }
          ]
        }
      : null;
  }

  if (item.type === "chapter") {
    const chapter = plan.chapters.find((candidate) => candidate.id === item.id);
    return chapter
      ? {
          title: `Rozdział ${dynamicChapterNumber(plan, chapter.id)}: ${chapter.workingTitle}`,
          description: chapter.summary || chapter.purpose,
          meta: [
            { label: "Akt", value: plan.acts.find((act) => act.id === chapter.actId)?.name ?? "Brak" },
            { label: "Konflikt", value: chapter.conflict || "Brak" },
            { label: "Punkt zwrotny", value: chapter.turningPoint || "Brak" }
          ]
        }
      : null;
  }

  return null;
}

function chaptersForAct(plan: BookPlan, actId: string): Chapter[] {
  return orderedChaptersForPlan(plan).filter((chapter) => chapter.actId === actId);
}

function chaptersWithoutAct(plan: BookPlan): Chapter[] {
  return orderedChaptersForPlan(plan).filter((chapter) => !chapter.actId);
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

function isPlanReady(plan: BookPlan): boolean {
  return plan.acts.length > 0 && plan.chapters.length > 0;
}

function emptyCharacterWorkspace(): CharacterWorkspace {
  return { characters: [], relations: [], memories: [], memoryLinks: [], visualAssets: [] };
}

function emptyWorldWorkspace(): WorldWorkspace {
  return { elements: [], rules: [], elementCharacters: [], elementThreads: [], elementChapters: [], elementScenes: [], elementRules: [], ruleThreads: [], ruleChapters: [], ruleScenes: [], visualAssets: [] };
}

function orderedScenesForChapter(plan: BookPlan, chapterId: string | null): Scene[] {
  return plan.scenes
    .filter((scene) => (scene.chapterId ?? null) === chapterId)
    .sort((left, right) => left.orderIndex - right.orderIndex || left.title.localeCompare(right.title, "pl-PL"));
}

function characterLabel(characters: CharacterWorkspace, characterId: string | null | undefined): string {
  if (!characterId) return "Brak";
  return characters.characters.find((item) => item.id === characterId)?.name ?? "Postać";
}

function worldElementLabel(world: WorldWorkspace, elementId: string | null | undefined): string {
  if (!elementId) return "Brak";
  return world.elements.find((item) => item.id === elementId)?.name ?? "Element świata";
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
  switch (kind) {
    case "characters":
      return sceneCharacterIds(plan, sceneId);
    case "threads":
      return sceneThreadIds(plan, sceneId);
    case "elements":
      return sceneElementIds(plan, sceneId);
    case "rules":
      return sceneRuleIds(plan, sceneId);
  }
}

function sceneRelationSnapshot(
  plan: BookPlan,
  sceneId: string
): Omit<SetSceneRelationsInput, "bookId" | "sceneId"> {
  return {
    characterIds: sceneCharacterIds(plan, sceneId),
    threadIds: sceneThreadIds(plan, sceneId),
    elementIds: sceneElementIds(plan, sceneId),
    ruleIds: sceneRuleIds(plan, sceneId)
  };
}

function sceneRelationInputKey(
  kind: SceneRelationKind
): keyof Omit<SetSceneRelationsInput, "bookId" | "sceneId"> {
  switch (kind) {
    case "characters":
      return "characterIds";
    case "threads":
      return "threadIds";
    case "elements":
      return "elementIds";
    case "rules":
      return "ruleIds";
  }
}

function sceneRelationOptions(
  kind: SceneRelationKind,
  plan: BookPlan,
  characters: CharacterWorkspace,
  world: WorldWorkspace
): Array<{ id: string; label: string; description: string }> {
  switch (kind) {
    case "characters":
      return characters.characters.map((character) => ({
        id: character.id,
        label: character.name || "Postać bez imienia",
        description: character.shortDescription || character.arcSummary || character.role || "Brak opisu postaci."
      }));
    case "threads":
      return plan.threads.map((thread) => ({
        id: thread.id,
        label: thread.name || "Wątek bez nazwy",
        description: thread.description || thread.status || "Brak opisu wątku."
      }));
    case "elements":
      return world.elements.map((element) => ({
        id: element.id,
        label: element.name || "Element świata bez nazwy",
        description: element.summary || element.details || element.elementType || "Brak opisu elementu świata."
      }));
    case "rules":
      return world.rules.map((rule) => ({
        id: rule.id,
        label: rule.name || "Reguła bez nazwy",
        description: rule.description || "Brak opisu reguły świata."
      }));
  }
}

function sceneRelationDotClass(kind: SceneRelationKind): string {
  switch (kind) {
    case "characters":
      return "character";
    case "threads":
      return "thread";
    case "elements":
      return "element";
    case "rules":
      return "rule";
  }
}

function normalizePlanStep(value: string | undefined): PlanStep {
  return planSteps.some((step) => step.key === value)
    ? (value as PlanStep)
    : "structure";
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
    "prepareChapterForScenes",
    "chapterSceneBreakdown",
    "sceneRelationSuggestions",
    "chapterThreadSuggestions",
    "chapterBeatSuggestions"
  ].includes(field);
}

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








