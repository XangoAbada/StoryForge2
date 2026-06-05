import type {
  AiRunResult,
  Book,
  BookCoverResult,
  BookConceptInput,
  CodexCliStatus,
  CodexModelCatalog,
  CreateProjectInput,
  GenerateBookCoverInput,
  GenerateNewProjectTitleRequest,
  Project,
  ProjectDetails,
  ProjectSummary,
  RunCodexPromptRequest
} from "./types";

const STORAGE_KEY = "storyforge2.browserPreview.projects";

type BrowserPreviewState = {
  projects: ProjectDetails[];
};

let memoryState: BrowserPreviewState = {
  projects: []
};

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return "__TAURI_INTERNALS__" in window;
}

export async function browserCreateProject(
  input: CreateProjectInput
): Promise<ProjectDetails> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name cannot be empty.");
  }

  const state = readState();
  const now = new Date().toISOString();
  const projectId = createId();
  const bookId = createId();

  const project: Project = {
    id: projectId,
    name,
    language: input.language ?? "pl",
    createdAt: now,
    updatedAt: now,
    activeBookId: bookId,
    settingsJson: "{}"
  };

  const book: Book = {
    id: bookId,
    projectId,
    title: "",
    workingTitle: name,
    premise: "",
    logline: "",
    genre: "",
    subgenre: "",
    targetAudience: "",
    tone: "",
    styleGuide: "",
    pointOfView: "",
    targetWordCount: null,
    coverImagePath: "",
    coverPrompt: "",
    coverNegativePrompt: "",
    coverGeneratedAt: null,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };

  const details = { project, book };
  state.projects.unshift(details);
  writeState(state);
  return details;
}

