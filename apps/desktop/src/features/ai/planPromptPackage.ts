import type {
  AIAction,
  Act,
  Beat,
  Book,
  BookPlan,
  Chapter,
  ChapterThread,
  CharacterWorkspace,
  PlotThread,
  Project,
  Scene,
  WorldWorkspace
} from "../../shared/api/types";
import { optionalLine, renderCappedEntityList } from "./promptContextLimits";
import type { PromptContextControl, PromptContextSource } from "./promptPackage";

type PlanContextKey =
  | PlanFieldKey
  | "bookCore"
  | "styleGuide"
  | "storyStructure"
  | "allActs"
  | "targetAct"
  | "siblingActs"
  | "actChapters"
  | "allChapters"
  | "targetChapter"
  | "chapterScenes"
  | "chapterAct"
  | "neighborChapters"
  | "targetScene"
  | "sceneChapter"
  | "neighborScenes"
  | "assignedBeats"
  | "assignedThreads"
  | "allBeats"
  | "targetBeat"
  | "beatChapter"
  | "siblingBeats"
  | "allThreads"
  | "targetThread"
  | "threadChapters"
  | "threadActs"
  | "targetThreadChapter"
  | "threadNeighborChapters"
  | "allCharacters"
  | "allWorldElements"
  | "allWorldRules"
  | "sceneManuscript"
  | "planAudit";

export type PlanFieldKey =
  | "storyStructure"
  | "storyStructureDescription"
  | "storyStructureNotes"
  | "acts"
  | "actPurpose"
  | "actSummary"
  | "beatSheet"
  | "beatName"
  | "beatRole"
  | "beatDescription"
  | "plotThreads"
  | "threadDescription"
  | "chapterPlan"
  | "chapterSummary"
  | "chapterPurpose"
  | "chapterConflict"
  | "chapterTurningPoint"
  | "sceneDraft"
  | "allChapterSceneDrafts"
  | "sceneTitle"
  | "sceneSummary"
  | "sceneGoal"
  | "sceneConflict"
  | "sceneOutcome"
  | "threadChapterDescription"
  | "chapterThreadSuggestions"
  | "allChapterThreadSuggestions"
  | "chapterBeatSuggestions"
  | "prepareChapterForScenes"
  | "chapterSceneBreakdown"
  | "sceneRelationSuggestions"
  | "planGaps";

type PlanStoryBibleContext = {
  characters: Array<{
    id: string;
    name: string;
    role: string;
    shortDescription: string;
    arcSummary: string;
    voiceNotes: string;
    knowledgeNotes: string;
  }>;
  worldElements: Array<{
    id: string;
    name: string;
    elementType: string;
    summary: string;
    details: string;
  }>;
  worldRules: Array<{
    id: string;
    name: string;
    description: string;
    violationConsequences: string;
  }>;
};

export type PlanFieldConfig = {
  key: PlanFieldKey;
  label: string;
  action: AIAction;
  targetKind: "structure" | "act" | "beat" | "thread" | "chapter" | "scene" | "audit";
  userInstruction: string;
};

