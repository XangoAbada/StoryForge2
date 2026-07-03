import type {
  AIAction,
  Book,
  BookPlan,
  CharacterWorkspace,
  Project,
  WorldElement,
  WorldRule,
  WorldWorkspace
} from "../../shared/api/types";
import { optionalLine } from "./promptContextLimits";
import type { PromptContextControl, PromptContextSource } from "./promptPackage";

export type WorldFieldKey =
  | "worldElement"
  | "worldRule"
  | "worldRuleAnalysis"
  | "elementType"
  | "elementName"
  | "elementSummary"
  | "elementDetails"
  | "elementStoryPurpose"
  | "elementConstraints"
  | "elementVisualPrompt"
  | "ruleName"
  | "ruleDescription"
  | "ruleScope"
  | "ruleCost"
  | "ruleLimitation"
  | "ruleExceptions"
  | "ruleViolationConsequences"
  | "ruleSceneExamples";

type WorldContextKey =
  | WorldFieldKey
  | "bookCore"
  | "styleGuide"
  | "bookPlan"
  | "characters"
  | "worldElements"
  | "worldRules"
  | "targetEntity";

export type WorldPromptEntity = WorldElement | WorldRule;

export type WorldFieldConfig = {
  key: WorldFieldKey;
  label: string;
  action: AIAction;
  targetKind: "element" | "rule" | "analysis";
  userInstruction: string;
};

export type WorldPromptPackage = {
  id: string;
  projectId: string;
  bookId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: {
    targetField: WorldFieldKey;
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
    plan: BookPlan;
    characters: CharacterWorkspace;
    world: WorldWorkspace;
    generationMode: "generate" | "expand" | "analyze";
    targetFieldCurrentValue: string;
    contextControl?: PromptContextControl;
    sourceSceneDiscovery?: unknown;
  };
  outputContract: {
    kind: "world_field_suggestion" | "world_element" | "world_rule" | "world_rule_analysis";
    format: "json";
    schema: unknown;
  };
  generationOptions: {
    providerId: "codex-cli-bridge";
  };
};

export const worldFieldConfigs: Record<WorldFieldKey, WorldFieldConfig> = {
  worldElement: field("worldElement", "Pełny element świata", "generate_world_element_field", "element", "Wygeneruj kompletny element świata do Story Bible: typ, nazwę, opis, szczegóły, znaczenie fabularne, ograniczenia i prompt wizualny."),
  worldRule: field("worldRule", "Pełna reguła świata", "generate_world_rule_field", "rule", "Wygeneruj kompletną regułę świata: nazwę, opis, zakres, koszt, ograniczenie, wyjątki, konsekwencje naruszenia i przykłady scen."),
  worldRuleAnalysis: field("worldRuleAnalysis", "Analiza reguły", "generate_world_rule_analysis", "analysis", "Przeanalizuj regułę świata pod kątem konsekwencji, sprzeczności, okazji fabularnych i pytań do autora. Nie zmieniaj kanonu."),
  elementType: field("elementType", "Typ elementu", "generate_world_element_field", "element", "Wygeneruj tylko typ elementu świata."),
  elementName: field("elementName", "Nazwa", "generate_world_element_field", "element", "Wygeneruj tylko nazwę elementu świata."),
  elementSummary: field("elementSummary", "Krótki opis", "generate_world_element_field", "element", "Wygeneruj tylko krótki opis elementu świata."),
  elementDetails: field("elementDetails", "Szczegóły", "generate_world_element_field", "element", "Wygeneruj tylko szczegóły elementu świata przydatne podczas pisania scen."),
  elementStoryPurpose: field("elementStoryPurpose", "Znaczenie fabularne", "generate_world_element_field", "element", "Wygeneruj tylko znaczenie fabularne elementu świata."),
  elementConstraints: field("elementConstraints", "Ograniczenia", "generate_world_element_field", "element", "Wygeneruj tylko ograniczenia, koszty lub warunki związane z elementem świata."),
  elementVisualPrompt: field("elementVisualPrompt", "Prompt wizualny", "generate_world_element_field", "element", "Wygeneruj tylko prompt wizualny elementu świata, bez generowania obrazu."),
  ruleName: field("ruleName", "Nazwa reguły", "generate_world_rule_field", "rule", "Wygeneruj tylko nazwę reguły świata."),
  ruleDescription: field("ruleDescription", "Opis reguły", "generate_world_rule_field", "rule", "Wygeneruj tylko opis reguły świata."),
  ruleScope: field("ruleScope", "Zakres", "generate_world_rule_field", "rule", "Wygeneruj tylko zakres obowiązywania reguły."),
  ruleCost: field("ruleCost", "Koszt", "generate_world_rule_field", "rule", "Wygeneruj tylko koszt związany z regułą."),
  ruleLimitation: field("ruleLimitation", "Ograniczenie", "generate_world_rule_field", "rule", "Wygeneruj tylko ograniczenie reguły."),
  ruleExceptions: field("ruleExceptions", "Wyjątki", "generate_world_rule_field", "rule", "Wygeneruj tylko wyjątki od reguły."),
  ruleViolationConsequences: field("ruleViolationConsequences", "Konsekwencje naruszenia", "generate_world_rule_field", "rule", "Wygeneruj tylko konsekwencje naruszenia reguły."),
  ruleSceneExamples: field("ruleSceneExamples", "Przykłady scen", "generate_world_rule_field", "rule", "Wygeneruj tylko przykłady scen, których dotyczy reguła.")
};

