import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAiRuns } from "../../shared/api/commands";
import { AiLogPage } from "./AiLogPage";

vi.mock("../../shared/api/commands", () => ({
  listAiRuns: vi.fn()
}));

function renderLogPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AiLogPage projectId="project-1" />
    </QueryClientProvider>
  );
}

describe("AiLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders collapsed log entries with readable request and response", async () => {
    vi.mocked(listAiRuns).mockResolvedValue([
      {
        id: "run-1",
        projectId: "project-1",
        providerId: "codex-cli-bridge",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        action: "suggest_point_of_view",
        promptPackageJson: {
          context: {
            targetField: "pointOfView",
            generationMode: "expand"
          }
        },
        prompt: "# Role\nPrompt testowy",
        rawOutput: JSON.stringify({
          version: 1,
          kind: "concept_field_suggestion",
          field: "pointOfView",
          summary: "Narracja bliska bohaterce",
          values: ["trzecia osoba ograniczona", "czas przeszły"],
          rationale: "Pasuje do tonu."
        }),
        status: "success",
        createdAt: "2026-06-05T12:00:00Z",
        completedAt: "2026-06-05T12:00:05Z"
      },
      {
        id: "run-2",
        projectId: "project-1",
        providerId: "codex-cli-bridge",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        action: "generate_world_element_field",
        promptPackageJson: {
          context: {
            targetField: "worldElement",
            generationMode: "generate"
          }
        },
        prompt: "# Role\nPrompt świata",
        rawOutput: JSON.stringify({
          version: 1,
          kind: "world_element",
          name: "Most Solny"
        }),
        status: "success",
        createdAt: "2026-06-05T12:10:00Z",
        completedAt: "2026-06-05T12:10:05Z"
      }
    ]);

    renderLogPage();

    const entry = await screen.findByText("Punkt widzenia", {
      selector: "strong"
    });
    expect(entry.closest("details")).not.toHaveAttribute("open");

    fireEvent.click(entry);

    expect((await screen.findAllByText("Request"))[0]).toBeInTheDocument();
    expect(screen.getByText("Rozwijanie")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.5")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Medium")[0]).toBeInTheDocument();
    expect(
      screen.getByText((_content, element) => {
        return (
          element?.tagName.toLowerCase() === "pre" &&
          element.textContent === "# Role\nPrompt testowy"
        );
      })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Response")[0]).toBeInTheDocument();
    expect(screen.getByText("Narracja bliska bohaterce")).toBeInTheDocument();
    expect(screen.getByText("trzecia osoba ograniczona")).toBeInTheDocument();
    expect(screen.getByText("czas przeszły")).toBeInTheDocument();
    expect(screen.queryByText(/"values"/)).not.toBeInTheDocument();
    expect(await screen.findByText("Element świata", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("generate_world_element_field")).not.toBeInTheDocument();
  });
});