export type PlanPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: PlanFieldKey;
    targetEntityId?: string;
    targetEntityLabel?: string;
    targetEntitySnapshot?: unknown;
    /** Tekst docelowej sceny jako czysty tekst, przycięty do limitu promptu. */
    targetSceneManuscript?: string;
    book: Pick<
      Book,
      | "workingTitle"
      | "premise"
      | "expandedPremise"
      | "centralConflict"
      | "antagonistForce"
      | "stakes"
      | "settingSketch"
      | "endingDirection"
      | "genre"
      | "subgenre"
      | "targetAudience"
      | "tone"
      | "pointOfView"
      | "targetWordCount"
      | "themesJson"
      | "styleGuide"
    >;
    plan: {
      structureType: string;
      structureDescription: string;
      structureNotes: string;
      acts: Act[];
      beats: Beat[];
      threads: PlotThread[];
      chapters: Chapter[];
      chapterThreads: BookPlan["chapterThreads"];
      chapterBeats: BookPlan["chapterBeats"];
      scenes: Scene[];
      sceneCharacters: BookPlan["sceneCharacters"];
      sceneThreads: BookPlan["sceneThreads"];
      sceneWorldElements: BookPlan["sceneWorldElements"];
      sceneWorldRules: BookPlan["sceneWorldRules"];
    };
    storyBible: PlanStoryBibleContext;
    generationMode: "generate" | "expand";
    targetFieldCurrentValue: string;
    contextControl?: PromptContextControl;
  };
  outputContract: {
    kind: "book_plan_suggestion";
    format: "json";
    schema: unknown;
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

export const planFieldConfigs: Record<PlanFieldKey, PlanFieldConfig> = {
  storyStructure: {
    key: "storyStructure",
    label: "Struktura fabuły",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Zaproponuj tylko typ struktury fabularnej dla książki. Nie generuj ani nie edytuj opisu, notatek, aktów, beatów, wątków ani rozdziałów."
  },
  storyStructureDescription: {
    key: "storyStructureDescription",
    label: "Opis struktury",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Wygeneruj tylko wartość pola opisu struktury. Jeśli pole ma już treść, rozwiń ją w kompletną docelową wersję bez zmiany typu struktury, notatek ani encji planu."
  },
  storyStructureNotes: {
    key: "storyStructureNotes",
    label: "Notatki do planu",
    action: "suggest_story_structure",
    targetKind: "structure",
    userInstruction:
      "Wygeneruj tylko wartość pola notatek do planu. Jeśli pole ma już treść, rozwiń ją w kompletną docelową wersję bez zmiany typu struktury, opisu ani encji planu."
  },
  acts: {
    key: "acts",
    label: "Akty",
    action: "generate_acts",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko akty z zakresem fabuły, celem i zwięzłym streszczeniem. Nie generuj beatów, wątków ani rozdziałów."
  },
  actPurpose: {
    key: "actPurpose",
    label: "Cel aktu",
    action: "generate_act_field",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko wartość pola celu wybranego aktu, korzystając z planu jako kontekstu. Nie zmieniaj innych pól ani encji."
  },
  actSummary: {
    key: "actSummary",
    label: "Streszczenie aktu",
    action: "generate_act_field",
    targetKind: "act",
    userInstruction:
      "Wygeneruj tylko wartość pola streszczenia wybranego aktu. Nie zmieniaj innych pól ani encji."
  },
  beatSheet: {
    key: "beatSheet",
    label: "Beat sheet",
    action: "generate_beat_sheet",
    targetKind: "beat",
    userInstruction:
      "Wygeneruj tylko beat sheet przypisany do istniejących roboczych rozdziałów. Traktuj beat jako obowiązek strukturalny rozdziału. Nie generuj struktury, aktów, wątków ani nowych rozdziałów."
  },
  beatName: {
    key: "beatName",
    label: "Nazwa beatu",
    action: "generate_beat_field",
    targetKind: "beat",
    userInstruction:
      "Wygeneruj tylko wartość pola nazwy wybranego beatu. Nie zmieniaj roli, opisu, przypisania ani innych elementów planu."
  },
  beatRole: {
    key: "beatRole",
    label: "Rola beatu",
    action: "generate_beat_field",
    targetKind: "beat",
    userInstruction:
      "Wygeneruj tylko wartość pola roli wybranego beatu w strukturze historii. Nie zmieniaj nazwy, opisu, przypisania ani innych elementów planu."
  },
  beatDescription: {
    key: "beatDescription",
    label: "Opis beatu",
    action: "generate_beat_field",
    targetKind: "beat",
    userInstruction:
      "Wygeneruj tylko wartość pola opisu wybranego beatu. Nie zmieniaj nazwy, roli, przypisania ani innych elementów planu."
  },
  plotThreads: {
    key: "plotThreads",
    label: "Wątki",
    action: "generate_plot_threads",
    targetKind: "thread",
    userInstruction:
      "Zaproponuj tylko wątki fabularne wraz z rolą i kolorem do mapy planu. Korzystaj z roboczego szkieletu rozdziałów jako kontekstu przebiegu, ale nie generuj struktury, aktów, beatów ani nowych rozdziałów."
  },
  threadDescription: {
    key: "threadDescription",
    label: "Opis wątku",
    action: "generate_plot_threads",
    targetKind: "thread",
    userInstruction:
      "Wygeneruj tylko wartość pola opisu wybranego wątku fabularnego. Nie zmieniaj nazwy, statusu, koloru, przypięć do rozdziałów ani innych elementów planu."
  },
  chapterPlan: {
    key: "chapterPlan",
    label: "Szkielet rozdziałów",
    action: "generate_chapter_plan",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko roboczy szkielet rozdziałów po istniejących aktach: numer, tytuł roboczy, krótkie streszczenie, wstępny cel i docelową liczbę słów dla każdego rozdziału. Jeśli książka ma docelową liczbę słów, rozdziel ją sensownie między rozdziały z uwzględnieniem rytmu aktów; jeśli jej nie ma, zaproponuj realistyczne orientacyjne wartości. Nie wymagaj pełnego konfliktu, punktu zwrotnego, beatów ani wątków; jeśli istnieją, możesz użyć ich wyłącznie jako kontekstu."
  },
  chapterSummary: {
    key: "chapterSummary",
    label: "Streszczenie rozdziału",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartość pola streszczenia wybranego rozdziału. Nie zmieniaj innych pól ani encji."
  },
  chapterPurpose: {
    key: "chapterPurpose",
    label: "Cel rozdziału",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartość pola celu fabularnego wybranego rozdziału. Nie zmieniaj innych pól ani encji."
  },
  chapterConflict: {
    key: "chapterConflict",
    label: "Konflikt rozdziału",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartość pola konfliktu wybranego rozdziału. Nie zmieniaj innych pól ani encji."
  },
  chapterTurningPoint: {
    key: "chapterTurningPoint",
    label: "Punkt zwrotny",
    action: "generate_chapter_field",
    targetKind: "chapter",
    userInstruction:
      "Wygeneruj tylko wartość pola punktu zwrotnego wybranego rozdziału. Nie zmieniaj innych pól ani encji."
  },
  sceneDraft: {
    key: "sceneDraft",
    label: "Nowa scena",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj jedną kompletną propozycję nowej sceny dla wybranego rozdziału. Użyj kontekstu rozdziału, sąsiednich rozdziałów, beatów i wątków. Nie zmieniaj istniejących encji; zwróć tylko dane nowej sceny."
  },
  allChapterSceneDrafts: {
    key: "allChapterSceneDrafts",
    label: "Sceny dla rozdziałów",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj po jednej kompletnej propozycji nowej sceny dla każdego istniejącego rozdziału. Użyj pełnego planu, beatów, wątków i istniejących scen jako kontekstu. Nie zmieniaj istniejących encji; zwróć tylko listę nowych scen z jednoznacznym wskazaniem rozdziału."
  },
  prepareChapterForScenes: {
    key: "prepareChapterForScenes",
    label: "Przygotowanie rozdziału",
    action: "prepare_chapter_for_scenes",
    targetKind: "chapter",
    userInstruction:
      "Przeaudytuj wybrany rozdział przed rozbiciem na sceny. Oceń cel, konflikt, punkt zwrotny, przypięte beaty, przypięte wątki i sąsiednie rozdziały. Nie zapisuj zmian; zwróć blokery, pytania do autora, ostrzeżenia i jeden najlepszy następny krok."
  },
  chapterSceneBreakdown: {
    key: "chapterSceneBreakdown",
    label: "Rozbicie rozdziału na sceny",
    action: "generate_chapter_scene_breakdown",
    targetKind: "scene",
    userInstruction:
      "Rozbij wybrany rozdział na 2-5 propozycji scen. Uwzględnij docelową liczbę słów rozdziału: docelowe liczby słów scen mają rozdzielać pulę rozdziału między sceny, a jeśli rozdział ma już sceny, traktuj ich docelowe liczby słów jako zajętą część puli. Każda scena ma mieć tytuł, streszczenie, cel, konflikt, wynik, docelową liczbę słów, sugerowane istniejące relacje oraz informację, który beat lub obowiązek rozdziału obsługuje. Nie twórz postaci ani świata; brakujące elementy zwróć jako kandydatów Story Bible."
  },
  sceneTitle: {
    key: "sceneTitle",
    label: "Tytuł sceny",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj tylko wartość pola tytułu wybranej sceny. Nie zmieniaj streszczenia, celu, konfliktu, wyniku, relacji ani innych elementów planu."
  },
  sceneSummary: {
    key: "sceneSummary",
    label: "Streszczenie sceny",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj tylko wartość pola streszczenia wybranej sceny. Jeśli scena ma już napisany tekst manuskryptu, streść wiernie to, co faktycznie się w nim dzieje; w przeciwnym razie oprzyj się na rozdziale, wątkach i postaciach. Nie zmieniaj innych pól ani encji."
  },
  sceneGoal: {
    key: "sceneGoal",
    label: "Cel sceny",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj tylko wartość pola celu wybranej sceny. Nie zmieniaj innych pól ani encji."
  },
  sceneConflict: {
    key: "sceneConflict",
    label: "Konflikt sceny",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj tylko wartość pola konfliktu wybranej sceny. Nie zmieniaj innych pól ani encji."
  },
  sceneOutcome: {
    key: "sceneOutcome",
    label: "Wynik sceny",
    action: "generate_scene_field",
    targetKind: "scene",
    userInstruction:
      "Wygeneruj tylko wartość pola wyniku wybranej sceny. Jeśli scena ma już napisany tekst manuskryptu, opisz wynik zgodny z tym tekstem. Nie zmieniaj innych pól ani encji."
  },
  threadChapterDescription: {
    key: "threadChapterDescription",
    label: "Opis wątku w rozdziale",
    action: "generate_thread_chapter_field",
    targetKind: "thread",
    userInstruction:
      "Wygeneruj tylko opis tego, co dzieje się z wybranym wątkiem w wybranym rozdziale. Uwzględnij ogólny opis wątku, treść rozdziału i sąsiednie rozdziały tego samego wątku. Nie zmieniaj listy relacji ani innych pól planu."
  },
  chapterThreadSuggestions: {
    key: "chapterThreadSuggestions",
    label: "Powiązane wątki",
    action: "suggest_chapter_relations",
    targetKind: "chapter",
    userInstruction:
      "Zasugeruj tylko istniejące wątki fabularne, które warto dopiąć do wybranego rozdziału. AI może nie sugerować żadnego wątku, jeśli nie ma to zastosowania w tym rozdziale. Nie twórz nowych wątków, nie sugeruj wątków spoza Current Plan i wyklucz wątki już przypisane do rozdziału."
  },
  allChapterThreadSuggestions: {
    key: "allChapterThreadSuggestions",
    label: "Wątki dla rozdziałów",
    action: "suggest_chapter_relations",
    targetKind: "chapter",
    userInstruction:
      "Zasugeruj przypisania istniejących wątków do wszystkich rozdziałów. Nie twórz nowych wątków, nie sugeruj wątków spoza Current Plan i nie duplikuj relacji już przypisanych do rozdziału."
  },
  chapterBeatSuggestions: {
    key: "chapterBeatSuggestions",
    label: "Powiązane beaty",
    action: "suggest_chapter_relations",
    targetKind: "chapter",
    userInstruction:
      "Zasugeruj tylko istniejące beaty, które warto dopiąć do wybranego rozdziału. AI może nie sugerować żadnego beatu, jeśli nie ma to zastosowania w tym rozdziale. Nie twórz nowych beatów, nie sugeruj beatów spoza Current Plan i wyklucz beaty już przypisane do rozdziału."
  },
  sceneRelationSuggestions: {
    key: "sceneRelationSuggestions",
    label: "Relacje sceny",
    action: "suggest_scene_relations",
    targetKind: "scene",
    userInstruction:
      "Zaproponuj relacje dla wybranej istniejącej sceny: postacie, POV, lokację, elementy świata, reguły świata i lokalne wątki. Używaj wyłącznie istniejących ID albo dokładnych nazw z kontekstu. Jeśli czegoś brakuje, zwróć to jako kandydat Story Bible, bez udawania, że encja istnieje."
  },
  planGaps: {
    key: "planGaps",
    label: "Luki planu",
    action: "find_plan_gaps",
    targetKind: "audit",
    userInstruction:
      "Znajdź luki, słabe napięcie, wątki bez payoffu i rozdziały bez celu."
  }
};

const planContextSourceLabels: Record<PlanContextKey, string> = {
  storyStructure: "Struktura fabuły",
  storyStructureDescription: "Opis struktury",
  storyStructureNotes: "Notatki do planu",
  acts: "Akty",
  actPurpose: "Cel aktu",
  actSummary: "Streszczenie aktu",
  beatSheet: "Beat sheet",
  beatName: "Nazwa beatu",
  beatRole: "Rola beatu",
  beatDescription: "Opis beatu",
  plotThreads: "Wątki",
  threadDescription: "Opis wątku",
  chapterPlan: "Szkielet rozdziałów",
  chapterSummary: "Streszczenie rozdziału",
  chapterPurpose: "Cel rozdziału",
  chapterConflict: "Konflikt rozdziału",
  chapterTurningPoint: "Punkt zwrotny",
  sceneDraft: "Nowa scena",
  allChapterSceneDrafts: "Sceny dla rozdziałów",
  prepareChapterForScenes: "Przygotowanie rozdziału",
  chapterSceneBreakdown: "Rozbicie rozdziału na sceny",
  sceneTitle: "Tytuł sceny",
  sceneSummary: "Streszczenie sceny",
  sceneGoal: "Cel sceny",
  sceneConflict: "Konflikt sceny",
  sceneOutcome: "Wynik sceny",
  threadChapterDescription: "Opis wątku w rozdziale",
  chapterThreadSuggestions: "Powiązane wątki",
  allChapterThreadSuggestions: "Wątki dla rozdziałów",
  chapterBeatSuggestions: "Powiązane beaty",
  sceneRelationSuggestions: "Relacje sceny",
  planGaps: "Luki planu",
  bookCore: "Rdzeń koncepcji",
  styleGuide: "Style guide",
  allActs: "Wszystkie akty",
  targetAct: "Docelowy akt",
  siblingActs: "Sąsiednie akty",
  actChapters: "Rozdziały aktu",
  allChapters: "Wszystkie rozdziały",
  targetChapter: "Docelowy rozdział",
  chapterScenes: "Sceny rozdziału",
  chapterAct: "Akt rozdziału",
  neighborChapters: "Sąsiednie rozdziały",
  targetScene: "Docelowa scena",
  sceneChapter: "Rozdział sceny",
  neighborScenes: "Sąsiednie sceny",
  assignedBeats: "Przypisane beaty",
  assignedThreads: "Przypisane wątki",
  allBeats: "Wszystkie beaty",
  targetBeat: "Docelowy beat",
  beatChapter: "Rozdział beatu",
  siblingBeats: "Sąsiednie beaty",
  allThreads: "Wszystkie wątki",
  targetThread: "Docelowy wątek",
  threadChapters: "Rozdziały wątku",
  threadActs: "Akty wątku",
  targetThreadChapter: "Relacja wątku z rozdziałem",
  threadNeighborChapters: "Sąsiednie rozdziały wątku",
  allCharacters: "Istniejące postacie",
  allWorldElements: "Istniejące elementy świata",
  allWorldRules: "Istniejące reguły świata",
  sceneManuscript: "Tekst sceny (manuskrypt)",
  planAudit: "Pełny plan"
};

const planPromptContextDefaultKeys: Record<PlanFieldKey, PlanContextKey[]> = {
  storyStructure: ["bookCore", "styleGuide", "storyStructure"],
  storyStructureDescription: ["bookCore", "styleGuide", "storyStructure", "allActs"],
  storyStructureNotes: ["bookCore", "styleGuide", "storyStructure", "allActs"],
  acts: ["bookCore", "styleGuide", "storyStructure", "allActs"],
  actPurpose: ["bookCore", "storyStructure", "targetAct", "siblingActs"],
  actSummary: ["bookCore", "storyStructure", "targetAct", "siblingActs", "actChapters"],
  beatSheet: ["bookCore", "styleGuide", "storyStructure", "allActs", "allChapters", "allBeats", "allThreads"],
  beatName: ["storyStructure", "targetBeat", "beatChapter", "siblingBeats", "assignedThreads"],
  beatRole: ["storyStructure", "targetBeat", "beatChapter", "siblingBeats", "assignedThreads"],
  beatDescription: ["storyStructure", "targetBeat", "beatChapter", "siblingBeats", "assignedThreads"],
  plotThreads: ["bookCore", "styleGuide", "storyStructure", "allThreads", "allChapters"],
  threadDescription: ["bookCore", "targetThread", "threadChapters", "threadActs"],
  chapterPlan: ["bookCore", "styleGuide", "storyStructure", "allActs", "allChapters"],
  chapterSummary: ["bookCore", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  chapterPurpose: ["bookCore", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  chapterConflict: ["bookCore", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  chapterTurningPoint: ["bookCore", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  sceneDraft: ["bookCore", "styleGuide", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  allChapterSceneDrafts: ["bookCore", "styleGuide", "planAudit"],
  prepareChapterForScenes: ["bookCore", "targetChapter", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters"],
  chapterSceneBreakdown: ["bookCore", "styleGuide", "targetChapter", "chapterScenes", "chapterAct", "assignedBeats", "assignedThreads", "neighborChapters", "allCharacters", "allWorldElements", "allWorldRules"],
  sceneTitle: ["bookCore", "styleGuide", "targetScene", "sceneManuscript", "sceneChapter", "neighborScenes", "assignedThreads"],
  sceneSummary: ["bookCore", "styleGuide", "targetScene", "sceneManuscript", "sceneChapter", "neighborScenes", "assignedThreads"],
  sceneGoal: ["bookCore", "targetScene", "sceneManuscript", "sceneChapter", "assignedThreads", "assignedBeats"],
  sceneConflict: ["bookCore", "targetScene", "sceneManuscript", "sceneChapter", "assignedThreads", "assignedBeats"],
  sceneOutcome: ["bookCore", "targetScene", "sceneManuscript", "sceneChapter", "neighborScenes", "assignedThreads"],
  threadChapterDescription: ["targetThreadChapter", "targetThread", "targetChapter", "threadNeighborChapters", "assignedBeats"],
  chapterThreadSuggestions: ["bookCore", "targetChapter", "assignedThreads", "allThreads", "assignedBeats", "neighborChapters"],
  allChapterThreadSuggestions: ["bookCore", "planAudit"],
  chapterBeatSuggestions: ["bookCore", "targetChapter", "assignedBeats", "allBeats", "assignedThreads", "neighborChapters"],
  sceneRelationSuggestions: ["bookCore", "targetScene", "sceneChapter", "assignedThreads", "allThreads", "neighborScenes", "allCharacters", "allWorldElements", "allWorldRules"],
  planGaps: ["bookCore", "styleGuide", "planAudit"]
};

export function buildPlanPromptPackage(
  project: Project,
  book: Book,
  plan: BookPlan,
  field: PlanFieldKey,
  targetEntity?: Act | Beat | PlotThread | Chapter | ChapterThread | Scene,
  contextControl?: PromptContextControl,
  storyBible: PlanStoryBibleContext = emptyPlanStoryBibleContext()
): PlanPromptPackage {
  const config = planFieldConfigs[field];
  const targetFieldCurrentValue = currentPlanFieldValue(plan, field, targetEntity);
  const generationMode = targetFieldCurrentValue.trim() ? "expand" : "generate";
  const effectiveContextControl = contextControl ?? defaultPlanContextControl(field);

  return {
    id: createPromptId(config.action),
    projectId: project.id,
    bookId: book.id,
    action: config.action,
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: config.userInstruction,
    context: {
      targetField: field,
      targetEntityId: targetEntity ? planTargetEntityId(targetEntity) : undefined,
      targetEntityLabel: targetEntity ? planTargetEntityLabel(plan, targetEntity) : undefined,
      ...(targetEntity ? { targetEntitySnapshot: stripSceneManuscript(targetEntity) } : {}),
      targetSceneManuscript:
        targetEntity && "manuscriptContent" in targetEntity
          ? trimManuscriptForPrompt(targetEntity.manuscriptContent ?? "")
          : "",
      book: bookPlanContext(book),
      plan: {
        structureType: plan.structure?.structureType ?? "",
        structureDescription: plan.structure?.description ?? "",
        structureNotes: plan.structure?.notes ?? "",
        acts: plan.acts,
        beats: plan.beats,
        threads: plan.threads,
        chapters: plan.chapters,
        chapterThreads: plan.chapterThreads,
        chapterBeats: plan.chapterBeats,
        scenes: plan.scenes.map((scene) => ({ ...scene, manuscriptContent: "" })),
        sceneCharacters: plan.sceneCharacters,
        sceneThreads: plan.sceneThreads,
        sceneWorldElements: plan.sceneWorldElements,
        sceneWorldRules: plan.sceneWorldRules
      },
      storyBible,
      generationMode,
      targetFieldCurrentValue,
      contextControl: effectiveContextControl
    },
    outputContract: {
      kind: "book_plan_suggestion",
      format: "json",
      schema: planSuggestionSchema(field)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderPlanPromptPackage(promptPackage: PlanPromptPackage): string {
  const config = planFieldConfigs[promptPackage.context.targetField];
  const authorPriority = renderAuthorPriority(
    promptPackage.context.contextControl
  );
  const modeInstruction =
    promptPackage.context.generationMode === "expand"
      ? `Tryb pracy: expand.
Obecna zawartość pola "${config.label}" jest materiałem wyjściowym:
${emptyFallback(promptPackage.context.targetFieldCurrentValue)}

Uwzględnij tę treść i rozwiń ją w lepszą, pełniejszą propozycję. Możesz przebudować, doprecyzować i przepisać istniejącą treść, jeśli dzięki temu wynik będzie spójniejszy. Zwróć kompletną docelową wartość pola, nie sam dopisek.`
      : `Tryb pracy: generate.
Pole "${config.label}" jest puste albo wymaga nowej propozycji. Wygeneruj kompletną docelową wartość pola.`;

  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj danych. Zwróć tylko propozycje jako JSON.
- Nie kasuj istniejących aktów, beatów, wątków ani rozdziałów; proponuj zmiany i dodatki.
- Elementy planu, które odwołujesz, identyfikuj po id albo dokładnej nazwie.
- Zwróć tylko sekcje przewidziane w Output Contract dla docelowego pola. Nie dopisuj pozostałych części planu.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

${authorPriority}

# Book Context
${renderBookContext(promptPackage.context.book, promptPackage.context.contextControl)}

# Current Plan
${renderPlanContext(
  promptPackage.context.plan,
  promptPackage.context.targetField,
  promptPackage.context.targetEntityId,
  promptPackage.context.contextControl
)}

${
  promptPackage.context.targetSceneManuscript &&
  isContextKeyIncluded("sceneManuscript", promptPackage.context.contextControl)
    ? `# Scene Manuscript\nNapisany tekst docelowej sceny (czysty tekst, może być przycięty):\n${promptPackage.context.targetSceneManuscript}\n\n`
    : ""
}# Existing Story Bible
${renderStoryBibleContext(promptPackage.context.storyBible, promptPackage.context.contextControl)}

# Current Work
Docelowe pole: ${promptPackage.context.targetField} (${config.label}).
Docelowy element: ${promptPackage.context.targetEntityLabel ?? "(brak)"}
Migawka docelowego elementu: ${JSON.stringify(promptPackage.context.targetEntitySnapshot ?? null)}
${modeInstruction}

# Output Contract
Zwróć JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function planPromptContextSources(field: PlanFieldKey): PromptContextSource[] {
  const required: PromptContextSource = {
    key: field,
    label: planFieldConfigs[field].label,
    required: true
  };
  const defaultKeys = planPromptContextDefaultKeys[field].filter((key) => key !== field);

  return [
    required,
    ...defaultKeys.map((key) => ({
      key,
      label: planContextSourceLabels[key],
      required: false
    }))
  ];
}

export function planPromptContextSource(
  field: PlanFieldKey,
  targetEntity?: Act | Beat | PlotThread | Chapter | ChapterThread | Scene
): PromptContextSource {
  const entityId = targetEntity ? planTargetEntityId(targetEntity) : "global";
  return {
    key: `field:${field}:${entityId}`,
    label: `Pole: ${planFieldConfigs[field].label}`,
    required: false
  };
}

export function planStoryBibleContext(
  characters: CharacterWorkspace,
  world: WorldWorkspace
): PlanStoryBibleContext {
  return {
    characters: characters.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      shortDescription: character.shortDescription,
      arcSummary: character.arcSummary,
      voiceNotes: character.voiceNotes,
      knowledgeNotes: character.knowledgeNotes
    })),
    worldElements: world.elements.map((element) => ({
      id: element.id,
      name: element.name,
      elementType: element.elementType,
      summary: element.summary,
      details: element.details
    })),
    worldRules: world.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      violationConsequences: rule.violationConsequences
    }))
  };
}

function emptyPlanStoryBibleContext(): PlanStoryBibleContext {
  return {
    characters: [],
    worldElements: [],
    worldRules: []
  };
}

function defaultPlanContextControl(field: PlanFieldKey): PromptContextControl {
  const sources = planPromptContextSources(field);

  return {
    includedContextKeys: sources.map((source) => source.key),
    authorPriorityComment: "",
    contextSources: sources
  };
}

function bookPlanContext(book: Book): PlanPromptPackage["context"]["book"] {
  return {
    workingTitle: book.workingTitle ?? "",
    premise: book.premise ?? "",
    expandedPremise: book.expandedPremise ?? "",
    centralConflict: book.centralConflict ?? "",
    antagonistForce: book.antagonistForce ?? "",
    stakes: book.stakes ?? "",
    settingSketch: book.settingSketch ?? "",
    endingDirection: book.endingDirection ?? "",
    genre: book.genre ?? "",
    subgenre: book.subgenre ?? "",
    targetAudience: book.targetAudience ?? "",
    tone: book.tone ?? "",
    pointOfView: book.pointOfView ?? "",
    targetWordCount: book.targetWordCount ?? null,
    themesJson: book.themesJson ?? "[]",
    styleGuide: book.styleGuide ?? ""
  };
}

function renderBookContext(
  book: PlanPromptPackage["context"]["book"],
  contextControl?: PromptContextControl
): string {
  if (contextControl && !isContextKeyIncluded("bookCore", contextControl)) {
    return "(pominięto przez autora)";
  }

  const lines = [
    optionalLine("Tytuł roboczy", book.workingTitle, "- "),
    optionalLine("Premise", book.premise, "- "),
    optionalLine("Rozszerzona premisa", book.expandedPremise, "- "),
    optionalLine("Konflikt centralny", book.centralConflict, "- "),
    optionalLine("Siła przeciwna", book.antagonistForce, "- "),
    optionalLine("Stawki", book.stakes, "- "),
    optionalLine("Setting", book.settingSketch, "- "),
    optionalLine("Kierunek zakończenia", book.endingDirection, "- "),
    optionalLine(
      "Gatunek",
      [book.genre, book.subgenre].filter(Boolean).join(", "),
      "- "
    ),
    optionalLine("Odbiorcy", book.targetAudience, "- "),
    optionalLine("Ton", book.tone, "- "),
    optionalLine("POV", book.pointOfView, "- "),
    optionalLine("Docelowa liczba słów", book.targetWordCount, "- "),
    optionalLine("Tematy", renderJsonList(book.themesJson), "- "),
    !contextControl || isContextKeyIncluded("styleGuide", contextControl)
      ? optionalLine("Style guide", book.styleGuide, "- ")
      : "- Style guide: (pominięto przez autora)"
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "(koncept książki jest pusty)";
}

function renderPlanContext(
  plan: PlanPromptPackage["context"]["plan"],
  targetField: PlanFieldKey,
  targetEntityId?: string,
  contextControl?: PromptContextControl
): string {
  const target = targetEntityForPlanContext(plan, targetEntityId);
  const sections = [
    isContextKeyIncluded("storyStructure", contextControl)
      ? `Struktura: ${JSON.stringify({
          type: plan.structureType,
          description: plan.structureDescription,
          notes: plan.structureNotes
        })}`
      : "",
    isContextKeyIncluded("allActs", contextControl)
      ? contextLine("Wszystkie akty", plan.acts.map(compactAct))
      : "",
    isContextKeyIncluded("targetAct", contextControl)
      ? contextLine("Docelowy akt", target.act ? compactAct(target.act) : null)
      : "",
    isContextKeyIncluded("siblingActs", contextControl)
      ? contextLine("Sąsiednie akty", siblingActs(plan, target.act).map(compactAct))
      : "",
    isContextKeyIncluded("actChapters", contextControl)
      ? contextLine("Rozdziały aktu", chaptersForAct(plan, target.act?.id).map(compactChapter))
      : "",
    isContextKeyIncluded("allChapters", contextControl)
      ? contextLine("Wszystkie rozdziały", orderedChapters(plan).map(compactChapter))
      : "",
    isContextKeyIncluded("targetChapter", contextControl)
      ? contextLine("Docelowy rozdział", target.chapter ? compactChapter(target.chapter) : null)
      : "",
    isContextKeyIncluded("chapterScenes", contextControl)
      ? contextLine("Sceny rozdziału", scenesForChapter(plan, target.chapter).map(compactScene))
      : "",
    isContextKeyIncluded("chapterAct", contextControl)
      ? contextLine("Akt rozdziału", target.chapter ? compactAct(actForChapter(plan, target.chapter)) : null)
      : "",
    isContextKeyIncluded("neighborChapters", contextControl)
      ? contextLine("Sąsiednie rozdziały", neighborChapters(plan, target.chapter).map(compactChapter))
      : "",
    isContextKeyIncluded("targetScene", contextControl)
      ? contextLine("Docelowa scena", target.scene ? compactScene(target.scene) : null)
      : "",
    isContextKeyIncluded("sceneChapter", contextControl)
      ? contextLine("Rozdział sceny", target.scene ? compactChapter(chapterForScene(plan, target.scene)) : null)
      : "",
    isContextKeyIncluded("neighborScenes", contextControl)
      ? contextLine("Sąsiednie sceny", neighborScenes(plan, target.scene).map(compactScene))
      : "",
    isContextKeyIncluded("assignedBeats", contextControl)
      ? contextLine("Przypisane beaty", assignedBeatsForChapter(plan, target.chapter).map((beat) => compactBeat(plan, beat)))
      : "",
    isContextKeyIncluded("assignedThreads", contextControl)
      ? contextLine("Przypisane wątki", assignedThreadsForChapter(plan, target.chapter).map(compactThread))
      : "",
    isContextKeyIncluded("allBeats", contextControl)
      ? contextLine("Wszystkie beaty", plan.beats.map((beat) => compactBeat(plan, beat)))
      : "",
    isContextKeyIncluded("targetBeat", contextControl)
      ? contextLine("Docelowy beat", target.beat ? compactBeat(plan, target.beat) : null)
      : "",
    isContextKeyIncluded("beatChapter", contextControl)
      ? contextLine("Rozdział beatu", target.beat ? compactChapter(chapterForBeat(plan, target.beat)) : null)
      : "",
    isContextKeyIncluded("siblingBeats", contextControl)
      ? contextLine("Sąsiednie beaty", siblingBeats(plan, target.beat).map((beat) => compactBeat(plan, beat)))
      : "",
    isContextKeyIncluded("allThreads", contextControl)
      ? contextLine("Wszystkie wątki", plan.threads.map(compactThread))
      : "",
    isContextKeyIncluded("targetThread", contextControl)
      ? contextLine("Docelowy wątek", target.thread ? compactThread(target.thread) : null)
      : "",
    isContextKeyIncluded("threadChapters", contextControl)
      ? contextLine("Rozdziały wątku", chaptersForThread(plan, target.thread?.id).map(compactChapter))
      : "",
    isContextKeyIncluded("threadActs", contextControl)
      ? contextLine("Akty wątku", actsForThread(plan, target.thread?.id).map(compactAct))
      : "",
    isContextKeyIncluded("targetThreadChapter", contextControl)
      ? contextLine("Relacja wątku z rozdziałem", target.relation ? compactChapterThread(plan, target.relation) : null)
      : "",
    isContextKeyIncluded("threadNeighborChapters", contextControl)
      ? contextLine("Sąsiednie rozdziały wątku", threadNeighborChapters(plan, target.relation).map(compactChapter))
      : "",
    isContextKeyIncluded("planAudit", contextControl)
      ? `Pełny plan: ${JSON.stringify({
          structure: {
            type: plan.structureType,
            description: plan.structureDescription,
            notes: plan.structureNotes
          },
          acts: plan.acts.map(compactAct),
          chapters: orderedChapters(plan).map(compactChapter),
          scenes: orderedScenes(plan).map(compactScene),
          beats: plan.beats.map((beat) => compactBeat(plan, beat)),
          threads: plan.threads.map(compactThread),
          chapterThreads: plan.chapterThreads,
          chapterBeats: plan.chapterBeats
        })}`
      : "",
    renderManualFieldContext(plan, targetField, contextControl)
  ].filter(Boolean);

  return sections.length ? sections.join("\n") : "(brak wybranego kontekstu planu)";
}

// Pusta sekcja ("[]"/"null") to szum, który uczy model, że danych nie ma —
// zamiast tego pomijamy linię w całości.
function contextLine(label: string, value: unknown): string {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return "";
  }
  return `${label}: ${JSON.stringify(value)}`;
}

function renderStoryBibleContext(
  storyBible: PlanStoryBibleContext,
  contextControl?: PromptContextControl
): string {
  const sections = [
    isContextKeyIncluded("allCharacters", contextControl) && storyBible.characters.length
      ? `Istniejące postacie: ${renderCappedEntityList(storyBible.characters, 30)}`
      : "",
    isContextKeyIncluded("allWorldElements", contextControl) && storyBible.worldElements.length
      ? `Istniejące elementy świata: ${renderCappedEntityList(storyBible.worldElements, 40)}`
      : "",
    isContextKeyIncluded("allWorldRules", contextControl) && storyBible.worldRules.length
      ? `Istniejące reguły świata: ${renderCappedEntityList(storyBible.worldRules, 40)}`
      : ""
  ].filter(Boolean);

  return sections.length
    ? sections.join("\n")
    : "(brak wybranego kontekstu Story Bible)";
}

function targetEntityForPlanContext(
  plan: PlanPromptPackage["context"]["plan"],
  targetEntityId?: string
) {
  const relation =
    targetEntityId && targetEntityId.includes(":")
      ? relationForId(plan, targetEntityId)
      : null;
  const chapterFromRelation = relation
    ? plan.chapters.find((chapter) => chapter.id === relation.chapterId) ?? null
    : null;
  const threadFromRelation = relation
    ? plan.threads.find((thread) => thread.id === relation.threadId) ?? null
    : null;
  const chapter =
    chapterFromRelation ??
    plan.chapters.find((item) => item.id === targetEntityId) ??
    null;
  const scene = plan.scenes.find((item) => item.id === targetEntityId) ?? null;
  const beat = plan.beats.find((item) => item.id === targetEntityId) ?? null;
  const thread =
    threadFromRelation ??
    plan.threads.find((item) => item.id === targetEntityId) ??
    null;
  const act =
    plan.acts.find((item) => item.id === targetEntityId) ??
    (chapter ? actForChapter(plan, chapter) : null) ??
    (scene ? actForChapter(plan, chapterForScene(plan, scene)) : null);

  return {
    act,
    beat,
    chapter: chapter ?? (scene ? chapterForScene(plan, scene) : null) ?? (beat ? chapterForBeat(plan, beat) : null),
    scene,
    thread,
    relation
  };
}

function relationForId(
  plan: PlanPromptPackage["context"]["plan"],
  relationId: string
): ChapterThread | null {
  const [threadId, chapterId] = relationId.split(":");
  if (!threadId || !chapterId) {
    return null;
  }

  return (
    plan.chapterThreads.find(
      (relation) =>
        relation.threadId === threadId && relation.chapterId === chapterId
    ) ?? null
  );
}

function compactAct(act: Act | null | undefined) {
  return act
    ? {
        id: act.id,
        name: act.name,
        purpose: act.purpose,
        summary: act.summary,
        startPercent: act.startPercent,
        endPercent: act.endPercent,
        orderIndex: act.orderIndex
      }
    : null;
}

function compactChapter(chapter: Chapter | null | undefined) {
  return chapter
    ? {
        id: chapter.id,
        actId: chapter.actId,
        number: chapter.number,
        workingTitle: chapter.workingTitle,
        summary: chapter.summary,
        purpose: chapter.purpose,
        conflict: chapter.conflict,
        turningPoint: chapter.turningPoint,
        targetWordCount: chapter.targetWordCount,
        orderIndex: chapter.orderIndex
      }
    : null;
}

function compactScene(scene: Scene | null | undefined) {
  return scene
    ? {
        id: scene.id,
        chapterId: scene.chapterId,
        orderIndex: scene.orderIndex,
        title: scene.title,
        summary: scene.summary,
        goal: scene.goal,
        conflict: scene.conflict,
        outcome: scene.outcome,
        timeMarker: scene.timeMarker,
        povCharacterId: scene.povCharacterId,
        locationId: scene.locationId,
        targetWordCount: scene.targetWordCount,
        status: scene.status
      }
    : null;
}

// Manuskrypt nie wchodzi do JSON-owych migawek planu — byłby dublem sekcji
// Scene Manuscript i rozsadzałby prompt oraz zapis pakietu w ai_runs.
function stripSceneManuscript<T>(entity: T): T {
  return entity && typeof entity === "object" && "manuscriptContent" in entity
    ? { ...entity, manuscriptContent: "" }
    : entity;
}

/** HTML z Tiptapa → czysty tekst; początek i koniec sceny, środek przycięty. */
function trimManuscriptForPrompt(html: string, maxWords = 2400): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }
  const head = words.slice(0, Math.floor(maxWords * 0.75)).join(" ");
  const tail = words.slice(-Math.floor(maxWords * 0.25)).join(" ");
  return `${head}\n(... środek sceny przycięty ...)\n${tail}`;
}

function compactBeat(plan: PlanPromptPackage["context"]["plan"], beat: Beat) {
  const chapter = chapterForBeat(plan, beat);

  return {
    id: beat.id,
    name: beat.name,
    role: beat.role,
    description: beat.description,
    orderIndex: beat.orderIndex,
    chapterId: chapter?.id ?? null,
    chapterTitle: chapter?.workingTitle ?? null
  };
}

function compactThread(thread: PlotThread | null | undefined) {
  return thread
    ? {
        id: thread.id,
        name: thread.name,
        description: thread.description,
        status: thread.status,
        orderIndex: thread.orderIndex
      }
    : null;
}

function compactChapterThread(
  plan: PlanPromptPackage["context"]["plan"],
  relation: ChapterThread
) {
  const thread = plan.threads.find((item) => item.id === relation.threadId);
  const chapter = plan.chapters.find((item) => item.id === relation.chapterId);

  return {
    threadId: relation.threadId,
    threadName: thread?.name ?? "",
    chapterId: relation.chapterId,
    chapterTitle: chapter?.workingTitle ?? "",
    chapterNumber: chapter?.number ?? null,
    description: relation.description
  };
}

function orderedChapters(plan: PlanPromptPackage["context"]["plan"]): Chapter[] {
  return [...plan.chapters].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }

    return left.number - right.number;
  });
}

