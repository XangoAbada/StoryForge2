import { createRootRoute, createRoute, createRouter, Outlet, useParams } from "@tanstack/react-router";
import { DashboardPage } from "../features/projects/DashboardPage";
import { ProjectShell } from "./ProjectShell";
import { BookConceptPage } from "../features/book/BookConceptPage";
import { BookPlanPage } from "../features/book/BookPlanPage";
import { CharactersPage } from "../features/characters/CharactersPage";
import { WorldPage } from "../features/world/WorldPage";
import { CodexSettingsPage } from "../features/ai/CodexSettingsPage";
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

const projectAiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai",
  component: ProjectAiRoute
});

const projectAiLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai-log",
  component: ProjectAiLogRoute
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  projectRoute,
  projectConceptRoute,
  projectPlanRoute,
  projectCharactersRoute,
  projectWorldRoute,
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

function ProjectAiRoute() {
  const projectId = useProjectId();
  return (
    <ProjectShell projectId={projectId} activeSection="ai">
      <CodexSettingsPage />
    </ProjectShell>
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
