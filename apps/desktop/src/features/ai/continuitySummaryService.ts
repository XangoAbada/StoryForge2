import {
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  runCodexPrompt,
  saveChapterAutoSummary,
  saveSceneAutoSummary,
  saveStorySoFar
} from "../../shared/api/commands";
import type { BookPlan, ProjectDetails, Scene } from "../../shared/api/types";
import { fnv1aHash, htmlToPlainText } from "../../shared/text/plainText";
import {
  buildChapterSummaryPromptPackage,
  buildSceneSummaryPromptPackage,
  buildStorySoFarPromptPackage,
  parseChapterSummaryResult,
  parseSceneSummaryResult,
  parseStorySoFarResult,
  renderChapterSummaryPromptPackage,
  renderSceneSummaryPromptPackage,
  renderStorySoFarPromptPackage
} from "./continuitySummaryPromptPackage";

// Pipeline ciągłości: po zapisie sceny (debounce) odświeża jej auto-streszczenie,
// a po nim leniwie regeneruje nieaktualne streszczenie rozdziału i "story so far".
// Wszystko fire-and-forget: błędy AI nie mogą blokować pisania, trafiają do
// ai_runs (run_codex_prompt loguje każdy przebieg) i na console.warn.

const SCENE_DEBOUNCE_MS = 15_000;

const pendingSceneTimers = new Map<string, number>();
const inFlight = new Set<string>();

export type ContinuityRefreshCallbacks = {
  onSaved?: () => void | Promise<void>;
  onStatus?: (message: string) => void;
};

/** Debounce po autosave: nie odpalamy AI przy każdym uderzeniu w klawiaturę. */
export function scheduleSceneAutoSummary(
  projectId: string,
  bookId: string,
  sceneId: string,
  callbacks?: ContinuityRefreshCallbacks
): void {
  const existing = pendingSceneTimers.get(sceneId);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  pendingSceneTimers.set(
    sceneId,
    window.setTimeout(() => {
      pendingSceneTimers.delete(sceneId);
      void refreshSceneAutoSummary(projectId, bookId, sceneId, callbacks);
    }, SCENE_DEBOUNCE_MS)
  );
}

/**
 * Odświeża streszczenie sceny, jeśli treść zmieniła się od ostatniego razu
 * (hash), a następnie domyka nieaktualne poziomy wyżej (rozdział, książka).
 */
export async function refreshSceneAutoSummary(
  projectId: string,
  bookId: string,
  sceneId: string,
  callbacks?: ContinuityRefreshCallbacks,
  force = false
): Promise<void> {
  const key = `scene:${sceneId}`;
  if (inFlight.has(key)) {
    return;
  }
  inFlight.add(key);
  try {
    const [details, plan, characters] = await Promise.all([
      getProject(projectId),
      getBookPlan(bookId),
      getCharacterWorkspace(projectId)
    ]);
    const scene = plan.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      return;
    }
    const plain = htmlToPlainText(scene.manuscriptContent);
    if (!plain.trim()) {
      return;
    }
    const hash = fnv1aHash(plain);
    if (!force && hash === scene.autoSummarySourceHash && scene.autoSummary.trim()) {
      return;
    }

    callbacks?.onStatus?.("Streszczam scenę…");
    const chapter = plan.chapters.find((item) => item.id === scene.chapterId) ?? null;
    const pov = scene.povCharacterId
      ? characters.characters.find((item) => item.id === scene.povCharacterId) ?? null
      : null;
    const promptPackage = buildSceneSummaryPromptPackage({
      project: details.project,
      book: details.book,
      scene,
      chapterTitle: chapter?.workingTitle ?? "",
      povCharacterName: pov?.name ?? "",
      sceneText: plain
    });
    const run = await runCodexPrompt({
      projectId,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderSceneSummaryPromptPackage(promptPackage)
    });
    if (run.status !== "success" || !run.rawOutput) {
      callbacks?.onStatus?.("Nie udało się streścić sceny");
      return;
    }
    const summary = parseSceneSummaryResult(run.rawOutput);
    await saveSceneAutoSummary({
      sceneId,
      autoSummary: summary.composedText,
      sourceHash: hash
    });
    callbacks?.onStatus?.("Streszczenie sceny zaktualizowane");
    await callbacks?.onSaved?.();
  } catch (error) {
    console.warn("Continuity: streszczenie sceny nie powstało", error);
    callbacks?.onStatus?.("Nie udało się streścić sceny");
  } finally {
    inFlight.delete(key);
  }

  await refreshStaleContinuity(projectId, bookId, callbacks);
}

