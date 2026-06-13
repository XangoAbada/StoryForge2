import type {
  Book,
  BookPlan,
  CharacterWorkspace,
  Chapter,
  PlotThread,
  Scene,
  WorldElement,
  WorldRule,
  WorldWorkspace
} from "../../shared/api/types";

export type ScenePromptContext = {
  book: Pick<Book, "id" | "title" | "workingTitle" | "premise" | "styleGuide" | "pointOfView" | "tone">;
  chapter: Chapter | null;
  scene: Scene;
  povCharacter: {
    id: string;
    name: string;
    voiceNotes: string;
    knowledgeNotes: string;
  } | null;
  characters: Array<{ id: string; name: string; role: string; voiceNotes: string; knowledgeNotes: string }>;
  threads: PlotThread[];
  location: WorldElement | null;
  worldElements: WorldElement[];
  relevantRules: WorldRule[];
};

export function buildScenePromptContext({
  book,
  plan,
  characters,
  world,
  sceneId
}: {
  book: Book;
  plan: BookPlan;
  characters: CharacterWorkspace;
  world: WorldWorkspace;
  sceneId: string;
}): ScenePromptContext | null {
  const scene = plan.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return null;
  }

  const chapter = scene.chapterId
    ? plan.chapters.find((item) => item.id === scene.chapterId) ?? null
    : null;
  const sceneCharacterIds = unique(
    plan.sceneCharacters.filter((item) => item.sceneId === scene.id).map((item) => item.characterId)
  );
  const sceneThreadIds = unique(
    plan.sceneThreads.filter((item) => item.sceneId === scene.id).map((item) => item.threadId)
  );
  const sceneElementIds = unique([
    ...(scene.locationId ? [scene.locationId] : []),
    ...plan.sceneWorldElements.filter((item) => item.sceneId === scene.id).map((item) => item.elementId)
  ]);
  const explicitRuleIds = plan.sceneWorldRules
    .filter((item) => item.sceneId === scene.id)
    .map((item) => item.ruleId);
  const elementRuleIds = world.elementRules
    .filter((item) => sceneElementIds.includes(item.elementId))
    .map((item) => item.ruleId);
  const threadRuleIds = world.ruleThreads
    .filter((item) => sceneThreadIds.includes(item.threadId))
    .map((item) => item.ruleId);
  const chapterThreadIds = chapter
    ? plan.chapterThreads.filter((item) => item.chapterId === chapter.id).map((item) => item.threadId)
    : [];
  const chapterRuleIds = world.ruleThreads
    .filter((item) => chapterThreadIds.includes(item.threadId))
    .map((item) => item.ruleId);
  const relevantRuleIds = unique([
    ...explicitRuleIds,
    ...elementRuleIds,
    ...threadRuleIds,
    ...chapterRuleIds
  ]);
  const pov = scene.povCharacterId
    ? characters.characters.find((item) => item.id === scene.povCharacterId) ?? null
    : null;

  return {
    book: {
      id: book.id,
      title: book.title,
      workingTitle: book.workingTitle,
      premise: book.premise,
      styleGuide: book.styleGuide,
      pointOfView: book.pointOfView,
      tone: book.tone
    },
    chapter,
    scene,
    povCharacter: pov
      ? {
          id: pov.id,
          name: pov.name,
          voiceNotes: pov.voiceNotes,
          knowledgeNotes: pov.knowledgeNotes
        }
      : null,
    characters: sceneCharacterIds
      .map((id) => characters.characters.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        role: item.role,
        voiceNotes: item.voiceNotes,
        knowledgeNotes: item.knowledgeNotes
      })),
    threads: sceneThreadIds
      .map((id) => plan.threads.find((item) => item.id === id))
      .filter((item): item is PlotThread => Boolean(item)),
    location: scene.locationId
      ? world.elements.find((item) => item.id === scene.locationId) ?? null
      : null,
    worldElements: sceneElementIds
      .map((id) => world.elements.find((item) => item.id === id))
      .filter((item): item is WorldElement => Boolean(item)),
    relevantRules: relevantRuleIds
      .map((id) => world.rules.find((item) => item.id === id))
      .filter((item): item is WorldRule => Boolean(item))
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