const defaultContext: Record<WorldFieldKey, WorldContextKey[]> = Object.fromEntries(
  Object.keys(worldFieldConfigs).map((key) => [
    key,
    ["bookCore", "styleGuide", "bookPlan", "characters", "worldElements", "worldRules", "targetEntity"]
  ])
) as Record<WorldFieldKey, WorldContextKey[]>;

const contextLabels: Record<WorldContextKey, string> = {
  ...Object.fromEntries(
    Object.values(worldFieldConfigs).map((config) => [config.key, config.label])
  ) as Record<WorldFieldKey, string>,
  bookCore: "Rdzeń książki",
  styleGuide: "Style guide",
  bookPlan: "Plan powieści",
  characters: "Postacie i relacje",
  worldElements: "Elementy świata",
  worldRules: "Reguły świata",
  targetEntity: "Docelowy element"
};

export function buildWorldPromptPackage(
  project: Project,
  book: Book,
  plan: BookPlan,
  characters: CharacterWorkspace,
  world: WorldWorkspace,
  fieldKey: WorldFieldKey,
  targetEntity?: WorldPromptEntity,
  contextControl?: PromptContextControl
): WorldPromptPackage {
  const config = worldFieldConfigs[fieldKey];
  const currentValue = currentWorldFieldValue(fieldKey, targetEntity);
  return {
    id: createPromptId(config.action),
    projectId: project.id,
    bookId: book.id,
    action: config.action,
    locale: project.language === "en" ? "en" : "pl",
    userInstruction: config.userInstruction,
    context: {
      targetField: fieldKey,
      targetEntityId: targetEntity ? worldEntityId(targetEntity) : undefined,
      targetEntityLabel: targetEntity ? worldEntityLabel(targetEntity) : undefined,
      ...(targetEntity ? { targetEntitySnapshot: targetEntity } : {}),
      book: compactBook(book),
      plan,
      characters,
      world,
      generationMode: fieldKey === "worldRuleAnalysis" ? "analyze" : currentValue.trim() ? "expand" : "generate",
      targetFieldCurrentValue: currentValue,
      contextControl: contextControl ?? defaultWorldContextControl(fieldKey)
    },
    outputContract: {
      kind: worldOutputKind(fieldKey),
      format: "json",
      schema: worldSuggestionSchema(fieldKey)
    },
    generationOptions: {
      providerId: "codex-cli-bridge"
    }
  };
}

