import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DashboardPage } from "../features/projects/DashboardPage";
import { ProjectShell } from "./ProjectShell";
import { BookConceptPage } from "../features/book/BookConceptPage";
import { BrainstormPage } from "../features/brainstorm/BrainstormPage";
import { BookPlanPage } from "../features/book/BookPlanPage";
import { CharactersPage } from "../features/characters/CharactersPage";
import { WorldPage } from "../features/world/WorldPage";
import { SceneEditorPage } from "../features/scenes/SceneEditorPage";
import { EditingPage } from "../features/editing/EditingPage";
import { ExportPage } from "../features/export/ExportPage";
import { AiSettingsPage } from "../features/ai/AiSettingsPage";
import { AiLogPage } from "../features/ai/AiLogPage";

const rootRoute = createRootRoute({
  component: RootLayout
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: ProjectConceptRoute
});

const projectBrainstormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/brainstorm",
  validateSearch: (search: Record<string, unknown>): { seed?: string; topic?: string } => ({
    seed: typeof search.seed === "string" ? search.seed : undefined,
    topic: typeof search.topic === "string" ? search.topic : undefined
  }),
  component: ProjectBrainstormRoute
});

const projectConceptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/concept",
  component: ProjectConceptRoute
});

const projectPlanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/plan",
  component: ProjectPlanRoute
});

const projectCharactersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/characters",
  component: ProjectCharactersRoute
});

const projectWorldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/world",
  component: ProjectWorldRoute
});

const projectEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/editor",
  component: ProjectEditorRoute
});

const projectEditingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/editing",
  component: ProjectEditingRoute
});

const projectExportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/export",
  component: ProjectExportRoute
});

// Ustawienia AI mają jedną kanoniczną trasę (/settings) — stary adres per
// projekt tylko przekierowuje, żeby nie utrzymywać dwóch wersji tej strony.
const projectAiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai",
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  }
});

const projectAiLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai-log",
  component: ProjectAiLogRoute
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  settingsRoute,
  projectRoute,
  projectBrainstormRoute,
  projectConceptRoute,
  projectPlanRoute,
  projectCharactersRoute,
  projectWorldRoute,
  projectEditorRoute,
  projectEditingRoute,
  projectExportRoute,
  projectAiRoute,
  projectAiLogRoute
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent"
});

function RootLayout() {
  return <Outlet />;
}

function ProjectBrainstormRoute() {
  const projectId = useProjectId();
  const { seed, topic } = projectBrainstormRoute.useSearch();
  return (
    <ProjectShell projectId={projectId} activeSection="brainstorm">
      <BrainstormPage projectId={projectId} seed={seed} topic={topic} />
    </ProjectShell>
  );
}

function ProjectConceptRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="concept">
      <BookConceptPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectPlanRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="plan">
      <BookPlanPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectCharactersRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="characters">
      <CharactersPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectWorldRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="world">
      <WorldPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectEditorRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="editor">
      <SceneEditorPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectEditingRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="editing">
      <EditingPage projectId={projectId} />
    </ProjectShell>
  );
}

function ProjectExportRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="export">
      <ExportPage projectId={projectId} />
    </ProjectShell>
  );
}

function SettingsRoute() {
  const { t } = useTranslation();
  return (
    <main className="settings-route">
      <div className="settings-route-inner">
        <Link to="/" className="settings-route-back">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("shell.back")}
        </Link>
        <AiSettingsPage />
      </div>
    </main>
  );
}

function ProjectAiLogRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="aiLog">
      <AiLogPage projectId={projectId} />
    </ProjectShell>
  );
}

function useProjectId(): string {
  const params = useParams({ strict: false }) as { projectId?: string };
  if (!params.projectId) {
    throw new Error("Missing projectId route parameter.");
  }
  return params.projectId;
}