function orderedScenes(plan: PlanPromptPackage["context"]["plan"]): Scene[] {
  return [...plan.scenes].sort((left, right) => {
    const leftChapter = left.chapterId ?? "";
    const rightChapter = right.chapterId ?? "";
    if (leftChapter !== rightChapter) {
      return leftChapter.localeCompare(rightChapter, "pl-PL");
    }

    return left.orderIndex - right.orderIndex || left.title.localeCompare(right.title, "pl-PL");
  });
}

function actForChapter(
  plan: PlanPromptPackage["context"]["plan"],
  chapter: Chapter | null | undefined
): Act | null {
  if (!chapter?.actId) {
    return null;
  }

  return plan.acts.find((act) => act.id === chapter.actId) ?? null;
}

function chapterForScene(
  plan: PlanPromptPackage["context"]["plan"],
  scene: Scene | null | undefined
): Chapter | null {
  if (!scene?.chapterId) {
    return null;
  }

  return plan.chapters.find((chapter) => chapter.id === scene.chapterId) ?? null;
}

function neighborScenes(
  plan: PlanPromptPackage["context"]["plan"],
  scene: Scene | null | undefined
): Scene[] {
  if (!scene) {
    return [];
  }

  const scenes = orderedScenes(plan).filter(
    (item) => (item.chapterId ?? null) === (scene.chapterId ?? null)
  );
  const index = scenes.findIndex((item) => item.id === scene.id);
  if (index < 0) {
    return [];
  }

  return [scenes[index - 1], scenes[index + 1]].filter(
    (item): item is Scene => Boolean(item)
  );
}

