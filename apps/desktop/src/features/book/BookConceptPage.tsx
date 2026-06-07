import {
  Clock3,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Sparkles,
  X
} from "lucide-react";
import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkCodexCli,
  getProject,
  updateBookConcept
} from "../../shared/api/commands";
import type { BookConceptInput } from "../../shared/api/types";
import { coverImageSource } from "../../shared/api/assets";
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
import {
  buildBookCoverPromptPackage,
  renderBookCoverPromptPackage
} from "../ai/coverPromptPackage";
import { CoverImageLightbox } from "../ai/CoverImageLightbox";
import {
  buildConceptFieldPromptPackage,
  conceptFieldConfigs,
  conceptFieldMaxResponseCharacters,
  conceptPromptContextSource,
  ConceptFieldKey,
  renderPromptPackage
} from "../ai/promptPackage";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import {
  createConceptPromptContextTarget,
  conceptPromptContextTargetId,
  promptContextControlForTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import {
  AiProposalStatus,
  BOOK_COVER_FIELD,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";

type BookConceptPageProps = {
  projectId: string;
};

type ConceptForm = {
  title: string;
  workingTitle: string;
  premise: string;
  protagonistSummary: string;
  protagonistGoal: string;
  expandedPremise: string;
  logline: string;
  centralConflict: string;
  antagonistForce: string;
  stakes: string;
  settingSketch: string;
  endingDirection: string;
  genre: string;
  subgenre: string;
  targetAudience: string;
  tone: string;
  pointOfView: string;
  targetWordCount: string;
  themesJson: string;
  unwantedThemes: string;
  alternativeTitlesJson: string;
  styleGuide: string;
};

type ConceptStageKey =
  | "idea"
  | "storyEngine"
  | "readerForm"
  | "rules"
  | "cover";

type ConceptStage = {
  key: ConceptStageKey;
  title: string;
  summary: string;
  fields: (keyof ConceptForm)[];
};

type ChoiceOption = {
  value: string;
  hint: string;
};

const ConceptPromptContext = createContext<(field: ConceptFieldKey) => void>(
  () => undefined
);

const emptyForm: ConceptForm = {
  title: "",
  workingTitle: "",
  premise: "",
  protagonistSummary: "",
  protagonistGoal: "",
  expandedPremise: "",
  logline: "",
  centralConflict: "",
  antagonistForce: "",
  stakes: "",
  settingSketch: "",
  endingDirection: "",
  genre: "",
  subgenre: "",
  targetAudience: "",
  tone: "",
  pointOfView: "",
  targetWordCount: "",
  themesJson: "",
  unwantedThemes: "",
  alternativeTitlesJson: "",
  styleGuide: ""
};

const fieldHints: Record<ConceptFieldKey, string> = {
  title: "Kandydat na tytuł do okładki, eksportu i prezentacji projektu.",
  workingTitle: "Robocza nazwa projektu, która pomaga rozpoznać książkę zanim powstanie finalny tytuł.",
  premise: "Krótka obietnica historii: kto, czego chce, co mu przeszkadza i dlaczego to ważne.",
  protagonistSummary: "Najważniejsza postać prowadząca historię; kim jest na starcie i dlaczego to ona niesie książkę.",
  protagonistGoal: "Konkretne zewnętrzne dążenie, które popycha fabułę do przodu.",
  expandedPremise: "Jeden akapit łączący rdzeń pomysłu, konflikt i przewidywany kierunek książki.",
  logline: "Jedno zwarte zdanie komunikujące bohatera, cel, przeszkodę i stawkę.",
  centralConflict: "Główne napięcie, które napędza decyzje bohatera i strukturę fabuły.",
  antagonistForce: "Antagonista, system, problem, tajemnica albo wewnętrzna blokada stojąca na drodze bohatera.",
  stakes: "To, co bohater, relacje albo świat tracą, jeśli cel nie zostanie osiągnięty.",
  settingSketch: "Miejsce, czas i podstawowe warunki świata, które realnie wpływają na konflikt.",
  endingDirection: "Robocza odpowiedź, dokąd historia ma emocjonalnie lub fabularnie dojść.",
  genre: "Główna konwencja, która ustawia oczekiwania czytelnika.",
  subgenre: "Doprecyzowanie obietnicy gatunkowej lub mieszanki konwencji.",
  targetAudience: "Grupa czytelników, pod którą dopasowujemy język, tempo, poziom mroku i złożoność.",
  tone: "Dominujący nastrój narracji i scen.",
  pointOfView: "Perspektywa i tryb narracji, które będą prowadzić sceny.",
  targetWordCount: "Orientacyjna długość książki używana później do planowania rozdziałów i tempa.",
  themesJson: "Główne idee, które mają wracać w postaciach, konflikcie i scenach.",
  unwantedThemes: "Treści, których AI i autor mają unikać w dalszej pracy.",
  alternativeTitlesJson: "Lista wariantów do porównania przed wyborem finalnym.",
  styleGuide: "Praktyczne zasady języka, rytmu, dialogu, opisów, humoru, mroku i zakazów stylistycznych."
};

const conceptStages: ConceptStage[] = [
  {
    key: "idea",
    title: "Pomysł",
    summary: "Rdzeń projektu, główna postać i świat, w którym konflikt ma sens.",
    fields: [
      "workingTitle",
      "premise",
      "protagonistSummary",
      "protagonistGoal",
      "settingSketch"
    ]
  },
  {
    key: "storyEngine",
    title: "Silnik historii",
    summary: "Napięcie, przeszkoda, stawki i roboczy kierunek finału.",
    fields: [
      "logline",
      "centralConflict",
      "antagonistForce",
      "stakes",
      "endingDirection",
      "expandedPremise"
    ]
  },
  {
    key: "readerForm",
    title: "Czytelnik i forma",
    summary: "Konwencja, odbiorca, ton, perspektywa i skala książki.",
    fields: [
      "genre",
      "subgenre",
      "targetAudience",
      "tone",
      "pointOfView",
      "targetWordCount"
    ]
  },
  {
    key: "rules",
    title: "Motywy i zasady",
    summary: "Tematy, granice i styl, które utrzymają późniejsze generacje w ryzach.",
    fields: ["themesJson", "unwantedThemes", "styleGuide"]
  },
  {
    key: "cover",
    title: "Okładka",
    summary: "Finalny tytuł, warianty tytułu i opcjonalna robocza okładka.",
    fields: ["title", "alternativeTitlesJson"]
  }
];

const genreOptions: ChoiceOption[] = [
  { value: "fantasy", hint: "Magia, reguły świata, obietnica niezwykłości." },
  { value: "kryminal", hint: "Zagadka, tropy, śledztwo i ujawnianie prawdy." },
  { value: "obyczajowa", hint: "Relacje, codzienność i emocjonalna przemiana." },
  { value: "thriller", hint: "Presja czasu, zagrożenie i wysokie napięcie." },
  { value: "horror", hint: "Lęk, niepewność i narastające poczucie grozy." },
  { value: "science fiction", hint: "Technologia, spekulacja i konsekwencje idei." },
  { value: "romans", hint: "Relacja uczuciowa jako główna oś napięcia." },
  { value: "realizm magiczny", hint: "Niezwykłość traktowana jak codzienność." }
];

const subgenreOptions: ChoiceOption[] = [
  { value: "dark academia", hint: "Sekrety, instytucje i intelektualny mrok." },
  { value: "cozy mystery", hint: "Zagadka bez brutalności na pierwszym planie." },
  { value: "urban fantasy", hint: "Niezwykłość wpisana we współczesne miasto." },
  { value: "space opera", hint: "Szeroka skala, przygoda i konflikt systemów." },
  { value: "slow burn romance", hint: "Relacja budowana przez dłuższe napięcie." }
];

const audienceOptions: ChoiceOption[] = [
  { value: "adult", hint: "Dorosły czytelnik, większa złożoność i tematy." },
  { value: "YA", hint: "Młodzi dorośli, szybkie tempo i silna identyfikacja." },
  { value: "new adult", hint: "Wejście w dorosłość, relacje i niezależność." },
  { value: "middle grade", hint: "Młodsi czytelnicy, przygoda i klarowny konflikt." },
  { value: "dzieci", hint: "Prostszy język, bezpieczniejsze tematy i wyraźny rytm." },
  { value: "fani kryminału", hint: "Czytelnicy oczekujący tropów, zwrotów i fair play." },
  { value: "fani fantasy", hint: "Czytelnicy lubiący świat, mitologię i konsekwencje magii." }
];

const toneOptions: ChoiceOption[] = [
  { value: "mroczny", hint: "Cięższy nastrój, tajemnica i moralne koszty." },
  { value: "ciepły", hint: "Bliskość, nadzieja i empatia wobec postaci." },
  { value: "ironiczny", hint: "Dystans, błyskotliwość i podważający narrator." },
  { value: "liryczny", hint: "Obrazowy język, rytm i emocjonalna gęstość." },
  { value: "napięty", hint: "Presja i ciągłe pytanie co dalej." },
  { value: "kameralny", hint: "Mniejsza skala, intymne sceny i relacje." },
  { value: "epicki", hint: "Szeroka skala, wysokie stawki i rozmach." },
  { value: "humorystyczny", hint: "Lekki rytm, komizm sytuacyjny lub dialogowy." }
];

const pointOfViewOptions: ChoiceOption[] = [
  { value: "pierwsza osoba", hint: "Blisko emocji i subiektywnej narracji." },
  { value: "trzecia osoba ograniczona", hint: "Blisko POV, ale z większą kontrolą dystansu." },
  { value: "trzecia osoba wszechwiedząca", hint: "Szersza skala i swobodny przegląd świata." },
  { value: "wielu POV", hint: "Kilka perspektyw w jednej strukturze." },
  { value: "czas teraźniejszy", hint: "Natychmiastowość i mocniejszy puls scen." },
  { value: "czas przeszły", hint: "Klasyczny rytm narracyjny." }
];

const themeOptions: ChoiceOption[] = [
  { value: "tożsamość", hint: "Kim jest bohater, kiedy odpadają role." },
  { value: "pamięć", hint: "Co zostaje z prawdy po czasie i manipulacji." },
  { value: "władza", hint: "Koszt kontroli nad innymi." },
  { value: "rodzina", hint: "Więzi, lojalność i dziedziczone rany." },
  { value: "wolność", hint: "Cena samostanowienia." },
  { value: "zdrada", hint: "Pęknięcie zaufania i jego konsekwencje." }
];

export function BookConceptPage({ projectId }: BookConceptPageProps) {
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore(
    (state) => state.activateTarget
  );
  const resetPromptContextDraft = useAiPromptContextStore(
    (state) => state.resetDraft
  );
  const [form, setForm] = useState<ConceptForm>(emptyForm);
  const activeStage = useProjectNavigationStore((state) =>
    normalizeConceptStage(state.viewState[projectId]?.conceptStage)
  );
  const setProjectViewState = useProjectNavigationStore(
    (state) => state.setProjectViewState
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [aiError, setAiError] = useState("");
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });

  const codexStatusQuery = useQuery({
    queryKey: ["codex-cli", codexPath],
    queryFn: () => checkCodexCli(codexPath),
    retry: 0
  });

  useEffect(() => {
    if (!projectQuery.data) {
      return;
    }

    const { book } = projectQuery.data;
    setForm({
      title: book.title,
      workingTitle: book.workingTitle,
      premise: book.premise,
      protagonistSummary: book.protagonistSummary ?? "",
      protagonistGoal: book.protagonistGoal ?? "",
      expandedPremise: book.expandedPremise ?? "",
      logline: book.logline,
      centralConflict: book.centralConflict ?? "",
      antagonistForce: book.antagonistForce ?? "",
      stakes: book.stakes ?? "",
      settingSketch: book.settingSketch ?? "",
      endingDirection: book.endingDirection ?? "",
      genre: book.genre,
      subgenre: book.subgenre,
      targetAudience: book.targetAudience,
      tone: book.tone,
      pointOfView: book.pointOfView,
      targetWordCount: book.targetWordCount?.toString() ?? "",
      themesJson: listTextFromJson(book.themesJson ?? "[]"),
      unwantedThemes: book.unwantedThemes ?? "",
      alternativeTitlesJson: listTextFromJson(book.alternativeTitlesJson ?? "[]"),
      styleGuide: book.styleGuide
    });
  }, [projectQuery.data?.book.id, projectQuery.data?.book.updatedAt]);

  const bookForPrompt = useMemo(() => {
    if (!projectQuery.data) {
      return null;
    }

    return {
      ...projectQuery.data.book,
      title: form.title,
      workingTitle: form.workingTitle,
      premise: form.premise,
      protagonistSummary: form.protagonistSummary,
      protagonistGoal: form.protagonistGoal,
      expandedPremise: form.expandedPremise,
      logline: form.logline,
      centralConflict: form.centralConflict,
      antagonistForce: form.antagonistForce,
      stakes: form.stakes,
      settingSketch: form.settingSketch,
      endingDirection: form.endingDirection,
      genre: form.genre,
      subgenre: form.subgenre,
      targetAudience: form.targetAudience,
      tone: form.tone,
      pointOfView: form.pointOfView,
      targetWordCount: parseOptionalPositiveInt(form.targetWordCount),
      themesJson: serializeListValue(form.themesJson),
      unwantedThemes: form.unwantedThemes,
      alternativeTitlesJson: serializeListValue(form.alternativeTitlesJson),
      styleGuide: form.styleGuide
    };
  }, [form, projectQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!projectQuery.data) {
        throw new Error("Brak projektu do zapisu.");
      }

      const validation = validateConceptForm(form);
      if (validation) {
        throw new ValidationError(validation);
      }

      return updateBookConcept(projectQuery.data.book.id, conceptInputFromForm(form));
    },
    onSuccess: async () => {
      setSaveMessage("Zapisano koncepcje.");
      setValidationMessage("");
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      if (error instanceof ValidationError) {
        setValidationMessage(error.message);
      }
    }
  });

  const generateFieldMutation = useMutation({
    mutationFn: async (field: ConceptFieldKey) => {
      if (!projectQuery.data || !bookForPrompt) {
        throw new GenerationError("Brak danych projektu.");
      }

      const targetId = conceptPromptContextTargetId(projectId, field);
      const contextControl = promptContextControlForTarget(targetId);
      const promptPackage = buildConceptFieldPromptPackage(
        projectQuery.data.project,
        bookForPrompt,
        field,
        contextControl
      );
      const prompt = renderPromptPackage(promptPackage);
      const snapshot = {
        projectId,
        bookId: projectQuery.data.book.id,
        field,
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt
      };

      enqueueProposal(snapshot);
      resetPromptContextDraft(targetId);
      return null;

    },
    onSuccess: () => setAiError(""),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setAiError(message);
    }
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveMessage("");
    setValidationMessage("");
    saveMutation.mutate();
  }

  function updateField<Key extends keyof ConceptForm>(
    key: Key,
    value: ConceptForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function generateField(field: ConceptFieldKey) {
    setAiError("");
    activateFieldPromptContext(field);
    queueFieldGeneration(field);
  }

  function activateFieldPromptContext(field: ConceptFieldKey) {
    const config = conceptFieldConfigs[field];
    const loading = fieldStatus(field);

    activatePromptContextTarget(
      createConceptPromptContextTarget(projectId, field, {
        submitLabel: "Wy\u015blij do AI",
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading
          ? `Pole "${config.label}" jest ju\u017c w kolejce AI.`
          : "Codex CLI nie jest teraz gotowy.",
        onSubmit: () => queueFieldGeneration(field)
      })
    );
  }

  function queueFieldGeneration(field: ConceptFieldKey) {
    const currentStatus = pendingProposalStatus(useProposalStore.getState().proposals, {
      projectId,
      field,
      scope: "bookConcept"
    });
    if (currentStatus) {
      return;
    }

    generateFieldMutation.mutate(field);
  }

  function generateCover() {
    setAiError("");
    if (!projectQuery.data || !bookForPrompt) {
      setAiError("Brak danych projektu.");
      return;
    }

    const promptPackage = buildBookCoverPromptPackage(
      projectQuery.data.project,
      bookForPrompt
    );
    const prompt = renderBookCoverPromptPackage(promptPackage);

    enqueueProposal({
      scope: "bookCover",
      projectId,
      bookId: projectQuery.data.book.id,
      field: BOOK_COVER_FIELD,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt,
      coverPrompt: promptPackage.coverPrompt,
      coverNegativePrompt: promptPackage.negativePrompt
    });
  }

  const codexUnavailable = codexStatusQuery.data?.available === false;
  const aiDisabled = !projectQuery.data || codexUnavailable;
  const fieldStatus = (field: ConceptFieldKey): AiProposalStatus | null =>
    pendingProposalStatus(proposals, {
      projectId,
      field,
      scope: "bookConcept"
    });
  const activeBookId = projectQuery.data?.book.id;
  const coverTask = proposals
    .filter(
      (proposal) =>
        proposal.projectId === projectId &&
        proposal.bookId === activeBookId &&
        proposal.field === BOOK_COVER_FIELD
    )
    .sort(compareCoverTasksForView)[0];
  const coverStatus = pendingProposalStatus(proposals, {
    projectId,
    bookId: activeBookId,
    field: BOOK_COVER_FIELD,
    scope: "bookCover"
  });
  const coverRunning = coverStatus === "running";
  const coverQueued = coverStatus === "queued";
  const coverPending = coverRunning || coverQueued;
  const coverProgressText = coverTask?.progressMessage ?? "";
  const coverSrc = coverImageSource(
    (coverRunning ? coverTask?.partialImageDataUrl : "") ||
      projectQuery.data?.book.coverImagePath
  );
  const activeStageConfig =
    conceptStages.find((stage) => stage.key === activeStage) ?? conceptStages[0];

  return (
    <ConceptPromptContext.Provider value={activateFieldPromptContext}>
      <section className="content-panel concept-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Faza 2</p>
          <h2>Koncepcja książki</h2>
        </div>
      </div>

      {projectQuery.isError ? (
        <div className="empty-state">
          <h3>Nie można wczytać projektu</h3>
          <p>Sprawdź, czy aplikacja działa w Tauri i baza jest dostępna.</p>
        </div>
      ) : null}

      <form className="concept-form" onSubmit={handleSubmit}>
        <div className="concept-stage-tabs" role="tablist" aria-label="Etapy koncepcji">
          {conceptStages.map((stage) => {
            const completion = stageCompletion(stage, form);
            const selected = stage.key === activeStageConfig.key;
            return (
              <button
                key={stage.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? "concept-stage-tab active" : "concept-stage-tab"}
                onClick={() =>
                  setProjectViewState(projectId, "conceptStage", stage.key)
                }
              >
                <span>{stage.title}</span>
                <strong>
                  {completion.complete}/{completion.total}
                </strong>
              </button>
            );
          })}
        </div>

        <div className="concept-stage-heading">
          <p>{activeStageConfig.summary}</p>
        </div>

        <div role="tabpanel" className="concept-stage-panel">
          {activeStage === "idea" ? (
            <FormSection>
              <TextField
                label="Tytuł roboczy"
                field="workingTitle"
                value={form.workingTitle}
                placeholder="Nazwa projektu na czas pracy"
                disabled={aiDisabled}
                loading={fieldStatus("workingTitle")}
                onGenerate={generateField}
                onChange={(value) => updateField("workingTitle", value)}
              />
              <TextField
                label="Premise"
                field="premise"
                value={form.premise}
                placeholder="Kto, czego chce, co mu przeszkadza i dlaczego to ważne"
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("premise")}
                onGenerate={generateField}
                onChange={(value) => updateField("premise", value)}
              />
              <div className="form-grid">
                <TextField
                  label="Bohater / bohaterka"
                  field="protagonistSummary"
                  value={form.protagonistSummary}
                  placeholder="Kim jest postać prowadząca historię"
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("protagonistSummary")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("protagonistSummary", value)}
                />
                <TextField
                  label="Cel bohatera"
                  field="protagonistGoal"
                  value={form.protagonistGoal}
                  placeholder="Konkretne dążenie napędzające fabułę"
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("protagonistGoal")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("protagonistGoal", value)}
                />
              </div>
              <TextField
                label="Setting"
                field="settingSketch"
                value={form.settingSketch}
                placeholder="Miejsce, czas i warunki świata wpływające na konflikt"
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("settingSketch")}
                onGenerate={generateField}
                onChange={(value) => updateField("settingSketch", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "storyEngine" ? (
            <FormSection>
              <div className="form-grid">
                <TextField
                  label="Logline"
                  field="logline"
                  value={form.logline}
                  placeholder="Bohater, cel, przeszkoda, stawka"
                  rows={3}
                  disabled={aiDisabled}
                  loading={fieldStatus("logline")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("logline", value)}
                />
                <TextField
                  label="Konflikt centralny"
                  field="centralConflict"
                  value={form.centralConflict}
                  placeholder="Główne tarcie fabularne"
                  rows={3}
                  disabled={aiDisabled}
                  loading={fieldStatus("centralConflict")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("centralConflict", value)}
                />
              </div>
              <div className="form-grid">
                <TextField
                  label="Siła przeciwna"
                  field="antagonistForce"
                  value={form.antagonistForce}
                  placeholder="Antagonista, system, tajemnica albo blokada"
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("antagonistForce")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("antagonistForce", value)}
                />
                <TextField
                  label="Stawki"
                  field="stakes"
                  value={form.stakes}
                  placeholder="Co zostanie utracone, jeśli bohater przegra"
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("stakes")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("stakes", value)}
                />
                <TextField
                  label="Kierunek zakończenia"
                  field="endingDirection"
                  value={form.endingDirection}
                  placeholder="Roboczy finał fabularny lub emocjonalny"
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("endingDirection")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("endingDirection", value)}
                />
              </div>
              <TextField
                label="Rozszerzona premisa"
                field="expandedPremise"
                value={form.expandedPremise}
                placeholder="Akapit rozwijający założenie książki"
                rows={5}
                disabled={aiDisabled}
                loading={fieldStatus("expandedPremise")}
                onGenerate={generateField}
                onChange={(value) => updateField("expandedPremise", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "readerForm" ? (
            <FormSection>
              <div className="form-grid concept-choice-grid">
                <MultiChoiceField
                  label="Gatunek"
                  field="genre"
                  value={form.genre}
                  options={genreOptions}
                  onChange={(value) => updateField("genre", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("genre")}
                />
                <MultiChoiceField
                  label="Podgatunek"
                  field="subgenre"
                  value={form.subgenre}
                  options={subgenreOptions}
                  onChange={(value) => updateField("subgenre", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("subgenre")}
                />
                <MultiChoiceField
                  label="Odbiorcy"
                  field="targetAudience"
                  value={form.targetAudience}
                  options={audienceOptions}
                  onChange={(value) => updateField("targetAudience", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("targetAudience")}
                />
                <MultiChoiceField
                  label="Ton"
                  field="tone"
                  value={form.tone}
                  options={toneOptions}
                  onChange={(value) => updateField("tone", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("tone")}
                />
                <MultiChoiceField
                  label="Punkt widzenia"
                  field="pointOfView"
                  value={form.pointOfView}
                  options={pointOfViewOptions}
                  onChange={(value) => updateField("pointOfView", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("pointOfView")}
                />
                <TextField
                  label="Docelowa liczba słów"
                  field="targetWordCount"
                  value={form.targetWordCount}
                  placeholder="np. 85000"
                  disabled={aiDisabled}
                  loading={fieldStatus("targetWordCount")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("targetWordCount", value)}
                />
              </div>
            </FormSection>
          ) : null}

          {activeStage === "rules" ? (
            <FormSection>
              <MultiChoiceField
                label="Tematy"
                field="themesJson"
                value={form.themesJson}
                options={themeOptions}
                onChange={(value) => updateField("themesJson", value)}
                onGenerate={generateField}
                disabled={aiDisabled}
                loading={fieldStatus("themesJson")}
              />
              <TextField
                label="Granice i tematy niechciane"
                field="unwantedThemes"
                value={form.unwantedThemes}
                placeholder="Czego unikać w późniejszych promptach"
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("unwantedThemes")}
                onGenerate={generateField}
                onChange={(value) => updateField("unwantedThemes", value)}
              />
              <TextField
                label="Style guide"
                field="styleGuide"
                value={form.styleGuide}
                placeholder="Notatki o języku, rytmie, zakazach i preferencjach"
                rows={5}
                disabled={aiDisabled}
                loading={fieldStatus("styleGuide")}
                onGenerate={generateField}
                onChange={(value) => updateField("styleGuide", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "cover" ? (
            <FormSection>
              <div className="cover-stage-layout">
                <div className="cover-title-fields">
                  <TextField
                    label="Tytuł finalny"
                    field="title"
                    value={form.title}
                    placeholder="Tytuł, który trafi na okładkę"
                    disabled={aiDisabled}
                    loading={fieldStatus("title")}
                    onGenerate={generateField}
                    onChange={(value) => updateField("title", value)}
                  />
                  <TextField
                    label="Alternatywne tytuły"
                    field="alternativeTitlesJson"
                    value={form.alternativeTitlesJson}
                    placeholder="Jeden tytuł na linię albo po przecinku"
                    rows={5}
                    disabled={aiDisabled}
                    loading={fieldStatus("alternativeTitlesJson")}
                    onGenerate={generateField}
                    onChange={(value) =>
                      updateField("alternativeTitlesJson", value)
                    }
                  />
                </div>

                <div className="cover-art-panel">
                  {coverSrc ? (
                    <button
                      type="button"
                      className="cover-preview cover-preview-button has-image"
                      onClick={() =>
                        setPreviewImage({
                          src: coverSrc,
                          alt: "Okładka robocza"
                        })
                      }
                      title="Otwórz okładkę w pełnym podglądzie"
                    >
                      <img src={coverSrc} alt="Okładka robocza" />
                    </button>
                  ) : (
                    <div className="cover-preview">
                      <div className="cover-placeholder">
                        <ImageIcon size={30} aria-hidden="true" />
                        <span>Brak okładki</span>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="secondary-button cover-generate-button"
                    onClick={generateCover}
                    disabled={
                      coverPending ||
                      !projectQuery.data ||
                      codexUnavailable
                    }
                    title="Utwórz okładkę na podstawie danych z widoku koncepcji"
                  >
                    {coverRunning ? (
                      <Loader2 size={16} className="spin-icon" />
                    ) : coverQueued ? (
                      <Clock3 size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {coverRunning
                      ? "Tworzę"
                      : coverQueued
                        ? "W kolejce"
                        : "Utwórz okładkę"}
                  </button>

                  {coverProgressText ? (
                    <div
                      className={coverPending ? "cover-progress active" : "cover-progress"}
                      role={coverPending ? "status" : undefined}
                      aria-live="polite"
                    >
                      <span>{coverProgressText}</span>
                      {coverPending ? (
                        <div className="cover-progress-track" aria-hidden="true">
                          <span />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {coverTask?.status === "error" ? (
                    <p className="warning-text">
                      {coverTask.errorMessage || "Nie udało się utworzyć okładki."}
                    </p>
                  ) : null}
                </div>
              </div>
            </FormSection>
          ) : null}
        </div>

        <div className="concept-save-row">
          <div className="button-row">
            <button
              type="submit"
              className="primary-button"
              disabled={saveMutation.isPending || !projectQuery.data}
            >
              <Save size={16} />
              {saveMutation.isPending ? "Zapisuję" : "Zapisz"}
            </button>
            {saveMessage ? <span className="success-text">{saveMessage}</span> : null}
            {validationMessage ? (
              <span className="warning-text">{validationMessage}</span>
            ) : null}
            {saveMutation.isError && !validationMessage ? (
              <span className="warning-text">Nie udało się zapisać koncepcji.</span>
            ) : null}
          </div>
        </div>
      </form>

      {codexUnavailable ? (
        <p className="warning-text">
          Codex CLI nie jest gotowy. Skonfiguruj go w prawym panelu albo
          ekranie AI.
        </p>
      ) : null}

      {aiError ? <p className="warning-text">{aiError}</p> : null}

      <CoverImageLightbox
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
      </section>
    </ConceptPromptContext.Provider>
  );
}

type FormSectionProps = {
  children: ReactNode;
};

function FormSection({ children }: FormSectionProps) {
  return <section className="concept-form-section">{children}</section>;
}

function normalizeConceptStage(value: string | undefined): ConceptStageKey {
  return conceptStages.some((stage) => stage.key === value)
    ? (value as ConceptStageKey)
    : "idea";
}

type TextFieldProps = {
  label: string;
  field: ConceptFieldKey;
  value: string;
  placeholder: string;
  disabled: boolean;
  loading: AiProposalStatus | null;
  rows?: number;
  onChange: (value: string) => void;
  onGenerate: (field: ConceptFieldKey) => void;
};

function TextField({
  label,
  field,
  value,
  placeholder,
  disabled,
  loading,
  rows,
  onChange,
  onGenerate
}: TextFieldProps) {
  return (
    <FieldFrame
      label={label}
      field={field}
      disabled={disabled}
      loading={loading}
      onGenerate={onGenerate}
    >
      {rows ? (
        <textarea
          className={field === "styleGuide" ? "style-guide-textarea" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          title={fieldHints[field]}
          aria-label={label}
          aria-describedby={`${field}-description`}
          rows={rows}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          title={fieldHints[field]}
          aria-label={label}
          aria-describedby={`${field}-description`}
        />
      )}
    </FieldFrame>
  );
}

type FieldFrameProps = {
  label: string;
  field: ConceptFieldKey;
  children: ReactNode;
  disabled: boolean;
  loading: AiProposalStatus | null;
  onGenerate: (field: ConceptFieldKey) => void;
};

function FieldFrame({
  label,
  field,
  children,
  disabled,
  loading,
  onGenerate
}: FieldFrameProps) {
  const activatePromptContext = useContext(ConceptPromptContext);

  return (
    <div
      className="field-shell"
      title={fieldHints[field]}
      onClick={(event) => {
        if (isEditablePromptTarget(event.target)) {
          activatePromptContext(field);
        }
      }}
      onFocusCapture={(event) => {
        if (isEditablePromptTarget(event.target)) {
          activatePromptContext(field);
        }
      }}
    >
      <div className="field-heading">
        <span className="field-label-text">{label}</span>
        <AiFieldActions
          field={field}
          disabled={disabled}
          loading={loading}
          onGenerate={onGenerate}
        />
      </div>
      <p className="field-description" id={`${field}-description`}>
        {fieldHints[field]}
      </p>
      {children}
    </div>
  );
}

type AiFieldButtonProps = {
  field: ConceptFieldKey;
  disabled: boolean;
  loading: AiProposalStatus | null;
  onGenerate: (field: ConceptFieldKey) => void;
};

function AiFieldActions({
  field,
  disabled,
  loading,
  onGenerate
}: AiFieldButtonProps) {
  const config = conceptFieldConfigs[field];
  const activeTargetId = useAiPromptContextStore((state) => state.activeTargetId);
  const activeTarget = useAiPromptContextStore((state) =>
    activeTargetId ? state.targets[activeTargetId] : null
  );
  const addContextSourceToActiveTarget = useAiPromptContextStore(
    (state) => state.addContextSourceToActiveTarget
  );
  const running = loading === "running";
  const queued = loading === "queued";
  const label = running ? "Generuje" : queued ? "W kolejce" : "AI";
  const fieldAlreadyInContext = Boolean(
    activeTarget?.sources.some((source) => source.key === field)
  );
  const addDisabled = !activeTarget || fieldAlreadyInContext;

  return (
    <div className="ai-field-actions">
      <button
        type="button"
        className="icon-button ai-field-button"
        onClick={() => onGenerate(field)}
        disabled={disabled || queued || running}
        title={
          queued
            ? `Pole "${config.label}" czeka w kolejce AI.`
            : running
              ? `Pole "${config.label}" jest generowane.`
              : `Generuj pole "${config.label}" z AI.`
        }
        aria-label={`Generuj ${config.label} z AI`}
      >
        {running ? (
          <Loader2 size={15} className="spin-icon" />
        ) : queued ? (
          <Clock3 size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        <span>{label}</span>
      </button>
      <button
        type="button"
        className="icon-button ai-context-add-button"
        onClick={(event) => {
          event.stopPropagation();
          addContextSourceToActiveTarget(conceptPromptContextSource(field));
        }}
        disabled={addDisabled}
        title={
          !activeTarget
            ? "Najpierw zaznacz pole tekstowe, aby otworzyc kontekst promptu."
            : fieldAlreadyInContext
              ? `Pole "${config.label}" jest juz w kontekscie promptu.`
              : `Dodaj pole "${config.label}" do kontekstu promptu.`
        }
        aria-label={`Dodaj ${config.label} do kontekstu promptu`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function AiFieldButton({
  field,
  disabled,
  loading,
  onGenerate
}: AiFieldButtonProps) {
  const config = conceptFieldConfigs[field];
  const running = loading === "running";
  const queued = loading === "queued";
  const label = running ? "Generuje" : queued ? "W kolejce" : "AI";

  return (
    <button
      type="button"
      className="icon-button ai-field-button"
      onClick={() => onGenerate(field)}
      disabled={disabled || queued || running}
      title={
        queued
          ? `Pole "${config.label}" czeka w kolejce AI.`
          : running
            ? `Pole "${config.label}" jest generowane.`
            : `Generuj pole "${config.label}" z AI. Prompt uwzględni pozostałe pola koncepcji.`
      }
      aria-label={`Generuj ${config.label} z AI`}
    >
      {running ? (
        <Loader2 size={15} className="spin-icon" />
      ) : queued ? (
        <Clock3 size={15} />
      ) : (
        <Sparkles size={15} />
      )}
      <span>{label}</span>
    </button>
  );
}

function isEditablePromptTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

type MultiChoiceFieldProps = {
  label: string;
  field: ConceptFieldKey;
  value: string;
  options: ChoiceOption[];
  disabled: boolean;
  loading: AiProposalStatus | null;
  onChange: (value: string) => void;
  onGenerate: (field: ConceptFieldKey) => void;
};

function MultiChoiceField({
  label,
  field,
  value,
  options,
  disabled,
  loading,
  onChange,
  onGenerate
}: MultiChoiceFieldProps) {
  const [customValue, setCustomValue] = useState("");
  const selectedValues = parseChoiceString(value);
  const knownValues = new Set(options.map((option) => option.value));
  const customSelectedValues = selectedValues.filter(
    (selected) => !knownValues.has(selected)
  );

  function setSelected(nextValues: string[]) {
    onChange(nextValues.join(", "));
  }

  function toggleChoice(choice: string) {
    if (selectedValues.includes(choice)) {
      setSelected(selectedValues.filter((selected) => selected !== choice));
      return;
    }

    setSelected([...selectedValues, choice]);
  }

  function addCustomValue() {
    const nextValue = customValue.trim();
    if (!nextValue || selectedValues.includes(nextValue)) {
      setCustomValue("");
      return;
    }

    setSelected([...selectedValues, nextValue]);
    setCustomValue("");
  }

  return (
    <FieldFrame
      label={label}
      field={field}
      disabled={disabled}
      loading={loading}
      onGenerate={onGenerate}
    >
      <div className="choice-field" aria-label={label}>
        <div className="choice-chip-list">
          {options.map((option) => {
            const selected = selectedValues.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                className={selected ? "choice-chip selected" : "choice-chip"}
                onClick={() => toggleChoice(option.value)}
                title={`${option.value}: ${option.hint}`}
                aria-pressed={selected}
              >
                {option.value}
              </button>
            );
          })}
          {customSelectedValues.map((selected) => (
            <button
              type="button"
              key={selected}
              className="choice-chip selected custom"
              onClick={() => toggleChoice(selected)}
              title={`Własna opcja: ${selected}. Kliknij, aby usunąć.`}
              aria-pressed
            >
              {selected}
              <X size={12} />
            </button>
          ))}
        </div>
        <div className="choice-custom-row">
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomValue();
              }
            }}
            placeholder="Własna opcja"
            title={`Dopisz własną wartość dla pola ${label}.`}
            aria-label={`Własna opcja ${label}`}
          />
          <button
            type="button"
            className="icon-button"
            onClick={addCustomValue}
            title={`Dodaj własną opcję do pola ${label}`}
            aria-label={`Dodaj własną opcję ${label}`}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    </FieldFrame>
  );
}

function parseChoiceString(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function conceptInputFromForm(form: ConceptForm): BookConceptInput {
  return {
    title: form.title,
    workingTitle: form.workingTitle,
    premise: form.premise,
    protagonistSummary: form.protagonistSummary,
    protagonistGoal: form.protagonistGoal,
    expandedPremise: form.expandedPremise,
    logline: form.logline,
    centralConflict: form.centralConflict,
    antagonistForce: form.antagonistForce,
    stakes: form.stakes,
    settingSketch: form.settingSketch,
    endingDirection: form.endingDirection,
    genre: form.genre,
    subgenre: form.subgenre,
    targetAudience: form.targetAudience,
    tone: form.tone,
    pointOfView: form.pointOfView,
    targetWordCount: parseOptionalPositiveInt(form.targetWordCount),
    themesJson: serializeListValue(form.themesJson),
    unwantedThemes: form.unwantedThemes,
    alternativeTitlesJson: serializeListValue(form.alternativeTitlesJson),
    styleGuide: form.styleGuide
  };
}

function stageCompletion(
  stage: ConceptStage,
  form: ConceptForm
): { complete: number; total: number } {
  const complete = stage.fields.filter((field) => {
    const value = form[field];
    return typeof value === "string" && value.trim().length > 0;
  }).length;

  return { complete, total: stage.fields.length };
}

function compareCoverTasksForView(
  left: { status: AiProposalStatus; createdAt: string },
  right: { status: AiProposalStatus; createdAt: string }
): number {
  const statusDiff = coverTaskStatusRank(left.status) - coverTaskStatusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function coverTaskStatusRank(status: AiProposalStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "error":
      return 2;
    case "success":
      return 3;
  }
}

function validateConceptForm(form: ConceptForm): string {
  if (form.targetWordCount.trim() && parseOptionalPositiveInt(form.targetWordCount) === null) {
    return "Docelowa liczba słów musi być dodatnią liczbą albo pozostać pusta.";
  }

  if (form.premise.length > conceptFieldMaxResponseCharacters.premise) {
    return "Premise jest zbyt długa; przenieś szczegóły do rozszerzonej premisy.";
  }

  if (form.logline.length > conceptFieldMaxResponseCharacters.logline) {
    return "Logline jest zbyt długi; powinien zmieścić się w jednym zwartym zdaniu.";
  }

  return "";
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function serializeListValue(value: string): string {
  return JSON.stringify([...new Set(parseChoiceString(value))]);
}

function listTextFromJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .join(", ");
    }
  } catch {
    return value;
  }

  return value;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class GenerationError extends Error {
  rawOutput: string;

  constructor(message: string, rawOutput = "") {
    super(message);
    this.name = "GenerationError";
    this.rawOutput = rawOutput;
  }
}
