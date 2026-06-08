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
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
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

type PlanStep = "structure" | "acts" | "beats" | "threads" | "chapters";
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
type BeatSortMode = "order" | "name" | "role";
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
  { key: "beats", label: "Beaty", icon: Target },
  { key: "threads", label: "Wątki", icon: GitBranch },
  { key: "chapters", label: "Rozdziały", icon: FileText }
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
    ) : activeStep === "threads" ? (
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
    ) : (
      <ChaptersStep
        bookId={bookId}
        plan={plan}
        saving={chapterMutation.isPending}
        onOpenChapter={openChapterModal}
        onCreateChapter={openNewChapterModal}
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
                                <em key={chapter.id}>{chapter.number}</em>
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
  return (
    <PlanCard
      title="Wątki"
      icon={<GitBranch size={18} />}
      action={
        <PlanAiActions
          field="plotThreads"
          onGenerate={() => onGenerate("plotThreads")}
          onActivatePrompt={() => onActivatePrompt("plotThreads")}
        />
      }
    >
      <div className="plan-grid-list compact">
        {plan.threads.map((thread) => (
          <ThreadForm
            key={thread.id}
            bookId={bookId}
            thread={thread}
            saving={saving}
            onSave={onSave}
            onDelete={() => onDelete({ type: "thread", id: thread.id })}
            onSelect={() => onSelect({ type: "thread", id: thread.id })}
          />
        ))}
        <ThreadForm
          bookId={bookId}
          saving={saving}
          orderIndex={plan.threads.length}
          onSave={onSave}
        />
      </div>
    </PlanCard>
  );
}

function ThreadForm({
  bookId,
  thread,
  orderIndex = 0,
  saving,
  onSave,
  onDelete,
  onSelect
}: {
  bookId: string;
  thread?: PlotThread;
  orderIndex?: number;
  saving: boolean;
  onSave: (input: UpsertPlotThreadInput) => void;
  onDelete?: () => void;
  onSelect?: () => void;
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
    <form className="plan-entity-card" onSubmit={submit}>
      <button
        type="button"
        className="plan-link-title"
        onClick={onSelect}
        disabled={!thread}
        aria-label={thread ? `Otwórz wątek ${thread.name}` : "Nowy wątek"}
      >
        <span style={{ background: color }} />
        {thread ? thread.name : "Nowy wątek"}
      </button>
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
      <EntityActions saving={saving} onDelete={onDelete} />
    </form>
  );
}

function ChaptersStep({
  plan,
  onOpenChapter,
  onCreateChapter,
  onGenerate,
  onActivatePrompt
}: StepProps & {
  onOpenChapter: (chapter: Chapter) => void;
  onCreateChapter: (actId?: string | null) => void;
}) {
  const chapterActRailRef = useRef<HTMLDivElement>(null);
  const chapterBoardRef = useRef<HTMLDivElement>(null);
  const lanes = chapterLanesForPlan(plan);
  const totalWords = plannedWordsForChapters(plan.chapters);

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
            <section className="chapter-act-column" key={lane.id}>
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
                      plan={plan}
                      onOpen={() => onOpenChapter(chapter)}
                    />
                  ))
                ) : (
                  <p className="muted-text chapter-empty-note">
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
    </section>
  );
}

