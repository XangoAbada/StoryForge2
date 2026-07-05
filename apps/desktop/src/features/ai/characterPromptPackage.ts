import type {
  AIAction,
  Book,
  Character,
  CharacterMemory,
  CharacterMemoryLink,
  CharacterRelation,
  CharacterWorkspace,
  Project,
  VisualAsset
} from "../../shared/api/types";
import { compactCharacter, compactMemory, compactRelation } from "./promptContextLimits";
import type { PromptContextControl, PromptContextSource } from "./promptPackage";

export type CharacterFieldKey =
  | "characterProfile"
  | "characterRelation"
  | "characterMemory"
  | "characterType"
  | "name"
  | "aliasesJson"
  | "role"
  | "shortDescription"
  | "appearance"
  | "externalGoal"
  | "internalNeed"
  | "wound"
  | "falseBelief"
  | "secret"
  | "strengthsJson"
  | "weaknessesJson"
  | "voiceNotes"
  | "arcSummary"
  | "knowledgeNotes"
  | "visualPrompt"
  | "relationDescription"
  | "relationHistory"
  | "relationConflict"
  | "relationOpinion"
  | "relationSecret"
  | "relationChangeOverTime"
  | "memoryTitle"
  | "memorySummary"
  | "memoryDetails"
  | "memorySubject"
  | "memoryEmotion"
  | "memoryLinkDescription"
  | "characterImage";

type CharacterContextKey =
  | CharacterFieldKey
  | "bookCore"
  | "styleGuide"
  | "allCharacters"
  | "targetCharacter"
  | "targetRelations"
  | "targetMemories"
  | "allMemories"
  | "memoryLinks"
  | "targetRelation"
  | "targetMemory"
  | "targetMemoryLink";

export type CharacterPromptEntity =
  | Character
  | CharacterRelation
  | CharacterMemory
  | CharacterMemoryLink;

export type CharacterFieldConfig = {
  key: CharacterFieldKey;
  label: string;
  action: AIAction;
  targetKind: "character" | "relation" | "memory" | "memoryLink" | "image";
  userInstruction: string;
};

export type CharacterPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: CharacterFieldKey;
    targetEntityId?: string;
    targetEntityLabel?: string;
    targetEntitySnapshot?: unknown;
    book: Pick<
      Book,
      | "workingTitle"
      | "premise"
      | "expandedPremise"
      | "genre"
      | "subgenre"
      | "settingSketch"
      | "targetAudience"
      | "tone"
      | "styleGuide"
      | "pointOfView"
    >;
    workspace: {
      characters: Character[];
      relations: CharacterRelation[];
      memories: CharacterMemory[];
      memoryLinks: CharacterMemoryLink[];
      visualAssets: VisualAsset[];
    };
    generationMode: "generate" | "expand";
    targetFieldCurrentValue: string;
    contextControl?: PromptContextControl;
    sourceSceneDiscovery?: unknown;
  };
  outputContract: {
    kind: "character_field_suggestion" | "character_profile" | "character_relation" | "character_memory" | "character_image";
    format: "json" | "png";
    schema: unknown;
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
    feature?: "image_generation";
    mode?: "fresh";
    outputFormat?: "png";
    aspectRatio?: "4:5";
  };
  imagePrompt?: string;
  negativePrompt?: string;
};

