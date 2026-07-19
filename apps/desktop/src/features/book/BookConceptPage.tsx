import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Sparkles
} from "lucide-react";
import {
  createContext,
  FormEvent,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useTranslation } from "react-i18next";
import { Button, Chip, Collapsible, Field, StatusPill } from "../../shared/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkCodexCli,
  getAiSettings,
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
  conceptPromptContextSource,
  ConceptFieldKey,
  renderPromptPackage
} from "../ai/promptPackage";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import { useBrainstormField } from "../ai/useBrainstormField";
import { describeTextProvider } from "../ai/textProviderInfo";
import {
  createConceptPromptContextTarget,
  conceptPromptContextTargetId,
  promptContextControlForActiveTarget,
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
  | "hero"
  | "world"
  | "stakesEnding"
  | "readerVoice"
  | "rules"
  | "cover";

type ConceptStage = {
  key: ConceptStageKey;
  titleKey: string;
  summaryKey: string;
  fields: (keyof ConceptForm)[];
};

type ChoiceOption = {
  id: string;
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

const fieldHintKeys: Record<ConceptFieldKey, string> = {
  title: "book.hintTitle",
  workingTitle: "book.hintWorkingTitle",
  premise: "book.hintPremise",
  protagonistSummary: "book.hintProtagonistSummary",
  protagonistGoal: "book.hintProtagonistGoal",
  expandedPremise: "book.hintExpandedPremise",
  centralConflict: "book.hintCentralConflict",
  antagonistForce: "book.hintAntagonistForce",
  stakes: "book.hintStakes",
  settingSketch: "book.hintSettingSketch",
  endingDirection: "book.hintEndingDirection",
  genre: "book.hintGenre",
  subgenre: "book.hintSubgenre",
  targetAudience: "book.hintTargetAudience",
  tone: "book.hintTone",
  pointOfView: "book.hintPointOfView",
  targetWordCount: "book.hintTargetWordCount",
  themesJson: "book.hintThemes",
  unwantedThemes: "book.hintUnwantedThemes",
  alternativeTitlesJson: "book.hintAlternativeTitles",
  styleGuide: "book.hintStyleGuide"
};

const conceptStages: ConceptStage[] = [
  {
    key: "idea",
    titleKey: "book.stageIdeaTitle",
    summaryKey: "book.stageIdeaSummary",
    fields: ["workingTitle", "premise"]
  },
  {
    key: "hero",
    titleKey: "book.stageHeroTitle",
    summaryKey: "book.stageHeroSummary",
    fields: ["protagonistSummary", "protagonistGoal", "centralConflict", "antagonistForce"]
  },
  {
    key: "world",
    titleKey: "book.stageWorldTitle",
    summaryKey: "book.stageWorldSummary",
    fields: ["settingSketch"]
  },
  {
    key: "stakesEnding",
    titleKey: "book.stageStakesEndingTitle",
    summaryKey: "book.stageStakesEndingSummary",
    fields: ["stakes", "endingDirection", "expandedPremise"]
  },
  {
    key: "readerVoice",
    titleKey: "book.stageReaderVoiceTitle",
    summaryKey: "book.stageReaderVoiceSummary",
    fields: ["genre", "subgenre", "targetAudience", "tone", "pointOfView", "targetWordCount"]
  },
  {
    key: "rules",
    titleKey: "book.stageRulesTitle",
    summaryKey: "book.stageRulesSummary",
    fields: ["themesJson", "unwantedThemes", "styleGuide"]
  },
  {
    key: "cover",
    titleKey: "book.stageCoverTitle",
    summaryKey: "book.stageCoverSummary",
    fields: ["title", "alternativeTitlesJson"]
  }
];

// ponytail: chip option hints/values left as data (decorative tooltips + prompt values); i18n them if the option lists ever need translated tooltips.
const genreOptions: ChoiceOption[] = [
  { id: "fantasy" },
  { id: "kryminal" },
  { id: "obyczajowa" },
  { id: "thriller" },
  { id: "horror" },
  { id: "scienceFiction" },
  { id: "romans" },
  { id: "realizmMagiczny" }
];

const subgenreOptions: ChoiceOption[] = [
  { id: "darkAcademia" },
  { id: "cozyMystery" },
  { id: "urbanFantasy" },
  { id: "spaceOpera" },
  { id: "slowBurnRomance" }
];

const audienceOptions: ChoiceOption[] = [
  { id: "adult" },
  { id: "ya" },
  { id: "newAdult" },
  { id: "middleGrade" },
  { id: "dzieci" },
  { id: "faniKryminalu" },
  { id: "faniFantasy" }
];

const toneOptions: ChoiceOption[] = [
  { id: "mroczny" },
  { id: "cieply" },
  { id: "ironiczny" },
  { id: "liryczny" },
  { id: "napiety" },
  { id: "kameralny" },
  { id: "epicki" },
  { id: "humorystyczny" }
];

const pointOfViewOptions: ChoiceOption[] = [
  { id: "pierwszaOsoba" },
  { id: "trzeciaOsobaOgraniczona" },
  { id: "trzeciaOsobaWszechwiedzaca" },
  { id: "wieluPov" },
  { id: "czasTerazniejszy" },
  { id: "czasPrzeszly" }
];

const themeOptions: ChoiceOption[] = [
  { id: "tozsamosc" },
  { id: "pamiec" },
  { id: "wladza" },
  { id: "rodzina" },
  { id: "wolnosc" },
  { id: "zdrada" }
];

export function BookConceptPage({ projectId }: BookConceptPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const stageTabsRef = useRef<HTMLDivElement>(null);
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore(
    (state) => state.activateTarget
  );
  const closePromptContextTarget = useAiPromptContextStore(
    (state) => state.closeTarget
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

  const aiSettingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings,
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
        throw new Error(t("book.noProjectToSave"));
      }

      const validation = validateConceptForm(form, t);
      if (validation) {
        throw new ValidationError(validation);
      }

      return updateBookConcept(projectQuery.data.book.id, conceptInputFromForm(form));
    },
    onSuccess: async () => {
      setSaveMessage(t("book.conceptSaved"));
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
        throw new GenerationError(t("book.noProjectData"));
      }

      const targetId = conceptPromptContextTargetId(projectId, field);
      const contextControl = promptContextControlForActiveTarget(targetId);
      const usedPromptContext = Boolean(contextControl);
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
      if (usedPromptContext) {
        closePromptContextTarget(targetId);
      }
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
  }

  function activateFieldPromptContext(field: ConceptFieldKey) {
    const config = conceptFieldConfigs[field];
    const loading = fieldStatus(field);

    activatePromptContextTarget(
      createConceptPromptContextTarget(projectId, field, {
        submitLabel: t("book.submitToAi"),
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading
          ? t("book.fieldQueuedReason", { label: config.label })
          : t("book.codexNotReady"),
        onSubmit: () => queueFieldGeneration(field),
        renderPrompt: () => {
          if (!projectQuery.data || !bookForPrompt) {
            return "";
          }
          const targetId = conceptPromptContextTargetId(projectId, field);
          return renderPromptPackage(
            buildConceptFieldPromptPackage(
              projectQuery.data.project,
              bookForPrompt,
              field,
              promptContextControlForActiveTarget(targetId)
            )
          );
        }
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
      setAiError(t("book.noProjectData"));
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

  const providerInfo = describeTextProvider(aiSettingsQuery.data);
  // Status Codex CLI blokuje generowanie tylko wtedy, gdy Codex jest aktywnym
  // dostawcą tekstu w ustawieniach AI. Dla pozostałych dostawców jego brak nie
  // powinien niczego wyłączać ani wyświetlać komunikatu o Codeksie.
  const codexUnavailable =
    providerInfo.isCodex && codexStatusQuery.data?.available === false;
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
  const activeStageIndex = Math.max(
    0,
    conceptStages.findIndex((stage) => stage.key === activeStageConfig.key)
  );
  const activeStageNumber = activeStageIndex + 1;
  const nextStage = conceptStages[activeStageIndex + 1] ?? null;

  useEffect(() => {
    const selectedTab = stageTabsRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );

    if (typeof selectedTab?.scrollIntoView === "function") {
      selectedTab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
      });
    }
  }, [activeStageConfig.key]);

  function goToNextStage() {
    if (!nextStage) {
      return;
    }

    setProjectViewState(projectId, "conceptStage", nextStage.key);
  }

  function scrollStageTabs(direction: -1 | 1) {
    const tabList = stageTabsRef.current;

    if (!tabList) {
      return;
    }

    const scrollAmount = Math.max(tabList.clientWidth - 96, 180);

    if (typeof tabList.scrollBy === "function") {
      tabList.scrollBy({
        left: direction * scrollAmount,
        behavior: "smooth"
      });
      return;
    }

    tabList.scrollLeft += direction * scrollAmount;
  }

  return (
    <ConceptPromptContext.Provider value={activateFieldPromptContext}>
      <div className="concept-workspace">
        <section className="concept-main-column">

      {projectQuery.isError ? (
        <div className="empty-state">
          <h3>{t("book.loadProjectErrorTitle")}</h3>
          <p>{t("book.loadProjectErrorHint")}</p>
        </div>
      ) : null}

          <form className="concept-form" onSubmit={handleSubmit}>
            <div className="concept-stage-card ui-card">
              <button
                type="button"
                className="stage-scroll-button previous"
                onClick={() => scrollStageTabs(-1)}
                aria-label={t("book.showPreviousStages")}
                title={t("book.showPreviousStages")}
              >
                <ChevronLeft size={18} />
              </button>
              <div
                ref={stageTabsRef}
                className="concept-steps"
                role="tablist"
                aria-label={t("book.conceptStagesLabel")}
              >
          {conceptStages.map((stage, index) => {
            const completion = stageCompletion(stage, form);
            const selected = stage.key === activeStageConfig.key;
            const done = completion.complete === completion.total;
            const className = [
              "concept-step",
              selected ? "active" : "",
              done ? "done" : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <Fragment key={stage.key}>
                {index > 0 ? (
                  <span className="concept-step-sep" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={className}
                  onClick={() =>
                    setProjectViewState(projectId, "conceptStage", stage.key)
                  }
                >
                  <span className="concept-step-n" aria-hidden="true">
                    {done ? "✓" : index + 1}
                  </span>
                  <span className="concept-step-label">{t(stage.titleKey)}</span>
                  <span className="ui-tab-badge">
                    {completion.complete}/{completion.total}
                  </span>
                </button>
              </Fragment>
            );
          })}
              </div>
              <button
                type="button"
                className="stage-scroll-button next"
                onClick={() => scrollStageTabs(1)}
                aria-label={t("book.showNextStages")}
                title={t("book.showNextStages")}
              >
                <ChevronRight size={18} />
              </button>
        </div>

            <div className="concept-editor-card ui-card">
              <div className="concept-stage-heading">
                <span className="stage-heading-icon">
                  <Sparkles size={18} />
                </span>
                <div>
                  <h2>
                    {t("book.phaseHeading", {
                      number: activeStageNumber,
                      title: t(activeStageConfig.titleKey)
                    })}
                  </h2>
                  <p>{t(activeStageConfig.summaryKey)}</p>
                </div>
              </div>

              <div role="tabpanel" className="concept-stage-panel">
          {activeStage === "idea" ? (
            <FormSection>
              <TextField
                label={t("book.labelWorkingTitle")}
                field="workingTitle"
                value={form.workingTitle}
                placeholder={t("book.placeholderWorkingTitle")}
                disabled={aiDisabled}
                loading={fieldStatus("workingTitle")}
                onGenerate={generateField}
                onChange={(value) => updateField("workingTitle", value)}
              />
              <TextField
                label={t("book.labelPremise")}
                field="premise"
                value={form.premise}
                placeholder={t("book.placeholderPremise")}
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("premise")}
                onGenerate={generateField}
                onChange={(value) => updateField("premise", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "hero" ? (
            <FormSection>
              <div className="form-grid">
                <TextField
                  label={t("book.labelProtagonistSummary")}
                  field="protagonistSummary"
                  value={form.protagonistSummary}
                  placeholder={t("book.placeholderProtagonistSummary")}
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("protagonistSummary")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("protagonistSummary", value)}
                />
                <TextField
                  label={t("book.labelProtagonistGoal")}
                  field="protagonistGoal"
                  value={form.protagonistGoal}
                  placeholder={t("book.placeholderProtagonistGoal")}
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("protagonistGoal")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("protagonistGoal", value)}
                />
                <TextField
                  label={t("book.labelCentralConflict")}
                  field="centralConflict"
                  value={form.centralConflict}
                  placeholder={t("book.placeholderCentralConflict")}
                  rows={3}
                  disabled={aiDisabled}
                  loading={fieldStatus("centralConflict")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("centralConflict", value)}
                />
                <TextField
                  label={t("book.labelAntagonistForce")}
                  field="antagonistForce"
                  value={form.antagonistForce}
                  placeholder={t("book.placeholderAntagonistForce")}
                  rows={3}
                  disabled={aiDisabled}
                  loading={fieldStatus("antagonistForce")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("antagonistForce", value)}
                />
              </div>
            </FormSection>
          ) : null}

          {activeStage === "world" ? (
            <FormSection>
              <TextField
                label={t("book.labelSetting")}
                field="settingSketch"
                value={form.settingSketch}
                placeholder={t("book.placeholderSetting")}
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("settingSketch")}
                onGenerate={generateField}
                onChange={(value) => updateField("settingSketch", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "stakesEnding" ? (
            <FormSection>
              <div className="form-grid">
                <TextField
                  label={t("book.labelStakes")}
                  field="stakes"
                  value={form.stakes}
                  placeholder={t("book.placeholderStakes")}
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("stakes")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("stakes", value)}
                />
                <TextField
                  label={t("book.labelEndingDirection")}
                  field="endingDirection"
                  value={form.endingDirection}
                  placeholder={t("book.placeholderEndingDirection")}
                  rows={4}
                  disabled={aiDisabled}
                  loading={fieldStatus("endingDirection")}
                  onGenerate={generateField}
                  onChange={(value) => updateField("endingDirection", value)}
                />
              </div>
              <TextField
                label={t("book.labelExpandedPremise")}
                field="expandedPremise"
                value={form.expandedPremise}
                placeholder={t("book.placeholderExpandedPremise")}
                rows={5}
                disabled={aiDisabled}
                loading={fieldStatus("expandedPremise")}
                onGenerate={generateField}
                onChange={(value) => updateField("expandedPremise", value)}
              />
            </FormSection>
          ) : null}

          {activeStage === "readerVoice" ? (
            <FormSection>
              <div className="form-grid concept-choice-grid">
                <MultiChoiceField
                  label={t("book.labelGenre")}
                  field="genre"
                  value={form.genre}
                  options={genreOptions}
                  keyBase="book.optGenre"
                  onChange={(value) => updateField("genre", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("genre")}
                />
                <MultiChoiceField
                  label={t("book.labelSubgenre")}
                  field="subgenre"
                  value={form.subgenre}
                  options={subgenreOptions}
                  keyBase="book.optSubgenre"
                  onChange={(value) => updateField("subgenre", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("subgenre")}
                />
                <MultiChoiceField
                  label={t("book.labelTargetAudience")}
                  field="targetAudience"
                  value={form.targetAudience}
                  options={audienceOptions}
                  keyBase="book.optAudience"
                  onChange={(value) => updateField("targetAudience", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("targetAudience")}
                />
                <MultiChoiceField
                  label={t("book.labelTone")}
                  field="tone"
                  value={form.tone}
                  options={toneOptions}
                  keyBase="book.optTone"
                  onChange={(value) => updateField("tone", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("tone")}
                />
                <MultiChoiceField
                  label={t("book.labelPointOfView")}
                  field="pointOfView"
                  value={form.pointOfView}
                  options={pointOfViewOptions}
                  keyBase="book.optPov"
                  onChange={(value) => updateField("pointOfView", value)}
                  onGenerate={generateField}
                  disabled={aiDisabled}
                  loading={fieldStatus("pointOfView")}
                />
                <TextField
                  label={t("book.labelTargetWordCount")}
                  field="targetWordCount"
                  value={form.targetWordCount}
                  placeholder={t("book.placeholderTargetWordCount")}
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
                label={t("book.labelThemes")}
                field="themesJson"
                value={form.themesJson}
                options={themeOptions}
                keyBase="book.optTheme"
                onChange={(value) => updateField("themesJson", value)}
                onGenerate={generateField}
                disabled={aiDisabled}
                loading={fieldStatus("themesJson")}
              />
              <TextField
                label={t("book.labelUnwantedThemes")}
                field="unwantedThemes"
                value={form.unwantedThemes}
                placeholder={t("book.placeholderUnwantedThemes")}
                rows={4}
                disabled={aiDisabled}
                loading={fieldStatus("unwantedThemes")}
                onGenerate={generateField}
                onChange={(value) => updateField("unwantedThemes", value)}
              />
              <TextField
                label={t("book.labelStyleGuide")}
                field="styleGuide"
                value={form.styleGuide}
                placeholder={t("book.placeholderStyleGuide")}
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
                    label={t("book.labelFinalTitle")}
                    field="title"
                    value={form.title}
                    placeholder={t("book.placeholderFinalTitle")}
                    disabled={aiDisabled}
                    loading={fieldStatus("title")}
                    onGenerate={generateField}
                    onChange={(value) => updateField("title", value)}
                  />
                  <Collapsible title={t("book.advancedTitle")} description={t("book.advancedTitlesDescription")}>
                    <TextField
                      label={t("book.labelAlternativeTitles")}
                      field="alternativeTitlesJson"
                      value={form.alternativeTitlesJson}
                      placeholder={t("book.placeholderAlternativeTitles")}
                      rows={5}
                      disabled={aiDisabled}
                      loading={fieldStatus("alternativeTitlesJson")}
                      onGenerate={generateField}
                      onChange={(value) =>
                        updateField("alternativeTitlesJson", value)
                      }
                    />
                  </Collapsible>
                </div>

                <div className="cover-art-panel">
                  {coverSrc ? (
                    <button
                      type="button"
                      className="cover-preview cover-preview-button has-image"
                      onClick={() =>
                        setPreviewImage({
                          src: coverSrc,
                          alt: t("book.coverWorkingAlt")
                        })
                      }
                      title={t("book.coverOpenFullPreview")}
                    >
                      <img src={coverSrc} alt={t("book.coverWorkingAlt")} />
                    </button>
                  ) : (
                    <div className="cover-preview">
                      <div className="cover-placeholder">
                        <ImageIcon size={30} aria-hidden="true" />
                        <span>{t("book.coverNone")}</span>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="ai"
                    className="cover-generate-button"
                    onClick={generateCover}
                    busy={coverRunning}
                    disabled={
                      coverPending ||
                      !projectQuery.data ||
                      codexUnavailable
                    }
                    title={t("book.coverGenerateTitle")}
                  >
                    {coverQueued ? (
                      <Clock3 size={16} aria-hidden />
                    ) : coverRunning ? null : (
                      <Sparkles size={16} aria-hidden />
                    )}
                    {coverRunning
                      ? t("book.coverCreating")
                      : coverQueued
                        ? t("book.coverQueued")
                        : t("book.coverCreate")}
                  </Button>

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
                      {coverTask.errorMessage || t("book.coverGenerateError")}
                    </p>
                  ) : null}
                </div>
              </div>
            </FormSection>
          ) : null}
        </div>

            </div>

            <div className="concept-save-row ui-card">
              <div className="concept-save-actions">
                <Button
                  type="submit"
                  variant="primary"
                  busy={saveMutation.isPending}
                  disabled={!projectQuery.data}
                >
                  {saveMutation.isPending ? null : <Save size={16} aria-hidden />}
                  {saveMutation.isPending ? t("book.saving") : t("book.saveChanges")}
                </Button>
                <Button variant="secondary" onClick={goToNextStage} disabled={!nextStage}>
                  {t("book.nextStage")}
                  <ArrowRight size={16} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  className="concept-plan-link"
                  disabled
                  title={t("book.planViewComingSoon")}
                >
                  <ListChecks size={16} aria-hidden />
                  {t("book.goToPlanView")}
                </Button>
                {saveMessage ? (
                  <StatusPill tone="success">{saveMessage}</StatusPill>
                ) : null}
                {validationMessage ? (
                  <span className="warning-text">{validationMessage}</span>
                ) : null}
                {saveMutation.isError && !validationMessage ? (
                  <span className="warning-text">{t("book.saveConceptError")}</span>
                ) : null}
              </div>
            </div>
      </form>

      {codexUnavailable ? (
        <p className="warning-text">
          {t("book.providerNotReady", { provider: providerInfo.providerLabel })}
        </p>
      ) : null}

      {aiError ? <p className="warning-text">{aiError}</p> : null}
        </section>

      <CoverImageLightbox
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
      </div>
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
  const { t } = useTranslation();
  const goToBrainstorm = useBrainstormField();
  const activatePromptContext = useContext(ConceptPromptContext);
  const activate = () => activatePromptContext(field);

  return (
    <Field
      label={label}
      hint={t(fieldHintKeys[field])}
      actions={
        <AiFieldActions
          field={field}
          disabled={disabled}
          loading={loading}
          onGenerate={onGenerate}
          onBrainstorm={() => goToBrainstorm({ fieldLabel: label, value })}
        />
      }
    >
      {rows ? (
        <textarea
          className={field === "styleGuide" ? "style-guide-textarea" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={activate}
          onClick={activate}
          placeholder={placeholder}
          aria-label={label}
          rows={rows}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={activate}
          onClick={activate}
          placeholder={placeholder}
          aria-label={label}
        />
      )}
    </Field>
  );
}

type AiFieldButtonProps = {
  field: ConceptFieldKey;
  disabled: boolean;
  loading: AiProposalStatus | null;
  onGenerate: (field: ConceptFieldKey) => void;
  onBrainstorm?: () => void;
};

function AiFieldActions({
  field,
  disabled,
  loading,
  onGenerate,
  onBrainstorm
}: AiFieldButtonProps) {
  const { t } = useTranslation();
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
  const label = running ? t("book.aiFieldGenerating") : queued ? t("book.aiFieldQueued") : t("book.aiFieldIdle");
  const fieldAlreadyInContext = Boolean(
    activeTarget?.sources.some((source) => source.key === field)
  );
  const addDisabled = !activeTarget || fieldAlreadyInContext;

  return (
    <>
      <Button
        variant="ai"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          if (onBrainstorm) {
            onBrainstorm();
            return;
          }
          onGenerate(field);
        }}
        disabled={disabled || queued || running}
        title={
          queued
            ? t("book.aiFieldQueuedTitle", { label: config.label })
            : running
              ? t("book.aiFieldRunningTitle", { label: config.label })
              : t("book.aiFieldGenerateTitle", { label: config.label })
        }
        aria-label={t("book.aiFieldGenerateAria", { label: config.label })}
      >
        {running ? (
          <Loader2 size={14} className="ui-spin" aria-hidden />
        ) : queued ? (
          <Clock3 size={14} aria-hidden />
        ) : (
          <Sparkles size={14} aria-hidden />
        )}
        {label}
      </Button>
      <Button
        variant="icon"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          addContextSourceToActiveTarget(conceptPromptContextSource(field));
        }}
        disabled={addDisabled}
        title={
          !activeTarget
            ? t("book.aiContextAddNoTarget")
            : fieldAlreadyInContext
              ? t("book.aiContextAddAlready", { label: config.label })
              : t("book.aiContextAddTitle", { label: config.label })
        }
        aria-label={t("book.aiContextAddAria", { label: config.label })}
      >
        <Plus size={14} aria-hidden />
      </Button>
    </>
  );
}

type MultiChoiceFieldProps = {
  label: string;
  field: ConceptFieldKey;
  value: string;
  options: ChoiceOption[];
  keyBase: string;
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
  keyBase,
  disabled,
  loading,
  onChange,
  onGenerate
}: MultiChoiceFieldProps) {
  const { t } = useTranslation();
  const [customValue, setCustomValue] = useState("");
  const selectedValues = parseChoiceString(value);
  // Treść idzie za językiem UI: wyświetlaną i zapisywaną wartością chipa jest przetłumaczona etykieta.
  const optionLabel = (option: ChoiceOption) => t(`${keyBase}.${option.id}.label`);
  const knownValues = new Set(options.map(optionLabel));
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

  const activatePromptContext = useContext(ConceptPromptContext);
  const goToBrainstorm = useBrainstormField();

  return (
    <Field
      label={label}
      hint={t(fieldHintKeys[field])}
      actions={
        <AiFieldActions
          field={field}
          disabled={disabled}
          loading={loading}
          onGenerate={onGenerate}
          onBrainstorm={() => goToBrainstorm({ fieldLabel: label, value })}
        />
      }
    >
      <div className="concept-chip-list" role="group" aria-label={label}>
        {options.map((option) => {
          const chipLabel = optionLabel(option);
          return (
            <Chip
              key={option.id}
              pressed={selectedValues.includes(chipLabel)}
              onClick={() => toggleChoice(chipLabel)}
              title={`${chipLabel}: ${t(`${keyBase}.${option.id}.hint`)}`}
            >
              {chipLabel}
            </Chip>
          );
        })}
        {customSelectedValues.map((selected) => (
          <Chip
            key={selected}
            tone="accent"
            onRemove={() => toggleChoice(selected)}
            removeLabel={t("book.customOptionRemove", { value: selected })}
            title={t("book.customOptionTitle", { value: selected })}
          >
            {selected}
          </Chip>
        ))}
      </div>
      <div className="concept-chip-custom">
        <input
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomValue();
            }
          }}
          onFocus={() => activatePromptContext(field)}
          placeholder={t("book.customOption")}
          title={t("book.customOptionAddValueTitle", { label })}
          aria-label={t("book.customOptionAria", { label })}
        />
        <Button
          variant="icon"
          onClick={addCustomValue}
          title={t("book.customOptionAddTitle", { label })}
          aria-label={t("book.customOptionAddAria", { label })}
        >
          <Plus size={15} aria-hidden />
        </Button>
      </div>
    </Field>
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
    case "cancelled":
      return 2;
    case "success":
      return 3;
  }
}

function validateConceptForm(
  form: ConceptForm,
  t: (key: string) => string
): string {
  if (form.targetWordCount.trim() && parseOptionalPositiveInt(form.targetWordCount) === null) {
    return t("book.validationWordCount");
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
