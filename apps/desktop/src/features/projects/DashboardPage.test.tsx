import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPromptContextStore } from "../ai/aiPromptContextStore";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import { useProposalStore } from "../ai/proposalStore";
import { DashboardPage } from "./DashboardPage";
import type { ProjectDetails, ProjectSummary } from "../../shared/api/types";
import {
  checkCodexCli,
  createProject,
  generateNewProjectTitle,
  getProject,
  listCodexModels,
  listProjects,
  runCodexPrompt,
  updateBookConcept
} from "../../shared/api/commands";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params
  }: {
    children: ReactNode;
    className?: string;
    params?: { projectId?: string };
  }) => (
    <a className={className} href={`/projects/${params?.projectId ?? "x"}/concept`}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn()
}));

vi.mock("../../shared/api/commands", async () => ({
  acceptGeneratedBookCover: vi.fn(),
  getAiSettings: vi.fn(async () =>
    (await import("../../shared/api/types")).DEFAULT_AI_SETTINGS
  ),
  cancelActiveCodexRun: vi.fn(),
  checkCodexCli: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  generateNewProjectTitle: vi.fn(),
  getProject: vi.fn(),
  listActiveCodexRuns: vi.fn(() => Promise.resolve([])),
  listAiProposals: vi.fn(() => Promise.resolve([])),
  listCodexModels: vi.fn(),
  listProjects: vi.fn(),
  markAiProposalAccepted: vi.fn(() => Promise.resolve()),
  markAiProposalRejected: vi.fn(() => Promise.resolve()),
  runCodexPrompt: vi.fn(),
  upsertAiProposalSnapshot: vi.fn(() => Promise.resolve()),
  updateBookConcept: vi.fn()
}));

const projectSummary: ProjectSummary = {
  id: "project-1",
  name: "Projekt testowy",
  language: "pl",
  updatedAt: "2026-06-05T12:00:00Z",
  activeBookId: "book-1",
  workingTitle: "Roboczy tytuł",
  coverImagePath:
    "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22/%3E"
};

const projectDetails: ProjectDetails = {
  project: {
    id: "project-1",
    name: "Projekt testowy",
    language: "pl",
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z",
    activeBookId: "book-1",
    settingsJson: "{}"
  },
  book: {
    id: "book-1",
    projectId: "project-1",
    title: "",
    workingTitle: "Roboczy tytuł",
    premise: "Bohaterka szuka zaginionej siostry.",
    protagonistSummary: "",
    protagonistGoal: "",
    expandedPremise: "",
    centralConflict: "",
    antagonistForce: "",
    stakes: "",
    settingSketch: "",
    endingDirection: "",
    genre: "kryminal",
    subgenre: "",
    targetAudience: "adult",
    tone: "napięty",
    styleGuide: "",
    pointOfView: "",
    targetWordCount: null,
    themesJson: "[]",
    unwantedThemes: "",
    alternativeTitlesJson: "[]",
    coverImagePath: projectSummary.coverImagePath,
    coverPrompt: "cover prompt",
    coverNegativePrompt: "watermark",
    coverGeneratedAt: "2026-06-05T12:00:00Z",
    storySoFar: "",
    storySoFarStale: 0,
    status: "draft",
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z"
  }
};