export const characterFieldConfigs: Record<CharacterFieldKey, CharacterFieldConfig> = {
  characterProfile: field("characterProfile", "Pełny profil postaci", "generate_character_field", "character", "Wygeneruj kompletny tekstowy profil jednej nowej postaci do powieści. Nie generuj obrazu ani ścieżki obrazu. Uwzględnij rodzaj postaci: może to być człowiek, zwierzę, ożywiony przedmiot, istota albo inny byt pasujący do książki."),
  characterRelation: field("characterRelation", "Pełna relacja", "generate_character_relation_field", "relation", "Wygeneruj kompletny szkic relacji między wskazanymi postaciami: typ, opis, historię, konflikt, opinię, zaufanie, sekret i zmianę w czasie. Nie twórz nowych postaci."),
  characterMemory: field("characterMemory", "Pełne wspomnienie", "generate_character_memory_field", "memory", "Wygeneruj kompletne wspomnienie dla wskazanej postaci: tytuł, opis, szczegóły, typ, temat, emocję i ważność. Nie twórz obrazu ani nowych postaci."),
  characterType: field("characterType", "Rodzaj postaci", "generate_character_field", "character", "Wygeneruj tylko rodzaj postaci: człowiek, zwierzę, istota, ożywiony przedmiot albo inny precyzyjny typ."),
  name: field("name", "Imię / nazwa", "generate_character_field", "character", "Wygeneruj tylko imię lub nazwę postaci."),
  aliasesJson: field("aliasesJson", "Aliasy", "generate_character_field", "character", "Wygeneruj tylko listę aliasów postaci jako JSON array stringów."),
  role: field("role", "Rola fabularna", "generate_character_field", "character", "Wygeneruj tylko rolę fabularną postaci."),
  shortDescription: field("shortDescription", "Krótki opis", "generate_character_field", "character", "Wygeneruj tylko krótki opis postaci przydatny podczas pisania powieści."),
  appearance: field("appearance", "Wygląd", "generate_character_field", "character", "Wygeneruj tylko opis wyglądu postaci pisany pod prozę: sylwetka, twarz, charakterystyczne detale, mowa ciała. Bez języka promptów graficznych."),
  externalGoal: field("externalGoal", "Cel zewnętrzny", "generate_character_field", "character", "Wygeneruj tylko zewnętrzny cel postaci."),
  internalNeed: field("internalNeed", "Potrzeba wewnętrzna", "generate_character_field", "character", "Wygeneruj tylko wewnętrzną potrzebę postaci."),
  wound: field("wound", "Rana", "generate_character_field", "character", "Wygeneruj tylko ranę psychologiczną lub fabularną postaci."),
  falseBelief: field("falseBelief", "Fałszywe przekonanie", "generate_character_field", "character", "Wygeneruj tylko fałszywe przekonanie postaci."),
  secret: field("secret", "Sekret", "generate_character_field", "character", "Wygeneruj tylko sekret postaci."),
  strengthsJson: field("strengthsJson", "Siły", "generate_character_field", "character", "Wygeneruj tylko listę sił postaci jako JSON array stringów."),
  weaknessesJson: field("weaknessesJson", "Słabości", "generate_character_field", "character", "Wygeneruj tylko listę słabości postaci jako JSON array stringów."),
  voiceNotes: field("voiceNotes", "Głos postaci", "generate_character_field", "character", "Wygeneruj tylko notatki o sposobie mówienia i głosie postaci."),
  arcSummary: field("arcSummary", "Łuk przemiany", "generate_character_field", "character", "Wygeneruj tylko streszczenie łuku przemiany postaci."),
  knowledgeNotes: field("knowledgeNotes", "Wiedza postaci", "generate_character_field", "character", "Wygeneruj tylko notatki o wiedzy postaci, pomyłkach, domysłach i tajemnicach."),
  visualPrompt: field("visualPrompt", "Prompt wizualny", "generate_character_field", "character", "Wygeneruj tylko prompt wizualny postaci, bez generowania obrazu."),
  relationDescription: field("relationDescription", "Opis relacji", "generate_character_relation_field", "relation", "Wygeneruj tylko opis relacji między dwiema postaciami."),
  relationHistory: field("relationHistory", "Historia relacji", "generate_character_relation_field", "relation", "Wygeneruj tylko historię relacji."),
  relationConflict: field("relationConflict", "Konflikt relacji", "generate_character_relation_field", "relation", "Wygeneruj tylko konflikt ukryty lub jawny w relacji."),
  relationOpinion: field("relationOpinion", "Opinia", "generate_character_relation_field", "relation", "Wygeneruj tylko opinię postaci A o postaci B."),
  relationSecret: field("relationSecret", "Sekret relacji", "generate_character_relation_field", "relation", "Wygeneruj tylko sekret związany z relacją."),
  relationChangeOverTime: field("relationChangeOverTime", "Zmiana w czasie", "generate_character_relation_field", "relation", "Wygeneruj tylko zmianę relacji w czasie historii."),
  memoryTitle: field("memoryTitle", "Tytuł wspomnienia", "generate_character_memory_field", "memory", "Wygeneruj tylko tytuł wspomnienia."),
  memorySummary: field("memorySummary", "Opis wspomnienia", "generate_character_memory_field", "memory", "Wygeneruj tylko zwięzły opis wspomnienia."),
  memoryDetails: field("memoryDetails", "Szczegóły wspomnienia", "generate_character_memory_field", "memory", "Wygeneruj tylko szczegóły wspomnienia przydatne podczas pisania scen."),
  memorySubject: field("memorySubject", "Temat wspomnienia", "generate_character_memory_field", "memory", "Wygeneruj tylko temat, osobę, miejsce lub wydarzenie, którego dotyczy wspomnienie."),
  memoryEmotion: field("memoryEmotion", "Emocja", "generate_character_memory_field", "memory", "Wygeneruj tylko dominującą emocję wspomnienia."),
  memoryLinkDescription: field("memoryLinkDescription", "Opis połączenia", "generate_character_memory_field", "memoryLink", "Wygeneruj tylko opis połączenia między dwoma wspomnieniami."),
  characterImage: field("characterImage", "Obraz postaci", "generate_character_image", "image", "Wygeneruj obraz reprezentujący postać na podstawie profilu i kontekstu powieści.")
};

