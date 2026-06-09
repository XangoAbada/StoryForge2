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
  Hash,
  LayoutList,
  Link2,
  Loader2,
  Map,
  MoreHorizontal,
  Pencil,
  Plus,
  Route,
  Save,
  Search,
  Sparkles,
  Target,
  Trash2,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { FormEvent, MouseEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAct,
  deleteBeat,
  deleteChapter,
  deletePlotThread,
  getBookPlan,
  getProject,
  saveStoryStructure,
  upsertAct,
  upsertBeat,
  upsertChapter,
  upsertPlotThread
} from "../../shared/api/commands";
import type {
  Act,
  Beat,
  BookPlan,
  Chapter,
  PlotThread,
  SaveStoryStructureInput,
  UpsertActInput,
  UpsertBeatInput,
  UpsertChapterInput,
  UpsertPlotThreadInput
} from "../../shared/api/types";
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
import {
  buildPlanPromptPackage,
  planFieldConfigs,
  planPromptContextSource,
  PlanFieldKey,
  renderPlanPromptPackage
} from "../ai/planPromptPackage";
import {
  createPlanPromptContextTarget,
  planPromptContextTargetId,
  promptContextControlForActiveTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import { pendingProposalStatus, useProposalStore } from "../ai/proposalStore";

type BookPlanPageProps = {
  projectId: string;
};

type PlanStep = "structure" | "acts" | "chapters" | "beats" | "threads";
type PlanMode = "wizard" | "preview";
type SelectedPlanItem =
  | { type: "structure"; id: string }
  | { type: "act"; id: string }
  | { type: "beat"; id: string }
  | { type: "thread"; id: string }
  | { type: "chapter"; id: string };
type ChapterModalState =
  | { mode: "create"; actId?: string | null }
  | { mode: "edit"; chapterId: string };
type ChapterRelationKind = "threads" | "beats";
type BeatSortMode = "order" | "name" | "role";
type ThreadViewMode = "map" | "list" | "table";
type ThreadSortMode = "order" | "name" | "status";
type ThreadEditTarget = "new" | string | null;
type BeatBoardLane = {
  id: string;
  actId: string | null;
  name: string;
  color: string;
  rangeLabel: string;
  beats: Beat[];
};

const planSteps: Array<{ key: PlanStep; label: string; icon: typeof Map }> = [
  { key: "structure", label: "Struktura", icon: Map },
  { key: "acts", label: "Akty", icon: Flag },
  { key: "chapters", label: "Rozdziały", icon: FileText },
  { key: "beats", label: "Beaty", icon: Target },
  { key: "threads", label: "Wątki", icon: GitBranch }
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
  const plan = planQuery.data ?? emptyPlan();
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
    mutationFn: (input: UpsertBeatInput) => upsertBeat(input),
    onSuccess: async (beat) => {
      setSelectedItem({ type: "beat", id: beat.id });
      setMessage("Zapisano beat.");
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
      setMessage("Usunięto element planu.");
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
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) {
    setErrorMessage("");
    if (!projectQuery.data || !bookId) {
      setErrorMessage("Brak danych projektu.");
      return;
    }

    const targetId = planPromptContextTargetId(projectId, field, targetEntity?.id);
    const contextControl = promptContextControlForActiveTarget(targetId);
    const usedPromptContext = Boolean(contextControl);
    const promptPackage = buildPlanPromptPackage(
      projectQuery.data.project,
      projectQuery.data.book,
      plan,
      field,
      targetEntity,
      contextControl
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

  function activatePlanPromptContext(
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) {
    const targetId = planPromptContextTargetId(projectId, field, targetEntity?.id);
    const loading = pendingProposalStatus(proposals, {
      projectId,
      bookId,
      field,
      scope: "bookPlan"
    });

    activatePromptContextTarget(
      createPlanPromptContextTarget(projectId, field, targetEntity?.id, {
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
        onGenerate={(field) => queuePlanGeneration(field)}
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
        onGenerate={queuePlanGeneration}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : activeStep === "chapters" ? (
      <ChaptersStep
        bookId={bookId}
        plan={plan}
        saving={chapterMutation.isPending || chapterReorderMutation.isPending}
        onOpenChapter={openChapterModal}
        onCreateChapter={openNewChapterModal}
        onSaveChapter={(input) => chapterMutation.mutate(input)}
        onReorderChapters={(inputs) => chapterReorderMutation.mutate(inputs)}
        onGenerate={queuePlanGeneration}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : activeStep === "beats" ? (
      <BeatsStep
        bookId={bookId}
        plan={plan}
        saving={beatMutation.isPending}
        onSave={(input) => beatMutation.mutate(input)}
        onDelete={(item) => deleteMutation.mutate(item)}
        onSelect={setSelectedItem}
        onGenerate={queuePlanGeneration}
        onActivatePrompt={activatePlanPromptContext}
      />
    ) : (
      <ThreadsStep
        bookId={bookId}
        plan={plan}
        saving={threadMutation.isPending}
        onSave={(input) => threadMutation.mutate(input)}
        onDelete={(item) => deleteMutation.mutate(item)}
        onSelect={setSelectedItem}
        onGenerate={queuePlanGeneration}
        onActivatePrompt={activatePlanPromptContext}
      />
    );

  return (
    <section className="plan-page">
      <header className="plan-page-header">
        <div>
          <p className="eyebrow">Plan powieści</p>
          <h2>Od struktury aktów do rozdziałów</h2>
          <p>
            Prowadź historię krok po kroku, a po ułożeniu rozdziałów przejdź do
            podglądu całej konstrukcji.
          </p>
        </div>
        <div className="plan-header-actions" role="group" aria-label="Tryb planu">
          <button
            type="button"
            className={mode === "wizard" ? "plan-mode-button active" : "plan-mode-button"}
            onClick={() => selectMode("wizard")}
          >
            <LayoutList size={16} />
            Kreator
          </button>
          <button
            type="button"
            className={mode === "preview" ? "plan-mode-button active" : "plan-mode-button"}
            onClick={() => selectMode("preview")}
            disabled={!isPlanReady(plan)}
            title={
              isPlanReady(plan)
                ? "Otwórz podgląd planu."
                : "Dodaj akty i rozdziały, aby odblokować podgląd."
            }
          >
            <Route size={16} />
            Podgląd
          </button>
        </div>
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
        saving={chapterMutation.isPending || deleteMutation.isPending}
        onClose={() => setChapterModal(null)}
        onSave={(input) =>
          chapterMutation.mutate(input, {
            onSuccess: () => setChapterModal(null)
          })
        }
        onDelete={(item) =>
          deleteMutation.mutate(item, {
            onSuccess: () => setChapterModal(null)
          })
        }
        onGenerate={queuePlanGeneration}
        onActivatePrompt={activatePlanPromptContext}
      />
    </section>
  );
}

type StepProps = {
  bookId: string;
  plan: BookPlan;
  saving: boolean;
  onGenerate: (field: PlanFieldKey, targetEntity?: Act | Beat | PlotThread | Chapter) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) => void;
};

function PlanStageNavigation({
  activeStep,
  onSelectStep
}: {
  activeStep: PlanStep;
  onSelectStep: (step: PlanStep) => void;
}) {
  return (
    <nav className="plan-stage-navigation" aria-label="Kroki planu powieści">
      <div className="plan-stage-track">
        {planSteps.map((step, index) => {
          const active = activeStep === step.key;

          return (
            <button
              type="button"
              key={step.key}
              className={active ? "plan-stage-step active" : "plan-stage-step"}
              onClick={() => onSelectStep(step.key)}
              aria-current={active ? "step" : undefined}
            >
              <span className="plan-stage-number">{index + 1}</span>
              <span className="plan-stage-label">{step.label}</span>
            </button>
          );
        })}
      </div>
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
  onGenerate: (field: PlanFieldKey, targetEntity?: Act | Beat | PlotThread | Chapter) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
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
  onDelete,
  onSelect,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onSave: (input: UpsertBeatInput) => void;
  onDelete: (item: SelectedPlanItem) => void;
  onSelect: (item: SelectedPlanItem) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [actFilter, setActFilter] = useState("all");
  const [threadFilter, setThreadFilter] = useState("all");
  const [sortMode, setSortMode] = useState<BeatSortMode>("order");
  const [expandedBeatId, setExpandedBeatId] = useState<string | null>(null);
  const [addingBeat, setAddingBeat] = useState(false);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("pl-PL");
  const visibleBeats = plan.beats
    .filter((beat) => {
      const threadIds = beatThreadIdsForBeat(plan, beat.id);
      const threadNames = plan.threads
        .filter((thread) => threadIds.includes(thread.id))
        .map((thread) => thread.name)
        .join(" ");
      const searchable = `${beat.name} ${beat.description} ${beat.role} ${threadNames}`
        .toLocaleLowerCase("pl-PL");
      const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
      const matchesAct =
        actFilter === "all" ||
        (actFilter === "none" ? !beat.actId : beat.actId === actFilter);
      const matchesThread =
        threadFilter === "all" || threadIds.includes(threadFilter);

      return matchesSearch && matchesAct && matchesThread;
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
  const lanes = beatBoardLanesForPlan(plan, visibleBeats);

  return (
    <PlanCard
      title="Beaty"
      icon={<Target size={18} />}
      action={
        <PlanAiActions
          field="beatSheet"
          onGenerate={() => onGenerate("beatSheet")}
          onActivatePrompt={() => onActivatePrompt("beatSheet")}
        />
      }
    >
      <div className="beat-board-shell">
        <div className="beat-board-toolbar">
          <div className="beat-board-heading">
            <strong>{visibleBeats.length} / {plan.beats.length}</strong>
            <span>beatów w widoku</span>
          </div>
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
            value={actFilter}
            onChange={(event) => setActFilter(event.target.value)}
            aria-label="Filtruj beaty po akcie"
          >
            <option value="all">Akt: Wszystkie</option>
            <option value="none">Bez aktu</option>
            {plan.acts.map((act) => (
              <option value={act.id} key={act.id}>
                {act.name}
              </option>
            ))}
          </select>
          <select
            value={threadFilter}
            onChange={(event) => setThreadFilter(event.target.value)}
            aria-label="Filtruj beaty po wątku"
          >
            <option value="all">Wątek: Wszystkie</option>
            {plan.threads.map((thread) => (
              <option value={thread.id} key={thread.id}>
                {thread.name}
              </option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as BeatSortMode)}
            aria-label="Sortuj beaty"
          >
            <option value="order">Sortuj: Kolejność</option>
            <option value="name">Sortuj: Nazwa</option>
            <option value="role">Sortuj: Rola</option>
          </select>
          <button
            type="button"
            className="primary-button beat-board-add-button"
            onClick={() => {
              setExpandedBeatId(null);
              setAddingBeat((current) => !current);
            }}
          >
            <Plus size={16} />
            Dodaj beat
          </button>
        </div>

        <div className="beat-board-timeline" aria-label="Oś aktów">
          {lanes.map((lane) => (
            <div
              className="beat-board-timeline-segment"
              style={{ borderTopColor: lane.color }}
              key={lane.id}
            >
              <span style={{ background: lane.color }} />
              <strong>{lane.name}</strong>
              <small>{lane.rangeLabel}</small>
            </div>
          ))}
        </div>

        {addingBeat ? (
          <div className="beat-board-new-form">
            <BeatForm
              bookId={bookId}
              plan={plan}
              saving={saving}
              orderIndex={plan.beats.length}
              onSave={onSave}
              onCancel={() => setAddingBeat(false)}
              formClassName="beat-board-editor-form"
            />
          </div>
        ) : null}

        <div className="beat-board-columns">
          {lanes.map((lane) => (
            <section className="beat-board-column" key={lane.id}>
              <div className="beat-board-column-header">
                <div>
                  <span style={{ background: lane.color }} />
                  <h4>{lane.name}</h4>
                </div>
                <small>{lane.beats.length} beatów</small>
              </div>
              <div className="beat-board-card-stack">
                {lane.beats.length === 0 ? (
                  <p className="beat-board-empty">Brak beatów dla tych filtrów.</p>
                ) : null}
                {lane.beats.map((beat) => {
                  const threads = threadsForBeat(plan, beat);
                  const chapters = chaptersForBeat(plan, beat);
                  const expanded = expandedBeatId === beat.id;

                  return (
                    <article
                      className={expanded ? "beat-board-card-shell active" : "beat-board-card-shell"}
                      key={beat.id}
                    >
                      <button
                        type="button"
                        className="beat-board-card"
                        onClick={() => {
                          setAddingBeat(false);
                          setExpandedBeatId(expanded ? null : beat.id);
                          onSelect({ type: "beat", id: beat.id });
                        }}
                        aria-expanded={expanded}
                        aria-label={`Otwórz beat ${beat.name}`}
                      >
                        <span className="beat-board-card-topline">
                          <span className="beat-board-number">{beat.orderIndex + 1}</span>
                          <MoreHorizontal size={16} />
                        </span>
                        <strong>{beat.name}</strong>
                        <span className="beat-board-description">
                          {beat.description || "Dodaj opis roli tego beatu w historii."}
                        </span>
                        <span className="beat-board-role">{beat.role || "Bez roli"}</span>
                        <span className="beat-board-meta">
                          <span>
                            Wątki:
                            {threads.length > 0 ? (
                              threads.map((thread) => (
                                <em key={thread.id}>{thread.name}</em>
                              ))
                            ) : (
                              <em>Brak</em>
                            )}
                          </span>
                          <span>
                            Rozdz.:
                            {chapters.length > 0 ? (
                              chapters.map((chapter) => (
                                <em key={chapter.id}>{dynamicChapterNumber(plan, chapter.id)}</em>
                              ))
                            ) : (
                              <em>Brak</em>
                            )}
                          </span>
                        </span>
                      </button>
                      {expanded ? (
                        <BeatForm
                          bookId={bookId}
                          beat={beat}
                          plan={plan}
                          saving={saving}
                          onSave={onSave}
                          onDelete={() => onDelete({ type: "beat", id: beat.id })}
                          onSelect={() => onSelect({ type: "beat", id: beat.id })}
                          onCancel={() => setExpandedBeatId(null)}
                          formClassName="beat-board-editor-form"
                        />
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PlanCard>
  );
}

function BeatForm({
  bookId,
  beat,
  plan,
  orderIndex = 0,
  saving,
  onSave,
  onDelete,
  onSelect,
  onCancel,
  formClassName
}: {
  bookId: string;
  beat?: Beat;
  plan: BookPlan;
  orderIndex?: number;
  saving: boolean;
  onSave: (input: UpsertBeatInput) => void;
  onDelete?: () => void;
  onSelect?: () => void;
  onCancel?: () => void;
  formClassName?: string;
}) {
  const beatThreadIds = plan.beatThreads
    .filter((item) => item.beatId === beat?.id)
    .map((item) => item.threadId);
  const [name, setName] = useState(beat?.name ?? `Beat ${orderIndex + 1}`);
  const [description, setDescription] = useState(beat?.description ?? "");
  const [role, setRole] = useState(beat?.role ?? "");
  const [actId, setActId] = useState(beat?.actId ?? plan.acts[0]?.id ?? "");
  const [threadIds, setThreadIds] = useState(beatThreadIds);

  useEffect(() => {
    setName(beat?.name ?? `Beat ${orderIndex + 1}`);
    setDescription(beat?.description ?? "");
    setRole(beat?.role ?? "");
    setActId(beat?.actId ?? plan.acts[0]?.id ?? "");
    setThreadIds(beatThreadIds);
  }, [
    beat?.name,
    beat?.description,
    beat?.role,
    beat?.actId,
    plan.acts,
    beatThreadIds.join("|"),
    orderIndex
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: beat?.id,
      bookId,
      actId: actId || null,
      name,
      description,
      role,
      orderIndex: beat?.orderIndex ?? orderIndex,
      threadIds
    });
  }

  return (
    <form
      className={formClassName ? `plan-entity-card ${formClassName}` : "plan-entity-card"}
      onSubmit={submit}
    >
      <button
        type="button"
        className="plan-link-title"
        onClick={onSelect}
        disabled={!beat}
        aria-label={beat ? `Otwórz beat ${beat.name}` : "Nowy beat"}
      >
        <Target size={15} />
        {beat ? beat.name : "Nowy beat"}
      </button>
      <label className="field-label">
        Nazwa
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field-label">
        Akt
        <select value={actId} onChange={(event) => setActId(event.target.value)}>
          <option value="">Bez aktu</option>
          {plan.acts.map((act) => (
            <option value={act.id} key={act.id}>
              {act.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Rola
        <input value={role} onChange={(event) => setRole(event.target.value)} />
      </label>
      <label className="field-label">
        Opis
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
        />
      </label>
      <RelationPicker
        label="Wątki"
        items={plan.threads}
        selectedIds={threadIds}
        onChange={setThreadIds}
      />
      <div className="beat-form-actions">
        <EntityActions saving={saving} onDelete={onDelete} />
        {onCancel ? (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Zamknij
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ThreadsStep({
  bookId,
  plan,
  saving,
  onSave,
  onDelete,
  onSelect,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onSave: (input: UpsertPlotThreadInput) => void;
  onDelete: (item: SelectedPlanItem) => void;
  onSelect: (item: SelectedPlanItem) => void;
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
            Zobacz przebieg wątków przez historię, ich pokrycie w rozdziałach i szybkie
            powiązania z beatami.
          </p>
        </div>
        <div className="thread-header-actions">
          <PlanAiActions
            field="plotThreads"
            onGenerate={() => onGenerate("plotThreads")}
            onActivatePrompt={() => onActivatePrompt("plotThreads")}
          />
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
          />

          <div className="thread-view-panel">
            <div className="thread-view-summary">
              <span>{visibleThreads.length} widocznych</span>
              <span>{linkedChapterCount} powiązań z rozdziałami</span>
              <span>{plan.beatThreads.length} powiązań z beatami</span>
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
                    onSelect={() => selectThread(thread)}
                    onEdit={() => {
                      setSelectedThreadId(thread.id);
                      setEditingThreadId(thread.id);
                    }}
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

        <ThreadDetailsPanel
          bookId={bookId}
          plan={plan}
          thread={selectedThread}
          editingThreadId={editingThreadId}
          orderIndex={plan.threads.length}
          saving={saving}
          onSave={finishEdit}
          onDelete={(thread) => onDelete({ type: "thread", id: thread.id })}
          onEdit={(target) => setEditingThreadId(target)}
          onCancelEdit={() => setEditingThreadId(null)}
        />
      </div>
    </section>
  );
}

function ThreadEditor({
  bookId,
  thread,
  orderIndex = 0,
  saving,
  onSave,
  onDelete,
  onCancel
}: {
  bookId: string;
  thread?: PlotThread;
  orderIndex?: number;
  saving: boolean;
  onSave: (input: UpsertPlotThreadInput) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(thread?.name ?? `Wątek ${orderIndex + 1}`);
  const [description, setDescription] = useState(thread?.description ?? "");
  const [color, setColor] = useState(thread?.color ?? actColors[orderIndex % actColors.length]);
  const [status, setStatus] = useState(thread?.status ?? "planned");

  useEffect(() => {
    setName(thread?.name ?? `Wątek ${orderIndex + 1}`);
    setDescription(thread?.description ?? "");
    setColor(thread?.color ?? actColors[orderIndex % actColors.length]);
    setStatus(thread?.status ?? "planned");
  }, [
    thread?.name,
    thread?.description,
    thread?.color,
    thread?.status,
    orderIndex
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: thread?.id,
      bookId,
      name,
      description,
      color,
      status,
      orderIndex: thread?.orderIndex ?? orderIndex
    });
  }

  return (
    <form className="thread-editor-form" onSubmit={submit}>
      <div className="thread-editor-title">
        <span style={{ background: color }} />
        <strong>{thread ? "Edytuj wątek" : "Nowy wątek"}</strong>
      </div>
      <label className="field-label">
        Nazwa
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field-label">
        Opis
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
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
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>
      <div className="thread-editor-actions">
        <EntityActions saving={saving} onDelete={onDelete} />
        {onCancel ? (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Zamknij
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ThreadFlowMap({
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
      <div className="thread-map-legend">
        {threads.slice(0, 6).map((thread) => (
          <button
            type="button"
            key={thread.id}
            className={selectedThreadId === thread.id ? "active" : ""}
            onClick={() => onSelect(thread)}
          >
            <span style={{ background: thread.color }} />
            {thread.name}
          </button>
        ))}
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
                      onClick={() => onSelect(thread)}
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
  onSelect,
  onEdit
}: {
  plan: BookPlan;
  thread: PlotThread;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const beats = beatsForThread(plan, thread);
  const chapters = chaptersForThread(plan, thread);
  const acts = actsForThread(plan, thread);
  const coverage = threadCoveragePercent(plan, thread);

  return (
    <article className={active ? "thread-summary-card active" : "thread-summary-card"}>
      <button type="button" className="thread-summary-hitarea" onClick={onSelect}>
        <span className="thread-color-dot" style={{ background: thread.color }} />
        <span>
          <strong>{thread.name}</strong>
          <em className={`thread-status-chip ${thread.status}`}>
            {threadStatusLabel(thread.status)}
          </em>
        </span>
      </button>
      <p>{thread.description || "Ten wątek nie ma jeszcze opisu."}</p>
      <div className="thread-card-metrics">
        <span>
          <b>Akty</b>
          {acts.length > 0 ? acts.map((act) => act.name).join(", ") : "Brak"}
        </span>
        <span>
          <b>Beaty</b>
          {beats.length}
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
        {beats.slice(0, 3).map((beat) => (
          <span key={beat.id}>{beat.name}</span>
        ))}
        {beats.length > 3 ? <span>+{beats.length - 3}</span> : null}
      </div>
      <button type="button" className="thread-card-edit" onClick={onEdit}>
        <Pencil size={14} />
        Edytuj
      </button>
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
            <th>Beaty</th>
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
                <td>{beatsForThread(plan, thread).length}</td>
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

function ThreadDetailsPanel({
  bookId,
  plan,
  thread,
  editingThreadId,
  orderIndex,
  saving,
  onSave,
  onDelete,
  onEdit,
  onCancelEdit
}: {
  bookId: string;
  plan: BookPlan;
  thread: PlotThread | null;
  editingThreadId: ThreadEditTarget;
  orderIndex: number;
  saving: boolean;
  onSave: (input: UpsertPlotThreadInput) => void;
  onDelete: (thread: PlotThread) => void;
  onEdit: (target: ThreadEditTarget) => void;
  onCancelEdit: () => void;
}) {
  const editingThread =
    editingThreadId && editingThreadId !== "new"
      ? plan.threads.find((candidate) => candidate.id === editingThreadId)
      : undefined;

  if (editingThreadId === "new" || editingThread) {
    return (
      <aside className="thread-details-panel">
        <ThreadEditor
          bookId={bookId}
          thread={editingThread}
          orderIndex={orderIndex}
          saving={saving}
          onSave={onSave}
          onDelete={editingThread ? () => onDelete(editingThread) : undefined}
          onCancel={onCancelEdit}
        />
      </aside>
    );
  }

  if (!thread) {
    return (
      <aside className="thread-details-panel">
        <div className="thread-detail-empty">
          <GitBranch size={22} />
          <strong>Wybierz wątek</strong>
          <p>Panel pokaże status, powiązania, checklistę i edycję wybranego wątku.</p>
        </div>
      </aside>
    );
  }

  const beats = beatsForThread(plan, thread);
  const chapters = chaptersForThread(plan, thread);
  const acts = actsForThread(plan, thread);
  const checklist = [
    { label: "Zdefiniowana rola w historii", complete: Boolean(thread.description.trim()) },
    { label: "Powiązane akty i beaty", complete: beats.length > 0 || acts.length > 0 },
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
        <strong>Powiązane beaty</strong>
        <div className="thread-chip-row">
          {beats.length > 0 ? (
            beats.map((beat) => <span key={beat.id}>{beat.name}</span>)
          ) : (
            <em>Brak</em>
          )}
        </div>
      </div>
      <div className="thread-detail-section">
        <strong>Powiązane rozdziały</strong>
        <div className="thread-chip-row">
          {chapters.length > 0 ? (
            chapters.map((chapter) => (
              <span key={chapter.id}>
                {dynamicChapterNumber(plan, chapter.id)}. {chapter.workingTitle}
              </span>
            ))
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
          <b>{beats.length}</b>
          Beaty
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
  plan,
  saving,
  onOpenChapter,
  onCreateChapter,
  onSaveChapter,
  onReorderChapters,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onOpenChapter: (chapter: Chapter) => void;
  onCreateChapter: (actId?: string | null) => void;
  onSaveChapter: (input: UpsertChapterInput) => void;
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
  const lanes = chapterLanesForPlan(plan);
  const totalWords = plannedWordsForChapters(plan.chapters);
  const draggedChapterId = chapterDrag?.chapterId ?? null;
  const dropTarget = chapterDrag?.dropTarget ?? null;

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
              <p className="eyebrow">Rozdziały</p>
              <h3>Mapa rozdziałów według aktów</h3>
              <p>
                {plan.chapters.length} rozdz. / {totalWords.toLocaleString("pl-PL")} słów
                planowanych
              </p>
            </div>
          </div>
          <div className="chapter-board-actions">
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
              onGenerate={() => onGenerate("chapterPlan")}
              onActivatePrompt={() => onActivatePrompt("chapterPlan")}
            />
          </div>
        </div>

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
  onOpenRelationPicker: (kind: ChapterRelationKind) => void;
  onUpdateRelations: (threadIds: string[], beatIds: string[]) => void;
}) {
  const beats = beatsForChapter(plan, chapter);
  const threads = threadsForChapter(plan, chapter);
  const beatIds = beats.map((beat) => beat.id);
  const threadIds = threads.map((thread) => thread.id);
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
      <span className="chapter-card-topline">
        <span className="chapter-number-badge">{number}</span>
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
        <span>{formatWordCount(chapter.targetWordCount)}</span>
      </span>
      <strong>{chapter.workingTitle}</strong>
      <p>{chapter.summary || "Brak streszczenia rozdziału."}</p>
      <span className="chapter-card-field">
        <b>Cel</b>
        {chapter.purpose || "Brak"}
      </span>
      <span className="chapter-card-field">
        <b>Konflikt</b>
        {chapter.conflict || "Brak"}
      </span>
      <span className="chapter-card-field">
        <b>Punkt zwrotny</b>
        {chapter.turningPoint || "Brak"}
      </span>
      <span className="chapter-chip-row">
        {beats.map((beat) => (
          <span className="chapter-chip beat" key={beat.id} title={beatPreviewText(beat)}>
            {beat.name}
            <button
              type="button"
              className="chapter-chip-remove"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onUpdateRelations(
                  threadIds,
                  beatIds.filter((beatId) => beatId !== beat.id)
                );
              }}
              aria-label={`Odepnij beat ${beat.name}`}
              title={`Odepnij beat ${beat.name}`}
            >
              -
            </button>
          </span>
        ))}
        {threads.map((thread) => (
          <span
            className="chapter-chip thread"
            key={thread.id}
            title={thread.description || "Brak opisu wątku."}
          >
            {thread.name}
            <button
              type="button"
              className="chapter-chip-remove"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onUpdateRelations(
                  threadIds.filter((threadId) => threadId !== thread.id),
                  beatIds
                );
              }}
              aria-label={`Odepnij wątek ${thread.name}`}
              title={`Odepnij wątek ${thread.name}`}
            >
              -
            </button>
          </span>
        ))}
        <button
          type="button"
          className="chapter-card-relation-add-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenRelationPicker("beats");
          }}
          aria-label={`Dodaj beat do rozdziału ${chapter.workingTitle}`}
          title="Dodaj beat"
        >
          <Plus size={13} />
          <span>Beat</span>
        </button>
        <button
          type="button"
          className="chapter-card-relation-add-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenRelationPicker("threads");
          }}
          aria-label={`Dodaj wątek do rozdziału ${chapter.workingTitle}`}
          title="Dodaj wątek"
        >
          <Plus size={13} />
          <span>Wątek</span>
        </button>
      </span>
    </article>
  );
}

function ChapterEditModal({
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
  onDelete: (item: SelectedPlanItem) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: Act | Beat | PlotThread | Chapter) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) => void;
}) {
  const chapter =
    state?.mode === "edit"
      ? plan.chapters.find((candidate) => candidate.id === state.chapterId)
      : undefined;

  useEffect(() => {
    if (!state) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, onClose]);

  if (!state) {
    return null;
  }

  const modalTitle =
    state.mode === "edit" && chapter
      ? `Rozdział ${dynamicChapterNumber(plan, chapter.id)}: ${chapter.workingTitle}`
      : "Nowy rozdział";
  const modal = (
    <div
      className="chapter-edit-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-edit-title"
    >
      <button
        type="button"
        className="chapter-edit-backdrop"
        onClick={onClose}
        aria-label="Zamknij edycję rozdziału"
      />
      <div className="chapter-edit-shell">
        <header className="chapter-edit-header">
          <div>
            <p className="eyebrow">Edycja rozdziału</p>
            <h3 id="chapter-edit-title">{modalTitle}</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Zamknij edycję rozdziału"
            title="Zamknij edycję rozdziału"
          >
            <X size={18} />
          </button>
        </header>
        <div className="chapter-edit-body">
          <ChapterForm
            bookId={bookId}
            chapter={chapter}
            plan={plan}
            saving={saving}
            orderIndex={plan.chapters.length}
            initialActId={state.mode === "create" ? state.actId : undefined}
            onCancel={onClose}
            onSave={onSave}
            onDelete={chapter ? () => onDelete({ type: "chapter", id: chapter.id }) : undefined}
            onGenerate={(field) => onGenerate(field, chapter)}
            onActivatePrompt={(field) => onActivatePrompt(field, chapter)}
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

function ChapterForm({
  bookId,
  chapter,
  plan,
  orderIndex = 0,
  initialActId,
  saving,
  onSave,
  onCancel,
  onDelete,
  onSelect,
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
  onCancel: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: Act | Beat | PlotThread | Chapter) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) => void;
}) {
  const chapterThreadIds = plan.chapterThreads
    .filter((item) => item.chapterId === chapter?.id)
    .map((item) => item.threadId);
  const chapterBeatIds = plan.chapterBeats
    .filter((item) => item.chapterId === chapter?.id)
    .map((item) => item.beatId);
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
  const completionItems = [
    { label: "Tytuł roboczy", complete: Boolean(workingTitle.trim()) },
    { label: "Akt", complete: Boolean(actId) },
    { label: "Streszczenie", complete: Boolean(summary.trim()) },
    { label: "Cel", complete: Boolean(purpose.trim()) },
    { label: "Konflikt", complete: Boolean(conflict.trim()) },
    { label: "Punkt zwrotny", complete: Boolean(turningPoint.trim()) },
    { label: "Beaty", complete: beatIds.length > 0 },
    { label: "Wątki", complete: threadIds.length > 0 }
  ];
  const completedItems = completionItems.filter((item) => item.complete).length;
  const completionPercent = Math.round((completedItems / completionItems.length) * 100);
  const visualStatus =
    completionPercent >= 88
      ? "Gotowy do pisania"
      : completionPercent >= 50
        ? "W trakcie"
        : "Szkic";
  const openChapterLabel = chapter ? `Otwórz rozdział ${chapter.workingTitle}` : "";

  return (
    <form className="chapter-edit-form" onSubmit={submit}>
      <div className="chapter-edit-metrics" aria-label="Najważniejsze informacje o rozdziale">
        <span className="chapter-edit-metric">
          <BookOpen size={16} />
          <span>Akt:</span>
          <strong>{selectedAct?.name ?? "Bez aktu"}</strong>
        </span>
        <span className="chapter-edit-metric">
          <Hash size={16} />
          <span>Numer:</span>
          <strong>{dynamicNumber}</strong>
        </span>
        <span className="chapter-edit-metric">
          <Target size={16} />
          <span>Cel słów:</span>
          <strong>{targetWords ? targetWords.toLocaleString("pl-PL") : "Brak"}</strong>
        </span>
        <span
          className={
            completionPercent >= 88
              ? "chapter-status-pill ready"
              : completionPercent >= 50
                ? "chapter-status-pill active"
                : "chapter-status-pill"
          }
        >
          <Circle size={10} />
          {visualStatus}
        </span>
      </div>

      <div className="chapter-edit-content-grid">
        <main className="chapter-edit-main">
          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <LayoutList size={17} />
              <h4>Treść rozdziału</h4>
            </div>
            <div className="chapter-field-stack">
              <PlanInlineField
                label="Streszczenie"
                value={summary}
                rows={4}
                field="chapterSummary"
                entity={chapter}
                onChange={setSummary}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label="Cel"
                value={purpose}
                rows={3}
                field="chapterPurpose"
                entity={chapter}
                onChange={setPurpose}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label="Konflikt"
                value={conflict}
                rows={3}
                field="chapterConflict"
                entity={chapter}
                onChange={setConflict}
                onGenerate={onGenerate}
                onActivatePrompt={onActivatePrompt}
              />
              <PlanInlineField
                label="Punkt zwrotny"
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
        </main>

        <aside className="chapter-edit-sidebar" aria-label="Powiązania rozdziału">
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Link2 size={16} />
              <h4>Powiązane wątki</h4>
              <ChapterRelationActions
                field="chapterThreadSuggestions"
                chapter={chapter}
                onGenerate={() => onGenerate("chapterThreadSuggestions", chapter)}
                onActivatePrompt={() => onActivatePrompt("chapterThreadSuggestions", chapter)}
                onOpenPicker={() => setRelationPicker("threads")}
              />
            </div>
            <div className="chapter-side-chip-list">
              {selectedThreads.length > 0 ? (
                selectedThreads.map((thread) => (
                  <span
                    className="chapter-side-chip thread"
                    key={thread.id}
                    title={thread.description || "Brak opisu wątku."}
                  >
                    {thread.name}
                    <button
                      type="button"
                      className="chapter-side-chip-remove"
                      onClick={() =>
                        setThreadIds((currentIds) =>
                          currentIds.filter((threadId) => threadId !== thread.id)
                        )
                      }
                      aria-label={`Odepnij wątek ${thread.name}`}
                      title={`Odepnij wątek ${thread.name}`}
                    >
                      -
                    </button>
                  </span>
                ))
              ) : (
                <span className="chapter-side-empty">Brak powiązanych wątków</span>
              )}
            </div>
          </section>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Route size={16} />
              <h4>Powiązane beaty</h4>
              <ChapterRelationActions
                field="chapterBeatSuggestions"
                chapter={chapter}
                onGenerate={() => onGenerate("chapterBeatSuggestions", chapter)}
                onActivatePrompt={() => onActivatePrompt("chapterBeatSuggestions", chapter)}
                onOpenPicker={() => setRelationPicker("beats")}
              />
            </div>
            <div className="chapter-side-chip-list">
              {selectedBeats.length > 0 ? (
                selectedBeats.map((beat) => (
                  <span
                    className="chapter-side-chip beat"
                    key={beat.id}
                    title={beatPreviewText(beat)}
                  >
                    {beat.name}
                    <button
                      type="button"
                      className="chapter-side-chip-remove"
                      onClick={() =>
                        setBeatIds((currentIds) =>
                          currentIds.filter((beatId) => beatId !== beat.id)
                        )
                      }
                      aria-label={`Odepnij beat ${beat.name}`}
                      title={`Odepnij beat ${beat.name}`}
                    >
                      -
                    </button>
                  </span>
                ))
              ) : (
                <span className="chapter-side-empty">Brak powiązanych beatów</span>
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

      <footer className="chapter-edit-footer">
        <div className="chapter-footer-status">
          <CheckCircle2 size={16} />
          <span>
            {completedItems} / {completionItems.length} elementów planu uzupełnionych
          </span>
        </div>
        <div className="chapter-footer-actions">
          {onDelete ? (
            <button type="button" className="ghost-button chapter-delete-button" onClick={onDelete}>
              <Trash2 size={16} />
              Usuń
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onCancel}>
            Anuluj
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={16} />
            {saving ? "Zapisuję" : "Zapisz zmiany"}
          </button>
          {onSelect && openChapterLabel ? (
            <button
              type="button"
              className="icon-button"
              onClick={onSelect}
              aria-label={openChapterLabel}
              title={openChapterLabel}
            >
              <Pencil size={16} />
            </button>
          ) : null}
        </div>
      </footer>
    </form>
  );
}

function ChapterRelationActions({
  field,
  chapter,
  onGenerate,
  onActivatePrompt,
  onOpenPicker
}: {
  field: Extract<PlanFieldKey, "chapterThreadSuggestions" | "chapterBeatSuggestions">;
  chapter?: Chapter;
  onGenerate: () => void;
  onActivatePrompt: () => void;
  onOpenPicker: () => void;
}) {
  const proposals = useProposalStore((state) => state.proposals);
  const loading = pendingProposalStatus(proposals, {
    field,
    scope: "bookPlan"
  });
  const running = loading === "running";
  const queued = loading === "queued";
  const label = planFieldConfigs[field].label;

  return (
    <span className="chapter-relation-actions">
      <button
        type="button"
        className="icon-button ai-field-button chapter-relation-ai-button"
        onClick={onGenerate}
        onFocus={onActivatePrompt}
        disabled={!chapter || queued || running}
        title={
          chapter
            ? `Zasugeruj ${label.toLowerCase()} z AI`
            : "Zapisz rozdział, aby AI mogło zasugerować powiązania."
        }
        aria-label={
          chapter
            ? `Zasugeruj ${label.toLowerCase()} z AI`
            : "Zapisz rozdział przed sugestią AI"
        }
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
        className="icon-button chapter-relation-add-button"
        onClick={onOpenPicker}
        title={`Dodaj ${label.toLowerCase()}`}
        aria-label={`Dodaj ${label.toLowerCase()}`}
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
                  className={
                    checked ? "chapter-relation-option selected" : "chapter-relation-option"
                  }
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
  entity?: Act | Chapter;
  onChange: (value: string) => void;
  onGenerate: (field: PlanFieldKey, targetEntity?: Act | Beat | PlotThread | Chapter) => void;
  onActivatePrompt: (
    field: PlanFieldKey,
    targetEntity?: Act | Beat | PlotThread | Chapter
  ) => void;
}) {
  return (
    <label className="field-label plan-inline-field">
      <span className="plan-inline-label-row">
        {label}
        <PlanAiActions
          field={field}
          targetEntity={entity}
          onGenerate={() => onGenerate(field, entity)}
          onActivatePrompt={() => onActivatePrompt(field, entity)}
        />
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onActivatePrompt(field, entity)}
        rows={rows}
      />
    </label>
  );
}

function PlanAiActions({
  field,
  targetEntity,
  onGenerate,
  onActivatePrompt
}: {
  field: PlanFieldKey;
  targetEntity?: Act | Beat | PlotThread | Chapter;
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
  const loading = pendingProposalStatus(proposals, {
    field,
    scope: "bookPlan"
  });
  const running = loading === "running";
  const queued = loading === "queued";
  const fieldAlreadyInContext = Boolean(
    activeTarget?.sources.some((source) => source.key === field)
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
        onClick={(event) => {
          event.stopPropagation();
          addContextSourceToActiveTarget(planPromptContextSource(field));
        }}
        onFocus={onActivatePrompt}
        disabled={!activeTarget || fieldAlreadyInContext}
        title="Dodaj pole planu do aktywnego kontekstu promptu."
        aria-label={`Dodaj ${planFieldConfigs[field].label} do kontekstu promptu`}
      >
        <Plus size={14} />
      </button>
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
                    <span>Rozdział {dynamicChapterNumber(plan, chapter.id)}</span>
                    <strong>{chapter.workingTitle}</strong>
                    <small>{chapter.targetWordCount ?? 0} słów</small>
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
        <button type="button" className="ghost-button" onClick={onDelete}>
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
const chapterDragActivationDistance = 6;

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

function actIdFromLaneElement(element: HTMLElement | null): string | null {
  if (!element || element.dataset.laneId === withoutActLaneId) {
    return null;
  }

  return element.dataset.actId || null;
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

function beatBoardLanesForPlan(plan: BookPlan, beats: Beat[]): BeatBoardLane[] {
  const actIds = new Set(plan.acts.map((act) => act.id));
  const lanes: BeatBoardLane[] = plan.acts.map((act) => ({
    id: act.id,
    actId: act.id,
    name: act.name,
    color: act.color,
    rangeLabel: `${act.startPercent}-${act.endPercent}%`,
    beats: beats.filter((beat) => beat.actId === act.id)
  }));
  const unassignedBeats = beats.filter((beat) => !beat.actId || !actIds.has(beat.actId));

  if (unassignedBeats.length > 0 || lanes.length === 0) {
    lanes.push({
      id: "without-act",
      actId: null,
      name: "Bez aktu",
      color: "#8a9791",
      rangeLabel: "Poza aktami",
      beats: unassignedBeats
    });
  }

  return lanes;
}

function beatThreadIdsForBeat(plan: BookPlan, beatId: string): string[] {
  return plan.beatThreads
    .filter((relation) => relation.beatId === beatId)
    .map((relation) => relation.threadId);
}

function threadsForBeat(plan: BookPlan, beat: Beat): PlotThread[] {
  const threadIds = new Set(beatThreadIdsForBeat(plan, beat.id));

  return plan.threads.filter((thread) => threadIds.has(thread.id));
}

function beatsForThread(plan: BookPlan, thread: PlotThread): Beat[] {
  const beatIds = new Set(
    plan.beatThreads
      .filter((relation) => relation.threadId === thread.id)
      .map((relation) => relation.beatId)
  );

  return plan.beats.filter((beat) => beatIds.has(beat.id));
}

function actsForThread(plan: BookPlan, thread: PlotThread): Act[] {
  const actIds = new Set<string>();

  for (const beat of beatsForThread(plan, thread)) {
    if (beat.actId) {
      actIds.add(beat.actId);
    }
  }

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
    return beat
      ? {
          title: beat.name,
          description: beat.description,
          meta: [
            { label: "Rola", value: beat.role || "Brak" },
            { label: "Akt", value: plan.acts.find((act) => act.id === beat.actId)?.name ?? "Brak" }
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
  return {
    structure: null,
    acts: [],
    beats: [],
    threads: [],
    chapters: [],
    chapterThreads: [],
    beatThreads: [],
    chapterBeats: []
  };
}

function isPlanReady(plan: BookPlan): boolean {
  return plan.acts.length > 0 && plan.chapters.length > 0;
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
    "chapterSummary",
    "chapterPurpose",
    "chapterConflict",
    "chapterTurningPoint",
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
