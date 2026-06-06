import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProposalPanel } from "../ai/AiProposalPanel";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import { useProposalStore } from "../ai/proposalStore";
import { BookConceptPage } from "./BookConceptPage";
import type { AiRunResult, ProjectDetails } from "../../shared/api/types";
import {
  checkCodexCli,
  generateBookCover,
  getProject,
  runCodexPrompt,
  updateBookConcept
} from "../../shared/api/commands";

vi.mock("../../shared/api/commands", () => ({
  checkCodexCli: vi.fn(),
  generateBookCover: vi.fn(),
  getProject: vi.fn(),
  runCodexPrompt: vi.fn(),
  updateBookConcept: vi.fn()
}));

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
    workingTitle: "Stary tytuł",
    premise: "Bohaterka szuka zaginionej siostry.",
    protagonistSummary: "",
    protagonistGoal: "",
    expandedPremise: "",
    logline: "",
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
    coverImagePath: "",
    coverPrompt: "",
    coverNegativePrompt: "",
    coverGeneratedAt: null,
    status: "draft",
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z"
  }
};

const conceptFieldOutput = JSON.stringify({
  version: 1,
  kind: "concept_field_suggestion",
  field: "workingTitle",
  summary: "Testowy tytuł",
  value: "Siostra z mgły",
  values: [],
  rationale: "Podkreśla tajemnicę.",
  warnings: []
});

const premiseSuggestionOutput = JSON.stringify({
  version: 1,
  kind: "concept_field_suggestion",
  field: "premise",
  summary: "Archiwistka odkrywa, że pamięć miasta jest fałszowana.",
  value:
    "Archiwistka odkrywa, że pamięć miasta jest fałszowana, i musi zdecydować, czy oddać siostrze prawdę kosztem spokoju mieszkańców.",
  values: [],
  rationale: "Używa istniejącego gatunku, tonu i zalążka konfliktu jako kontekstu.",
  warnings: []
});

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BookConceptPage projectId="project-1" />
      <AiProposalPanel projectId="project-1" />
    </QueryClientProvider>
  );
}