const titleOutput = JSON.stringify({
  version: 1,
  kind: "concept_field_suggestion",
  field: "workingTitle",
  summary: "Nowy tytuł",
  value: "Siostra z mgły",
  values: [],
  rationale: "Podkreśla tajemnicę.",
  warnings: []
});

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([projectSummary]);
    vi.mocked(getProject).mockResolvedValue(projectDetails);
    vi.mocked(createProject).mockResolvedValue(projectDetails);
    vi.mocked(checkCodexCli).mockResolvedValue({
      available: true,
      path: "codex",
      version: "codex 1.0.0",
      authLikelyReady: null
    });
    vi.mocked(listCodexModels).mockResolvedValue({
      fallback: true,
      models: [],
      errorMessage: "fallback"
    });
    vi.mocked(runCodexPrompt).mockResolvedValue({
      id: "run-1",
      providerId: "codex-cli-bridge",
      promptPackageId: "generate_working_title:test",
      action: "generate_working_title",
      status: "success",
      rawOutput: titleOutput,
      durationMs: 10
    });
    vi.mocked(generateNewProjectTitle).mockResolvedValue({
      id: "new-title-run-1",
      providerId: "codex-cli-bridge",
      promptPackageId: "generate_working_title:new-project",
      action: "generate_working_title",
      status: "success",
      rawOutput: titleOutput,
      durationMs: 10
    });
    vi.mocked(updateBookConcept).mockResolvedValue({
      ...projectDetails.book,
      workingTitle: "Siostra z mgły"
    });
    useProposalStore.setState({ proposals: [], activeProposal: null });
    useAiPromptContextStore.setState({
      activeTargetId: null,
      targets: {},
      drafts: {}
    });
    useCodexSettingsStore.setState({
      codexPath: "codex",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      timeoutSeconds: 180
    });
  });

  it("renders book-shaped project cards with covers and accepts dashboard title proposals", async () => {
    const rendered = renderDashboard();

    expect(await screen.findByText("Roboczy tytuł")).toBeInTheDocument();
    expect(rendered.container.querySelector(".book .cover img")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Generuj tytuł roboczy z AI dla projektu Roboczy tytuł/i
      })
    );

    const panel = await screen.findByLabelText("Kontekst promptu AI");
    expect(runCodexPrompt).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: /Wy.lij do AI/i }));
    expect(await screen.findByDisplayValue("Siostra z mgły")).toBeInTheDocument();
    const request = vi.mocked(runCodexPrompt).mock.calls[0][0];
    expect(request.promptPackageJson).toMatchObject({
      context: {
        contextControl: expect.any(Object)
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /Akceptuj/i }));

    await waitFor(() =>
      expect(updateBookConcept).toHaveBeenCalledWith("book-1", {
        workingTitle: "Siostra z mgły"
      })
    );
  });

  it("shows a new project title in proposals and applies it after acceptance", async () => {
    renderDashboard();

    const generateButton = await screen.findByRole("button", {
      name: /Generuj tytuł dla nowego projektu/i
    });
    await waitFor(() => expect(generateButton).not.toBeDisabled());
    const titleInput = screen.getByPlaceholderText("Roboczy tytuł książki");

    fireEvent.click(generateButton);

    const panel = await screen.findByLabelText("Kontekst promptu AI");
    expect(generateNewProjectTitle).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: /Wy.lij do AI/i }));
    expect(await screen.findByDisplayValue("Siostra z mgły")).toBeInTheDocument();
    expect(titleInput).toHaveValue("");
    expect(generateNewProjectTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "generate_working_title",
        model: "gpt-5.5",
        reasoningEffort: "medium"
      })
    );
    const request = vi.mocked(generateNewProjectTitle).mock.calls[0][0];
    expect(request.promptPackageJson).toMatchObject({
      context: {
        contextControl: expect.any(Object)
      }
    });

    fireEvent.click(screen.getByRole("button", { name: /Akceptuj/i }));

    await waitFor(() => expect(titleInput).toHaveValue("Siostra z mgły"));
    expect(createProject).not.toHaveBeenCalled();
    expect(updateBookConcept).not.toHaveBeenCalled();
  });

  it("uses dashboard prompt context comment for a new project title", async () => {
    renderDashboard();

    const titleInput = await screen.findByPlaceholderText("Roboczy tytuł książki");
    fireEvent.focus(titleInput);

    const panel = await screen.findByLabelText("Kontekst promptu AI");
    expect(within(panel).getByLabelText("Kontekst: Wpis autora")).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /Dodaj wpis autora do kontekstu promptu/i
      })
    ).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("Komentarz autora"), {
      target: { value: "Tytuł ma brzmieć jak chłodny thriller." }
    });

    fireEvent.click(
      within(panel).getByRole("button", { name: /Wy.lij do AI/i })
    );

    await waitFor(() => expect(generateNewProjectTitle).toHaveBeenCalled());
    const request = vi.mocked(generateNewProjectTitle).mock.calls[0][0];

    expect(request.prompt).toContain("Tytuł ma brzmieć jak chłodny thriller.");
    expect(request.promptPackageJson).toMatchObject({
      context: {
        contextControl: {
          authorPriorityComment: "Tytuł ma brzmieć jak chłodny thriller.",
          contextSources: [
            {
              key: "seedTitle",
              label: "Wpis autora",
              required: true
            }
          ]
        }
      }
    });
    expect(screen.queryByLabelText("Kontekst promptu AI")).not.toBeInTheDocument();
    expect(useAiPromptContextStore.getState().activeTargetId).toBeNull();
  });
});
