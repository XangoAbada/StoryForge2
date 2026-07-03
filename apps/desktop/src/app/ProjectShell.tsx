import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  History,
  Search,
  Settings,
  ShieldCheck
} from "lucide-react";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAiSettings,
  getProject,
  listCodexModels,
  searchProject
} from "../shared/api/commands";
import type { ReasoningEffort, SearchResult } from "../shared/api/types";
import { describeTextProvider } from "../features/ai/textProviderInfo";
import { AiProposalPanel } from "../features/ai/AiProposalPanel";
import { AiPromptContextPanel } from "../features/ai/AiPromptContextPanel";
import { useCodexSettingsStore } from "../features/ai/codexSettingsStore";
import {
  projectLogReturnHref,
  useProjectNavigationStore
} from "./projectNavigationStore";

type ProjectShellProps = {
  projectId: string;
  activeSection: "concept" | "plan" | "characters" | "world" | "editor" | "export" | "ai" | "aiLog";
  children: ReactNode;
};

const reasoningLevels: Array<{
  value: ReasoningEffort;
  label: string;
  hint: string;
}> = [
  { value: "low", label: "Low", hint: "Szybciej, mniej analizy." },
  { value: "medium", label: "Medium", hint: "Balans jakości i czasu." },
  { value: "high", label: "High", hint: "Głębsze rozumowanie dla trudnych pól." },
  { value: "xhigh", label: "XHigh", hint: "Najgłębsze rozumowanie, wolniejsze." }
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
  const aiSettingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings,
    retry: 0
  });
  const providerInfo = describeTextProvider(aiSettingsQuery.data);
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
      : activeSection === "plan"
        ? "Faza 3: Plan powieści"
        : activeSection === "characters"
          ? "Faza 4: Postacie i relacje"
          : activeSection === "world"
            ? "Faza 5: Świat i reguły"
            : activeSection === "editor"
              ? "Faza 7: Edytor scen i rozdziałów"
              : activeSection === "export"
                ? "Eksport książki"
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
        title: "Fallback, gdy katalog modeli jest niedostępny"
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
          <span className="brand-word">
            Story<em>Forge</em>
          </span>
        </Link>

        <div className="sidebar-project">
          <strong>{title}</strong>
        </div>

        <nav className="sidebar-nav" aria-label="Etapy pisania">
          {(
            [
              ["concept", "01", "Koncepcja"],
              ["plan", "02", "Plan"],
              ["characters", "03", "Postacie"],
              ["world", "04", "Świat"],
              ["editor", "05", "Edytor"],
              ["export", "06", "Eksport"]
            ] as const
          ).map(([section, num, label]) => (
            <Link
              key={section}
              to={`/projects/$projectId/${section}`}
              params={{ projectId }}
              className={activeSection === section ? "nav-item active" : "nav-item"}
            >
              <span className="nav-num" aria-hidden>
                {num}
              </span>
              {label}
            </Link>
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
            <p>{subtitle}</p>
            <h1>{title}</h1>
          </div>
          <ProjectSearch projectId={projectId} />
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
              <span>
                {providerInfo.isCodex
                  ? `Codex CLI · ${model}`
                  : `${providerInfo.providerLabel} · ${providerInfo.modelLabel}`}
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="model-menu-body">
              {providerInfo.isCodex ? (
                <>
                  <label className="field-label">
                    Model
                    <select
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      title="Model używany przez codex exec przy generowaniu treści pól."
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
                </>
              ) : (
                <>
                  <p className="muted-text">
                    Aktywny dostawca tekstu: <strong>{providerInfo.providerLabel}</strong>
                    {providerInfo.modelLabel ? ` (${providerInfo.modelLabel})` : ""}. Model
                    i parametry ustawisz w ustawieniach AI. Suwak reasoning dotyczy tylko
                    Codeksa.
                  </p>
                  <Link
                    className="model-menu-settings-link"
                    to="/projects/$projectId/ai"
                    params={{ projectId }}
                  >
                    Otwórz ustawienia AI
                  </Link>
                </>
              )}
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

const searchSectionByEntityType: Record<string, { route: string; viewStateKey: string; label: string }> = {
  scene: { route: "editor", viewStateKey: "searchSceneId", label: "Scena" },
  character: { route: "characters", viewStateKey: "searchCharacterId", label: "Postać" },
  world_element: { route: "world", viewStateKey: "searchElementId", label: "Świat" }
};

function ProjectSearch({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const setProjectViewState = useProjectNavigationStore(
    (state) => state.setProjectViewState
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      searchProject(projectId, trimmed)
        .then((items) => {
          setResults(items);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [projectId, query]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function openResult(result: SearchResult) {
    const section = searchSectionByEntityType[result.entityType];
    if (!section) {
      return;
    }
    setProjectViewState(projectId, section.viewStateKey, result.entityId);
    setOpen(false);
    setQuery("");
    void navigate({
      to: `/projects/$projectId/${section.route}`,
      params: { projectId }
    });
  }

  return (
    <div className="project-search" ref={containerRef}>
      <label className="project-search-input">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Szukaj w projekcie…"
          aria-label="Szukaj w projekcie"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      </label>
      {open && query.trim().length >= 2 ? (
        <div className="project-search-results" role="listbox" aria-label="Wyniki wyszukiwania">
          {results.length === 0 ? (
            <p className="muted-text">Brak wyników.</p>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={`${result.entityType}:${result.entityId}`}
                className="project-search-result"
                onClick={() => openResult(result)}
              >
                <span className="project-search-kind">
                  {searchSectionByEntityType[result.entityType]?.label ?? result.entityType}
                </span>
                <strong>{result.title || "Bez tytułu"}</strong>
                <span className="project-search-snippet">{result.snippet}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
