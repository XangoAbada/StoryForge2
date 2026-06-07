import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Boxes,
  Brain,
  FileText,
  History,
  Map,
  PenLine,
  Settings,
  Users
} from "lucide-react";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getProject } from "../shared/api/commands";
import { AiProposalPanel } from "../features/ai/AiProposalPanel";
import { AiPromptContextPanel } from "../features/ai/AiPromptContextPanel";
import { CodexStatusPanel } from "../features/ai/CodexStatusPanel";
import { useCodexSettingsStore } from "../features/ai/codexSettingsStore";
import {
  projectLogReturnHref,
  useProjectNavigationStore
} from "./projectNavigationStore";

type ProjectShellProps = {
  projectId: string;
  activeSection: "concept" | "ai" | "aiLog";
  children: ReactNode;
};

const disabledSections = [
  { label: "Plan", icon: Map },
  { label: "Postacie", icon: Users },
  { label: "Świat", icon: Boxes },
  { label: "Rozdziały", icon: FileText },
  { label: "Edytor", icon: PenLine },
  { label: "Ciągłość", icon: Brain }
];

export function ProjectShell({
  projectId,
  activeSection,
  children
}: ProjectShellProps) {
  const navigate = useNavigate();
  const location = useLocation({
    select: (currentLocation) => ({
      href: currentLocation.href
    })
  });
  const contextPanelWidth = useCodexSettingsStore(
    (state) => state.contextPanelWidth
  );
  const setContextPanelWidth = useCodexSettingsStore(
    (state) => state.setContextPanelWidth
  );
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const rememberLogReturnLocation = useProjectNavigationStore(
    (state) => state.rememberLogReturnLocation
  );
  const storedLogReturnLocation = useProjectNavigationStore(
    (state) => state.logReturnLocations[projectId]
  );

  const title =
    projectQuery.data?.book.workingTitle ||
    projectQuery.data?.project.name ||
    "Projekt";

  useEffect(() => {
    if (activeSection !== "aiLog") {
      rememberLogReturnLocation(projectId, location.href);
    }
  }, [activeSection, location.href, projectId, rememberLogReturnLocation]);

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = contextPanelWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = clamp(startWidth + startX - moveEvent.clientX, 280, 560);
      setContextPanelWidth(nextWidth);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function toggleAiLog() {
    if (activeSection === "aiLog") {
      void navigate({
        href: projectLogReturnHref(projectId, storedLogReturnLocation)
      });
      return;
    }

    rememberLogReturnLocation(projectId, location.href);
    void navigate({
      to: "/projects/$projectId/ai-log",
      params: { projectId }
    });
  }

  return (
    <div
      className="project-shell"
      style={
        {
          "--context-panel-width": `${contextPanelWidth}px`
        } as CSSProperties
      }
    >
      <aside className="sidebar">
        <Link className="brand-link" to="/">
          <span>SF2</span>
          <strong>StoryForge2</strong>
        </Link>

        <nav className="sidebar-nav" aria-label="Etapy pisania">
          <Link
            to="/projects/$projectId/concept"
            params={{ projectId }}
            className={activeSection === "concept" ? "nav-item active" : "nav-item"}
          >
            <BookOpen size={17} />
            Koncepcja
          </Link>

          {disabledSections.map(({ label, icon: Icon }) => (
            <span className="nav-item disabled" key={label}>
              <Icon size={17} />
              {label}
            </span>
          ))}
        </nav>

        <Link
          to="/projects/$projectId/ai"
          params={{ projectId }}
          className={activeSection === "ai" ? "nav-item active bottom" : "nav-item bottom"}
        >
          <Settings size={17} />
          AI
        </Link>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Projekt</p>
            <h1>{title}</h1>
          </div>
          {projectQuery.isError ? (
            <span className="status-pill muted">błąd danych</span>
          ) : (
            <span className="status-pill">lokalny SQLite</span>
          )}
        </header>

        <main className="workspace-main">{children}</main>
      </div>

      <aside className="context-panel">
        <button
          type="button"
          className="context-resize-handle"
          onPointerDown={handleResizeStart}
          title="Przeciągnij, aby zmienić szerokość panelu AI"
          aria-label="Zmień szerokość panelu AI"
        />
        <CodexStatusPanel compact />
        <AiPromptContextPanel />
        <AiProposalPanel projectId={projectId} />
        <button
          type="button"
          className={
            activeSection === "aiLog"
              ? "context-log-link active"
              : "context-log-link"
          }
          title={activeSection === "aiLog" ? "Zamknij log AI" : "Otwórz log AI"}
          onClick={toggleAiLog}
        >
          <History size={16} />
          Log AI
        </button>
      </aside>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
