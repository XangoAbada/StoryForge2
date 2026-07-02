import { Plus, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  checkCodexCli,
  createProject,
  deleteProject,
  getProject,
  listProjects
} from "../../shared/api/commands";
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
import { Button, EmptyState, Spinner, StatusPill } from "../../shared/ui";
import {
  NEW_PROJECT_PROPOSAL_ID,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";

function projectCountLabel(count: number): string {
  if (count === 1) {
    return "1 projekt";
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  const few = mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14);
  return `${count} ${few ? "projekty" : "projektów"}`;
}

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
        submitLabel: "Wyślij do AI",
        submitDisabled:
          Boolean(newProjectStatus) ||
          createMutation.isPending,
        submitDisabledReason: "Generowanie tytułu jest teraz niedostępne.",
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
        submitLabel: "Wyślij do AI",
        submitDisabled:
          Boolean(projectStatus) ||
          codexUnavailable ||
          codexStatusQuery.isLoading,
        submitDisabledReason: projectStatus
          ? "Tytuł roboczy jest już w kolejce AI."
          : "Codex CLI nie jest teraz gotowy.",
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

  function requestProjectDelete(projectId: string, displayTitle: string) {
    if (deleteMutation.isPending) {
      return;
    }

    const confirmed = window.confirm(
      `Usunąć projekt „${displayTitle}”? Tej operacji nie można cofnąć.`
    );

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
          <p className="masthead-over">Lokalny warsztat pisarski</p>
          <h1>
            Story<em>Forge</em>
          </h1>
          <p className="masthead-tagline">
            Od pierwszej iskry pomysłu do gotowego rękopisu.
          </p>
          <Link to="/settings" className="masthead-link">
            Ustawienia AI
          </Link>
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
              placeholder="Roboczy tytuł książki"
              aria-label="Roboczy tytuł nowej książki"
            />
            <Button
              variant="ai"
              aria-label="Generuj tytuł dla nowego projektu"
              title="Generuj tytuł dla nowego projektu"
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
              Zaproponuj
            </Button>
            <Button
              variant="icon"
              aria-label="Dodaj wpis autora do kontekstu promptu"
              title={
                activePromptTarget
                  ? "Wpis autora jest już wymaganym kontekstem tego promptu."
                  : "Najpierw zaznacz pole tekstowe, aby otworzyć kontekst promptu."
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
              Załóż projekt
            </Button>
          </div>
          {createMutation.isError ? (
            <p className="warning-text">Nie udało się utworzyć projektu.</p>
          ) : null}
        </form>

        <section className="shelf-section">
          <div className="shelf-label">
            <h2>Twoja półka</h2>
            <div className="rule" aria-hidden="true" />
            {projectCount > 0 ? <span>{projectCountLabel(projectCount)}</span> : null}
          </div>

          {projectsQuery.isLoading ? (
            <p className="muted-text shelf-loading">
              <Spinner /> Ładuję projekty...
            </p>
          ) : null}

          {projectsQuery.isError ? (
            <EmptyState
              title="Backend desktopowy nie odpowiada"
              description="Uruchom aplikację przez Tauri, aby korzystać z lokalnej bazy SQLite i komend Rust."
            />
          ) : null}

          {projectsQuery.data?.length === 0 ? (
            <EmptyState
              title="Jeszcze nie ma projektów"
              description="Utwórz pierwszy projekt, a StoryForge2 założy książkę i bazę."
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
                          <StatusPill tone="warn">AI w toku</StatusPill>
                        ) : null}
                      </span>
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
                      title="Generuj tytuł roboczy z AI"
                      aria-label={`Generuj tytuł roboczy z AI dla projektu ${displayTitle}`}
                    >
                      {generating ? <Spinner /> : <Sparkles size={15} />}
                    </Button>
                    <Button
                      variant="icon"
                      onClick={() => addProjectTitleToPromptContext(project.id)}
                      disabled={!canAddProjectTitleContext}
                      title={
                        activePromptTarget?.projectId !== project.id
                          ? "Najpierw otwórz kontekst promptu tego projektu."
                          : "Tytuł roboczy jest już w kontekście promptu."
                      }
                      aria-label={`Dodaj tytuł roboczy projektu ${displayTitle} do kontekstu promptu`}
                    >
                      <Plus size={14} />
                    </Button>
                    <Button
                      variant="icon"
                      className="book-delete"
                      onClick={() => requestProjectDelete(project.id, displayTitle)}
                      disabled={deleteMutation.isPending}
                      title="Usuń projekt"
                      aria-label={`Usuń projekt ${displayTitle}`}
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
            <p className="warning-text">Nie udało się usunąć projektu.</p>
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
