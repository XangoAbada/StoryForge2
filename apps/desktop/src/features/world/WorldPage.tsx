import {
  BookOpen,
  Boxes,
  FileText,
  GitBranch,
  Globe2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Collapsible, EmptyState, Field, Modal, Segmented, Tabs, TwoPane } from "../../shared/ui";
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
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
import { useBrainstormField } from "../ai/useBrainstormField";
import {
  registerWorldDraftFieldTarget,
  unregisterWorldDraftFieldTarget
} from "../ai/worldDraftFieldTargets";

type WorldPageProps = {
  projectId: string;
};

type WorldMode = "elements" | "rules";
type WorldTab = "profile" | "links" | "visuals";
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

const worldElementTypeValues = [
  "location",
  "faction",
  "object",
  "culture",
  "technology",
  "magic",
  "creature",
  "historical_event",
  "institution",
  "custom",
  "other"
];

const elementTabs: Array<{ key: WorldTab; icon: typeof Globe2 }> = [
  { key: "profile", icon: Globe2 },
  { key: "links", icon: GitBranch },
  { key: "visuals", icon: Boxes }
];

const ruleTabs: Array<{ key: WorldTab; icon: typeof Globe2 }> = [
  { key: "profile", icon: BookOpen },
  { key: "links", icon: GitBranch }
];

type ElementFieldItem = {
  field: WorldFieldKey;
  key: keyof UpsertWorldElementInput;
  rows?: number;
  advanced?: boolean;
};

const elementFields: ElementFieldItem[] = [
  { field: "elementName", key: "name", rows: 1 },
  { field: "elementSummary", key: "summary", rows: 3 },
  { field: "elementStoryPurpose", key: "storyPurpose", rows: 3 },
  { field: "elementConstraints", key: "constraints", rows: 3 },
  { field: "elementDetails", key: "details", rows: 5, advanced: true }
];

type RuleFieldItem = {
  field: WorldFieldKey;
  key: keyof UpsertWorldRuleInput;
  rows?: number;
  advanced?: boolean;
};

const ruleFields: RuleFieldItem[] = [
  { field: "ruleName", key: "name", rows: 1 },
  { field: "ruleDescription", key: "description", rows: 4 },
  { field: "ruleScope", key: "scope", rows: 2 },
  { field: "ruleCost", key: "cost", rows: 2 },
  { field: "ruleLimitation", key: "limitation", rows: 2 },
  { field: "ruleExceptions", key: "exceptions", rows: 2 },
  { field: "ruleViolationConsequences", key: "violationConsequences", rows: 3 },
  { field: "ruleSceneExamples", key: "sceneExamples", rows: 3, advanced: true }
];

