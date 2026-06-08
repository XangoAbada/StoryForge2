import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileText,
  History,
  Lightbulb,
  Map,
  PenLine,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useMemo
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getProject, listCodexModels } from "../shared/api/commands";
import type { ReasoningEffort } from "../shared/api/types";
import { AiProposalPanel } from "../features/ai/AiProposalPanel";
import { AiPromptContextPanel } from "../features/ai/AiPromptContextPanel";
import { useCodexSettingsStore } from "../features/ai/codexSettingsStore";
import {
  projectLogReturnHref,
  useProjectNavigationStore
} from "./projectNavigationStore";
import storyforgeLogo from "../assets/storyforge-logo-source.png";

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

const reasoningLevels: Array<{
  value: ReasoningEffort;
  label: string;
  hint: string;
}> = [
  { value: "low", label: "Low", hint: "Szybciej, mniej analizy." },
  { value: "medium", label: "Medium", hint: "Balans jakosci i czasu." },
  { value: "high", label: "High", hint: "Glebsze rozumowanie dla trudnych pol." },
  { value: "xhigh", label: "XHigh", hint: "Najglebsze rozumowanie, wolniejsze." }
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
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const model = useCodexSettingsStore((state) => state.model);
  const setModel = useCodexSettingsStore((state) => state.setModel);
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );
  const setReasoningEffort = useCodexSettingsStore(
    (state) => state.setReasoningEffort
  );
  const modelQuery = useQuery({
    queryKey: ["codex-models", codexPath],
    queryFn: () => listCodexModels(codexPath),
    retry: 0
  });
  const contextPanelWidth = useCodexSettingsStore(
    (state) => state.contextPanelWidth
  );
  const setContextPanelWidth = useCodexSettingsStore(
    (state) => state.setContextPanelWidth
  );
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
  const subtitle =
    activeSection === "concept"
      ? "Faza 2: Koncepcja książki"
      : activeSection === "aiLog"
        ? "Log AI"
        : "Ustawienia AI";

  const modelOptions = useMemo(() => {
    const catalogModels = modelQuery.data?.models ?? [];
    const options = [
      ...catalogModels.map((item) => {
        const rawItem = item as typeof item & { display_name?: string };
        return {
          value: item.slug,
          label: item.displayName || rawItem.display_name || item.slug,
          title: item.description || item.slug
        };
      }),
      {
        value: model,
        label: model,
        title: "Aktualnie wybrany model"
      },
      {
        value: "gpt-5.5",
        label: "GPT-5.5",
        title: "Fallback, gdy katalog modeli jest niedostepny"
      }
    ];
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
  }, [model, modelQuery.data?.models]);
  const reasoningIndex = Math.max(
    0,
    reasoningLevels.findIndex((level) => level.value === reasoningEffort)
  );

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
      const nextWidth = clamp(startWidth + startX - moveEvent.clientX, 300, 560);
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

  function updateReasoning(index: number) {
    setReasoningEffort(reasoningLevels[index]?.value ?? "medium");
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
          <span className="brand-mark">
            <img src={storyforgeLogo} alt="" />
          </span>
        </Link>

        <nav className="sidebar-nav" aria-label="Etapy pisania">
          <Link
            to="/projects/$projectId/concept"
            params={{ projectId }}
            className={activeSection === "concept" ? "nav-item active" : "nav-item"}
          >
            <Lightbulb size={18} />
            Koncepcja
          </Link>

          {disabledSections.map(({ label, icon: Icon }) => (
            <span className="nav-item disabled" key={label}>
              <Icon size={18} />
              {label}
            </span>
          ))}
        </nav>

        <div className="sidebar-bottom-nav">
          <Link
            to="/projects/$projectId/ai"
            params={{ projectId }}
            className={activeSection === "ai" ? "nav-item active" : "nav-item"}
          >
            <ShieldCheck size={18} />
            AI
          </Link>
          <span className="nav-item disabled">
            <Settings size={18} />
            Ustawienia
          </span>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div>
            <h1>Projekt: {title}</h1>
            <p>{subtitle}</p>
          </div>
        </header>

        <main className="workspace-main">{children}</main>
      </div>

      <aside className="context-panel global-context-panel" aria-label="Panel projektu">
        <button
          type="button"
          className="context-resize-handle"
          onPointerDown={handleResizeStart}
          title="Przeciągnij, aby zmienić szerokość panelu"
          aria-label="Zmień szerokość panelu projektu"
        />
        <div className="workspace-header-actions context-status-bar" aria-label="Status projektu">
          <span className="autosave-status">
            <CheckCircle2 size={16} />
            Zapisano automatycznie • 10:42
          </span>
          <details className="model-menu-panel">
            <summary
              className={projectQuery.isError ? "topbar-select muted" : "topbar-select ready"}
            >
              {projectQuery.isError ? <CircleDot size={16} /> : <CheckCircle2 size={16} />}
              <span>{projectQuery.isError ? "Błąd danych" : "Gotowy"}</span>
              <ChevronDown size={15} />
            </summary>
            <div className="model-menu-body">
              <label className="field-label">
                Model
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  title="Model uzywany przez codex exec przy generowaniu tresci pol."
                >
                  {modelOptions.map((option) => (
                    <option value={option.value} key={option.value} title={option.title}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Poziom reasoning
                <div className="reasoning-control">
                  <input
                    type="range"
                    min={0}
                    max={reasoningLevels.length - 1}
                    step={1}
                    value={reasoningIndex}
                    onChange={(event) => updateReasoning(Number(event.target.value))}
                    title={reasoningLevels[reasoningIndex]?.hint}
                  />
                  <div className="reasoning-labels" aria-hidden="true">
                    {reasoningLevels.map((level) => (
                      <span
                        key={level.value}
                        className={level.value === reasoningEffort ? "active" : ""}
                        title={level.hint}
                      >
                        {level.label}
                      </span>
                    ))}
                  </div>
                </div>
              </label>

              {modelQuery.data?.fallback ? (
                <p className="muted-text">{modelQuery.data.errorMessage}</p>
              ) : null}
            </div>
          </details>
        </div>
        <AiPromptContextPanel />
        <AiProposalPanel projectId={projectId} />
        <div className="context-panel-footer">
          <button
            type="button"
            className={
              activeSection === "aiLog"
                ? "context-footer-action active"
                : "context-footer-action"
            }
            title={activeSection === "aiLog" ? "Zamknij log AI" : "Otwórz log AI"}
            onClick={toggleAiLog}
          >
            <History size={18} />
            Log AI
          </button>
        </div>
      </aside>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