function scenesForChapter(
  plan: PlanPromptPackage["context"]["plan"],
  chapter: Chapter | null | undefined
): Scene[] {
  if (!chapter) {
    return [];
  }

  return orderedScenes(plan).filter((scene) => scene.chapterId === chapter.id);
}

function siblingActs(
  plan: PlanPromptPackage["context"]["plan"],
  act: Act | null | undefined
): Act[] {
  if (!act) {
    return [];
  }

  const orderedActs = [...plan.acts].sort((left, right) => left.orderIndex - right.orderIndex);
  const index = orderedActs.findIndex((item) => item.id === act.id);
  if (index < 0) {
    return [];
  }

  return [orderedActs[index - 1], orderedActs[index + 1]].filter(
    (item): item is Act => Boolean(item)
  );
}

function chaptersForAct(
  plan: PlanPromptPackage["context"]["plan"],
  actId: string | null | undefined
): Chapter[] {
  if (!actId) {
    return [];
  }

  return orderedChapters(plan).filter((chapter) => chapter.actId === actId);
}

function neighborChapters(
  plan: PlanPromptPackage["context"]["plan"],
  chapter: Chapter | null | undefined
): Chapter[] {
  if (!chapter) {
    return [];
  }

  const chapters = orderedChapters(plan);
  const index = chapters.findIndex((item) => item.id === chapter.id);
  if (index < 0) {
    return [];
  }

  return [chapters[index - 1], chapters[index + 1]].filter(
    (item): item is Chapter => Boolean(item)
  );
}