function ChapterBoardCard({
  chapter,
  plan,
  onOpen
}: {
  chapter: Chapter;
  plan: BookPlan;
  onOpen: () => void;
}) {
  const beats = beatsForChapter(plan, chapter);
  const threads = threadsForChapter(plan, chapter);

  return (
    <button
      type="button"
      className="chapter-board-card"
      onClick={onOpen}
      aria-label={`Otwórz rozdział ${chapter.workingTitle}`}
    >
      <span className="chapter-card-topline">
        <span className="chapter-number-badge">{chapter.number}</span>
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
        {beats.slice(0, 2).map((beat) => (
          <span className="chapter-chip beat" key={beat.id}>
            {beat.name}
          </span>
        ))}
        {threads.slice(0, 2).map((thread) => (
          <span className="chapter-chip thread" key={thread.id}>
            {thread.name}
          </span>
        ))}
        {beats.length + threads.length > 4 ? (
          <span className="chapter-chip muted">+{beats.length + threads.length - 4}</span>
        ) : null}
      </span>
    </button>
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
      ? `Rozdział ${chapter.number}: ${chapter.workingTitle}`
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
  const [number, setNumber] = useState(chapter?.number ?? orderIndex + 1);
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

  useEffect(() => {
    setNumber(chapter?.number ?? orderIndex + 1);
    setWorkingTitle(chapter?.workingTitle ?? `Rozdział ${orderIndex + 1}`);
    setSummary(chapter?.summary ?? "");
    setPurpose(chapter?.purpose ?? "");
    setConflict(chapter?.conflict ?? "");
    setTurningPoint(chapter?.turningPoint ?? "");
    setTargetWordCount(chapter?.targetWordCount?.toString() ?? "");
    setActId(chapter?.actId ?? defaultChapterActId(initialActId, plan));
    setThreadIds(chapterThreadIds);
    setBeatIds(chapterBeatIds);
  }, [
    chapter?.number,
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
      number,
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
  const summaryPreview =
    summary.trim() ||
    "Dodaj krótkie streszczenie, aby podgląd rozdziału pomagał ocenić kierunek scen.";
  const purposePreview =
    purpose.trim() ||
    "Określ, co rozdział ma zmienić w historii, wiedzy bohatera albo napięciu fabularnym.";
  const notesPreview =
    conflict.trim() || turningPoint.trim()
      ? [conflict.trim(), turningPoint.trim()].filter(Boolean).join(" ")
      : "Konflikt i punkt zwrotny utworzą tu szybką notatkę kontrolną.";
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
          <strong>{number || 1}</strong>
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
              <FileText size={17} />
              <h4>Podstawy</h4>
            </div>
            <div className="chapter-basic-grid">
              <label className="field-label">
                Numer
                <input
                  type="number"
                  min={1}
                  value={number}
                  onChange={(event) => setNumber(Number(event.target.value))}
                />
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
              <label className="field-label chapter-title-field">
                Tytuł roboczy
                <input
                  value={workingTitle}
                  onChange={(event) => setWorkingTitle(event.target.value)}
                />
              </label>
              <label className="field-label">
                Cel słów
                <input
                  inputMode="numeric"
                  value={targetWordCount}
                  onChange={(event) => setTargetWordCount(event.target.value)}
                />
              </label>
            </div>
          </section>

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

          <section className="chapter-edit-section">
            <div className="chapter-section-heading">
              <ClipboardList size={17} />
              <h4>Beaty i znaczniki</h4>
            </div>
            <div className="chapter-relation-grid">
              <RelationPicker
                label="Beaty"
                items={plan.beats}
                selectedIds={beatIds}
                onChange={setBeatIds}
              />
              <RelationPicker
                label="Wątki"
                items={plan.threads}
                selectedIds={threadIds}
                onChange={setThreadIds}
              />
            </div>
          </section>
        </main>

        <aside className="chapter-edit-sidebar" aria-label="Podgląd rozdziału">
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Eye size={16} />
              <h4>Podgląd rozdziału</h4>
            </div>
            <p>{summaryPreview}</p>
          </section>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Target size={16} />
              <h4>Rola w akcji</h4>
            </div>
            <p>{purposePreview}</p>
          </section>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <Link2 size={16} />
              <h4>Powiązane wątki</h4>
            </div>
            <div className="chapter-side-chip-list">
              {selectedThreads.length > 0 ? (
                selectedThreads.map((thread) => (
                  <span className="chapter-side-chip thread" key={thread.id}>
                    {thread.name}
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
            </div>
            <div className="chapter-side-chip-list">
              {selectedBeats.length > 0 ? (
                selectedBeats.map((beat) => (
                  <span className="chapter-side-chip beat" key={beat.id}>
                    {beat.name}
                  </span>
                ))
              ) : (
                <span className="chapter-side-empty">Brak powiązanych beatów</span>
              )}
            </div>
          </section>
          <section className="chapter-side-section">
            <div className="chapter-side-heading">
              <ClipboardList size={16} />
              <h4>Lista kontrolna</h4>
            </div>
            <ul className="chapter-checklist">
              {completionItems.map((item) => (
                <li className={item.complete ? "complete" : undefined} key={item.label}>
                  {item.complete ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="chapter-side-note">{notesPreview}</p>
            <div className="chapter-progress-row">
              <span>Postęp rozdziału</span>
              <strong>{completionPercent}%</strong>
            </div>
            <div className="chapter-progress-track" aria-hidden="true">
              <span style={{ width: `${completionPercent}%` }} />
            </div>
          </section>
        </aside>
      </div>

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
                    <span>Rozdział {chapter.number}</span>
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
                {plan.chapters.map((chapter) => {
                  const linked = plan.chapterThreads.some(
                    (item) => item.chapterId === chapter.id && item.threadId === thread.id
                  );
                  return (
                    <button
                      type="button"
                      key={chapter.id}
                      className={linked ? "thread-node linked" : "thread-node"}
                      onClick={() => onSelect({ type: "chapter", id: chapter.id })}
                      aria-label={`${thread.name} w rozdziale ${chapter.number}`}
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

  if (unassigned.length > 0 || lanes.length === 0) {
    lanes.push({
      id: "without-act",
      actId: null,
      name: "Bez aktu",
      color: "#8a9791",
      purpose: "Rozdziały czekające na przypisanie do aktu.",
      rangeLabel: "Poza aktami",
      chapters: unassigned
    });
  }

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

function chaptersForBeat(plan: BookPlan, beat: Beat): Chapter[] {
  const chapterIds = new Set(
    plan.chapterBeats
      .filter((relation) => relation.beatId === beat.id)
      .map((relation) => relation.chapterId)
  );

  return plan.chapters.filter((chapter) => chapterIds.has(chapter.id));
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
  const threadIds = new Set(
    plan.chapterThreads
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.threadId)
  );

  return plan.threads.filter((thread) => threadIds.has(thread.id));
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
          title: `Rozdział ${chapter.number}: ${chapter.workingTitle}`,
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
  return plan.chapters.filter((chapter) => chapter.actId === actId);
}

function chaptersWithoutAct(plan: BookPlan): Chapter[] {
  return plan.chapters.filter((chapter) => !chapter.actId);
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
    "chapterTurningPoint"
  ].includes(field);
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed.replace(/\s+/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