export function renderWorldPromptPackage(promptPackage: WorldPromptPackage): string {
  const config = worldFieldConfigs[promptPackage.context.targetField];
  const scopeRule =
    promptPackage.context.targetField === "worldElement"
      ? "- Wygeneruj komplet pól tekstowych jednego elementu świata."
      : promptPackage.context.targetField === "worldRule"
        ? "- Wygeneruj komplet pól tekstowych jednej reguły świata."
        : promptPackage.context.targetField === "worldRuleAnalysis"
          ? "- Przeanalizuj wskazaną regułę. Nie zapisuj i nie zmieniaj kanonu."
          : `- Wygeneruj tylko docelowe pole "${config.label}".`;

  return `# Role
Jestes asystentem pisarskim pracujacym wewnatrz StoryForge2.

# Task
${promptPackage.userInstruction}

# Hard Rules
- Pisz po polsku, chyba że projekt ma inny język.
- Dla locale "pl" używaj poprawnych polskich znaków.
- Nie zapisuj danych. Zwroc tylko propozycje jako JSON.
${scopeRule}
- Nie aktualizuj innych pól, elementów, reguł, postaci, wątków ani rozdziałów.
- Odpowiedz wylacznie poprawnym JSON bez trailing commas.

${renderAuthorPriority(promptPackage.context.contextControl)}

# Book Context
${renderBookContext(promptPackage.context.book, promptPackage.context.contextControl)}

# Story Workspace
${renderWorkspaceContext(promptPackage)}

# Current Work
Docelowe pole: ${promptPackage.context.targetField} (${config.label}).
Docelowy element: ${promptPackage.context.targetEntityLabel ?? "(brak)"}
Migawka docelowego elementu: ${JSON.stringify(promptPackage.context.targetEntitySnapshot ?? null)}
Obecna wartosc pola: ${emptyFallback(promptPackage.context.targetFieldCurrentValue)}
Tryb: ${promptPackage.context.generationMode}.

# Output Contract
Zwroc JSON:
${JSON.stringify(promptPackage.outputContract.schema, null, 2)}
`;
}

