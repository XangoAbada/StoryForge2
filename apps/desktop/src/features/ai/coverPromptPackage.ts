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
      protagonistSummary: string;
      antagonistForce: string;
      settingSketch: string;
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
    mode: "fresh";
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
    "No watermark, publisher logo, author name, subtitle, extra text, mockup frame, UI, illegible title, or duplicate cover layout.";

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
        protagonistSummary: book.protagonistSummary,
        antagonistForce: book.antagonistForce,
        settingSketch: book.settingSketch,
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
      mode: "fresh",
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
  return `Generate one portrait PNG book cover image with $imagegen.
Create it from scratch as a fresh image generation. Do not edit, extend, inpaint, upscale, reuse, vary, or derive from any existing cover, preview, file, or prior generated image.
Bowri final target path:
${outputFilePath}
Do not copy, move, inspect, or modify files yourself. Bowri will copy the generated PNG to that target path after you return.

Image brief:
${promptPackage.coverPrompt}

Avoid:
${promptPackage.negativePrompt}
Also avoid using any previously generated or saved image as input.

Return only compact JSON after generation:
{"imagePath":"<actual PNG path or image session directory>"}
`;
}

export function renderCoverVisualPrompt(book: Book): string {
  const coverTitle = titleForCover(book);

  return [
    `Title text: "${coverTitle}"`,
    "Format: portrait 2:3 editorial book cover, polished raster illustration.",
    "Composition: one clear central visual idea, strong silhouette, readable title area, generous margins.",
    optionalLine(
      "Genre and mood",
      compact([book.genre, book.subgenre, book.tone].filter(isFilled).join(", "))
    ),
    optionalLine("Story image", compact(book.premise, 260)),
    optionalLine("Character cue", compact(book.protagonistSummary, 180)),
    optionalLine(
      "Threat or tension",
      compact([book.centralConflict, book.antagonistForce].filter(isFilled).join("; "), 220)
    ),
    optionalLine("World cue", compact(book.settingSketch, 180)),
    optionalLine("Design note", compact(book.styleGuide, 160)),
    "Typography: show only the title, spelled exactly, no subtitle or author name."
  ]
    .filter(isFilled)
    .join("\n");
}

function titleForCover(book: Pick<Book, "title" | "workingTitle">): string {
  const title = book.title.trim() || book.workingTitle.trim();
  return title.length > 0 ? title : "Untitled book";
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function optionalLine(label: string, value: string): string {
  return value ? `${label}: ${value}` : "";
}

function compact(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function isFilled(value: string): boolean {
  return value.trim().length > 0;
}
