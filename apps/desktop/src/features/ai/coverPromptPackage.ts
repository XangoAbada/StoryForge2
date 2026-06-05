import type { AIAction, Book, Project } from "../../shared/api/types";

export type CoverPromptPackage = {
  id: string;
  projectId: string;
  action: Extract<AIAction, "generate_cover_image">;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    book: {
      title: string;
      workingTitle: string;
      premise: string;
      genre: string;
      targetAudience: string;
      tone: string;
      styleGuide: string;
    };
  };
  outputContract: {
    kind: "book_cover_image";
    format: "png";
    schema: unknown;
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
    feature: "image_generation";
    outputFormat: "png";
    aspectRatio: "2:3";
  };
  coverPrompt: string;
  negativePrompt: string;
};

export function buildBookCoverPromptPackage(
  project: Project,
  book: Book
): CoverPromptPackage {
  const coverPrompt = renderCoverVisualPrompt(book);
  const negativePrompt =
    "No watermark, no publisher logo, no author name, no mockup frame, no UI, no unreadable typography, no duplicate book covers, no gore.";

  return {
    id: createPromptId("generate_cover_image"),
    projectId: project.id,
    action: "generate_cover_image",
    locale: project.language === "en" ? "en" : "pl",
    userInstruction:
      "Generate a real raster working book cover image from the current concept data.",
    context: {
      book: {
        title: book.title,
        workingTitle: book.workingTitle,
        premise: book.premise,
        genre: book.genre,
        targetAudience: book.targetAudience,
        tone: book.tone,
        styleGuide: book.styleGuide
      }
    },
    outputContract: {
      kind: "book_cover_image",
      format: "png",
      schema: {
        version: 1,
        kind: "book_cover_image",
        imagePath: "string",
        prompt: "string",
        negativePrompt: "string",
        warnings: ["string"]
      }
    },
    generationOptions: {
      providerId: "codex-cli-bridge",
      feature: "image_generation",
      outputFormat: "png",
      aspectRatio: "2:3"
    },
    coverPrompt,
    negativePrompt
  };
}

export function renderBookCoverPromptPackage(
  promptPackage: CoverPromptPackage,
  outputFilePath = "{OUTPUT_FILE}"
): string {
  const coverTitle = titleForCover(promptPackage.context.book);

  return `# Role
You are generating a working book cover asset for StoryForge2.

# Task
Use Codex CLI image generation to create one portrait PNG book cover image.
Invoke $imagegen explicitly. Prefer this output path:
${outputFilePath}

# Visual Prompt
${promptPackage.coverPrompt}

# Negative Prompt
${promptPackage.negativePrompt}

# Hard Rules
- The cover must be portrait with a 2:3 book-cover composition.
- Make a real raster image, not SVG, HTML, CSS, or a text-only placeholder.
- Include the book title as readable cover typography inside the image: "${coverTitle}".
- The title text should be prominent, spelled exactly as provided, and integrated with the cover design.
- Do not call any image API directly or ask for an API key.
- Prefer saving the generated PNG to the output path above.
- If Codex image generation saves the PNG under the Codex generated_images directory and moving or copying is blocked, do not retry shell commands; return JSON with imagePath set to the actual generated PNG path if it is known.
- Return only JSON when image generation is complete.

# Output Contract
Return JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function renderCoverVisualPrompt(book: Book): string {
  const coverTitle = titleForCover(book);

  return [
    "Use case: illustration-story",
    "Asset type: working book cover",
    `Primary request: a polished editorial cover for the book title "${coverTitle}"`,
    `Scene/backdrop: visual metaphor for this premise: ${emptyFallback(book.premise)}`,
    `Style/medium: sophisticated illustrated book-cover art, strong silhouette, tactile print texture`,
    `Composition/framing: portrait 2:3, central focal image, generous safe margins, clear title area`,
    `Typography/title: include readable title text exactly as "${coverTitle}", prominent and professionally typeset`,
    `Lighting/mood: ${emptyFallback(book.tone)}`,
    `Genre cues: ${emptyFallback(book.genre)}`,
    `Audience: ${emptyFallback(book.targetAudience)}`,
    `Style notes: ${emptyFallback(book.styleGuide)}`,
    "Constraints: no watermark, no logo, no author name, no series badge; only the book title should appear as text"
  ].join("\n");
}

function titleForCover(book: Pick<Book, "title" | "workingTitle">): string {
  return emptyFallback(book.title || book.workingTitle);
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function emptyFallback(value: string): string {
  return value.trim().length > 0 ? value : "(missing)";
}