function chapterForBeat(
  plan: PlanPromptPackage["context"]["plan"],
  beat: Beat | null | undefined
): Chapter | null {
  if (!beat) {
    return null;
  }

  const chapterId =
    "chapterId" in beat && typeof beat.chapterId === "string"
      ? beat.chapterId
      : plan.chapterBeats.find((relation) => relation.beatId === beat.id)?.chapterId;

  return chapterId
    ? plan.chapters.find((chapter) => chapter.id === chapterId) ?? null
    : null;
}

function assignedBeatsForChapter(
  plan: PlanPromptPackage["context"]["plan"],
  chapter: Chapter | null | undefined
): Beat[] {
  if (!chapter) {
    return [];
  }

  const beatIds = new Set(
    plan.chapterBeats
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.beatId)
  );

  return plan.beats.filter((beat) => beatIds.has(beat.id));
}

function assignedThreadsForChapter(
  plan: PlanPromptPackage["context"]["plan"],
  chapter: Chapter | null | undefined
): PlotThread[] {
  if (!chapter) {
    return [];
  }

  const threadIds = new Set(
    plan.chapterThreads
      .filter((relation) => relation.chapterId === chapter.id)
      .map((relation) => relation.threadId)
  );

  return plan.threads.filter((thread) => threadIds.has(thread.id));
}