describe("BookConceptPage AI flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProject).mockResolvedValue(projectDetails);
    vi.mocked(checkCodexCli).mockResolvedValue({
      available: true,
      path: "codex",
      version: "codex 1.0.0",
      authLikelyReady: null
    });
    vi.mocked(runCodexPrompt).mockResolvedValue(successfulRun());
    vi.mocked(generateBookCover).mockResolvedValue({
      book: {
        ...projectDetails.book,
        coverImagePath: "data:image/png;base64,test",
        coverPrompt: "cover prompt",
        coverNegativePrompt: "negative",
        coverGeneratedAt: "2026-06-05T12:05:00Z"
      },
      aiRun: {
        id: "cover-run-1",
        providerId: "codex-cli-bridge",
        promptPackageId: "generate_cover_image:test",
        action: "generate_cover_image",
        status: "success",
        rawOutput: "{}",
        durationMs: 12
      },
      imagePath: "data:image/png;base64,test",
      prompt: "cover prompt",
      negativePrompt: "negative",
      generatedAt: "2026-06-05T12:05:00Z"
    });
    vi.mocked(updateBookConcept).mockResolvedValue({
      ...projectDetails.book,
      workingTitle: "Siostra z mgły"
    });
    useProposalStore.setState({ activeProposal: null });
    useCodexSettingsStore.setState({
      codexPath: "codex",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      timeoutSeconds: 180
    });
  });

  it("shows a field proposal immediately and saves only after acceptance", async () => {
    let resolveRun: (result: AiRunResult) => void = () => undefined;
    vi.mocked(runCodexPrompt).mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );

    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();
    const generateButton = screen.getByRole("button", {
      name: /Generuj Tytuł roboczy z AI/i
    });

    await waitFor(() => expect(generateButton).not.toBeDisabled());
    fireEvent.click(generateButton);

    expect(await screen.findByText(/Zadanie jest w kolejce panelu/i)).toBeInTheDocument();
    expect(updateBookConcept).not.toHaveBeenCalled();

    resolveRun(successfulRun());

    expect(await screen.findByDisplayValue("Siostra z mgły")).toBeInTheDocument();
    expect(runCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "generate_working_title",
        model: "gpt-5.5",
        reasoningEffort: "medium"
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Akceptuj/i }));

    await waitFor(() =>
      expect(updateBookConcept).toHaveBeenCalledWith("book-1", {
        workingTitle: "Siostra z mgły"
      })
    );
  });

  it("saves all phase 2 concept fields", async () => {
    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Bohater / bohaterka"), {
      target: { value: "Archiwistka z drukarni pamięci." }
    });
    fireEvent.change(screen.getByLabelText("Cel bohatera"), {
      target: { value: "Odnaleźć siostrę przed korektą miejskich wspomnień." }
    });
    fireEvent.change(screen.getByLabelText("Setting"), {
      target: { value: "Miasto drukarni i nocnych archiwów." }
    });

    fireEvent.click(screen.getByRole("tab", { name: /Silnik historii/i }));
    fireEvent.change(screen.getByLabelText("Logline"), {
      target: { value: "Jedno zdanie sprzedające historię." }
    });
    fireEvent.change(screen.getByLabelText("Siła przeciwna"), {
      target: { value: "Cech drukarzy fałszujących pamięć miasta." }
    });
    fireEvent.change(screen.getByLabelText("Kierunek zakończenia"), {
      target: { value: "Prawda wychodzi na jaw, ale bohaterka płaci wspomnieniem." }
    });

    fireEvent.click(screen.getByRole("tab", { name: /Czytelnik i forma/i }));
    fireEvent.change(screen.getByLabelText("Docelowa liczba słów"), {
      target: { value: "85000" }
    });
    fireEvent.click(screen.getByRole("button", { name: "fantasy" }));
    fireEvent.change(screen.getByLabelText("Własna opcja Gatunek"), {
      target: { value: "noir" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Dodaj własną opcję Gatunek/i })
    );

    fireEvent.click(screen.getByRole("tab", { name: /Okładka/i }));
    fireEvent.change(screen.getByLabelText("Tytuł finalny"), {
      target: { value: "Finalny tytuł" }
    });
    fireEvent.change(screen.getByLabelText("Alternatywne tytuły"), {
      target: { value: "Tytuł A, Tytuł B" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/i }));

    await waitFor(() =>
      expect(updateBookConcept).toHaveBeenCalledWith(
        "book-1",
        expect.objectContaining({
          title: "Finalny tytuł",
          protagonistSummary: "Archiwistka z drukarni pamięci.",
          protagonistGoal: "Odnaleźć siostrę przed korektą miejskich wspomnień.",
          antagonistForce: "Cech drukarzy fałszujących pamięć miasta.",
          settingSketch: "Miasto drukarni i nocnych archiwów.",
          endingDirection: "Prawda wychodzi na jaw, ale bohaterka płaci wspomnieniem.",
          logline: "Jedno zdanie sprzedające historię.",
          targetWordCount: 85000,
          alternativeTitlesJson: JSON.stringify(["Tytuł A", "Tytuł B"]),
          genre: "kryminal, fantasy, noir"
        })
      )
    );
  });

  it("renders an AI button for every phase 2 concept field", async () => {
    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();

    const stageLabels = [
      {
        tab: /Pomysł/i,
        labels: [
          "Tytuł roboczy",
          "Premise",
          "Bohater / bohaterka",
          "Cel bohatera",
          "Setting"
        ]
      },
      {
        tab: /Silnik historii/i,
        labels: [
          "Logline",
          "Konflikt centralny",
          "Siła przeciwna",
          "Stawki",
          "Kierunek zakończenia",
          "Rozszerzona premisa"
        ]
      },
      {
        tab: /Czytelnik i forma/i,
        labels: [
          "Gatunek",
          "Podgatunek",
          "Odbiorcy",
          "Ton",
          "Punkt widzenia",
          "Docelowa liczba słów"
        ]
      },
      {
        tab: /Motywy i zasady/i,
        labels: ["Tematy", "Granice i tematy niechciane", "Style guide"]
      },
      {
        tab: /Okładka/i,
        labels: ["Tytuł finalny", "Alternatywne tytuły"]
      }
    ];

    for (const stage of stageLabels) {
      fireEvent.click(screen.getByRole("tab", { name: stage.tab }));
      for (const label of stage.labels) {
        expect(
          screen.getByRole("button", { name: `Generuj ${label} z AI` })
        ).toBeInTheDocument();
        expect(screen.getByText(fieldDescriptionForLabel(label))).toBeInTheDocument();
      }
    }
  });

  it("does not repeat the active stage title in the form body", async () => {
    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();

    expect(screen.queryByText(/^Etap$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Pomys/i)).toHaveLength(1);
  });

  it("groups cover titles separately from the cover preview and generation action", async () => {
    const { container } = renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Okładka/i }));

    const titleFields = container.querySelector(".cover-title-fields");
    const artPanel = container.querySelector(".cover-art-panel");
    const preview = container.querySelector<HTMLElement>(
      ".cover-art-panel .cover-preview"
    );
    const generateButton = screen.getByRole("button", {
      name: /Utwórz okładkę/i
    });

    expect(titleFields).toContainElement(screen.getByLabelText("Tytuł finalny"));
    expect(titleFields).toContainElement(
      screen.getByLabelText("Alternatywne tytuły")
    );
    expect(artPanel).toContainElement(preview);
    expect(artPanel).toContainElement(generateButton);
  });

  it("generates and accepts only the premise field from the premise button", async () => {
    vi.mocked(runCodexPrompt).mockResolvedValue({
      id: "run-premise",
      providerId: "codex-cli-bridge",
      promptPackageId: "generate_premise:test",
      action: "generate_premise",
      status: "success",
      rawOutput: premiseSuggestionOutput,
      durationMs: 12
    });

    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Generuj Premise z AI/i })
    );

    const premiseValue =
      "Archiwistka odkrywa, że pamięć miasta jest fałszowana, i musi zdecydować, czy oddać siostrze prawdę kosztem spokoju mieszkańców.";
    expect(await screen.findByDisplayValue(premiseValue)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Akceptuj/i }));

    await waitFor(() =>
      expect(updateBookConcept).toHaveBeenCalledWith("book-1", {
        premise: premiseValue
      })
    );
  });

  it("generates a cover from current concept form values", async () => {
    renderWithQueryClient();

    expect(await screen.findByDisplayValue("Stary tytuł")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Premise"), {
      target: { value: "Nowa bohaterka znajduje mapę ukrytą w druku." }
    });
    fireEvent.click(screen.getByRole("tab", { name: /Okładka/i }));

    const coverButton = await screen.findByRole("button", {
      name: /Utwórz okładkę/i
    });
    await waitFor(() => expect(coverButton).not.toBeDisabled());
    fireEvent.click(coverButton);

    await waitFor(() =>
      expect(generateBookCover).toHaveBeenCalledWith(
        expect.objectContaining({
          coverPrompt: expect.stringContaining(
            "Nowa bohaterka znajduje mapę ukrytą w druku."
          ),
          codexPath: "codex",
          model: "gpt-5.5",
          reasoningEffort: "medium"
        })
      )
    );
  });
});