export function worldPromptContextSources(fieldKey: WorldFieldKey): PromptContextSource[] {
  const required: PromptContextSource = {
    key: fieldKey,
    label: worldFieldConfigs[fieldKey].label,
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

export function worldPromptContextSource(
  fieldKey: WorldFieldKey,
  targetEntity?: WorldPromptEntity
): PromptContextSource {
  return {
    key: `world-field:${fieldKey}:${targetEntity ? worldEntityId(targetEntity) : "global"}`,
    label: `Pole: ${worldFieldConfigs[fieldKey].label}`,
    required: false
  };
}

export function worldEntityId(entity: WorldPromptEntity): string {
  return entity.id;
}

function field(
  key: WorldFieldKey,
  label: string,
  action: AIAction,
  targetKind: WorldFieldConfig["targetKind"],
  userInstruction: string
): WorldFieldConfig {
  return { key, label, action, targetKind, userInstruction };
}

function defaultWorldContextControl(fieldKey: WorldFieldKey): PromptContextControl {
  const sources = worldPromptContextSources(fieldKey);
  return {
    includedContextKeys: sources.map((source) => source.key),
    authorPriorityComment: "",
    contextSources: sources
  };
}

function worldOutputKind(fieldKey: WorldFieldKey): WorldPromptPackage["outputContract"]["kind"] {
  if (fieldKey === "worldElement") {
    return "world_element";
  }
  if (fieldKey === "worldRule") {
    return "world_rule";
  }
  if (fieldKey === "worldRuleAnalysis") {
    return "world_rule_analysis";
  }
  return "world_field_suggestion";
}

function compactBook(book: Book): WorldPromptPackage["context"]["book"] {
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
  book: WorldPromptPackage["context"]["book"],
  contextControl?: PromptContextControl
): string {
  if (!isIncluded("bookCore", contextControl)) {
    return "(pominieto przez autora)";
  }

  const lines = [
    optionalLine("Tytuł roboczy", book.workingTitle),
    optionalLine("Premisa", book.premise),
    optionalLine("Rozszerzona premisa", book.expandedPremise),
    optionalLine("Świat/setting", book.settingSketch),
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

function renderWorkspaceContext(promptPackage: WorldPromptPackage): string {
  const { plan, characters, world, contextControl } = promptPackage.context;
  return [
    isIncluded("bookPlan", contextControl) && (plan.chapters.length || plan.threads.length)
      ? `Plan: ${JSON.stringify({
          chapters: plan.chapters.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.workingTitle, summary: chapter.summary })),
          threads: plan.threads.map((thread) => ({ id: thread.id, name: thread.name, description: thread.description, status: thread.status }))
        })}`
      : "",
    isIncluded("characters", contextControl)
      ? workspaceLine("Postacie", characters.characters.map((character) => ({ id: character.id, name: character.name, role: character.role, description: character.shortDescription })))
      : "",
    isIncluded("worldElements", contextControl)
      ? workspaceLine("Elementy świata", world.elements.map(compactElement))
      : "",
    isIncluded("worldRules", contextControl)
      ? workspaceLine("Reguły świata", world.rules.map(compactRule))
      : "",
    isIncluded("targetEntity", contextControl)
      ? workspaceLine("Docelowy element", promptPackage.context.targetEntitySnapshot ?? null)
      : "",
    promptPackage.context.sourceSceneDiscovery
      ? `Źródło odkrycia ze sceny: ${JSON.stringify(promptPackage.context.sourceSceneDiscovery)}`
      : "",
    renderManualFieldContext(promptPackage)
  ].filter(Boolean).join("\n") || "(brak wybranego kontekstu świata)";
}

// Pustych sekcji nie serializujemy — "Postacie: []" to szum w prompcie.
function workspaceLine(label: string, value: unknown): string {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return "";
  }
  return `${label}: ${JSON.stringify(value)}`;
}

function renderManualFieldContext(promptPackage: WorldPromptPackage): string {
  const contextControl = promptPackage.context.contextControl;
  if (!contextControl) {
    return "";
  }

  const selected = contextControl.contextSources.filter(
    (source) => source.key.startsWith("world-field:") && isIncluded(source.key, contextControl)
  );
  return selected.length ? `Dodatkowe pola dodane przez autora: ${JSON.stringify(selected)}` : "";
}

function currentWorldFieldValue(fieldKey: WorldFieldKey, entity?: WorldPromptEntity): string {
  if (!entity || fieldKey === "worldElement" || fieldKey === "worldRule" || fieldKey === "worldRuleAnalysis") {
    return "";
  }

  const record = entity as Record<string, unknown>;
  const map: Partial<Record<WorldFieldKey, string>> = {
    elementType: String(record.elementType ?? ""),
    elementName: String(record.name ?? ""),
    elementSummary: String(record.summary ?? ""),
    elementDetails: String(record.details ?? ""),
    elementStoryPurpose: String(record.storyPurpose ?? ""),
    elementConstraints: String(record.constraints ?? ""),
    elementVisualPrompt: String(record.visualPrompt ?? ""),
    ruleName: String(record.name ?? ""),
    ruleDescription: String(record.description ?? ""),
    ruleScope: String(record.scope ?? ""),
    ruleCost: String(record.cost ?? ""),
    ruleLimitation: String(record.limitation ?? ""),
    ruleExceptions: String(record.exceptions ?? ""),
    ruleViolationConsequences: String(record.violationConsequences ?? ""),
    ruleSceneExamples: String(record.sceneExamples ?? "")
  };
  return map[fieldKey] ?? "";
}

function worldSuggestionSchema(fieldKey: WorldFieldKey): unknown {
  if (fieldKey === "worldElement") {
    return {
      version: 1,
      kind: "world_element",
      type: "location",
      name: "string",
      summary: "string",
      details: "string",
      storyPurpose: "string",
      constraints: "string",
      visualPrompt: "string",
      warnings: ["string"]
    };
  }

  if (fieldKey === "worldRule") {
    return {
      version: 1,
      kind: "world_rule",
      name: "string",
      description: "string",
      scope: "string",
      cost: "string",
      limitation: "string",
      exceptions: "string",
      violationConsequences: "string",
      sceneExamples: "string",
      warnings: ["string"]
    };
  }

  if (fieldKey === "worldRuleAnalysis") {
    return {
      version: 1,
      kind: "world_rule_analysis",
      ruleName: "string",
      consequences: ["string"],
      possibleContradictions: ["string"],
      storyOpportunities: ["string"],
      questionsForAuthor: ["string"],
      warnings: ["string"]
    };
  }

  return {
    version: 1,
    kind: "world_field_suggestion",
    field: fieldKey,
    summary: "string",
    value: "string",
    warnings: ["string"]
  };
}

function worldEntityLabel(entity: WorldPromptEntity): string {
  return entity.name || "Element świata";
}

function compactElement(element: WorldElement) {
  return {
    id: element.id,
    type: element.elementType,
    name: element.name,
    summary: element.summary,
    storyPurpose: element.storyPurpose,
    constraints: element.constraints
  };
}

function compactRule(rule: WorldRule) {
  return {
    id: rule.id,
    name: rule.name,
    scope: rule.scope,
    description: rule.description,
    limitation: rule.limitation,
    violationConsequences: rule.violationConsequences
  };
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

function emptyFallback(value: string | undefined | null): string {
  return value?.trim() ? value : "(brak)";
}

function createPromptId(action: AIAction): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }
  return `${action}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