function siblingBeats(
  plan: PlanPromptPackage["context"]["plan"],
  beat: Beat | null | undefined
): Beat[] {
  const chapter = chapterForBeat(plan, beat);
  if (!beat || !chapter) {
    return [];
  }

  const beats = assignedBeatsForChapter(plan, chapter).sort(
    (left, right) => left.orderIndex - right.orderIndex
  );
  const index = beats.findIndex((item) => item.id === beat.id);
  if (index < 0) {
    return [];
  }

  return [beats[index - 1], beats[index + 1]].filter(
    (item): item is Beat => Boolean(item)
  );
}

function chaptersForThread(
  plan: PlanPromptPackage["context"]["plan"],
  threadId: string | null | undefined
): Chapter[] {
  if (!threadId) {
    return [];
  }

  const chapterIds = new Set(
    plan.chapterThreads
      .filter((relation) => relation.threadId === threadId)
      .map((relation) => relation.chapterId)
  );

  return orderedChapters(plan).filter((chapter) => chapterIds.has(chapter.id));
}

function actsForThread(
  plan: PlanPromptPackage["context"]["plan"],
  threadId: string | null | undefined
): Act[] {
  const actIds = new Set(
    chaptersForThread(plan, threadId)
      .map((chapter) => chapter.actId)
      .filter((actId): actId is string => Boolean(actId))
  );

  return plan.acts.filter((act) => actIds.has(act.id));
}