/**
 * Leniwa regeneracja poziomów wyżej: rozdziały z flagą stale, potem story so
 * far książki. Wywoływana po streszczeniu sceny i przy wejściu do edytora.
 */
export async function refreshStaleContinuity(
  projectId: string,
  bookId: string,
  callbacks?: ContinuityRefreshCallbacks
): Promise<void> {
  const key = `book:${bookId}`;
  if (inFlight.has(key)) {
    return;
  }
  inFlight.add(key);
  try {
    const [details, plan] = await Promise.all([getProject(projectId), getBookPlan(bookId)]);
    let anySaved = false;

    for (const chapter of plan.chapters) {
      const sceneSummaries = chapterSceneSummaries(plan, chapter.id);
      const needsRefresh =
        sceneSummaries.length > 0 &&
        (chapter.autoSummaryStale === 1 || !chapter.autoSummary.trim());
      if (!needsRefresh) {
        continue;
      }
      const saved = await refreshChapterSummary(projectId, details, chapter.id, sceneSummaries, callbacks);
      anySaved = anySaved || saved;
    }

    // Story so far po odświeżeniu rozdziałów — pracuje na świeżych danych.
    const freshPlan = anySaved ? await getBookPlan(bookId) : plan;
    const chapterSummaries = freshPlan.chapters
      .filter((chapter) => (chapter.autoSummary || chapter.summary).trim())
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((chapter) => ({
        number: chapter.number,
        workingTitle: chapter.workingTitle,
        summary: chapter.autoSummary || chapter.summary
      }));
    const bookNeedsRefresh =
      chapterSummaries.length > 0 &&
      (details.book.storySoFarStale === 1 || anySaved || !details.book.storySoFar.trim());
    if (bookNeedsRefresh) {
      callbacks?.onStatus?.("Aktualizuję story so far…");
      const promptPackage = buildStorySoFarPromptPackage({
        project: details.project,
        book: details.book,
        chapterSummaries
      });
      const run = await runCodexPrompt({
        projectId,
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderStorySoFarPromptPackage(promptPackage)
      });
      if (run.status === "success" && run.rawOutput) {
        await saveStorySoFar({ bookId, storySoFar: parseStorySoFarResult(run.rawOutput) });
        anySaved = true;
      }
    }

    if (anySaved) {
      callbacks?.onStatus?.("Kontekst ciągłości zaktualizowany");
      await callbacks?.onSaved?.();
    }
  } catch (error) {
    console.warn("Continuity: regeneracja streszczeń nie powiodła się", error);
  } finally {
    inFlight.delete(key);
  }
}

async function refreshChapterSummary(
  projectId: string,
  details: ProjectDetails,
  chapterId: string,
  sceneSummaries: Array<{ title: string; timeMarker: string; summary: string }>,
  callbacks?: ContinuityRefreshCallbacks
): Promise<boolean> {
  try {
    const chapter = (await getBookPlan(details.book.id)).chapters.find(
      (item) => item.id === chapterId
    );
    if (!chapter) {
      return false;
    }
    callbacks?.onStatus?.(`Streszczam rozdział ${chapter.number}…`);
    const promptPackage = buildChapterSummaryPromptPackage({
      project: details.project,
      book: details.book,
      chapter,
      sceneSummaries
    });
    const run = await runCodexPrompt({
      projectId,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderChapterSummaryPromptPackage(promptPackage)
    });
    if (run.status !== "success" || !run.rawOutput) {
      return false;
    }
    await saveChapterAutoSummary({
      chapterId,
      autoSummary: parseChapterSummaryResult(run.rawOutput)
    });
    return true;
  } catch (error) {
    console.warn("Continuity: streszczenie rozdziału nie powstało", error);
    return false;
  }
}

/** Streszczenia scen rozdziału: auto tam gdzie jest, fallback na plan sceny. */
function chapterSceneSummaries(
  plan: BookPlan,
  chapterId: string
): Array<{ title: string; timeMarker: string; summary: string }> {
  return plan.scenes
    .filter((scene) => scene.chapterId === chapterId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((scene) => ({
      title: scene.title,
      timeMarker: scene.timeMarker,
      summary: sceneSummaryForChapter(scene)
    }))
    .filter((item) => item.summary.trim());
}

function sceneSummaryForChapter(scene: Scene): string {
  if (scene.autoSummary.trim()) {
    return scene.autoSummary;
  }
  return [scene.summary, scene.outcome].filter(Boolean).join(" ");
}

