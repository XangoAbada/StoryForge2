import {
  BookOpen,
  Boxes,
  FileText,
  GitBranch,
  Globe2,
  Loader2,
  Minus,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteWorldElement,
  deleteWorldRule,
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  setWorldElementRelations,
  setWorldRuleRelations,
  upsertWorldElement,
  upsertWorldRule
} from "../../shared/api/commands";
import type {
  BookPlan,
  CharacterWorkspace,
  SetWorldElementRelationsInput,
  SetWorldRuleRelationsInput,
  UpsertWorldElementInput,
  UpsertWorldRuleInput,
  WorldElement,
  WorldRule,
  WorldWorkspace
} from "../../shared/api/types";
import {
  buildWorldPromptPackage,
  renderWorldPromptPackage,
  worldEntityId,
  worldFieldConfigs,
  WorldFieldKey,
  worldPromptContextSource,
  WorldPromptEntity
} from "../ai/worldPromptPackage";
import {
  createWorldPromptContextTarget,
  promptContextControlForActiveTarget,
  useAiPromptContextStore,
  worldPromptContextTargetId
} from "../ai/aiPromptContextStore";
import {
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";
import {
  registerWorldDraftFieldTarget,
  unregisterWorldDraftFieldTarget
} from "../ai/worldDraftFieldTargets";

type WorldPageProps = {
  projectId: string;
};

type WorldTab = "profile" | "rules" | "links" | "visuals";
type WorldSidebarItem =
  | {
      kind: "element";
      id: string;
      label: string;
      meta: string;
      description: string;
      elementType: string;
    }
  | {
      kind: "rule";
      id: string;
      label: string;
      meta: string;
      description: string;
    };
type RelationPickerState =
  | { target: "element"; kind: "characters" | "threads" | "chapters" | "scenes" | "rules" }
  | { target: "rule"; kind: "elements" | "threads" | "chapters" | "scenes" };

const newWorldElementDraftId = "new-world-element";
const newWorldRuleDraftId = "new-world-rule";

const worldElementTypes = [
  { value: "location", label: "Lokacja" },
  { value: "faction", label: "Frakcja" },
  { value: "object", label: "Przedmiot" },
  { value: "culture", label: "Kultura" },
  { value: "technology", label: "Technologia" },
  { value: "magic", label: "Magia" },
  { value: "creature", label: "Istota" },
  { value: "historical_event", label: "Wydarzenie historyczne" },
  { value: "institution", label: "Instytucja" },
  { value: "custom", label: "Zwyczaj" },
  { value: "other", label: "Inne" }
];

const worldTabs: Array<{ key: WorldTab; label: string; icon: typeof Globe2 }> = [
  { key: "profile", label: "Profil", icon: Globe2 },
  { key: "rules", label: "Reguły", icon: BookOpen },
  { key: "links", label: "Połączenia", icon: GitBranch },
  { key: "visuals", label: "Wizualia", icon: Boxes }
];

type ElementFieldItem = {
  field: WorldFieldKey;
  key: keyof UpsertWorldElementInput;
  rows?: number;
};

const elementFields: ElementFieldItem[] = [
  { field: "elementName", key: "name", rows: 1 },
  { field: "elementSummary", key: "summary", rows: 3 },
  { field: "elementDetails", key: "details", rows: 5 },
  { field: "elementStoryPurpose", key: "storyPurpose", rows: 3 },
  { field: "elementConstraints", key: "constraints", rows: 3 }
];

type RuleFieldItem = {
  field: WorldFieldKey;
  key: keyof UpsertWorldRuleInput;
  rows?: number;
};

const ruleFields: RuleFieldItem[] = [
  { field: "ruleName", key: "name", rows: 1 },
  { field: "ruleDescription", key: "description", rows: 4 },
  { field: "ruleScope", key: "scope", rows: 2 },
  { field: "ruleCost", key: "cost", rows: 2 },
  { field: "ruleLimitation", key: "limitation", rows: 2 },
  { field: "ruleExceptions", key: "exceptions", rows: 2 },
  { field: "ruleViolationConsequences", key: "violationConsequences", rows: 3 },
  { field: "ruleSceneExamples", key: "sceneExamples", rows: 3 }
];

export function WorldPage({ projectId }: WorldPageProps) {
  const queryClient = useQueryClient();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore((state) => state.activateTarget);
  const closePromptContextTarget = useAiPromptContextStore((state) => state.closeTarget);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [linkFocus, setLinkFocus] = useState<"element" | "rule">("element");
  const [activeTab, setActiveTab] = useState<WorldTab>("profile");
  const [elementDraft, setElementDraft] = useState<UpsertWorldElementInput>(() => emptyElementInput(projectId, 0));
  const [ruleDraft, setRuleDraft] = useState<UpsertWorldRuleInput>(() => emptyRuleInput(projectId, 0));
  const [picker, setPicker] = useState<RelationPickerState | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const bookId = projectQuery.data?.book.id;
  const planQuery = useQuery({
    queryKey: ["book-plan", bookId],
    queryFn: () => getBookPlan(bookId ?? ""),
    enabled: Boolean(bookId),
    retry: 0
  });
  const characterQuery = useQuery({
    queryKey: ["character-workspace", projectId],
    queryFn: () => getCharacterWorkspace(projectId),
    retry: 0
  });
  const worldQuery = useQuery({
    queryKey: ["world-workspace", projectId],
    queryFn: () => getWorldWorkspace(projectId),
    retry: 0
  });

  const project = projectQuery.data?.project;
  const book = projectQuery.data?.book;
  const plan = planQuery.data ?? emptyPlan();
  const characters = characterQuery.data ?? emptyCharacterWorkspace();
  const world = worldQuery.data ?? emptyWorldWorkspace();
  const selectedElement = world.elements.find((item) => item.id === selectedElementId) ?? null;
  const selectedRule = world.rules.find((item) => item.id === selectedRuleId) ?? null;

  useEffect(() => {
    if (!selectedElementId && world.elements[0]) {
      setSelectedElementId(world.elements[0].id);
    }
  }, [selectedElementId, world.elements]);

  useEffect(() => {
    if (!selectedRuleId && world.rules[0]) {
      setSelectedRuleId(world.rules[0].id);
    }
  }, [selectedRuleId, world.rules]);

  useEffect(() => {
    setElementDraft(selectedElement ? elementToInput(selectedElement) : emptyElementInput(projectId, world.elements.length));
  }, [projectId, selectedElement?.id, world.elements.length]);

  useEffect(() => {
    setRuleDraft(selectedRule ? ruleToInput(selectedRule) : emptyRuleInput(projectId, world.rules.length));
  }, [projectId, selectedRule?.id, world.rules.length]);

  useEffect(() => {
    const targetId = selectedElement?.id ?? newWorldElementDraftId;
    registerWorldDraftFieldTarget(targetId, (field, value) => {
      setElementDraft((current) => applyWorldElementValue(current, field, value));
      return true;
    });
    return () => unregisterWorldDraftFieldTarget(targetId);
  }, [selectedElement?.id]);

  useEffect(() => {
    const targetId = selectedRule?.id ?? newWorldRuleDraftId;
    registerWorldDraftFieldTarget(targetId, (field, value) => {
      setRuleDraft((current) => applyWorldRuleValue(current, field, value));
      return true;
    });
    return () => unregisterWorldDraftFieldTarget(targetId);
  }, [selectedRule?.id]);

  useEffect(() => {
    setTypeFilter("all");
  }, [activeTab]);

  const sidebarItems = useMemo<WorldSidebarItem[]>(() => {
    const query = search.trim().toLocaleLowerCase("pl-PL");
    const elementItems: WorldSidebarItem[] = world.elements.map((element) => ({
      kind: "element",
      id: element.id,
      label: element.name || "Bez nazwy",
      meta: typeLabel(element.elementType),
      description: element.summary || "Brak opisu.",
      elementType: element.elementType
    }));
    const ruleItems: WorldSidebarItem[] = world.rules.map((rule) => ({
      kind: "rule",
      id: rule.id,
      label: rule.name || "Bez nazwy",
      meta: "Reguła",
      description: rule.description || "Brak opisu reguły."
    }));
    const source =
      activeTab === "rules"
        ? ruleItems
        : activeTab === "links"
          ? [...elementItems, ...ruleItems]
          : elementItems;

    return source.filter((item) => {
      const matchesType =
        activeTab === "links"
          ? typeFilter === "all" || item.kind === typeFilter
          : item.kind === "rule" || typeFilter === "all" || item.elementType === typeFilter;
      const matchesSearch =
        !query ||
        [item.label, item.meta, item.description]
          .join(" ")
          .toLocaleLowerCase("pl-PL")
          .includes(query);
      return matchesType && matchesSearch;
    });
  }, [activeTab, search, typeFilter, world.elements, world.rules]);

  const invalidateWorld = async () => {
    await queryClient.invalidateQueries({ queryKey: ["world-workspace", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const elementMutation = useMutation({
    mutationFn: (input: UpsertWorldElementInput) => upsertWorldElement(input),
    onSuccess: async (element) => {
      setSelectedElementId(element.id);
      setMessage("Zapisano element świata.");
      setErrorMessage("");
      await invalidateWorld();
    },
    onError: showError
  });
  const ruleMutation = useMutation({
    mutationFn: (input: UpsertWorldRuleInput) => upsertWorldRule(input),
    onSuccess: async (rule) => {
      setSelectedRuleId(rule.id);
      setMessage("Zapisano regułę świata.");
      setErrorMessage("");
      await invalidateWorld();
    },
    onError: showError
  });
  const deleteElementMutation = useMutation({
    mutationFn: (id: string) => deleteWorldElement(id),
    onSuccess: async () => {
      setSelectedElementId(null);
      setMessage("Usunięto element świata.");
      await invalidateWorld();
    },
    onError: showError
  });
  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => deleteWorldRule(id),
    onSuccess: async () => {
      setSelectedRuleId(null);
      setMessage("Usunięto regułę świata.");
      await invalidateWorld();
    },
    onError: showError
  });
  const elementRelationsMutation = useMutation({
    mutationFn: (input: SetWorldElementRelationsInput) => setWorldElementRelations(input),
    onSuccess: invalidateWorld,
    onError: showError
  });
  const ruleRelationsMutation = useMutation({
    mutationFn: (input: SetWorldRuleRelationsInput) => setWorldRuleRelations(input),
    onSuccess: invalidateWorld,
    onError: showError
  });

  function showError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  function saveElement(event: FormEvent) {
    event.preventDefault();
    elementMutation.mutate({
      ...elementDraft,
      projectId,
      elementType: elementDraft.elementType || "location"
    });
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    ruleMutation.mutate({ ...ruleDraft, projectId });
  }

  function startNewElement() {
    setSelectedElementId(newWorldElementDraftId);
    setLinkFocus("element");
    setActiveTab("profile");
    setElementDraft(emptyElementInput(projectId, world.elements.length));
    setMessage("");
    setErrorMessage("");
  }

  function startNewRule() {
    setSelectedRuleId(newWorldRuleDraftId);
    setLinkFocus("rule");
    setActiveTab("rules");
    setRuleDraft(emptyRuleInput(projectId, world.rules.length));
    setMessage("");
    setErrorMessage("");
  }

  function openDefaultRelationPicker() {
    if (linkFocus === "rule" && selectedRule) {
      setPicker({ target: "rule", kind: "elements" });
      return;
    }

    if (selectedElement) {
      setPicker({ target: "element", kind: "rules" });
      return;
    }

    if (selectedRule) {
      setPicker({ target: "rule", kind: "elements" });
      return;
    }

    setErrorMessage("Wybierz element albo regułę, aby dodać połączenie.");
  }

  function runHeaderCreateAction() {
    if (activeTab === "rules") {
      startNewRule();
      return;
    }

    if (activeTab === "links") {
      openDefaultRelationPicker();
      return;
    }

    startNewElement();
  }

  function headerCreateLabel(): string {
    if (activeTab === "rules") {
      return "Nowa reguła";
    }

    if (activeTab === "links") {
      return "Nowe połączenie";
    }

    return "Nowy element";
  }

  function editorHeaderIcon() {
    if (activeTab === "rules" || (activeTab === "links" && linkFocus === "rule")) {
      return <BookOpen size={32} />;
    }

    return <Globe2 size={32} />;
  }

  function editorHeaderEyebrow(): string {
    if (activeTab === "rules") {
      return "Reguła świata";
    }

    if (activeTab === "links") {
      return linkFocus === "rule" ? "Połączenia reguły" : "Połączenia elementu";
    }

    return selectedElement ? "Element świata" : "Nowy element";
  }

  function editorHeaderTitle(): string {
    if (activeTab === "rules" || (activeTab === "links" && linkFocus === "rule")) {
      return ruleDraft.name || "Bez nazwy";
    }

    return elementDraft.name || "Bez nazwy";
  }

  function editorHeaderDescription(): string {
    if (activeTab === "rules") {
      return ruleDraft.description || "Określ zasadę, koszt i konsekwencje naruszenia.";
    }

    if (activeTab === "links") {
      if (linkFocus === "rule") {
        return ruleDraft.description || "Łącz regułę z elementami, wątkami oraz rozdziałami.";
      }

      return elementDraft.summary || "Łącz element z regułami, postaciami, wątkami oraz rozdziałami.";
    }

    return elementDraft.summary || "Określ miejsce elementu w logice świata i fabule.";
  }

  function queueWorldGeneration(field: WorldFieldKey, targetEntity?: WorldPromptEntity) {
    setErrorMessage("");
    if (!project || !book) {
      setErrorMessage("Brak danych projektu.");
      return;
    }

    const effectiveTarget =
      targetEntity ??
      (isRuleField(field)
        ? ruleDraftPreview(ruleDraft)
        : elementDraftPreview(elementDraft));
    const targetId = worldPromptContextTargetId(projectId, field, worldEntityId(effectiveTarget));
    const contextControl = promptContextControlForActiveTarget(targetId);
    const usedPromptContext = Boolean(contextControl);
    const promptPackage = buildWorldPromptPackage(
      project,
      book,
      plan,
      characters,
      world,
      field,
      effectiveTarget,
      contextControl
    );
    const prompt = renderWorldPromptPackage(promptPackage);

    enqueueProposal({
      scope: "world",
      projectId,
      bookId: book.id,
      field,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt
    });

    if (usedPromptContext) {
      closePromptContextTarget(targetId);
    }
  }

  function activateWorldPromptContext(field: WorldFieldKey, targetEntity?: WorldPromptEntity) {
    const effectiveTarget =
      targetEntity ??
      (isRuleField(field)
        ? ruleDraftPreview(ruleDraft)
        : elementDraftPreview(elementDraft));
    const targetId = worldPromptContextTargetId(projectId, field, worldEntityId(effectiveTarget));
    const loading = pendingProposalStatus(proposals, {
      projectId,
      field,
      scope: "world",
      targetEntityId: worldEntityId(effectiveTarget)
    });

    activatePromptContextTarget(
      createWorldPromptContextTarget(projectId, field, worldEntityId(effectiveTarget), {
        submitLabel: "Wyślij do AI",
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading
          ? `Pole "${worldFieldConfigs[field].label}" jest już w kolejce AI.`
          : undefined,
        onSubmit: () => queueWorldGeneration(field, effectiveTarget)
      })
    );
  }

  function updateElementRelations(next: Partial<Omit<SetWorldElementRelationsInput, "projectId" | "elementId">>) {
    if (!selectedElement) {
      return;
    }

    elementRelationsMutation.mutate({
      projectId,
      elementId: selectedElement.id,
      characterIds: elementCharacterIds(world, selectedElement.id),
      threadIds: elementThreadIds(world, selectedElement.id),
      chapterIds: elementChapterIds(world, selectedElement.id),
      sceneIds: elementSceneIds(world, selectedElement.id),
      ruleIds: elementRuleIds(world, selectedElement.id),
      ...next
    });
  }

  function updateRuleRelations(next: Partial<Omit<SetWorldRuleRelationsInput, "projectId" | "ruleId">>) {
    if (!selectedRule) {
      return;
    }

    ruleRelationsMutation.mutate({
      projectId,
      ruleId: selectedRule.id,
      elementIds: ruleElementIds(world, selectedRule.id),
      threadIds: ruleThreadIds(world, selectedRule.id),
      chapterIds: ruleChapterIds(world, selectedRule.id),
      sceneIds: ruleSceneIds(world, selectedRule.id),
      ...next
    });
  }

  if (projectQuery.isLoading || worldQuery.isLoading || planQuery.isLoading || characterQuery.isLoading) {
    return <p className="muted-text">Ładuję świat...</p>;
  }

  if (projectQuery.isError || worldQuery.isError || !project || !book) {
    return <p className="warning-text">Nie można wczytać kreatora świata.</p>;
  }

  return (
    <section className="world-page">
      <header className="world-header">
        <div>
          <p className="eyebrow">Story Bible</p>
          <h2>Świat</h2>
          <p className="muted-text">Elementy świata, reguły i ich powiązania z postaciami oraz planem.</p>
        </div>
        <div className="world-header-actions">
          <button type="button" className="secondary-button" onClick={() => queueWorldGeneration("worldElement", elementDraftPreview(emptyElementInput(projectId, world.elements.length)))}>
            <Sparkles size={16} />
            AI element
          </button>
          <button type="button" className="secondary-button" onClick={() => queueWorldGeneration("worldRule", ruleDraftPreview(emptyRuleInput(projectId, world.rules.length)))}>
            <Sparkles size={16} />
            AI reguła
          </button>
          <button type="button" className="secondary-button" onClick={openDefaultRelationPicker}>
            <Sparkles size={16} />
            AI połączenie
          </button>
        </div>
      </header>

      <div className="world-layout">
        <aside className="world-list-panel">
          <div className="world-toolbar">
            <label className="world-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj świata" />
            </label>
            {activeTab === "rules" ? null : (
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} title="Filtruj listę świata">
                {activeTab === "links" ? (
                  <>
                    <option value="all">Elementy i reguły</option>
                    <option value="element">Tylko elementy</option>
                    <option value="rule">Tylko reguły</option>
                  </>
                ) : (
                  <>
                    <option value="all">Wszystkie typy</option>
                    {worldElementTypes.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </>
                )}
              </select>
            )}
          </div>
          <div className="world-card-list">
            {sidebarItems.map((item) => (
              <button
                type="button"
                key={`${item.kind}:${item.id}`}
                className={
                  (item.kind === "element" && item.id === selectedElementId && (activeTab !== "links" || linkFocus === "element")) ||
                  (item.kind === "rule" && item.id === selectedRuleId && (activeTab !== "links" || linkFocus === "rule"))
                    ? "world-card active"
                    : "world-card"
                }
                onClick={() => {
                  if (item.kind === "element") {
                    setSelectedElementId(item.id);
                    setLinkFocus("element");
                    if (activeTab === "rules") {
                      setActiveTab("profile");
                    }
                    return;
                  }

                  setSelectedRuleId(item.id);
                  setLinkFocus("rule");
                }}
              >
                <span className="world-card-icon">{item.kind === "rule" ? <BookOpen size={18} /> : <Globe2 size={18} />}</span>
                <span className="world-card-body">
                  <strong>{item.label}</strong>
                  <small>{item.meta}</small>
                  <span>{item.description}</span>
                </span>
              </button>
            ))}
            {sidebarItems.length === 0 ? (
              <p className="world-empty">Brak pozycji pasujacych do filtrow.</p>
            ) : null}
          </div>
        </aside>

        <main className="world-editor-panel">
          <div className="world-editor-heading">
            <div className="world-avatar">{editorHeaderIcon()}</div>
            <div>
              <p className="eyebrow">{editorHeaderEyebrow()}</p>
              <h3>{editorHeaderTitle()}</h3>
              <p className="muted-text">{editorHeaderDescription()}</p>
            </div>
            <div className="button-row">
              {activeTab !== "rules" && selectedElement ? (
                <button type="button" className="ghost-button danger" onClick={() => deleteElementMutation.mutate(selectedElement.id)}>
                  <Trash2 size={15} />
                  Usun
                </button>
              ) : null}
              {activeTab === "rules" && selectedRule ? (
                <button type="button" className="ghost-button danger" onClick={() => deleteRuleMutation.mutate(selectedRule.id)}>
                  <Trash2 size={15} />
                  Usun
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={runHeaderCreateAction}>
                <Plus size={15} />
                {headerCreateLabel()}
              </button>
            </div>
          </div>

          <div className="world-tabs" role="tablist" aria-label="Sekcje świata">
            {worldTabs.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                className={activeTab === key ? "world-tab active" : "world-tab"}
                onClick={() => setActiveTab(key)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "profile" ? (
            <form className="world-editor-form" onSubmit={saveElement}>
              <label className="field-label">Typ elementu
                <select
                  value={elementDraft.elementType}
                  onChange={(event) => setElementDraft({ ...elementDraft, elementType: event.target.value })}
                  onFocus={() => activateWorldPromptContext("elementType", elementDraftPreview(elementDraft))}
                >
                  {worldElementTypes.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="world-field-grid">
                {elementFields.map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(elementDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={elementDraftPreview(elementDraft)}
                    onChange={(value) => setElementDraft({ ...elementDraft, [item.key]: value })}
                    onGenerate={queueWorldGeneration}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </div>
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={elementMutation.isPending}
                saveLabel="Zapisz element"
              />
            </form>
          ) : null}

          {activeTab === "rules" ? (
            <form className="world-rule-editor" onSubmit={saveRule}>
              <div className="world-section-heading">
                <h3><BookOpen size={17} /> {ruleDraft.name || "Nowa reguła"}</h3>
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => queueWorldGeneration("worldRuleAnalysis", ruleDraftPreview(ruleDraft))}>
                    <Sparkles size={15} />
                    Analizuj
                  </button>
                </div>
              </div>
              <div className="world-field-grid">
                {ruleFields.map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(ruleDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={ruleDraftPreview(ruleDraft)}
                    onChange={(value) => setRuleDraft({ ...ruleDraft, [item.key]: value })}
                    onGenerate={queueWorldGeneration}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </div>
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={ruleMutation.isPending}
                  saveLabel="Zapisz regułę"
              />
            </form>
          ) : null}

          {activeTab === "links" ? (
            <WorldLinksPanel
              world={world}
              plan={plan}
              characters={characters}
              selectedElement={linkFocus === "element" ? selectedElement : null}
              selectedRule={linkFocus === "rule" ? selectedRule : null}
              onOpenPicker={setPicker}
              onUpdateElement={updateElementRelations}
              onUpdateRule={updateRuleRelations}
            />
          ) : null}

          {activeTab === "visuals" ? (
            <form className="world-editor-form" onSubmit={saveElement}>
              <WorldAiField
                field="elementVisualPrompt"
                value={elementDraft.visualPrompt}
                rows={7}
                target={elementDraftPreview(elementDraft)}
                onChange={(value) => setElementDraft({ ...elementDraft, visualPrompt: value })}
                onGenerate={queueWorldGeneration}
                onActivate={activateWorldPromptContext}
              />
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={elementMutation.isPending}
                saveLabel="Zapisz prompt"
              />
            </form>
          ) : null}
        </main>
      </div>

      {picker ? (
        <RelationPicker
          state={picker}
          world={world}
          plan={plan}
          characters={characters}
          selectedElement={selectedElement}
          selectedRule={selectedRule}
          onClose={() => setPicker(null)}
          onUpdateElement={(next) => {
            updateElementRelations(next);
            setPicker(null);
          }}
          onUpdateRule={(next) => {
            updateRuleRelations(next);
            setPicker(null);
          }}
        />
      ) : null}
    </section>
  );
}

function WorldAiField({ field, value, rows = 3, target, onChange, onGenerate, onActivate }: {
  field: WorldFieldKey;
  value: string;
  rows?: number;
  target: WorldPromptEntity;
  onChange: (value: string) => void;
  onGenerate: (field: WorldFieldKey, target?: WorldPromptEntity) => void;
  onActivate: (field: WorldFieldKey, target?: WorldPromptEntity) => void;
}) {
  return (
    <div className="field-shell world-field wide" onFocusCapture={(event) => isEditablePromptTarget(event.target) && onActivate(field, target)} onClick={(event) => isEditablePromptTarget(event.target) && onActivate(field, target)}>
      <div className="field-heading">
        <span className="field-label-text">{worldFieldConfigs[field].label}</span>
        <div className="field-ai-actions">
          <button type="button" className="icon-button" onClick={() => onGenerate(field, target)} title="Wygeneruj to pole z AI" aria-label={`Wygeneruj pole ${worldFieldConfigs[field].label}`}>
            <Sparkles size={15} />
          </button>
          <button type="button" className="icon-button" onClick={() => useAiPromptContextStore.getState().addContextSourceToActiveTarget(worldPromptContextSource(field, target))} title="Dodaj pole do kontekstu AI" aria-label={`Dodaj pole ${worldFieldConfigs[field].label} do kontekstu AI`}>
            <Plus size={15} />
          </button>
        </div>
      </div>
      {rows === 1 ? <input value={value} onChange={(event) => onChange(event.target.value)} /> : <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} />}
    </div>
  );
}

function WorldLinksPanel({ world, plan, characters, selectedElement, selectedRule, onOpenPicker, onUpdateElement, onUpdateRule }: {
  world: WorldWorkspace;
  plan: BookPlan;
  characters: CharacterWorkspace;
  selectedElement: WorldElement | null;
  selectedRule: WorldRule | null;
  onOpenPicker: (state: RelationPickerState) => void;
  onUpdateElement: (next: Partial<Omit<SetWorldElementRelationsInput, "projectId" | "elementId">>) => void;
  onUpdateRule: (next: Partial<Omit<SetWorldRuleRelationsInput, "projectId" | "ruleId">>) => void;
}) {
  if (!selectedElement && !selectedRule) {
    return <PanelEmpty icon={<GitBranch size={28} />} text="Wybierz element albo regułę, aby łączyć je z kanonem." />;
  }

  return (
    <div className="world-links-grid">
      {selectedElement ? (
        <>
          <RelationBlock title="Postacie" icon={<Users size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "characters" })}>
            {elementCharacterIds(world, selectedElement.id).map((id) => (
              <RelationChip key={id} label={characters.characters.find((item) => item.id === id)?.name ?? "Postac"} onRemove={() => onUpdateElement({ characterIds: elementCharacterIds(world, selectedElement.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
          <RelationBlock title="Wątki" icon={<GitBranch size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "threads" })}>
            {elementThreadIds(world, selectedElement.id).map((id) => (
              <RelationChip key={id} label={plan.threads.find((item) => item.id === id)?.name ?? "Wątek"} onRemove={() => onUpdateElement({ threadIds: elementThreadIds(world, selectedElement.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
          <RelationBlock title="Rozdziały" icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "chapters" })}>
            {elementChapterIds(world, selectedElement.id).map((id) => (
              <RelationChip key={id} label={chapterLabel(plan, id)} onRemove={() => onUpdateElement({ chapterIds: elementChapterIds(world, selectedElement.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
          <RelationBlock title="Reguły elementu" icon={<BookOpen size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "rules" })}>
            {elementRuleIds(world, selectedElement.id).map((id) => (
              <RelationChip key={id} label={world.rules.find((item) => item.id === id)?.name ?? "Reguła"} onRemove={() => onUpdateElement({ ruleIds: elementRuleIds(world, selectedElement.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
        </>
      ) : null}

      {selectedElement ? (
        <RelationBlock title="Sceny" icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "scenes" })}>
          {elementSceneIds(world, selectedElement.id).map((id) => (
            <RelationChip key={id} label={sceneLabel(plan, id)} onRemove={() => onUpdateElement({ sceneIds: elementSceneIds(world, selectedElement.id).filter((item) => item !== id) })} />
          ))}
        </RelationBlock>
      ) : null}

      {selectedRule ? (
        <>
          <RelationBlock title="Elementy reguły" icon={<Globe2 size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "elements" })}>
            {ruleElementIds(world, selectedRule.id).map((id) => (
              <RelationChip key={id} label={world.elements.find((item) => item.id === id)?.name ?? "Element"} onRemove={() => onUpdateRule({ elementIds: ruleElementIds(world, selectedRule.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
          <RelationBlock title="Wątki reguły" icon={<GitBranch size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "threads" })}>
            {ruleThreadIds(world, selectedRule.id).map((id) => (
              <RelationChip key={id} label={plan.threads.find((item) => item.id === id)?.name ?? "Wątek"} onRemove={() => onUpdateRule({ threadIds: ruleThreadIds(world, selectedRule.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
          <RelationBlock title="Rozdziały reguły" icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "chapters" })}>
            {ruleChapterIds(world, selectedRule.id).map((id) => (
              <RelationChip key={id} label={chapterLabel(plan, id)} onRemove={() => onUpdateRule({ chapterIds: ruleChapterIds(world, selectedRule.id).filter((item) => item !== id) })} />
            ))}
          </RelationBlock>
        </>
      ) : null}

      {selectedRule ? (
        <RelationBlock title="Sceny reguły" icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "scenes" })}>
          {ruleSceneIds(world, selectedRule.id).map((id) => (
            <RelationChip key={id} label={sceneLabel(plan, id)} onRemove={() => onUpdateRule({ sceneIds: ruleSceneIds(world, selectedRule.id).filter((item) => item !== id) })} />
          ))}
        </RelationBlock>
      ) : null}
    </div>
  );
}

function RelationBlock({ title, icon, children, onAdd }: { title: string; icon: ReactNode; children: ReactNode; onAdd: () => void }) {
  return (
    <section className="world-link-block">
      <header>
        <h3>{icon}{title}</h3>
        <button type="button" className="world-relation-add-button" onClick={onAdd} title={`Dodaj relację: ${title}`} aria-label={`Dodaj relację: ${title}`}>
          <Plus size={15} />
        </button>
      </header>
      <div className="world-chip-row">{children}</div>
    </section>
  );
}

function RelationChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="world-relation-chip">
      {label}
      <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(); }} title={`Odłącz relację: ${label}`} aria-label={`Odłącz relację: ${label}`}>
        <Minus size={12} />
      </button>
    </span>
  );
}

function RelationPicker({ state, world, plan, characters, selectedElement, selectedRule, onClose, onUpdateElement, onUpdateRule }: {
  state: RelationPickerState;
  world: WorldWorkspace;
  plan: BookPlan;
  characters: CharacterWorkspace;
  selectedElement: WorldElement | null;
  selectedRule: WorldRule | null;
  onClose: () => void;
  onUpdateElement: (next: Partial<Omit<SetWorldElementRelationsInput, "projectId" | "elementId">>) => void;
  onUpdateRule: (next: Partial<Omit<SetWorldRuleRelationsInput, "projectId" | "ruleId">>) => void;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const options = pickerOptions(state, world, plan, characters, selectedElement, selectedRule);
  const content = (
    <div className="world-relation-modal" role="dialog" aria-modal="true" aria-labelledby="world-relation-title">
      <button type="button" className="world-relation-backdrop" onClick={onClose} aria-label="Zamknij modal" />
      <section className="world-relation-shell">
        <header className="world-relation-header">
          <div>
            <p className="eyebrow">Relacje świata</p>
            <h3 id="world-relation-title">{pickerTitle(state)}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Zamknij" aria-label="Zamknij">
            <X size={16} />
          </button>
        </header>
        <div className="world-relation-list">
          {options.map((option) => (
            <button
              type="button"
              key={option.id}
              className={option.selected ? "world-relation-option selected" : "world-relation-option"}
              onClick={() => {
                if (state.target === "element") {
                  if (!selectedElement) return;
                  const ids = toggleId(option.currentIds, option.id);
                  const key = relationInputKey(state.kind);
                  onUpdateElement({ [key]: ids });
                  return;
                }
                if (!selectedRule) return;
                const ids = toggleId(option.currentIds, option.id);
                const key = ruleRelationInputKey(state.kind);
                onUpdateRule({ [key]: ids });
              }}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
          {options.length === 0 ? <p className="world-empty">Brak dostępnych encji.</p> : null}
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function EditorFooter({ message, errorMessage, saving, saveLabel }: { message: string; errorMessage: string; saving: boolean; saveLabel: string }) {
  return (
    <footer className="world-editor-footer">
      <div>
        {message ? <p className="muted-text">{message}</p> : null}
        {errorMessage ? <p className="warning-text">{errorMessage}</p> : null}
      </div>
      <button type="submit" className="primary-button" disabled={saving}>
        {saving ? <Loader2 size={15} className="spin-icon" /> : <Save size={15} />}
        {saveLabel}
      </button>
    </footer>
  );
}

function PanelEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="world-panel-empty">{icon}<p>{text}</p></div>;
}

function emptyElementInput(projectId: string, orderIndex: number): UpsertWorldElementInput {
  return {
    projectId,
    elementType: "location",
    name: "",
    summary: "",
    details: "",
    storyPurpose: "",
    constraints: "",
    visualPrompt: "",
    imageAssetId: null,
    status: "draft",
    orderIndex
  };
}

function emptyRuleInput(projectId: string, orderIndex: number): UpsertWorldRuleInput {
  return {
    projectId,
    name: "",
    description: "",
    scope: "",
    cost: "",
    limitation: "",
    exceptions: "",
    violationConsequences: "",
    sceneExamples: "",
    status: "draft",
    orderIndex
  };
}

function elementToInput(element: WorldElement): UpsertWorldElementInput {
  return { ...element };
}

function ruleToInput(rule: WorldRule): UpsertWorldRuleInput {
  return { ...rule };
}

function elementDraftPreview(input: UpsertWorldElementInput): WorldElement {
  const now = new Date().toISOString();
  return { id: input.id ?? newWorldElementDraftId, createdAt: now, updatedAt: now, imageAssetId: input.imageAssetId ?? null, ...input };
}

function ruleDraftPreview(input: UpsertWorldRuleInput): WorldRule {
  const now = new Date().toISOString();
  return { id: input.id ?? newWorldRuleDraftId, createdAt: now, updatedAt: now, ...input };
}

function applyWorldElementValue(input: UpsertWorldElementInput, field: WorldFieldKey, value: string): UpsertWorldElementInput {
  if (field === "worldElement") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return {
        ...input,
        elementType: stringValue(parsed.type, input.elementType),
        name: stringValue(parsed.name, input.name),
        summary: stringValue(parsed.summary, input.summary),
        details: stringValue(parsed.details, input.details),
        storyPurpose: stringValue(parsed.storyPurpose, input.storyPurpose),
        constraints: stringValue(parsed.constraints, input.constraints),
        visualPrompt: stringValue(parsed.visualPrompt, input.visualPrompt)
      };
    } catch {
      return { ...input, summary: value };
    }
  }

  const map: Partial<Record<WorldFieldKey, keyof UpsertWorldElementInput>> = {
    elementType: "elementType",
    elementName: "name",
    elementSummary: "summary",
    elementDetails: "details",
    elementStoryPurpose: "storyPurpose",
    elementConstraints: "constraints",
    elementVisualPrompt: "visualPrompt"
  };
  const key = map[field];
  return key ? { ...input, [key]: value } : input;
}

function applyWorldRuleValue(input: UpsertWorldRuleInput, field: WorldFieldKey, value: string): UpsertWorldRuleInput {
  if (field === "worldRule") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return {
        ...input,
        name: stringValue(parsed.name, input.name),
        description: stringValue(parsed.description, input.description),
        scope: stringValue(parsed.scope, input.scope),
        cost: stringValue(parsed.cost, input.cost),
        limitation: stringValue(parsed.limitation, input.limitation),
        exceptions: stringValue(parsed.exceptions, input.exceptions),
        violationConsequences: stringValue(parsed.violationConsequences, input.violationConsequences),
        sceneExamples: stringValue(parsed.sceneExamples, input.sceneExamples)
      };
    } catch {
      return { ...input, description: value };
    }
  }

  const map: Partial<Record<WorldFieldKey, keyof UpsertWorldRuleInput>> = {
    ruleName: "name",
    ruleDescription: "description",
    ruleScope: "scope",
    ruleCost: "cost",
    ruleLimitation: "limitation",
    ruleExceptions: "exceptions",
    ruleViolationConsequences: "violationConsequences",
    ruleSceneExamples: "sceneExamples"
  };
  const key = map[field];
  return key ? { ...input, [key]: value } : input;
}

function emptyPlan(): BookPlan {
  const now = new Date().toISOString();
  const planVersion = {
    id: "",
    bookId: "",
    name: "Plan główny",
    description: "",
    isActive: true,
    createdAt: now,
    updatedAt: now
  };
  return {
    planVersion,
    planVersions: [planVersion],
    structure: null,
    acts: [],
    beats: [],
    threads: [],
    chapters: [],
    chapterThreads: [],
    chapterBeats: [],
    scenes: [],
    sceneCharacters: [],
    sceneThreads: [],
    sceneWorldElements: [],
    sceneWorldRules: []
  };
}

function emptyCharacterWorkspace(): CharacterWorkspace {
  return { characters: [], relations: [], memories: [], memoryLinks: [], visualAssets: [] };
}

function emptyWorldWorkspace(): WorldWorkspace {
  return { elements: [], rules: [], elementCharacters: [], elementThreads: [], elementChapters: [], elementScenes: [], elementRules: [], ruleThreads: [], ruleChapters: [], ruleScenes: [], visualAssets: [] };
}

function elementCharacterIds(world: WorldWorkspace, elementId: string): string[] {
  return world.elementCharacters.filter((item) => item.elementId === elementId).map((item) => item.characterId);
}

function elementThreadIds(world: WorldWorkspace, elementId: string): string[] {
  return world.elementThreads.filter((item) => item.elementId === elementId).map((item) => item.threadId);
}

function elementChapterIds(world: WorldWorkspace, elementId: string): string[] {
  return world.elementChapters.filter((item) => item.elementId === elementId).map((item) => item.chapterId);
}

function elementSceneIds(world: WorldWorkspace, elementId: string): string[] {
  return world.elementScenes.filter((item) => item.elementId === elementId).map((item) => item.sceneId);
}

function elementRuleIds(world: WorldWorkspace, elementId: string): string[] {
  return world.elementRules.filter((item) => item.elementId === elementId).map((item) => item.ruleId);
}

function ruleElementIds(world: WorldWorkspace, ruleId: string): string[] {
  return world.elementRules.filter((item) => item.ruleId === ruleId).map((item) => item.elementId);
}

function ruleThreadIds(world: WorldWorkspace, ruleId: string): string[] {
  return world.ruleThreads.filter((item) => item.ruleId === ruleId).map((item) => item.threadId);
}

function ruleChapterIds(world: WorldWorkspace, ruleId: string): string[] {
  return world.ruleChapters.filter((item) => item.ruleId === ruleId).map((item) => item.chapterId);
}

function ruleSceneIds(world: WorldWorkspace, ruleId: string): string[] {
  return world.ruleScenes.filter((item) => item.ruleId === ruleId).map((item) => item.sceneId);
}

function pickerOptions(state: RelationPickerState, world: WorldWorkspace, plan: BookPlan, characters: CharacterWorkspace, selectedElement: WorldElement | null, selectedRule: WorldRule | null) {
  const currentIds =
    state.target === "element" && selectedElement
      ? state.kind === "characters"
        ? elementCharacterIds(world, selectedElement.id)
        : state.kind === "threads"
          ? elementThreadIds(world, selectedElement.id)
          : state.kind === "chapters"
            ? elementChapterIds(world, selectedElement.id)
            : state.kind === "scenes"
              ? elementSceneIds(world, selectedElement.id)
              : elementRuleIds(world, selectedElement.id)
      : state.target === "rule" && selectedRule
        ? state.kind === "elements"
          ? ruleElementIds(world, selectedRule.id)
          : state.kind === "threads"
            ? ruleThreadIds(world, selectedRule.id)
            : state.kind === "chapters"
              ? ruleChapterIds(world, selectedRule.id)
              : ruleSceneIds(world, selectedRule.id)
        : [];

  const source =
    state.kind === "characters"
      ? characters.characters.map((item) => ({ id: item.id, label: item.name, description: item.role || item.shortDescription }))
      : state.kind === "threads"
        ? plan.threads.map((item) => ({ id: item.id, label: item.name, description: item.description }))
        : state.kind === "chapters"
          ? plan.chapters.map((item) => ({ id: item.id, label: chapterLabel(plan, item.id), description: item.summary }))
          : state.kind === "scenes"
            ? plan.scenes.map((item) => ({ id: item.id, label: sceneLabel(plan, item.id), description: item.summary }))
          : state.kind === "rules"
            ? world.rules.map((item) => ({ id: item.id, label: item.name, description: item.description }))
            : world.elements.map((item) => ({ id: item.id, label: item.name, description: item.summary }));

  return source.map((option) => ({
    ...option,
    currentIds,
    selected: currentIds.includes(option.id)
  }));
}

function pickerTitle(state: RelationPickerState): string {
  const labels: Record<string, string> = {
    characters: "Powiąż postacie",
    threads: "Powiąż wątki",
    chapters: "Powiąż rozdziały",
    rules: "Powiąż reguły",
    elements: "Powiąż elementy świata"
  };
  return labels[state.kind] ?? "Powiąż encje";
}

function relationInputKey(kind: Extract<RelationPickerState, { target: "element" }>["kind"]) {
  return kind === "characters" ? "characterIds" : kind === "threads" ? "threadIds" : kind === "chapters" ? "chapterIds" : kind === "scenes" ? "sceneIds" : "ruleIds";
}

function ruleRelationInputKey(kind: Extract<RelationPickerState, { target: "rule" }>["kind"]) {
  return kind === "elements" ? "elementIds" : kind === "threads" ? "threadIds" : kind === "chapters" ? "chapterIds" : "sceneIds";
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function chapterLabel(plan: BookPlan, chapterId: string): string {
  const chapter = plan.chapters.find((item) => item.id === chapterId);
  return chapter ? `Rozdział ${chapter.number}: ${chapter.workingTitle || "Bez tytułu"}` : "Rozdział";
}

function typeLabel(value: string): string {
  return worldElementTypes.find((option) => option.value === value)?.label ?? value;
}

function sceneLabel(plan: BookPlan, sceneId: string): string {
  const scene = plan.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return "Scena";
  }
  const chapter = scene.chapterId ? plan.chapters.find((item) => item.id === scene.chapterId) : null;
  const chapterPrefix = chapter ? `R${chapter.number}` : "Bez rozdziału";
  return `${chapterPrefix}.${scene.orderIndex + 1} ${scene.title || "Scena bez tytułu"}`;
}

function isRuleField(field: WorldFieldKey): boolean {
  return field === "worldRule" || field === "worldRuleAnalysis" || field.startsWith("rule");
}

function isEditablePromptTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