export async function browserListProjects(): Promise<ProjectSummary[]> {
  return readState()
    .projects.map(({ project, book }) => ({
      id: project.id,
      name: project.name,
      language: project.language,
      updatedAt: project.updatedAt,
      activeBookId: project.activeBookId,
      workingTitle: book.workingTitle,
      coverImagePath: book.coverImagePath ?? ""
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function browserGetProject(
  projectId: string
): Promise<ProjectDetails> {
  const details = readState().projects.find(
    ({ project }) => project.id === projectId
  );

  if (!details) {
    throw new Error("Project not found in browser preview storage.");
  }

  return normalizeDetails(details);
}

export async function browserUpdateBookConcept(
  bookId: string,
  input: BookConceptInput
): Promise<Book> {
  const state = readState();
  const details = state.projects.find(({ book }) => book.id === bookId);

  if (!details) {
    throw new Error("Book not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  details.book = {
    ...details.book,
    ...definedOnly(input),
    updatedAt: now
  };
  details.project = {
    ...details.project,
    updatedAt: now
  };

  writeState(state);
  return details.book;
}

export async function browserCheckCodexCli(
  codexPath?: string
): Promise<CodexCliStatus> {
  return {
    available: false,
    path: codexPath || "codex",
    authLikelyReady: null,
    message:
      "Podgląd Vite działa bez backendu Tauri. Uruchom aplikację desktopową, aby sprawdzić Codex CLI."
  };
}

export async function browserListCodexModels(
  _codexPath?: string
): Promise<CodexModelCatalog> {
  return {
    fallback: true,
    models: [
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningLevel: "medium",
        supportedReasoningLevels: [
          { effort: "low", description: "Szybciej, mniej planowania" },
          { effort: "medium", description: "Dobry balans" },
          { effort: "high", description: "Glebsze rozumowanie" },
          { effort: "xhigh", description: "Najglebsze rozumowanie" }
        ]
      }
    ],
    errorMessage:
      "Podgląd Vite nie może odczytać katalogu modeli Codex CLI bez backendu Tauri."
  };
}

export async function browserRunCodexPrompt(
  request: RunCodexPromptRequest
): Promise<AiRunResult> {
  return {
    id: createId(),
    providerId: "codex-cli-bridge",
    promptPackageId: request.promptPackageId,
    action: request.action,
    status: "error",
    rawOutput: null,
    errorMessage:
      "Podgląd Vite nie może uruchomić codex exec. Użyj aplikacji Tauri desktop.",
    durationMs: 0
  };
}

export async function browserGenerateNewProjectTitle(
  request: GenerateNewProjectTitleRequest
): Promise<AiRunResult> {
  const seedTitle = extractSeedTitle(request.promptPackageJson);
  const value = seedTitle
    ? `Sekret ${seedTitle}`
    : "Sekret Trzeciego Dnia";

  return {
    id: createId(),
    providerId: "codex-cli-bridge",
    promptPackageId: request.promptPackageId,
    action: request.action,
    status: "success",
    rawOutput: JSON.stringify({
      version: 1,
      kind: "concept_field_suggestion",
      field: "workingTitle",
      summary: value,
      value,
      values: [],
      rationale: "Browser preview generated a deterministic title.",
      warnings: []
    }),
    durationMs: 0
  };
}

function extractSeedTitle(promptPackageJson: unknown): string {
  if (
    promptPackageJson &&
    typeof promptPackageJson === "object" &&
    "context" in promptPackageJson
  ) {
    const context = (promptPackageJson as { context?: { seedTitle?: unknown } })
      .context;
    if (typeof context?.seedTitle === "string") {
      return context.seedTitle.trim();
    }
  }

  return "";
}

export async function browserGenerateBookCover(
  input: GenerateBookCoverInput
): Promise<BookCoverResult> {
  const state = readState();
  const details = state.projects.find(
    ({ project, book }) => project.id === input.projectId && book.id === input.bookId
  );

  if (!details) {
    throw new Error("Book not found in browser preview storage.");
  }

  const now = new Date().toISOString();
  const imagePath = createCoverDataUrl(
    details.book.workingTitle || details.project.name,
    input.coverPrompt
  );

  details.book = {
    ...details.book,
    coverImagePath: imagePath,
    coverPrompt: input.coverPrompt,
    coverNegativePrompt: input.coverNegativePrompt,
    coverGeneratedAt: now,
    updatedAt: now
  };
  details.project = {
    ...details.project,
    updatedAt: now
  };

  writeState(state);

  return {
    book: details.book,
    aiRun: {
      id: createId(),
      providerId: "codex-cli-bridge",
      promptPackageId: input.promptPackageId,
      action: "generate_cover_image",
      status: "success",
      rawOutput: JSON.stringify({
        version: 1,
        kind: "book_cover_image",
        imagePath,
        warnings: ["Browser preview generated a local placeholder data URL."]
      }),
      durationMs: 0
    },
    imagePath,
    prompt: input.coverPrompt,
    negativePrompt: input.coverNegativePrompt,
    generatedAt: now
  };
}

function readState(): BrowserPreviewState {
  if (typeof window === "undefined") {
    return memoryState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { projects: [] };
    }

    const parsed = JSON.parse(raw) as BrowserPreviewState;
    return Array.isArray(parsed.projects) ? parsed : { projects: [] };
  } catch {
    return memoryState;
  }
}

function writeState(state: BrowserPreviewState): void {
  memoryState = state;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    memoryState = state;
  }
}

function definedOnly(input: BookConceptInput): BookConceptInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as BookConceptInput;
}

function normalizeDetails(details: ProjectDetails): ProjectDetails {
  return {
    project: details.project,
    book: {
      ...details.book,
      coverImagePath: details.book.coverImagePath ?? "",
      coverPrompt: details.book.coverPrompt ?? "",
      coverNegativePrompt: details.book.coverNegativePrompt ?? "",
      coverGeneratedAt: details.book.coverGeneratedAt ?? null
    }
  };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createCoverDataUrl(title: string, prompt: string): string {
  const safeTitle = escapeSvg(title || "Untitled");
  const safePrompt = escapeSvg(prompt.slice(0, 120));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#263c35"/><stop offset="0.55" stop-color="#a86f25"/><stop offset="1" stop-color="#f5f1e8"/></linearGradient></defs><rect width="800" height="1200" fill="url(#g)"/><rect x="54" y="54" width="692" height="1092" fill="none" stroke="#fffdf8" stroke-width="6" opacity=".75"/><circle cx="400" cy="420" r="170" fill="#fffdf8" opacity=".22"/><text x="400" y="850" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="#fffdf8" font-weight="700">${safeTitle}</text><text x="400" y="930" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="24" fill="#fffdf8" opacity=".78">${safePrompt}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