function threadNeighborChapters(
  plan: PlanPromptPackage["context"]["plan"],
  relation: ChapterThread | null | undefined
): Chapter[] {
  if (!relation) {
    return [];
  }

  const chapters = chaptersForThread(plan, relation.threadId);
  const index = chapters.findIndex((chapter) => chapter.id === relation.chapterId);
  if (index < 0) {
    return [];
  }

  return [chapters[index - 1], chapters[index + 1]].filter(
    (item): item is Chapter => Boolean(item)
  );
}

function renderManualFieldContext(
  plan: PlanPromptPackage["context"]["plan"],
  targetField: PlanFieldKey,
  contextControl?: PromptContextControl
): string {
  if (!contextControl) {
    return "";
  }

  const selectedManualSources = contextControl.contextSources.filter(
    (source) =>
      source.key.startsWith("field:") &&
      source.key !== targetField &&
      isContextKeyIncluded(source.key, contextControl)
  );
  if (selectedManualSources.length === 0) {
    return "";
  }

  const values = selectedManualSources.map((source) => {
    const [, field, entityId] = source.key.split(":");
    const planField = field as PlanFieldKey;
    return {
      label: source.label,
      field: planField,
      entityId,
      value: currentPlanContextFieldValue(plan, planField, entityId)
    };
  });

  return `Dodatkowe pola dodane przez autora: ${JSON.stringify(values)}`;
}

function currentPlanContextFieldValue(
  plan: PlanPromptPackage["context"]["plan"],
  field: PlanFieldKey,
  entityId: string | undefined
): string {
  if (field === "storyStructure") {
    return plan.structureType;
  }
  if (field === "storyStructureDescription") {
    return plan.structureDescription;
  }
  if (field === "storyStructureNotes") {
    return plan.structureNotes;
  }

  const target = targetEntityForPlanContext(plan, entityId === "global" ? undefined : entityId);
  if (field === "actPurpose") {
    return target.act?.purpose ?? "";
  }
  if (field === "actSummary") {
    return target.act?.summary ?? "";
  }
  if (field === "beatName") {
    return target.beat?.name ?? "";
  }
  if (field === "beatRole") {
    return target.beat?.role ?? "";
  }
  if (field === "beatDescription") {
    return target.beat?.description ?? "";
  }
  if (field === "threadDescription") {
    return target.thread?.description ?? "";
  }
  if (field === "chapterSummary") {
    return target.chapter?.summary ?? "";
  }
  if (field === "chapterPurpose") {
    return target.chapter?.purpose ?? "";
  }
  if (field === "chapterConflict") {
    return target.chapter?.conflict ?? "";
  }
  if (field === "chapterTurningPoint") {
    return target.chapter?.turningPoint ?? "";
  }
  if (field === "sceneTitle") {
    return target.scene?.title ?? "";
  }
  if (field === "sceneSummary") {
    return target.scene?.summary ?? "";
  }
  if (field === "sceneGoal") {
    return target.scene?.goal ?? "";
  }
  if (field === "sceneConflict") {
    return target.scene?.conflict ?? "";
  }
  if (field === "sceneOutcome") {
    return target.scene?.outcome ?? "";
  }
  if (field === "threadChapterDescription") {
    return target.relation?.description ?? "";
  }

  return "";
}

function planTargetEntityId(entity: Act | Beat | PlotThread | Chapter | ChapterThread | Scene): string {
  if ("chapterId" in entity && "threadId" in entity) {
    return `${entity.threadId}:${entity.chapterId}`;
  }

  return entity.id;
}

function planTargetEntityLabel(
  plan: BookPlan,
  entity: Act | Beat | PlotThread | Chapter | ChapterThread | Scene
): string {
  if ("chapterId" in entity && "threadId" in entity) {
    const thread = plan.threads.find((item) => item.id === entity.threadId);
    const chapter = plan.chapters.find((item) => item.id === entity.chapterId);
    return `${thread?.name ?? "Watek"} / ${chapter?.workingTitle ?? "Rozdzial"}`;
  }

  if ("workingTitle" in entity) {
    return entity.workingTitle;
  }
  if ("title" in entity) {
    return entity.title || "Scena bez tytułu";
  }

  return entity.name;
}

function currentPlanFieldValue(
  plan: BookPlan,
  field: PlanFieldKey,
  targetEntity?: Act | Beat | PlotThread | Chapter | ChapterThread | Scene
): string {
  if (field === "storyStructure") {
    return plan.structure?.structureType ?? "";
  }
  if (field === "storyStructureDescription") {
    return plan.structure?.description ?? "";
  }
  if (field === "storyStructureNotes") {
    return plan.structure?.notes ?? "";
  }
  if (targetEntity && "purpose" in targetEntity && field === "actPurpose") {
    return targetEntity.purpose ?? "";
  }
  if (targetEntity && "summary" in targetEntity && field === "actSummary") {
    return targetEntity.summary ?? "";
  }
  if (targetEntity && "role" in targetEntity && field === "beatName") {
    return targetEntity.name ?? "";
  }
  if (targetEntity && "role" in targetEntity && field === "beatRole") {
    return targetEntity.role ?? "";
  }
  if (targetEntity && "role" in targetEntity && field === "beatDescription") {
    return targetEntity.description ?? "";
  }
  if (targetEntity && "description" in targetEntity && field === "threadDescription") {
    return targetEntity.description ?? "";
  }
  if (targetEntity && "summary" in targetEntity && field === "chapterSummary") {
    return targetEntity.summary ?? "";
  }
  if (targetEntity && "purpose" in targetEntity && field === "chapterPurpose") {
    return targetEntity.purpose ?? "";
  }
  if (targetEntity && "conflict" in targetEntity && field === "chapterConflict") {
    return targetEntity.conflict ?? "";
  }
  if (
    targetEntity &&
    "turningPoint" in targetEntity &&
    field === "chapterTurningPoint"
  ) {
    return targetEntity.turningPoint ?? "";
  }
  if (targetEntity && "title" in targetEntity && field === "sceneTitle") {
    return targetEntity.title ?? "";
  }
  if (targetEntity && "title" in targetEntity && field === "sceneSummary") {
    return targetEntity.summary ?? "";
  }
  if (targetEntity && "title" in targetEntity && field === "sceneGoal") {
    return targetEntity.goal ?? "";
  }
  if (targetEntity && "title" in targetEntity && field === "sceneConflict") {
    return targetEntity.conflict ?? "";
  }
  if (targetEntity && "title" in targetEntity && field === "sceneOutcome") {
    return targetEntity.outcome ?? "";
  }
  if (
    targetEntity &&
    "chapterId" in targetEntity &&
    "threadId" in targetEntity &&
    field === "threadChapterDescription"
  ) {
    return targetEntity.description ?? "";
  }
  if (targetEntity && "workingTitle" in targetEntity && field === "chapterThreadSuggestions") {
    const assignedThreadIds = new Set(
      plan.chapterThreads
        .filter((relation) => relation.chapterId === targetEntity.id)
        .map((relation) => relation.threadId)
    );
    const assignedThreads = plan.threads
      .filter((thread) => assignedThreadIds.has(thread.id))
      .map((thread) => ({ id: thread.id, name: thread.name }));
    return assignedThreads.length ? JSON.stringify(assignedThreads) : "";
  }
  if (targetEntity && "workingTitle" in targetEntity && field === "chapterBeatSuggestions") {
    const assignedBeatIds = new Set(
      plan.chapterBeats
        .filter((relation) => relation.chapterId === targetEntity.id)
        .map((relation) => relation.beatId)
    );
    const assignedBeats = plan.beats
      .filter((beat) => assignedBeatIds.has(beat.id))
      .map((beat) => ({ id: beat.id, name: beat.name }));
    return assignedBeats.length ? JSON.stringify(assignedBeats) : "";
  }
  if (targetEntity && "workingTitle" in targetEntity && field === "sceneDraft") {
    const chapterScenes = plan.scenes
      .filter((scene) => scene.chapterId === targetEntity.id)
      .map((scene) => ({ id: scene.id, title: scene.title, summary: scene.summary }));
    return chapterScenes.length ? JSON.stringify(chapterScenes) : "";
  }

  return "";
}

