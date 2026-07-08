import { Download, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  checkCodexCli,
  chooseExportDirectory,
  chooseImportFile,
  createProject,
  deleteProject,
  exportProject,
  getAiSettings,
  getProject,
  importProject,
  listAiRunUsageTotalsAll,
  listProjects,
  revealExportFile
} from "../../shared/api/commands";
import { setUiLanguage, UI_LANGUAGES } from "../../shared/i18n";
import { formatPln, formatUsd, totalCostOf } from "../ai/pricing";
import { coverImageSource } from "../../shared/api/assets";
import { formatLocalDateTime } from "../../shared/date";
import { AiProposalPanel } from "../ai/AiProposalPanel";
import { AiPromptContextPanel } from "../ai/AiPromptContextPanel";
import { AiProviderStatusPanel } from "../ai/AiProviderStatusPanel";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import {
  NEW_PROJECT_TITLE_PROMPT_TARGET_ID,
  createConceptPromptContextTarget,
  createNewProjectTitlePromptTarget,
  conceptPromptContextTargetId,
  promptContextControlForActiveTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import {
  buildNewProjectTitlePromptPackage,
  buildConceptFieldPromptPackage,
  conceptPromptContextSource,
  renderNewProjectTitlePromptPackage,
  renderPromptPackage
} from "../ai/promptPackage";
import { Button, EmptyState, Spinner, StatusPill, confirmDialog } from "../../shared/ui";
import {
  NEW_PROJECT_PROPOSAL_ID,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [proposalProjectId, setProposalProjectId] = useState("");
  const [aiError, setAiError] = useState("");
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore(
    (state) => state.activateTarget
  );
  const closePromptContextTarget = useAiPromptContextStore(
    (state) => state.closeTarget
  );
  const activePromptTargetId = useAiPromptContextStore(
    (state) => state.activeTargetId
  );
  const activePromptTarget = useAiPromptContextStore((state) =>
    activePromptTargetId ? state.targets[activePromptTargetId] : null
  );
  const addContextSourceToActiveTarget = useAiPromptContextStore(
    (state) => state.addContextSourceToActiveTarget
  );

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    retry: 0
  });

  const codexStatusQuery = useQuery({
    queryKey: ["codex-cli", codexPath],
    queryFn: () => checkCodexCli(codexPath),
    retry: 0
  });

  const usageTotalsQuery = useQuery({
    queryKey: ["ai-run-usage-totals-all"],
    queryFn: listAiRunUsageTotalsAll,
    retry: 0
  });
  const aiSettingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings,
    retry: 0
  });
  const plnPerUsd = aiSettingsQuery.data?.plnPerUsd ?? 4;

  const projectCost = (projectId: string) =>
    totalCostOf(
      (usageTotalsQuery.data ?? []).filter((group) => group.projectId === projectId)
    );

  const createMutation = useMutation({
    mutationFn: () => createProject({ name, language: "pl" }),
    onSuccess: async (details) => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate({
        to: "/projects/$projectId/concept",
        params: { projectId: details.project.id }
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const [transferInfo, setTransferInfo] = useState("");
  const [transferWarnings, setTransferWarnings] = useState<string[]>([]);

  const exportProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const outputDirectory = await chooseExportDirectory();
      if (!outputDirectory) {
        return null;
      }
      const result = await exportProject({ projectId, outputDirectory });
      await revealExportFile(result.filePath);
      return result;
    },
    onMutate: () => {
      setTransferInfo("");
      setTransferWarnings([]);
    },
    onSuccess: (result) => {
      if (!result) {
        return;
      }
      setTransferInfo(t("dashboard.exportSuccess", { path: result.filePath }));
      setTransferWarnings(result.warnings);
    }
  });

  const importProjectMutation = useMutation({
    mutationFn: async () => {
      const zipPath = await chooseImportFile();
      if (!zipPath) {
        return null;
      }
      return importProject(zipPath);
    },
    onMutate: () => {
      setTransferInfo("");
      setTransferWarnings([]);
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }
      setTransferInfo(t("dashboard.importSuccess", { name: result.project.name }));
      setTransferWarnings(result.warnings);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const queueProjectTitleMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const targetId = conceptPromptContextTargetId(projectId, "workingTitle");
      const details = await getProject(projectId);
      const contextControl = promptContextControlForActiveTarget(targetId);
      const usedPromptContext = Boolean(contextControl);
      const promptPackage = buildConceptFieldPromptPackage(
        details.project,
        details.book,
        "workingTitle",
        contextControl
      );
      const prompt = renderPromptPackage(promptPackage);

      enqueueProposal({
        projectId,
        bookId: details.book.id,
        field: "workingTitle",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt
      });
      if (usedPromptContext) {
        closePromptContextTarget(targetId);
      }
    },
    onMutate: (projectId) => {
      setProposalProjectId(projectId);
      setAiError("");
    },
    onSuccess: () => setAiError(""),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setAiError(message);
    }
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length === 0) {
      return;
    }
    createMutation.mutate();
  }

  function enqueueNewProjectTitle() {
    const contextControl = promptContextControlForActiveTarget(
      NEW_PROJECT_TITLE_PROMPT_TARGET_ID
    );
    const usedPromptContext = Boolean(contextControl);
    const promptPackage = buildNewProjectTitlePromptPackage(
      name,
      "pl",
      contextControl
    );
    const prompt = renderNewProjectTitlePromptPackage(promptPackage);

    enqueueProposal({
      scope: "newProject",
      projectId: NEW_PROJECT_PROPOSAL_ID,
      bookId: NEW_PROJECT_PROPOSAL_ID,
      field: "workingTitle",
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt
    });
    if (usedPromptContext) {
      closePromptContextTarget(NEW_PROJECT_TITLE_PROMPT_TARGET_ID);
    }
    setProposalProjectId(NEW_PROJECT_PROPOSAL_ID);
    setAiError("");
  }

  function activateNewProjectTitleTarget(nextName = name) {
    activatePromptContextTarget(
      createNewProjectTitlePromptTarget(nextName, {
        submitLabel: t("dashboard.sendToAi"),
        submitDisabled:
          Boolean(newProjectStatus) ||
          createMutation.isPending,
        submitDisabledReason: t("dashboard.generateTitleUnavailable"),
        onSubmit: enqueueNewProjectTitle
      })
    );
  }

  function queueProjectTitle(projectId: string) {
    queueProjectTitleMutation.mutate(projectId);
  }

  function activateProjectTitleTarget(projectId: string) {
    const projectStatus = proposalStatus(projectId);
    setProposalProjectId(projectId);
    setAiError("");
    activatePromptContextTarget(
      createConceptPromptContextTarget(projectId, "workingTitle", {
        submitLabel: t("dashboard.sendToAi"),
        submitDisabled:
          Boolean(projectStatus) ||
          codexUnavailable ||
          codexStatusQuery.isLoading,
        submitDisabledReason: projectStatus
          ? t("dashboard.titleAlreadyQueued")
          : t("dashboard.codexNotReady"),
        onSubmit: () => queueProjectTitle(projectId)
      })
    );
  }

  function addProjectTitleToPromptContext(projectId: string) {
    if (
      activePromptTarget?.projectId !== projectId ||
      activePromptTarget.sources.some((source) => source.key === "workingTitle")
    ) {
      return;
    }

    addContextSourceToActiveTarget(conceptPromptContextSource("workingTitle"));
  }

  async function requestProjectDelete(projectId: string, displayTitle: string) {
    if (deleteMutation.isPending) {
      return;
    }

    const confirmed = await confirmDialog({
      title: t("common.delete"),
      message: t("dashboard.deleteConfirm", { title: displayTitle }),
      confirmLabel: t("common.delete"),
      danger: true
    });

    if (confirmed) {
      deleteMutation.mutate(projectId);
    }
  }

  const codexUnavailable = codexStatusQuery.data?.available === false;
  const newProjectStatus = proposalStatus(NEW_PROJECT_PROPOSAL_ID);
  const firstVisibleProposal =
    proposals.find((proposal) => proposal.projectId === NEW_PROJECT_PROPOSAL_ID) ??
    proposals.find((proposal) => proposal.projectId === proposalProjectId) ??
    proposals[0];
  const visibleProposalProjectId =
    firstVisibleProposal?.projectId ||
    proposalProjectId ||
    projectsQuery.data?.[0]?.id ||
    "";

  function proposalStatus(projectId: string): "queued" | "running" | null {
    return pendingProposalStatus(proposals, {
      projectId,
      field: "workingTitle",
      scope:
        projectId === NEW_PROJECT_PROPOSAL_ID ? "newProject" : "bookConcept"
    });
  }

  const projectCount = projectsQuery.data?.length ?? 0;

  return (
    <main className="dashboard dashboard-with-panel">
      <div className="dashboard-main-column">
        <header className="masthead">
          <p className="masthead-over">{t("dashboard.mastheadOver")}</p>
          <h1>
            Bow<em>ri</em>
          </h1>
          <p className="masthead-tagline">{t("dashboard.mastheadTagline")}</p>
          <div className="masthead-controls">
            <label className="masthead-ai-language">
              <span>{t("dashboard.uiLanguage")}</span>
              <select
                value={i18n.language}
                onChange={(event) => setUiLanguage(event.target.value)}
              >
                {UI_LANGUAGES.map((language) => (
                  <option value={language.value} key={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <Link to="/settings" className="masthead-link">
              {t("dashboard.settingsLink")}
            </Link>
          </div>
        </header>

        <form className="new-project-form" onSubmit={handleSubmit}>
          <div className="new-project-row">
            <input
              className="new-project-input"
              value={name}
              onFocus={() => activateNewProjectTitleTarget()}
              onChange={(event) => {
                setName(event.target.value);
                activateNewProjectTitleTarget(event.target.value);
              }}
              placeholder={t("dashboard.newProjectPlaceholder")}
              aria-label={t("dashboard.newProjectAriaLabel")}
            />
            <Button
              variant="ai"
              aria-label={t("dashboard.generateNewTitleAria")}
              title={t("dashboard.generateNewTitleAria")}
              onClick={() => activateNewProjectTitleTarget()}
              disabled={
                Boolean(newProjectStatus) ||
                createMutation.isPending ||
                codexUnavailable ||
                codexStatusQuery.isLoading
              }
            >
              {newProjectStatus ? (
                <Spinner />
              ) : (
                <Sparkles size={15} aria-hidden="true" />
              )}
              {t("dashboard.propose")}
            </Button>
            <Button
              variant="icon"
              aria-label={t("dashboard.addAuthorNoteAria")}
              title={
                activePromptTarget
                  ? t("dashboard.addAuthorNoteActive")
                  : t("dashboard.addAuthorNoteHint")
              }
              disabled
            >
              <Plus size={14} />
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={createMutation.isPending}
              disabled={name.trim().length === 0}
            >
              {t("dashboard.createProject")}
            </Button>
          </div>
          {createMutation.isError ? (
            <p className="warning-text">{t("dashboard.createProjectError")}</p>
          ) : null}
        </form>

        <section className="shelf-section">
          <div className="shelf-label">
            <h2>{t("dashboard.shelfTitle")}</h2>
            <div className="rule" aria-hidden="true" />
            <div className="shelf-label-actions">
              {projectCount > 0 ? (
                <span className="shelf-count">
                  {t("dashboard.projectCount", { count: projectCount })}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="shelf-import"
                onClick={() => importProjectMutation.mutate()}
                disabled={importProjectMutation.isPending}
                title={t("dashboard.importProject")}
              >
                {importProjectMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Upload size={15} aria-hidden="true" />
                )}
                {t("dashboard.importProjectShort")}
              </Button>
            </div>
          </div>

          {projectsQuery.isLoading ? (
            <p className="muted-text shelf-loading">
              <Spinner /> {t("dashboard.loadingProjects")}
            </p>
          ) : null}

          {projectsQuery.isError ? (
            <EmptyState
              title={t("dashboard.backendUnavailableTitle")}
              description={t("dashboard.backendUnavailableDescription")}
            />
          ) : null}

          {projectsQuery.data?.length === 0 ? (
            <EmptyState
              title={t("dashboard.noProjectsTitle")}
              description={t("dashboard.noProjectsDescription")}
            />
          ) : null}

          <div className="shelf">
            {projectsQuery.data?.map((project) => {
              const coverSrc = coverImageSource(project.coverImagePath);
              const displayTitle = project.workingTitle || project.name;
              const projectQueueStatus = proposalStatus(project.id);
              const generating =
                (queueProjectTitleMutation.isPending &&
                  queueProjectTitleMutation.variables === project.id) ||
                Boolean(projectQueueStatus);
              const projectTitleAlreadyInContext = Boolean(
                activePromptTarget?.sources.some(
                  (source) => source.key === "workingTitle"
                )
              );
              const canAddProjectTitleContext =
                activePromptTarget?.projectId === project.id &&
                !projectTitleAlreadyInContext;

              return (
                <article className="book" key={project.id}>
                  <Link
                    className="book-link"
                    to="/projects/$projectId/concept"
                    params={{ projectId: project.id }}
                  >
                    <span className="cover">
                      {coverSrc ? (
                        <img src={coverSrc} alt="" />
                      ) : (
                        <>
                          <span className="cover-title">{displayTitle}</span>
                          <span className="cover-sub">{project.name}</span>
                        </>
                      )}
                    </span>
                    <span className="book-meta">
                      <strong className="book-title">{displayTitle}</strong>
                      <span className="book-row">
                        <time>{formatLocalDateTime(project.updatedAt)}</time>
                        {generating ? (
                          <StatusPill tone="warn">
                            {t("dashboard.aiInProgress")}
                          </StatusPill>
                        ) : null}
                      </span>
                      {(() => {
                        const cost = projectCost(project.id);
                        if (!cost.hasPricing || cost.usd <= 0) {
                          return null;
                        }
                        return (
                          <span
                            className="book-cost"
                            title={t("dashboard.costTitle")}
                          >
                            {cost.estimated ? "~" : ""}
                            {formatUsd(cost.usd)}
                            <span className="book-cost-pln">
                              {formatPln(cost.usd, plnPerUsd)}
                            </span>
                          </span>
                        );
                      })()}
                    </span>
                  </Link>
                  <div className="book-actions">
                    <Button
                      variant="icon"
                      onClick={() => activateProjectTitleTarget(project.id)}
                      disabled={
                        generating ||
                        codexUnavailable ||
                        codexStatusQuery.isLoading ||
                        !project.activeBookId
                      }
                      title={t("dashboard.generateTitleAiTitle")}
                      aria-label={t("dashboard.generateTitleAiAria", {
                        title: displayTitle
                      })}
                    >
                      {generating ? <Spinner /> : <Sparkles size={15} />}
                    </Button>
                    <Button
                      variant="icon"
                      onClick={() => addProjectTitleToPromptContext(project.id)}
                      disabled={!canAddProjectTitleContext}
                      title={
                        activePromptTarget?.projectId !== project.id
                          ? t("dashboard.addTitleContextOpenFirst")
                          : t("dashboard.addTitleContextAlready")
                      }
                      aria-label={t("dashboard.addTitleContextAria", {
                        title: displayTitle
                      })}
                    >
                      <Plus size={14} />
                    </Button>
                    <Button
                      variant="icon"
                      onClick={() => exportProjectMutation.mutate(project.id)}
                      disabled={exportProjectMutation.isPending}
                      title={t("dashboard.exportProject")}
                      aria-label={t("dashboard.exportProjectAria", {
                        title: displayTitle
                      })}
                    >
                      {exportProjectMutation.isPending &&
                      exportProjectMutation.variables === project.id ? (
                        <Spinner />
                      ) : (
                        <Download size={15} />
                      )}
                    </Button>
                    <Button
                      variant="icon"
                      className="book-delete"
                      onClick={() => requestProjectDelete(project.id, displayTitle)}
                      disabled={deleteMutation.isPending}
                      title={t("dashboard.deleteProject")}
                      aria-label={t("dashboard.deleteProjectAria", {
                        title: displayTitle
                      })}
                    >
                      {deleteMutation.isPending &&
                      deleteMutation.variables === project.id ? (
                        <Spinner />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {aiError ? <p className="warning-text">{aiError}</p> : null}
          {deleteMutation.isError ? (
            <p className="warning-text">{t("dashboard.deleteProjectError")}</p>
          ) : null}
          {transferInfo ? <p className="muted-text">{transferInfo}</p> : null}
          {transferWarnings.map((warning) => (
            <p className="warning-text" key={warning}>
              {warning}
            </p>
          ))}
          {exportProjectMutation.isError ? (
            <p className="warning-text">
              {t("dashboard.exportError", {
                message:
                  exportProjectMutation.error instanceof Error
                    ? exportProjectMutation.error.message
                    : String(exportProjectMutation.error)
              })}
            </p>
          ) : null}
          {importProjectMutation.isError ? (
            <p className="warning-text">
              {t("dashboard.importError", {
                message:
                  importProjectMutation.error instanceof Error
                    ? importProjectMutation.error.message
                    : String(importProjectMutation.error)
              })}
            </p>
          ) : null}
        </section>
      </div>

      <aside className="dashboard-side-panel">
        <AiProviderStatusPanel />
        <AiPromptContextPanel />
        {visibleProposalProjectId ? (
          <AiProposalPanel
            projectId={visibleProposalProjectId}
            onAcceptValue={
              visibleProposalProjectId === NEW_PROJECT_PROPOSAL_ID
                ? (value) => setName(value)
                : undefined
            }
          />
        ) : (
          <section className="context-section compact">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">{t("dashboard.proposalsEyebrow")}</p>
                <h2>{t("dashboard.proposalsPanelTitle")}</h2>
              </div>
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <p className="muted-text">{t("dashboard.proposalsEmpty")}</p>
          </section>
        )}
      </aside>
    </main>
  );
}
