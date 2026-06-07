import { BookOpen, FolderOpen, Loader2, Plus, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  checkCodexCli,
  createProject,
  getProject,
  listProjects
} from "../../shared/api/commands";
import { coverImageSource } from "../../shared/api/assets";
import { formatLocalDateTime } from "../../shared/date";
import { AiProposalPanel } from "../ai/AiProposalPanel";
import { AiPromptContextPanel } from "../ai/AiPromptContextPanel";
import { CodexStatusPanel } from "../ai/CodexStatusPanel";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import {
  createConceptPromptContextTarget,
  createNewProjectTitlePromptTarget,
  promptContextControlForTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import {
  buildNewProjectTitlePromptPackage,
  buildConceptFieldPromptPackage,
  conceptPromptContextSource,
  renderNewProjectTitlePromptPackage,
  renderPromptPackage
} from "../ai/promptPackage";
import {
  NEW_PROJECT_PROPOSAL_ID,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";

export function DashboardPage() {
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
  const resetPromptContextDraft = useAiPromptContextStore(
    (state) => state.resetDraft
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

  const queueProjectTitleMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const target = createConceptPromptContextTarget(projectId, "workingTitle");
      const details = await getProject(projectId);
      const contextControl = promptContextControlForTarget(target.targetId);
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
      resetPromptContextDraft(target.targetId);
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
    const target = createNewProjectTitlePromptTarget(name, {
      submitLabel: "Wy\u015blij do AI",
      submitDisabled:
        Boolean(newProjectStatus) ||
        createMutation.isPending,
      submitDisabledReason: "Generowanie tytulu jest teraz niedostepne.",
      onSubmit: enqueueNewProjectTitle
    });
    activatePromptContextTarget(target);
    const contextControl = promptContextControlForTarget(target.targetId);
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
    resetPromptContextDraft(target.targetId);
    setProposalProjectId(NEW_PROJECT_PROPOSAL_ID);
    setAiError("");
  }

  function activateNewProjectTitleTarget(nextName = name) {
    activatePromptContextTarget(
      createNewProjectTitlePromptTarget(nextName, {
        submitLabel: "Wy\u015blij do AI",
        submitDisabled:
          Boolean(newProjectStatus) ||
          createMutation.isPending,
        submitDisabledReason: "Generowanie tytulu jest teraz niedostepne.",
        onSubmit: enqueueNewProjectTitle
      })
    );
  }

  function activateProjectTitleTarget(projectId: string) {
    activatePromptContextTarget(
      createConceptPromptContextTarget(projectId, "workingTitle", {
        submitLabel: "Wy\u015blij do AI",
        submitDisabled:
          Boolean(proposalStatus(projectId)) ||
          queueProjectTitleMutation.isPending,
        submitDisabledReason: "Tytul roboczy jest juz w kolejce albo AI jest niedostepne.",
        onSubmit: () => queueProjectTitle(projectId)
      })
    );
  }

  function queueProjectTitle(projectId: string) {
    activateProjectTitleTarget(projectId);
    queueProjectTitleMutation.mutate(projectId);
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

  return (
    <main className="dashboard dashboard-with-panel">
      <div className="dashboard-main-column">
        <section className="dashboard-header">
          <div>
            <p className="eyebrow">StoryForge2</p>
            <h1>Projekty</h1>
            <p className="muted-text">
              Lokalny warsztat pisarski z kanonem, SQLite i Codex CLI Bridge.
            </p>
          </div>
          <form className="new-project-form" onSubmit={handleSubmit}>
            <label className="field-label">
              Nowy projekt
              <div className="inline-control new-project-title-control">
                <BookOpen size={16} aria-hidden="true" />
                <input
                  value={name}
                  onFocus={() => activateNewProjectTitleTarget()}
                  onChange={(event) => {
                    setName(event.target.value);
                    activateNewProjectTitleTarget(event.target.value);
                  }}
                  placeholder="Roboczy tytuł książki"
                />
                <button
                  type="button"
                  className="icon-button ai-inline-button"
                  aria-label="Generuj tytuł dla nowego projektu"
                  title="Generuj tytuł dla nowego projektu"
                  onFocus={() => activateNewProjectTitleTarget()}
                  onClick={enqueueNewProjectTitle}
                  disabled={
                    Boolean(newProjectStatus) ||
                    createMutation.isPending ||
                    codexUnavailable ||
                    codexStatusQuery.isLoading
                  }
                >
                  {newProjectStatus ? (
                    <Loader2 size={16} className="spin-icon" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                </button>
                <button
                  type="button"
                  className="icon-button ai-context-add-button"
                  aria-label="Dodaj wpis autora do kontekstu promptu"
                  title={
                    activePromptTarget
                      ? "Wpis autora jest juz wymaganym kontekstem tego promptu."
                      : "Najpierw zaznacz pole tekstowe, aby otworzyc kontekst promptu."
                  }
                  disabled
                >
                  <Plus size={14} />
                </button>
                <button
                  type="submit"
                  className="icon-button strong"
                  aria-label="Utwórz projekt"
                  title="Utwórz projekt"
                  disabled={createMutation.isPending || name.trim().length === 0}
                >
                  <Plus size={17} />
                </button>
              </div>
            </label>
            {createMutation.isError ? (
              <p className="warning-text">Nie udało się utworzyć projektu.</p>
            ) : null}
          </form>
        </section>

        <section className="project-list-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Biblioteka</p>
              <h2>Ostatnie projekty</h2>
            </div>
            <FolderOpen size={20} aria-hidden="true" />
          </div>

          {projectsQuery.isLoading ? (
            <p className="muted-text">Ładuję projekty...</p>
          ) : null}

          {projectsQuery.isError ? (
            <div className="empty-state">
              <h3>Backend desktopowy nie odpowiada</h3>
              <p>
                Uruchom aplikację przez Tauri, aby korzystać z lokalnej bazy
                SQLite i komend Rust.
              </p>
            </div>
          ) : null}

          {projectsQuery.data?.length === 0 ? (
            <div className="empty-state">
              <h3>Jeszcze nie ma projektów</h3>
              <p>Utwórz pierwszy projekt, a StoryForge2 założy książkę i bazę.</p>
            </div>
          ) : null}

          <div className="project-grid">
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
                <article className="project-card-shell" key={project.id}>
                  <Link
                    className="project-card book-card"
                    to="/projects/$projectId/concept"
                    params={{ projectId: project.id }}
                  >
                    <span className="project-cover-art">
                      {coverSrc ? (
                        <img src={coverSrc} alt="" />
                      ) : (
                        <span className="project-card-icon">
                          <BookOpen size={28} />
                        </span>
                      )}
                    </span>
                    <span className="project-card-copy">
                      <strong>{displayTitle}</strong>
                      <small>{project.name}</small>
                      <time>{formatLocalDateTime(project.updatedAt)}</time>
                    </span>
                  </Link>
                  <div className="project-card-ai-actions">
                  <button
                    type="button"
                    className="icon-button project-card-ai-button"
                    onFocus={() => activateProjectTitleTarget(project.id)}
                    onClick={() => queueProjectTitle(project.id)}
                    disabled={
                      generating ||
                      codexUnavailable ||
                      codexStatusQuery.isLoading ||
                      !project.activeBookId
                    }
                    title="Generuj tytuł roboczy z AI"
                    aria-label={`Generuj tytuł roboczy z AI dla projektu ${displayTitle}`}
                  >
                    {generating ? (
                      <Loader2 size={16} className="spin-icon" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                  </button>
                    <button
                      type="button"
                      className="icon-button ai-context-add-button project-card-context-button"
                      onClick={() => addProjectTitleToPromptContext(project.id)}
                    disabled={!canAddProjectTitleContext}
                    title={
                      activePromptTarget?.projectId !== project.id
                        ? "Najpierw otworz kontekst promptu tego projektu."
                        : "Tytul roboczy jest juz w kontekscie promptu."
                    }
                    aria-label={`Dodaj tytul roboczy projektu ${displayTitle} do kontekstu promptu`}
                  >
                    <Plus size={14} />
                  </button>
                  </div>
                </article>
              );
            })}
          </div>

          {aiError ? <p className="warning-text">{aiError}</p> : null}
        </section>
      </div>

      <aside className="dashboard-side-panel">
        <CodexStatusPanel compact />
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
                <p className="eyebrow">Propozycje</p>
                <h2>Panel AI</h2>
              </div>
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <p className="muted-text">
              Wybierz projekt i uruchom generowanie tytułu roboczego.
            </p>
          </section>
        )}
      </aside>
    </main>
  );
}