const defaultContext: Record<CharacterFieldKey, CharacterContextKey[]> = Object.fromEntries(
  Object.keys(characterFieldConfigs).map((key) => [
    key,
    ["bookCore", "styleGuide", "allCharacters", "targetCharacter", "targetRelations", "targetMemories"]
  ])
) as Record<CharacterFieldKey, CharacterContextKey[]>;

defaultContext.characterImage = [
  "bookCore",
  "styleGuide",
  "targetCharacter",
  "targetRelations",
  "targetMemories"
];
defaultContext.memoryLinkDescription = [
  "targetMemoryLink",
  "targetMemory",
  "allMemories",
  "memoryLinks"
];

const contextLabels: Record<CharacterContextKey, string> = {
  ...Object.fromEntries(
    Object.values(characterFieldConfigs).map((config) => [config.key, config.label])
  ) as Record<CharacterFieldKey, string>,
  bookCore: "Rdzeń książki",
  styleGuide: "Style guide",
  allCharacters: "Wszystkie postacie",
  targetCharacter: "Docelowa postać",
  targetRelations: "Relacje postaci",
  targetMemories: "Wspomnienia postaci",
  allMemories: "Wszystkie wspomnienia",
  memoryLinks: "Połączenia wspomnień",
  targetRelation: "Docelowa relacja",
  targetMemory: "Docelowe wspomnienie",
  targetMemoryLink: "Docelowe połączenie wspomnień"
};