function successfulRun(): AiRunResult {
  return {
    id: "run-1",
    providerId: "codex-cli-bridge",
    promptPackageId: "generate_working_title:test",
    action: "generate_working_title",
    status: "success",
    rawOutput: conceptFieldOutput,
    durationMs: 12
  };
}

function fieldDescriptionForLabel(label: string): RegExp {
  const descriptions: Record<string, RegExp> = {
    "Tytuł roboczy": /Robocza nazwa projektu/i,
    Premise: /Krótka obietnica historii/i,
    "Bohater / bohaterka": /Najważniejsza postać/i,
    "Cel bohatera": /Konkretne zewnętrzne dążenie/i,
    Setting: /Miejsce, czas i podstawowe warunki świata/i,
    Logline: /Jedno zwarte zdanie/i,
    "Konflikt centralny": /Główne napięcie/i,
    "Siła przeciwna": /Antagonista, system, problem/i,
    Stawki: /co bohater, relacje albo świat tracą/i,
    "Kierunek zakończenia": /dokąd historia ma emocjonalnie/i,
    "Rozszerzona premisa": /Jeden akapit łączący/i,
    Gatunek: /Główna konwencja/i,
    Podgatunek: /Doprecyzowanie obietnicy gatunkowej/i,
    Odbiorcy: /Grupa czytelników/i,
    Ton: /Dominujący nastrój/i,
    "Punkt widzenia": /Perspektywa i tryb narracji/i,
    "Docelowa liczba słów": /Orientacyjna długość książki/i,
    Tematy: /Główne idee/i,
    "Granice i tematy niechciane": /Treści, których AI i autor/i,
    "Style guide": /Praktyczne zasady języka/i,
    "Tytuł finalny": /Kandydat na tytuł/i,
    "Alternatywne tytuły": /Lista wariantów/i
  };

  return descriptions[label];
}