function planSuggestionSchema(field: PlanFieldKey): unknown {
  const base = {
    version: 1,
    kind: "book_plan_suggestion",
    field,
    summary: "string",
    warnings: ["string"]
  };

  if (field === "storyStructure") {
    return {
      ...base,
      structure: {
        structureType: "three_act | save_the_cat | heros_journey | mystery_outline | custom"
      }
    };
  }

  if (
    field === "storyStructureDescription" ||
    field === "storyStructureNotes" ||
    field === "threadDescription" ||
    field === "threadChapterDescription" ||
    field === "sceneTitle" ||
    field === "sceneSummary" ||
    field === "sceneGoal" ||
    field === "sceneConflict" ||
    field === "sceneOutcome"
  ) {
    return {
      ...base,
      value: "string"
    };
  }

  if (field === "acts") {
    return {
      ...base,
      acts: [
        {
          name: "string",
          purpose: "string",
          summary: "string",
          startPercent: 0,
          endPercent: 25,
          color: "#3f8f6b"
        }
      ]
    };
  }

  if (field === "beatSheet") {
    return {
      ...base,
      beats: [
        {
          name: "string",
          description: "string",
          role: "string",
          chapterNameOrId: "string"
        }
      ]
    };
  }

  if (field === "plotThreads") {
    return {
      ...base,
      threads: [
        {
          name: "string",
          description: "string",
          color: "#3f8f6b",
          status: "planned"
        }
      ]
    };
  }

  if (field === "chapterPlan") {
    return {
      ...base,
      chapters: [
        {
          number: 1,
          workingTitle: "string",
          summary: "string",
          purpose: "string",
          targetWordCount: 3500,
          actNameOrId: "string"
        }
      ]
    };
  }

  if (field === "prepareChapterForScenes") {
    return {
      ...base,
      readiness: {
        blockers: ["string"],
        questionsForAuthor: ["string"],
        warnings: ["string"],
        nextStep: "string"
      }
    };
  }

  if (field === "chapterSceneBreakdown") {
    return {
      ...base,
      scenes: [
        {
          title: "string",
          summary: "string",
          goal: "string",
          conflict: "string",
          outcome: "string",
          targetWordCount: 1200,
          handledBeatOrDuty: "string",
          relationHints: {
            characterNamesOrIds: ["existing character id or exact character name"],
            threadNamesOrIds: ["existing thread id or exact thread name"],
            elementNamesOrIds: ["existing world element id or exact world element name"],
            ruleNamesOrIds: ["existing world rule id or exact world rule name"]
          },
          storyBibleNeeds: [
            {
              kind: "character | location | faction | object | rule | relation",
              label: "string",
              reason: "string"
            }
          ]
        }
      ]
    };
  }

  if (field === "sceneRelationSuggestions") {
    return {
      ...base,
      relationHints: {
        povCharacterNameOrId: "existing character id or exact character name",
        locationNameOrId: "existing world element id or exact world element name",
        characterNamesOrIds: ["existing character id or exact character name"],
        threadNamesOrIds: ["existing thread id or exact thread name"],
        elementNamesOrIds: ["existing world element id or exact world element name"],
        ruleNamesOrIds: ["existing world rule id or exact world rule name"]
      },
      storyBibleCandidates: [
        {
          kind: "character | location | faction | object | rule | relation",
          label: "string",
          reason: "string",
          similarExistingNameOrId: "string"
        }
      ]
    };
  }

  if (field === "sceneDraft") {
    return {
      ...base,
      scene: {
        title: "string",
        summary: "string",
        goal: "string",
        conflict: "string",
        outcome: "string",
        targetWordCount: 1200
      },
      relationHints: {
        characterNamesOrIds: ["existing character id or exact character name"],
        threadNamesOrIds: ["existing thread id or exact thread name"],
        elementNamesOrIds: ["existing world element id or exact world element name"],
        ruleNamesOrIds: ["existing world rule id or exact world rule name"]
      }
    };
  }

  if (field === "allChapterSceneDrafts") {
    return {
      ...base,
      scenes: [
        {
          chapterNameOrId: "existing chapter id or exact chapter title",
          title: "string",
          summary: "string",
          goal: "string",
          conflict: "string",
          outcome: "string",
          targetWordCount: 1200,
          relationHints: {
            threadNamesOrIds: ["existing thread id or exact thread name"]
          }
        }
      ]
    };
  }

  if (field === "chapterThreadSuggestions") {
    return {
      ...base,
      threadNamesOrIds: ["existing thread id or exact thread name"]
    };
  }

  if (field === "allChapterThreadSuggestions") {
    return {
      ...base,
      chapterThreads: [
        {
          chapterNameOrId: "existing chapter id or exact chapter title",
          threadNamesOrIds: ["existing thread id or exact thread name"]
        }
      ]
    };
  }

  if (field === "chapterBeatSuggestions") {
    return {
      ...base,
      beatNamesOrIds: ["existing beat id or exact beat name"]
    };
  }

  if (field === "planGaps") {
    return {
      ...base,
      value: [
        {
          problem: "string",
          whyItMatters: "string",
          suggestedFix: "string"
        }
      ]
    };
  }

  return {
    ...base,
    value: "string"
  };
}

function renderAuthorPriority(contextControl?: PromptContextControl): string {
  const comment = contextControl?.authorPriorityComment.trim();
  return comment
    ? `# Author Priority\nKomentarz autora ma najwyzszy priorytet:\n${comment}`
    : "";
}

function isContextKeyIncluded(
  key: string,
  contextControl?: PromptContextControl
): boolean {
  if (!contextControl) {
    return true;
  }

  const requiredKeys = new Set(
    contextControl.contextSources
      .filter((source) => source.required)
      .map((source) => source.key)
  );

  return requiredKeys.has(key) || contextControl.includedContextKeys.includes(key);
}

function renderJsonList(value: string | undefined | null): string {
  if (!value) {
    return "";
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .join(", ");
    }
  } catch {
    return value;
  }

  return value;
}

function emptyFallback(value: string | undefined | null): string {
  return value?.trim() ? value : "(brak)";
}

function createPromptId(action: AIAction): string {
  if ("randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