export function WorldPage({ projectId }: WorldPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore((state) => state.activateTarget);
  const closePromptContextTarget = useAiPromptContextStore((state) => state.closeTarget);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorldMode>("elements");
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

  const searchElementId = useProjectNavigationStore(
    (state) => state.viewState[projectId]?.searchElementId
  );
  const clearProjectViewState = useProjectNavigationStore(
    (state) => state.clearProjectViewState
  );

  useEffect(() => {
    if (!searchElementId) {
      return;
    }
    if (world.elements.some((item) => item.id === searchElementId)) {
      setSelectedElementId(searchElementId);
      clearProjectViewState(projectId, "searchElementId");
    }
  }, [clearProjectViewState, projectId, searchElementId, world.elements]);

  useEffect(() => {
    if (!selectedRuleId && world.rules[0]) {
      setSelectedRuleId(world.rules[0].id);
    }
  }, [selectedRuleId, world.rules]);

  useEffect(() => {
    setElementDraft(selectedElement ? elementToInput(selectedElement) : emptyElementInput(projectId, world.elements.length));
  }, [projectId, selectedElement?.id, selectedElement?.updatedAt, world.elements.length]);

  useEffect(() => {
    setRuleDraft(selectedRule ? ruleToInput(selectedRule) : emptyRuleInput(projectId, world.rules.length));
  }, [projectId, selectedRule?.id, selectedRule?.updatedAt, world.rules.length]);

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
  }, [mode]);

  useEffect(() => {
    if (mode === "rules" && activeTab === "visuals") {
      setActiveTab("profile");
    }
  }, [mode, activeTab]);

  const sidebarItems = useMemo<WorldSidebarItem[]>(() => {
    const query = search.trim().toLocaleLowerCase("pl-PL");
    const elementItems: WorldSidebarItem[] = world.elements.map((element) => ({
      kind: "element",
      id: element.id,
      label: element.name || t("world.list.unnamed"),
      meta: typeLabel(t, element.elementType),
      description: element.summary || t("world.list.noDescription"),
      elementType: element.elementType
    }));
    const ruleItems: WorldSidebarItem[] = world.rules.map((rule) => ({
      kind: "rule",
      id: rule.id,
      label: rule.name || t("world.list.unnamed"),
      meta: t("world.list.ruleMeta"),
      description: rule.description || t("world.list.noRuleDescription")
    }));
    const source = mode === "rules" ? ruleItems : elementItems;

    return source.filter((item) => {
      const matchesType =
        item.kind === "rule" || typeFilter === "all" || item.elementType === typeFilter;
      const matchesSearch =
        !query ||
        [item.label, item.meta, item.description]
          .join(" ")
          .toLocaleLowerCase("pl-PL")
          .includes(query);
      return matchesType && matchesSearch;
    });
  }, [mode, search, typeFilter, world.elements, world.rules, t]);

  const invalidateWorld = async () => {
    await queryClient.invalidateQueries({ queryKey: ["world-workspace", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const elementMutation = useMutation({
    mutationFn: (input: UpsertWorldElementInput) => upsertWorldElement(input),
    onSuccess: async (element) => {
      setSelectedElementId(element.id);
      setMessage(t("world.messages.elementSaved"));
      setErrorMessage("");
      await invalidateWorld();
    },
    onError: showError
  });
  const ruleMutation = useMutation({
    mutationFn: (input: UpsertWorldRuleInput) => upsertWorldRule(input),
    onSuccess: async (rule) => {
      setSelectedRuleId(rule.id);
      setMessage(t("world.messages.ruleSaved"));
      setErrorMessage("");
      await invalidateWorld();
    },
    onError: showError
  });
  const deleteElementMutation = useMutation({
    mutationFn: (id: string) => deleteWorldElement(id),
    onSuccess: async () => {
      setSelectedElementId(null);
      setMessage(t("world.messages.elementDeleted"));
      await invalidateWorld();
    },
    onError: showError
  });
  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => deleteWorldRule(id),
    onSuccess: async () => {
      setSelectedRuleId(null);
      setMessage(t("world.messages.ruleDeleted"));
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
    setMode("elements");
    setSelectedElementId(newWorldElementDraftId);
    setActiveTab("profile");
    setElementDraft(emptyElementInput(projectId, world.elements.length));
    setMessage("");
    setErrorMessage("");
  }

  function startNewRule() {
    setMode("rules");
    setSelectedRuleId(newWorldRuleDraftId);
    setActiveTab("profile");
    setRuleDraft(emptyRuleInput(projectId, world.rules.length));
    setMessage("");
    setErrorMessage("");
  }

  function openDefaultRelationPicker() {
    if (mode === "rules" && selectedRule) {
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

    setErrorMessage(t("world.messages.chooseElementOrRule"));
  }

  function runHeaderCreateAction() {
    if (mode === "rules") {
      startNewRule();
      return;
    }

    startNewElement();
  }

  function headerCreateLabel(): string {
    return mode === "rules" ? t("world.create.newRule") : t("world.create.newElement");
  }

  function editorHeaderIcon() {
    if (mode === "rules") {
      return <BookOpen size={32} />;
    }

    return <Globe2 size={32} />;
  }

  function editorHeaderEyebrow(): string {
    if (mode === "rules") {
      return activeTab === "links" ? t("world.editorHeader.ruleLinks") : t("world.editorHeader.worldRule");
    }

    if (activeTab === "links") {
      return t("world.editorHeader.elementLinks");
    }

    return selectedElement ? t("world.editorHeader.worldElement") : t("world.editorHeader.newElement");
  }

  function editorHeaderTitle(): string {
    if (mode === "rules") {
      return ruleDraft.name || t("world.editorHeader.unnamed");
    }

    return elementDraft.name || t("world.editorHeader.unnamed");
  }

  function editorHeaderDescription(): string {
    if (mode === "rules") {
      return activeTab === "links"
        ? ruleDraft.description || t("world.editorHeader.ruleLinksPlaceholder")
        : ruleDraft.description || t("world.editorHeader.rulePlaceholder");
    }

    if (activeTab === "links") {
      return elementDraft.summary || t("world.editorHeader.elementLinksPlaceholder");
    }

    return elementDraft.summary || t("world.editorHeader.elementPlaceholder");
  }

  function queueWorldGeneration(field: WorldFieldKey, targetEntity?: WorldPromptEntity) {
    setErrorMessage("");
    if (!project || !book) {
      setErrorMessage(t("world.messages.noProjectData"));
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
        submitLabel: t("world.promptContext.submitLabel"),
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading
          ? t("world.promptContext.queuedReason", { label: t(`world.fieldLabel.${field}`) })
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
    return <p className="muted-text">{t("world.loading")}</p>;
  }

  if (projectQuery.isError || worldQuery.isError || !project || !book) {
    return <p className="warning-text">{t("world.loadError")}</p>;
  }

  return (
    <section className="bible-page world-page">
      <header className="bible-header">
        <div>
          <p className="eyebrow">{t("world.header.eyebrow")}</p>
          <h2>{t("world.header.title")}</h2>
          <p className="muted-text">{t("world.header.subtitle")}</p>
        </div>
        <div className="bible-header-actions">
          <Button variant="ai" onClick={() => activateWorldPromptContext("worldElement", elementDraftPreview(emptyElementInput(projectId, world.elements.length)))}>
            <Sparkles size={16} aria-hidden />
            {t("world.header.aiElement")}
          </Button>
          <Button variant="ai" onClick={() => activateWorldPromptContext("worldRule", ruleDraftPreview(emptyRuleInput(projectId, world.rules.length)))}>
            <Sparkles size={16} aria-hidden />
            {t("world.header.aiRule")}
          </Button>
          <Button variant="ai" onClick={openDefaultRelationPicker}>
            <Sparkles size={16} aria-hidden />
            {t("world.header.aiLink")}
          </Button>
        </div>
      </header>

      <TwoPane
        paneWidth={300}
        pane={
          <>
            <div className="bible-toolbar">
              <Segmented
                ariaLabel={t("world.list.modeAriaLabel")}
                items={[
                  { id: "elements", label: t("world.list.segmentElements") },
                  { id: "rules", label: t("world.list.segmentRules") }
                ]}
                value={mode}
                onChange={setMode}
              />
              <input
                className="ui-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("world.list.searchPlaceholder")}
                aria-label={t("world.list.searchAriaLabel")}
              />
              {mode === "elements" ? (
                <select
                  className="ui-input"
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  title={t("world.list.filterTitle")}
                  aria-label={t("world.list.filterAriaLabel")}
                >
                  <option value="all">{t("world.list.allTypes")}</option>
                  {worldElementTypeValues.map((value) => (
                    <option value={value} key={value}>{typeLabel(t, value)}</option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="bible-list">
              {sidebarItems.map((item) => (
                <button
                  type="button"
                  key={`${item.kind}:${item.id}`}
                  className={
                    item.id === (mode === "rules" ? selectedRuleId : selectedElementId)
                      ? "bible-item active"
                      : "bible-item"
                  }
                  onClick={() => {
                    if (item.kind === "element") {
                      setSelectedElementId(item.id);
                      return;
                    }

                    setSelectedRuleId(item.id);
                  }}
                >
                  <span className="t">{item.label}</span>
                  <span className="m">{item.meta}</span>
                </button>
              ))}
              {sidebarItems.length === 0 ? (
                <p className="bible-list-empty">{t("world.list.empty")}</p>
              ) : null}
            </div>
            <Button variant="secondary" block onClick={runHeaderCreateAction}>
              <Plus size={15} aria-hidden />
              {headerCreateLabel()}
            </Button>
          </>
        }
      >
        <main className="bible-editor">
          <div className="bible-editor-heading">
            <div className="bible-avatar">{editorHeaderIcon()}</div>
            <div className="bible-editor-heading-body">
              <p className="eyebrow">{editorHeaderEyebrow()}</p>
              <h3>{editorHeaderTitle()}</h3>
              <p className="muted-text">{editorHeaderDescription()}</p>
            </div>
            <div className="button-row">
              {mode === "elements" && selectedElement ? (
                <Button variant="danger" onClick={() => deleteElementMutation.mutate(selectedElement.id)}>
                  <Trash2 size={15} aria-hidden />
                  {t("world.editor.delete")}
                </Button>
              ) : null}
              {mode === "rules" && selectedRule ? (
                <Button variant="danger" onClick={() => deleteRuleMutation.mutate(selectedRule.id)}>
                  <Trash2 size={15} aria-hidden />
                  {t("world.editor.delete")}
                </Button>
              ) : null}
            </div>
          </div>

          <Tabs
            ariaLabel={t("world.editor.sectionsAriaLabel")}
            items={(mode === "rules" ? ruleTabs : elementTabs).map(({ key, icon: Icon }) => ({
              id: key,
              label: (
                <>
                  <Icon size={15} aria-hidden />
                  {t(`world.tabs.${key}`)}
                </>
              )
            }))}
            value={activeTab}
            onChange={setActiveTab}
          />

          {mode === "elements" && activeTab === "profile" ? (
            <form className="bible-form" onSubmit={saveElement}>
              <Field label={t("world.profile.elementType")}>
                <select
                  value={elementDraft.elementType}
                  onChange={(event) => setElementDraft({ ...elementDraft, elementType: event.target.value })}
                  onFocus={() => activateWorldPromptContext("elementType", elementDraftPreview(elementDraft))}
                >
                  {worldElementTypeValues.map((value) => (
                    <option key={value} value={value}>{typeLabel(t, value)}</option>
                  ))}
                </select>
              </Field>
              <div className="bible-field-grid">
                {elementFields.filter((item) => !item.advanced).map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(elementDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={elementDraftPreview(elementDraft)}
                    onChange={(value) => setElementDraft({ ...elementDraft, [item.key]: value })}
                    onGenerate={activateWorldPromptContext}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </div>
              <Collapsible title={t("world.profile.advancedTitle")} description={t("world.profile.advancedDescription")}>
                {elementFields.filter((item) => item.advanced).map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(elementDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={elementDraftPreview(elementDraft)}
                    onChange={(value) => setElementDraft({ ...elementDraft, [item.key]: value })}
                    onGenerate={activateWorldPromptContext}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </Collapsible>
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={elementMutation.isPending}
                saveLabel={t("world.profile.saveElement")}
              />
            </form>
          ) : null}

          {mode === "rules" && activeTab === "profile" ? (
            <form className="bible-form" onSubmit={saveRule}>
              <div className="bible-section-heading">
                <h4><BookOpen size={17} aria-hidden /> {ruleDraft.name || t("world.rules.newRule")}</h4>
                <Button variant="ai" size="sm" onClick={() => activateWorldPromptContext("worldRuleAnalysis", ruleDraftPreview(ruleDraft))}>
                  <Sparkles size={14} aria-hidden />
                  {t("world.rules.analyze")}
                </Button>
              </div>
              <div className="bible-field-grid">
                {ruleFields.filter((item) => !item.advanced).map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(ruleDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={ruleDraftPreview(ruleDraft)}
                    onChange={(value) => setRuleDraft({ ...ruleDraft, [item.key]: value })}
                    onGenerate={activateWorldPromptContext}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </div>
              <Collapsible title={t("world.rules.advancedTitle")} description={t("world.rules.advancedDescription")}>
                {ruleFields.filter((item) => item.advanced).map((item) => (
                  <WorldAiField
                    key={item.field}
                    field={item.field}
                    value={String(ruleDraft[item.key] ?? "")}
                    rows={item.rows}
                    target={ruleDraftPreview(ruleDraft)}
                    onChange={(value) => setRuleDraft({ ...ruleDraft, [item.key]: value })}
                    onGenerate={activateWorldPromptContext}
                    onActivate={activateWorldPromptContext}
                  />
                ))}
              </Collapsible>
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={ruleMutation.isPending}
                saveLabel={t("world.rules.saveRule")}
              />
            </form>
          ) : null}

          {activeTab === "links" ? (
            <WorldLinksPanel
              world={world}
              plan={plan}
              characters={characters}
              selectedElement={mode === "elements" ? selectedElement : null}
              selectedRule={mode === "rules" ? selectedRule : null}
              onOpenPicker={setPicker}
              onUpdateElement={updateElementRelations}
              onUpdateRule={updateRuleRelations}
            />
          ) : null}

          {mode === "elements" && activeTab === "visuals" ? (
            <form className="bible-form" onSubmit={saveElement}>
              <div className="bible-field-grid">
                <WorldAiField
                  field="elementVisualPrompt"
                  value={elementDraft.visualPrompt}
                  rows={7}
                  target={elementDraftPreview(elementDraft)}
                  onChange={(value) => setElementDraft({ ...elementDraft, visualPrompt: value })}
                  onGenerate={activateWorldPromptContext}
                  onActivate={activateWorldPromptContext}
                />
              </div>
              <EditorFooter
                message={message}
                errorMessage={errorMessage}
                saving={elementMutation.isPending}
                saveLabel={t("world.visuals.savePrompt")}
              />
            </form>
          ) : null}
        </main>
      </TwoPane>

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
  const { t } = useTranslation();
  const fieldLabel = t(`world.fieldLabel.${field}`);
  const goToBrainstorm = useBrainstormField();
  const activate = () => onActivate(field, target);
  return (
    <Field
      label={fieldLabel}
      className="wide"
      actions={
        <>
          <Button
            variant="ai"
            size="sm"
            onClick={() => goToBrainstorm({ fieldLabel, entityName: (target as { name?: string }).name, value })}
            title={t("world.aiField.generateTitle")}
            aria-label={t("world.aiField.generateAriaLabel", { label: fieldLabel })}
          >
            <Sparkles size={14} aria-hidden />
            AI
          </Button>
          <Button
            variant="icon"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => useAiPromptContextStore.getState().addContextSourceToActiveTarget(worldPromptContextSource(field, target))}
            title={t("world.aiField.addTitle")}
            aria-label={t("world.aiField.addAriaLabel", { label: fieldLabel })}
          >
            <Plus size={14} aria-hidden />
          </Button>
        </>
      }
    >
      {rows === 1 ? (
        <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={activate} onClick={activate} />
      ) : (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} onFocus={activate} onClick={activate} />
      )}
    </Field>
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
  const { t } = useTranslation();
  if (!selectedElement && !selectedRule) {
    return <EmptyState icon={<GitBranch size={28} />} title={t("world.links.emptyTitle")} description={t("world.links.emptyDescription")} />;
  }

  return (
    <div className="world-links-grid">
      {selectedElement ? (
        <>
          <RelationBlock title={t("world.links.characters")} icon={<Users size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "characters" })}>
            {elementCharacterIds(world, selectedElement.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateElement({ characterIds: elementCharacterIds(world, selectedElement.id).filter((item) => item !== id) })}>
                {characters.characters.find((item) => item.id === id)?.name ?? t("world.links.characterFallback")}
              </Chip>
            ))}
          </RelationBlock>
          <RelationBlock title={t("world.links.threads")} icon={<GitBranch size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "threads" })}>
            {elementThreadIds(world, selectedElement.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateElement({ threadIds: elementThreadIds(world, selectedElement.id).filter((item) => item !== id) })}>
                {plan.threads.find((item) => item.id === id)?.name ?? t("world.links.threadFallback")}
              </Chip>
            ))}
          </RelationBlock>
          <RelationBlock title={t("world.links.chapters")} icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "chapters" })}>
            {elementChapterIds(world, selectedElement.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateElement({ chapterIds: elementChapterIds(world, selectedElement.id).filter((item) => item !== id) })}>
                {chapterLabel(t, plan, id)}
              </Chip>
            ))}
          </RelationBlock>
          <RelationBlock title={t("world.links.elementRules")} icon={<BookOpen size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "rules" })}>
            {elementRuleIds(world, selectedElement.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateElement({ ruleIds: elementRuleIds(world, selectedElement.id).filter((item) => item !== id) })}>
                {world.rules.find((item) => item.id === id)?.name ?? t("world.links.ruleFallback")}
              </Chip>
            ))}
          </RelationBlock>
        </>
      ) : null}

      {selectedElement ? (
        <RelationBlock title={t("world.links.scenes")} icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "element", kind: "scenes" })}>
          {elementSceneIds(world, selectedElement.id).map((id) => (
            <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateElement({ sceneIds: elementSceneIds(world, selectedElement.id).filter((item) => item !== id) })}>
              {sceneLabel(t, plan, id)}
            </Chip>
          ))}
        </RelationBlock>
      ) : null}

      {selectedRule ? (
        <>
          <RelationBlock title={t("world.links.ruleElements")} icon={<Globe2 size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "elements" })}>
            {ruleElementIds(world, selectedRule.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateRule({ elementIds: ruleElementIds(world, selectedRule.id).filter((item) => item !== id) })}>
                {world.elements.find((item) => item.id === id)?.name ?? t("world.links.elementFallback")}
              </Chip>
            ))}
          </RelationBlock>
          <RelationBlock title={t("world.links.ruleThreads")} icon={<GitBranch size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "threads" })}>
            {ruleThreadIds(world, selectedRule.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateRule({ threadIds: ruleThreadIds(world, selectedRule.id).filter((item) => item !== id) })}>
                {plan.threads.find((item) => item.id === id)?.name ?? t("world.links.threadFallback")}
              </Chip>
            ))}
          </RelationBlock>
          <RelationBlock title={t("world.links.ruleChapters")} icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "chapters" })}>
            {ruleChapterIds(world, selectedRule.id).map((id) => (
              <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateRule({ chapterIds: ruleChapterIds(world, selectedRule.id).filter((item) => item !== id) })}>
                {chapterLabel(t, plan, id)}
              </Chip>
            ))}
          </RelationBlock>
        </>
      ) : null}

      {selectedRule ? (
        <RelationBlock title={t("world.links.ruleScenes")} icon={<FileText size={17} />} onAdd={() => onOpenPicker({ target: "rule", kind: "scenes" })}>
          {ruleSceneIds(world, selectedRule.id).map((id) => (
            <Chip tone="accent" key={id} removeLabel={t("world.links.detach")} onRemove={() => onUpdateRule({ sceneIds: ruleSceneIds(world, selectedRule.id).filter((item) => item !== id) })}>
              {sceneLabel(t, plan, id)}
            </Chip>
          ))}
        </RelationBlock>
      ) : null}
    </div>
  );
}