export function buildCharacterPromptPackage(
  project: Project,
  book: Book,
  workspace: CharacterWorkspace,
  fieldKey: CharacterFieldKey,
  targetEntity?: CharacterPromptEntity,
  contextControl?: PromptContextControl
): CharacterPromptPackage {
  const config = characterFieldConfigs[fieldKey];
  const currentValue = currentCharacterFieldValue(fieldKey, targetEntity);
  const packageBase: CharacterPromptPackage = {
    id: createPromptId(config.action),
    projectId: project.id,
    bookId: book.id,
    action: config.action,
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: config.userInstruction,
    context: {
      targetField: fieldKey,
      targetEntityId: targetEntity ? characterEntityId(targetEntity) : undefined,
      targetEntityLabel: targetEntity ? characterEntityLabel(workspace, targetEntity) : undefined,
      ...(targetEntity ? { targetEntitySnapshot: targetEntity } : {}),
      book: compactBook(book),
      workspace: {
        characters: workspace.characters,
        relations: workspace.relations,
        memories: workspace.memories,
        memoryLinks: workspace.memoryLinks,
        visualAssets: workspace.visualAssets
      },
      generationMode: currentValue.trim() ? "expand" : "generate",
      targetFieldCurrentValue: currentValue,
      contextControl: contextControl ?? defaultCharacterContextControl(fieldKey)
    },
    outputContract: {
      kind: characterOutputKind(fieldKey),
      format: fieldKey === "characterImage" ? "png" : "json",
      schema: characterSuggestionSchema(fieldKey)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };

  if (fieldKey === "characterImage") {
    const imagePrompt = renderCharacterImagePrompt(book, targetEntity as Character | undefined);
    return {
      ...packageBase,
      generationOptions: {
        providerId: "codex-cli-bridge",
        feature: "image_generation",
        mode: "fresh",
        outputFormat: "png",
        aspectRatio: "4:5"
      },
      imagePrompt,
      negativePrompt:
        "No text, labels, watermark, UI frame, low quality, extra limbs, distorted face, blurry details, duplicate character, or cropped head."
    };
  }

  return packageBase;
}

export function renderCharacterPromptPackage(promptPackage: CharacterPromptPackage): string {
  if (promptPackage.context.targetField === "characterImage") {
    return `Generate one portrait/reference PNG character image with $imagegen.
Create it from scratch as a fresh image generation. Do not edit, reuse, vary, or derive from any existing image.
StoryForge2 final target path:
{OUTPUT_FILE}

Image brief:
${promptPackage.imagePrompt}

Avoid:
${promptPackage.negativePrompt}

Return only compact JSON after generation:
{"imagePath":"<actual PNG path or image session directory>"}
`;
  }

  const config = characterFieldConfigs[promptPackage.context.targetField];
  const scopeRule =
    promptPackage.context.targetField === "characterProfile"
      ? "- Wygeneruj komplet pól tekstowych profilu postaci. Nie generuj obrazu, pliku ani assetu."
      : promptPackage.context.targetField === "characterRelation"
        ? "- Wygeneruj komplet pól tekstowych jednej relacji. Nie twórz ani nie zapisuj postaci."
      : promptPackage.context.targetField === "characterMemory"
        ? "- Wygeneruj komplet pól tekstowych jednego wspomnienia. Nie twórz ani nie zapisuj postaci."
      : `- Wygeneruj tylko docelowe pole "${config.label}".`;
  return `# Role
Jesteś asystentem pisarskim pracującym wewnątrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj danych. Zwróć tylko propozycję jako JSON.
${scopeRule}
- Nie aktualizuj innych pól, postaci, relacji, wspomnień ani obrazów.
- Odpowiedz wyłącznie poprawnym JSON bez trailing commas.

${renderAuthorPriority(promptPackage.context.contextControl)}

# Book Context
${renderBookContext(promptPackage.context.book, promptPackage.context.contextControl)}

# Character Workspace
${renderWorkspaceContext(promptPackage)}

# Current Work
Docelowe pole: ${promptPackage.context.targetField} (${config.label}).
Docelowy element: ${promptPackage.context.targetEntityLabel ?? "(brak)"}
Migawka docelowego elementu: ${JSON.stringify(promptPackage.context.targetEntitySnapshot ?? null)}
Obecna wartość pola: ${emptyFallback(promptPackage.context.targetFieldCurrentValue)}
Tryb: ${promptPackage.context.generationMode}.

# Output Contract
Zwróć JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function characterPromptContextSources(fieldKey: CharacterFieldKey): PromptContextSource[] {
  const required: PromptContextSource = {
    key: fieldKey,
    label: characterFieldConfigs[fieldKey].label,
    required: true
  };

  return [
    required,
    ...defaultContext[fieldKey]
      .filter((key) => key !== fieldKey)
      .map((key) => ({
        key,
        label: contextLabels[key],
        required: false
      }))
  ];
}

export function characterPromptContextSource(
  fieldKey: CharacterFieldKey,
  targetEntity?: CharacterPromptEntity
): PromptContextSource {
  return {
    key: `character-field:${fieldKey}:${targetEntity ? characterEntityId(targetEntity) : "global"}`,
    label: `Pole: ${characterFieldConfigs[fieldKey].label}`,
    required: false
  };
}

export function characterEntityId(entity: CharacterPromptEntity): string {
  if ("fromMemoryId" in entity) {
    return entity.id;
  }
  return entity.id;
}

function field(
  key: CharacterFieldKey,
  label: string,
  action: AIAction,
  targetKind: CharacterFieldConfig["targetKind"],
  userInstruction: string
): CharacterFieldConfig {
  return { key, label, action, targetKind, userInstruction };
}

function defaultCharacterContextControl(fieldKey: CharacterFieldKey): PromptContextControl {
  const sources = characterPromptContextSources(fieldKey);
  return {
    includedContextKeys: sources.map((source) => source.key),
    authorPriorityComment: "",
    contextSources: sources
  };
}

function characterOutputKind(fieldKey: CharacterFieldKey): CharacterPromptPackage["outputContract"]["kind"] {
  if (fieldKey === "characterImage") {
    return "character_image";
  }
  if (fieldKey === "characterProfile") {
    return "character_profile";
  }
  if (fieldKey === "characterRelation") {
    return "character_relation";
  }
  if (fieldKey === "characterMemory") {
    return "character_memory";
  }
  return "character_field_suggestion";
}

function compactBook(book: Book): CharacterPromptPackage["context"]["book"] {
  return {
    workingTitle: book.workingTitle ?? "",
    premise: book.premise ?? "",
    expandedPremise: book.expandedPremise ?? "",
    genre: book.genre ?? "",
    subgenre: book.subgenre ?? "",
    settingSketch: book.settingSketch ?? "",
    targetAudience: book.targetAudience ?? "",
    tone: book.tone ?? "",
    styleGuide: book.styleGuide ?? "",
    pointOfView: book.pointOfView ?? ""
  };
}

function renderBookContext(
  book: CharacterPromptPackage["context"]["book"],
  contextControl?: PromptContextControl
): string {
  if (!isIncluded("bookCore", contextControl)) {
    return "(pominięto przez autora)";
  }

  const lines = [
    optionalLine("Tytuł roboczy", book.workingTitle),
    optionalLine("Premisa", book.premise),
    optionalLine("Rozszerzona premisa", book.expandedPremise),
    optionalLine("Gatunek", [book.genre, book.subgenre].filter(Boolean).join(", ")),
    optionalLine(
      "Odbiorca / ton / POV",
      [book.targetAudience, book.tone, book.pointOfView].filter(Boolean).join(", ")
    ),
    isIncluded("styleGuide", contextControl)
      ? optionalLine("Style guide", book.styleGuide)
      : ""
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "(koncept książki jest pusty)";
}

function renderWorkspaceContext(promptPackage: CharacterPromptPackage): string {
  const { workspace, targetEntityId, contextControl } = promptPackage.context;
  const targetCharacter = findTargetCharacter(workspace, targetEntityId);
  return [
    isIncluded("allCharacters", contextControl)
      ? workspaceLine("Postacie", workspace.characters.map(compactCharacter))
      : "",
    isIncluded("targetCharacter", contextControl)
      ? workspaceLine("Docelowa postać", compactCharacter(targetCharacter))
      : "",
    isIncluded("targetRelations", contextControl)
      ? workspaceLine("Relacje postaci", workspace.relations.filter((relation) => relation.fromCharacterId === targetCharacter?.id || relation.toCharacterId === targetCharacter?.id).map(compactRelation))
      : "",
    isIncluded("targetMemories", contextControl)
      ? workspaceLine("Wspomnienia postaci", workspace.memories.filter((memory) => memory.characterId === targetCharacter?.id).map(compactMemory))
      : "",
    isIncluded("allMemories", contextControl)
      ? workspaceLine("Wszystkie wspomnienia", workspace.memories.map(compactMemory))
      : "",
    isIncluded("memoryLinks", contextControl)
      ? workspaceLine("Połączenia wspomnień", workspace.memoryLinks)
      : "",
    promptPackage.context.sourceSceneDiscovery
      ? `Źródło odkrycia ze sceny: ${JSON.stringify(promptPackage.context.sourceSceneDiscovery)}`
      : "",
    renderManualFieldContext(promptPackage)
  ].filter(Boolean).join("\n") || "(brak wybranego kontekstu postaci)";
}

// Pustych sekcji nie serializujemy — "Postacie: []" to szum w prompcie.
function workspaceLine(label: string, value: unknown): string {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return "";
  }
  return `${label}: ${JSON.stringify(value)}`;
}

function renderManualFieldContext(promptPackage: CharacterPromptPackage): string {
  const contextControl = promptPackage.context.contextControl;
  if (!contextControl) {
    return "";
  }

  const selected = contextControl.contextSources.filter(
    (source) =>
      source.key.startsWith("character-field:") &&
      isIncluded(source.key, contextControl)
  );
  if (selected.length === 0) {
    return "";
  }

  return `Dodatkowe pola dodane przez autora: ${JSON.stringify(selected)}`;
}

function findTargetCharacter(
  workspace: CharacterPromptPackage["context"]["workspace"],
  targetEntityId?: string
): Character | null {
  const direct = workspace.characters.find((character) => character.id === targetEntityId);
  if (direct) {
    return direct;
  }
  const relation = workspace.relations.find((item) => item.id === targetEntityId);
  if (relation) {
    return workspace.characters.find((item) => item.id === relation.fromCharacterId) ?? null;
  }
  const memory = workspace.memories.find((item) => item.id === targetEntityId);
  if (memory) {
    return workspace.characters.find((item) => item.id === memory.characterId) ?? null;
  }
  return null;
}

function characterEntityLabel(
  workspace: CharacterWorkspace,
  entity: CharacterPromptEntity
): string {
  if ("name" in entity) {
    return entity.name;
  }
  if ("fromCharacterId" in entity) {
    const from = workspace.characters.find((item) => item.id === entity.fromCharacterId);
    const to = workspace.characters.find((item) => item.id === entity.toCharacterId);
    return `${from?.name ?? "Postać"} -> ${to?.name ?? "Postać"}`;
  }
  if ("characterId" in entity) {
    return entity.title;
  }
  return entity.description || "Połączenie wspomnień";
}

function currentCharacterFieldValue(
  fieldKey: CharacterFieldKey,
  entity?: CharacterPromptEntity
): string {
  if (fieldKey === "characterProfile") {
    return "";
  }

  if (!entity) {
    return "";
  }
  const record = entity as Record<string, unknown>;
  const map: Partial<Record<CharacterFieldKey, string>> = {
    characterRelation: "",
    characterMemory: "",
    characterType: String(record.characterType ?? ""),
    name: String(record.name ?? ""),
    aliasesJson: String(record.aliasesJson ?? ""),
    role: String(record.role ?? ""),
    shortDescription: String(record.shortDescription ?? ""),
    appearance: String(record.appearance ?? ""),
    externalGoal: String(record.externalGoal ?? ""),
    internalNeed: String(record.internalNeed ?? ""),
    wound: String(record.wound ?? ""),
    falseBelief: String(record.falseBelief ?? ""),
    secret: String(record.secret ?? ""),
    strengthsJson: String(record.strengthsJson ?? ""),
    weaknessesJson: String(record.weaknessesJson ?? ""),
    voiceNotes: String(record.voiceNotes ?? ""),
    arcSummary: String(record.arcSummary ?? ""),
    knowledgeNotes: String(record.knowledgeNotes ?? ""),
    visualPrompt: String(record.visualPrompt ?? ""),
    relationDescription: String(record.description ?? ""),
    relationHistory: String(record.history ?? ""),
    relationConflict: String(record.conflict ?? ""),
    relationOpinion: String(record.opinion ?? ""),
    relationSecret: String(record.secret ?? ""),
    relationChangeOverTime: String(record.changeOverTime ?? ""),
    memoryTitle: String(record.title ?? ""),
    memorySummary: String(record.summary ?? ""),
    memoryDetails: String(record.details ?? ""),
    memorySubject: String(record.subject ?? ""),
    memoryEmotion: String(record.emotion ?? ""),
    memoryLinkDescription: String(record.description ?? ""),
    characterImage: String(record.visualPrompt ?? "")
  };
  return map[fieldKey] ?? "";
}

function characterSuggestionSchema(fieldKey: CharacterFieldKey): unknown {
  if (fieldKey === "characterImage") {
    return {
      version: 1,
      kind: "character_image",
      imagePath: "string",
      prompt: "string",
      negativePrompt: "string",
      warnings: ["string"]
    };
  }

  if (fieldKey === "characterProfile") {
    return {
      version: 1,
      kind: "character_profile",
      summary: "string",
      character: {
        characterType: "person | animal | creature | object | spirit | other",
        name: "string",
        aliases: ["string"],
        role: "string",
        shortDescription: "string",
        appearance: "string",
        externalGoal: "string",
        internalNeed: "string",
        wound: "string",
        falseBelief: "string",
        secret: "string",
        strengths: ["string"],
        weaknesses: ["string"],
        voiceNotes: "string",
        arcSummary: "string",
        knowledgeNotes: "string",
        visualPrompt: "string"
      },
      warnings: ["string"]
    };
  }

  if (fieldKey === "characterRelation") {
    return {
      version: 1,
      kind: "character_relation",
      summary: "string",
      relation: {
        relationType: "rodzina | przyjazn | romans | rywalizacja | mentor | wrog | sojusz | zaleznosc | tajemnica | inne",
        description: "string",
        history: "string",
        conflict: "string",
        opinion: "string",
        trustLevel: 0,
        secret: "string",
        changeOverTime: "string"
      },
      warnings: ["string"]
    };
  }

  if (fieldKey === "characterMemory") {
    return {
      version: 1,
      kind: "character_memory",
      summary: "string",
      memory: {
        title: "string",
        summary: "string",
        details: "string",
        memoryType: "wydarzenie | miejsce | osoba | przedmiot | sekret | sen | trauma | inne",
        subject: "string",
        emotion: "string",
        importance: 0
      },
      warnings: ["string"]
    };
  }

  return {
    version: 1,
    kind: "character_field_suggestion",
    field: fieldKey,
    summary: "string",
    value: fieldKey.endsWith("Json") ? ["string"] : "string",
    warnings: ["string"]
  };
}

function renderCharacterImagePrompt(book: Book, character?: Character): string {
  return [
    "Format: portrait 4:5 character reference image, polished raster illustration, no text.",
    optionalLine("Book", [book.workingTitle, book.genre, book.tone].filter(Boolean).join(", ")),
    optionalLine("World and mood", compact(book.settingSketch || book.premise, 220)),
    optionalLine("Character", character ? compact(`${character.name}, ${character.characterType}, ${character.role}. ${character.shortDescription}`, 260) : ""),
    optionalLine("Inner life", character ? compact([character.externalGoal, character.internalNeed, character.wound, character.falseBelief].filter(Boolean).join("; "), 240) : ""),
    optionalLine("Voice and arc", character ? compact([character.voiceNotes, character.arcSummary].filter(Boolean).join("; "), 220) : ""),
    optionalLine("Visual prompt", character?.visualPrompt ?? ""),
    optionalLine("Design note", compact(book.styleGuide, 180))
  ].filter(Boolean).join("\n");
}

function renderAuthorPriority(contextControl?: PromptContextControl): string {
  const comment = contextControl?.authorPriorityComment.trim();
  return comment ? `# Author Priority\nKomentarz autora ma najwyzszy priorytet:\n${comment}` : "";
}

function isIncluded(key: string, contextControl?: PromptContextControl): boolean {
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

function optionalLine(label: string, value: string): string {
  return value.trim() ? `${label}: ${value.trim()}` : "";
}

function compact(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function emptyFallback(value: string | undefined | null): string {
  return value?.trim() ? value : "(brak)";
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }
  return `${action}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