function RelationBlock({ title, icon, children, onAdd }: { title: string; icon: ReactNode; children: ReactNode; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="world-link-block">
      <header>
        <h4>{icon}{title}</h4>
        <Button variant="icon" onClick={onAdd} title={t("world.links.addRelation", { title })} aria-label={t("world.links.addRelation", { title })}>
          <Plus size={15} aria-hidden />
        </Button>
      </header>
      <div className="chip-row">{children}</div>
    </section>
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
  const { t } = useTranslation();
  const options = pickerOptions(t, state, world, plan, characters, selectedElement, selectedRule);
  return (
    <Modal title={pickerTitle(t, state)} onClose={onClose} size="md">
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
        {options.length === 0 ? <p className="muted-text">{t("world.picker.noEntities")}</p> : null}
      </div>
    </Modal>
  );
}

function EditorFooter({ message, errorMessage, saving, saveLabel }: { message: string; errorMessage: string; saving: boolean; saveLabel: string }) {
  return (
    <footer className="bible-editor-footer">
      <div>
        {message ? <p className="success-text">{message}</p> : null}
        {errorMessage ? <p className="warning-text">{errorMessage}</p> : null}
      </div>
      <Button variant="primary" type="submit" busy={saving}>
        <Save size={15} aria-hidden />
        {saveLabel}
      </Button>
    </footer>
  );
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

function pickerOptions(t: TFunction, state: RelationPickerState, world: WorldWorkspace, plan: BookPlan, characters: CharacterWorkspace, selectedElement: WorldElement | null, selectedRule: WorldRule | null) {
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
          ? plan.chapters.map((item) => ({ id: item.id, label: chapterLabel(t, plan, item.id), description: item.summary }))
          : state.kind === "scenes"
            ? plan.scenes.map((item) => ({ id: item.id, label: sceneLabel(t, plan, item.id), description: item.summary }))
          : state.kind === "rules"
            ? world.rules.map((item) => ({ id: item.id, label: item.name, description: item.description }))
            : world.elements.map((item) => ({ id: item.id, label: item.name, description: item.summary }));

  return source.map((option) => ({
    ...option,
    currentIds,
    selected: currentIds.includes(option.id)
  }));
}

function pickerTitle(t: TFunction, state: RelationPickerState): string {
  const labels: Record<string, string> = {
    characters: t("world.picker.characters"),
    threads: t("world.picker.threads"),
    chapters: t("world.picker.chapters"),
    rules: t("world.picker.rules"),
    elements: t("world.picker.elements")
  };
  return labels[state.kind] ?? t("world.picker.fallback");
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

function chapterLabel(t: TFunction, plan: BookPlan, chapterId: string): string {
  const chapter = plan.chapters.find((item) => item.id === chapterId);
  return chapter
    ? t("world.labels.chapter", { number: chapter.number, title: chapter.workingTitle || t("world.labels.chapterUntitled") })
    : t("world.labels.chapterFallback");
}

function typeLabel(t: TFunction, value: string): string {
  return worldElementTypeValues.includes(value) ? t(`world.elementType.${value}`) : value;
}

function sceneLabel(t: TFunction, plan: BookPlan, sceneId: string): string {
  const scene = plan.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return t("world.labels.sceneFallback");
  }
  const chapter = scene.chapterId ? plan.chapters.find((item) => item.id === scene.chapterId) : null;
  const chapterPrefix = chapter ? `R${chapter.number}` : t("world.labels.sceneNoChapter");
  return t("world.labels.scene", { prefix: chapterPrefix, number: scene.orderIndex + 1, title: scene.title || t("world.labels.sceneUntitled") });
}

function isRuleField(field: WorldFieldKey): boolean {
  return field === "worldRule" || field === "worldRuleAnalysis" || field.startsWith("rule");
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
