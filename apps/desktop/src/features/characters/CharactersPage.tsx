import {
  Brain,
  Camera,
  Clock3,
  Link2,
  Loader2,
  Minus,
  Network,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { FormEvent, MouseEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { coverImageSource } from "../../shared/api/assets";
import {
  deleteCharacter,
  deleteCharacterMemory,
  deleteCharacterMemoryLink,
  deleteCharacterRelation,
  getCharacterWorkspace,
  getProject,
  upsertCharacter,
  upsertCharacterMemory,
  upsertCharacterMemoryLink,
  upsertCharacterRelation
} from "../../shared/api/commands";
import type {
  Character,
  CharacterMemory,
  CharacterMemoryLink,
  CharacterRelation,
  CharacterWorkspace,
  UpsertCharacterInput,
  UpsertCharacterMemoryInput,
  UpsertCharacterMemoryLinkInput,
  UpsertCharacterRelationInput,
  VisualAsset
} from "../../shared/api/types";
import {
  buildCharacterPromptPackage,
  characterEntityId,
  characterFieldConfigs,
  CharacterFieldKey,
  characterPromptContextSource,
  CharacterPromptEntity,
  renderCharacterPromptPackage
} from "../ai/characterPromptPackage";
import {
  characterPromptContextTargetId,
  createCharacterPromptContextTarget,
  promptContextControlForActiveTarget,
  useAiPromptContextStore
} from "../ai/aiPromptContextStore";
import {
  CHARACTER_IMAGE_FIELD,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";
import {
  applyCharacterDraftField,
  registerCharacterDraftFieldTarget,
  unregisterCharacterDraftFieldTarget
} from "../ai/characterDraftFieldTargets";

type CharactersPageProps = {
  projectId: string;
};

type EditorTab = "profile" | "relations" | "memories" | "image";
type RelationModalState =
  | { mode: "create"; fromCharacterId: string }
  | { mode: "edit"; relationId: string };
type MemoryModalState =
  | { mode: "create"; characterId: string }
  | { mode: "edit"; memoryId: string };
type MemoryLinkModalState =
  | { mode: "create"; fromMemoryId: string }
  | { mode: "edit"; linkId: string };

const newCharacterDraftId = "new-character";

const characterTypeOptions = [
  { value: "person", label: "Człowiek" },
  { value: "animal", label: "Zwierzę" },
  { value: "creature", label: "Istota" },
  { value: "object", label: "Ożywiony przedmiot" },
  { value: "spirit", label: "Duch / byt" },
  { value: "other", label: "Inne" }
];

const relationTypeOptions = [
  "rodzina",
  "przyjaźń",
  "romans",
  "rywalizacja",
  "mentor",
  "wróg",
  "sojusz",
  "zależność",
  "tajemnica",
  "inne"
];

const memoryTypeOptions = ["wydarzenie", "miejsce", "osoba", "przedmiot", "sekret", "sen", "trauma", "inne"];

const characterTabs: Array<{ key: EditorTab; label: string; icon: typeof UserRound }> = [
  { key: "profile", label: "Profil", icon: UserRound },
  { key: "relations", label: "Relacje", icon: Users },
  { key: "memories", label: "Wspomnienia", icon: Brain },
  { key: "image", label: "Obraz", icon: Camera }
];

type CharacterFieldItem = {
  field: CharacterFieldKey;
  key: keyof UpsertCharacterInput;
  rows?: number;
  list?: boolean;
};

const characterFieldGroups: Array<{
  title: string;
  description: string;
  icon: typeof UserRound;
  fields: CharacterFieldItem[];
}> = [
  {
    title: "Tożsamość",
    description: "Podstawowe informacje, po których łatwo rozpoznać rolę postaci w powieści.",
    icon: UserRound,
    fields: [
      { field: "characterType", key: "characterType" },
      { field: "name", key: "name" },
      { field: "aliasesJson", key: "aliasesJson", list: true },
      { field: "role", key: "role" },
      { field: "shortDescription", key: "shortDescription", rows: 3 }
    ]
  },
  {
    title: "Motywacje i konflikt",
    description: "Cele, potrzeby i wewnętrzne napięcia, które prowadzą postać przez fabułę.",
    icon: Sparkles,
    fields: [
      { field: "externalGoal", key: "externalGoal", rows: 2 },
      { field: "internalNeed", key: "internalNeed", rows: 2 },
      { field: "wound", key: "wound", rows: 2 },
      { field: "falseBelief", key: "falseBelief", rows: 2 },
      { field: "secret", key: "secret", rows: 2 }
    ]
  },
  {
    title: "Zasoby i ograniczenia",
    description: "Mocne strony i słabości, które dają scenom tarcie oraz wiarygodne wybory.",
    icon: Network,
    fields: [
      { field: "strengthsJson", key: "strengthsJson", list: true },
      { field: "weaknessesJson", key: "weaknessesJson", list: true }
    ]
  },
  {
    title: "Głos, łuk i wiedza",
    description: "Sposób mówienia, kierunek przemiany i notatki potrzebne podczas pisania.",
    icon: Brain,
    fields: [
      { field: "voiceNotes", key: "voiceNotes", rows: 3 },
      { field: "arcSummary", key: "arcSummary", rows: 3 },
      { field: "knowledgeNotes", key: "knowledgeNotes", rows: 4 }
    ]
  },
  {
    title: "Wizualia",
    description: "Opis referencyjny używany przy generowaniu obrazu postaci.",
    icon: Camera,
    fields: [
      { field: "visualPrompt", key: "visualPrompt", rows: 4 }
    ]
  }
];

const characterFields = characterFieldGroups.flatMap((group) => group.fields);

export function CharactersPage({ projectId }: CharactersPageProps) {
  const queryClient = useQueryClient();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const activatePromptContextTarget = useAiPromptContextStore((state) => state.activateTarget);
  const closePromptContextTarget = useAiPromptContextStore((state) => state.closeTarget);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("profile");
  const [draft, setDraft] = useState<UpsertCharacterInput>(() => emptyCharacterInput(projectId, 0));
  const [relationModal, setRelationModal] = useState<RelationModalState | null>(null);
  const [memoryModal, setMemoryModal] = useState<MemoryModalState | null>(null);
  const [memoryLinkModal, setMemoryLinkModal] = useState<MemoryLinkModalState | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const workspaceQuery = useQuery({
    queryKey: ["character-workspace", projectId],
    queryFn: () => getCharacterWorkspace(projectId),
    retry: 0
  });
  const workspace = workspaceQuery.data ?? emptyWorkspace();
  const book = projectQuery.data?.book;
  const project = projectQuery.data?.project;
  const selectedCharacter = workspace.characters.find((item) => item.id === selectedCharacterId) ?? null;
  const selectedImage = selectedCharacter
    ? assetForCharacter(workspace, selectedCharacter)
    : null;

  useEffect(() => {
    if (!selectedCharacterId && workspace.characters[0]) {
      setSelectedCharacterId(workspace.characters[0].id);
    }
  }, [selectedCharacterId, workspace.characters]);

  useEffect(() => {
    if (selectedCharacter) {
      setDraft(characterToInput(selectedCharacter));
      return;
    }

    setDraft(emptyCharacterInput(projectId, workspace.characters.length));
  }, [projectId, selectedCharacter?.id, workspace.characters.length]);

  useEffect(() => {
    const targetId = selectedCharacter?.id ?? "new-character";
    registerCharacterDraftFieldTarget(targetId, (field, value) => {
      setDraft((current) => applyCharacterValue(current, field, value));
      return true;
    });
    return () => unregisterCharacterDraftFieldTarget(targetId);
  }, [selectedCharacter?.id]);

  const filteredCharacters = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pl-PL");
    return workspace.characters.filter((character) => {
      const matchesType = typeFilter === "all" || character.characterType === typeFilter;
      const matchesSearch =
        !query ||
        [character.name, character.role, character.shortDescription, character.aliasesJson]
          .join(" ")
          .toLocaleLowerCase("pl-PL")
          .includes(query);
      return matchesType && matchesSearch;
    });
  }, [search, typeFilter, workspace.characters]);

  const invalidateCharacters = async () => {
    await queryClient.invalidateQueries({ queryKey: ["character-workspace", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const characterMutation = useMutation({
    mutationFn: (input: UpsertCharacterInput) => upsertCharacter(input),
    onSuccess: async (character) => {
      setSelectedCharacterId(character.id);
      setMessage("Zapisano postać.");
      setErrorMessage("");
      await invalidateCharacters();
    },
    onError: showError
  });
  const deleteCharacterMutation = useMutation({
    mutationFn: (id: string) => deleteCharacter(id),
    onSuccess: async () => {
      setSelectedCharacterId(null);
      setMessage("Usunięto postać.");
      await invalidateCharacters();
    },
    onError: showError
  });
  const relationMutation = useMutation({
    mutationFn: (input: UpsertCharacterRelationInput) => upsertCharacterRelation(input),
    onSuccess: async () => {
      setRelationModal(null);
      setMessage("Zapisano relację.");
      await invalidateCharacters();
    },
    onError: showError
  });
  const memoryMutation = useMutation({
    mutationFn: (input: UpsertCharacterMemoryInput) => upsertCharacterMemory(input),
    onSuccess: async () => {
      setMemoryModal(null);
      setMessage("Zapisano wspomnienie.");
      await invalidateCharacters();
    },
    onError: showError
  });
  const memoryLinkMutation = useMutation({
    mutationFn: (input: UpsertCharacterMemoryLinkInput) => upsertCharacterMemoryLink(input),
    onSuccess: async () => {
      setMemoryLinkModal(null);
      setMessage("Zapisano połączenie wspomnień.");
      await invalidateCharacters();
    },
    onError: showError
  });
  const deleteRelationMutation = useMutation({
    mutationFn: (id: string) => deleteCharacterRelation(id),
    onSuccess: invalidateCharacters,
    onError: showError
  });
  const deleteMemoryMutation = useMutation({
    mutationFn: (id: string) => deleteCharacterMemory(id),
    onSuccess: invalidateCharacters,
    onError: showError
  });
  const deleteMemoryLinkMutation = useMutation({
    mutationFn: (id: string) => deleteCharacterMemoryLink(id),
    onSuccess: invalidateCharacters,
    onError: showError
  });

  function showError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  function saveCharacter(event: FormEvent) {
    event.preventDefault();
    characterMutation.mutate({
      ...draft,
      projectId,
      aliasesJson: serializeListInput(draft.aliasesJson),
      strengthsJson: serializeListInput(draft.strengthsJson),
      weaknessesJson: serializeListInput(draft.weaknessesJson)
    });
  }

  function startNewCharacter() {
    setSelectedCharacterId(newCharacterDraftId);
    setActiveTab("profile");
    setDraft(emptyCharacterInput(projectId, workspace.characters.length));
    setMessage("");
    setErrorMessage("");
  }

  function generateFullCharacter() {
    if (selectedCharacter) {
      startNewCharacter();
    }
    const freshDraft = emptyCharacterInput(projectId, workspace.characters.length);
    const target = draftCharacterPreview(freshDraft);
    setSelectedCharacterId(newCharacterDraftId);
    setActiveTab("profile");
    setDraft(freshDraft);
    queueCharacterGeneration("characterProfile", target);
  }

  function generateRelationForCharacter(character: Character) {
    const state: RelationModalState = { mode: "create", fromCharacterId: character.id };
    const relationDraft = relationToInput(null, state, workspace);
    if (!relationDraft.toCharacterId) {
      setErrorMessage("Dodaj przynajmniej drugą postać, aby AI mogło utworzyć relację.");
      return;
    }

    setRelationModal(state);
    setErrorMessage("");
    queueCharacterGeneration("characterRelation", relationPreview(relationDraft));
  }

  function generateMemoryForCharacter(character: Character) {
    const state: MemoryModalState = { mode: "create", characterId: character.id };
    const memoryDraft = memoryToInput(null, state, workspace);
    setMemoryModal(state);
    setErrorMessage("");
    queueCharacterGeneration("characterMemory", memoryPreview(memoryDraft));
  }

  function queueCharacterGeneration(field: CharacterFieldKey, targetEntity?: CharacterPromptEntity) {
    setErrorMessage("");
    if (!project || !book) {
      setErrorMessage("Brak danych projektu.");
      return;
    }

    const effectiveTarget = targetEntity ?? selectedCharacter ?? draftCharacterPreview(draft);
    const targetId = characterPromptContextTargetId(projectId, field, characterEntityId(effectiveTarget));
    const contextControl = promptContextControlForActiveTarget(targetId);
    const usedPromptContext = Boolean(contextControl);
    const promptPackage = buildCharacterPromptPackage(
      project,
      book,
      workspace,
      field,
      effectiveTarget,
      contextControl
    );
    const prompt = renderCharacterPromptPackage(promptPackage);

    enqueueProposal({
      scope: "characters",
      projectId,
      bookId: book.id,
      field: field === "characterImage" ? CHARACTER_IMAGE_FIELD : field,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt,
      coverPrompt: promptPackage.imagePrompt,
      coverNegativePrompt: promptPackage.negativePrompt
    });

    if (usedPromptContext) {
      closePromptContextTarget(targetId);
    }
  }

  function activateCharacterPromptContext(field: CharacterFieldKey, targetEntity?: CharacterPromptEntity) {
    const effectiveTarget = targetEntity ?? selectedCharacter ?? draftCharacterPreview(draft);
    const targetId = characterPromptContextTargetId(projectId, field, characterEntityId(effectiveTarget));
    const loading = pendingProposalStatus(proposals, {
      projectId,
      field: field === "characterImage" ? CHARACTER_IMAGE_FIELD : field,
      scope: "characters",
      targetEntityId: characterEntityId(effectiveTarget)
    });

    activatePromptContextTarget(
      createCharacterPromptContextTarget(projectId, field, characterEntityId(effectiveTarget), {
        submitLabel: "Wyślij do AI",
        submitDisabled: Boolean(loading),
        submitDisabledReason: loading ? `Pole "${characterFieldConfigs[field].label}" jest już w kolejce AI.` : undefined,
        onSubmit: () => queueCharacterGeneration(field, effectiveTarget)
      })
    );
  }

  if (projectQuery.isLoading || workspaceQuery.isLoading) {
    return <p className="muted-text">Ładuję postacie...</p>;
  }

  if (projectQuery.isError || workspaceQuery.isError || !project || !book) {
    return <p className="warning-text">Nie można wczytać kreatora postaci.</p>;
  }

  return (
    <section className="characters-page">
      <header className="characters-header">
        <div>
          <p className="eyebrow">Story Bible</p>
          <h2>Postacie</h2>
          <p className="muted-text">Profile, relacje, wspomnienia i obrazy referencyjne dla powieści.</p>
        </div>
        <div className="characters-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={generateFullCharacter}
            title="Utwórz pełny tekstowy profil postaci z AI bez obrazu"
            aria-label="Utwórz pełny profil postaci z AI"
          >
            <Sparkles size={16} />
            AI postać
          </button>
          <button type="button" className="primary-button" onClick={startNewCharacter}>
            <Plus size={16} />
            Nowa postać
          </button>
        </div>
      </header>

      <div className="characters-layout">
        <aside className="characters-list-panel">
          <div className="characters-toolbar">
            <label className="characters-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj postaci" />
            </label>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} title="Filtruj rodzaj postaci">
              <option value="all">Wszystkie rodzaje</option>
              {characterTypeOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="character-card-list">
            {filteredCharacters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                image={assetForCharacter(workspace, character)}
                relations={relationsForCharacter(workspace, character.id)}
                active={character.id === selectedCharacterId}
                onSelect={() => setSelectedCharacterId(character.id)}
                onDetachRelation={(relationId, event) => {
                  event.stopPropagation();
                  deleteRelationMutation.mutate(relationId);
                }}
              />
            ))}
            {filteredCharacters.length === 0 ? (
              <p className="character-empty">Brak postaci pasujących do filtrów.</p>
            ) : null}
          </div>
        </aside>

        <main className="character-editor-panel">
          <form className="character-editor-form" onSubmit={saveCharacter}>
            <div className="character-editor-heading">
              <div className="character-avatar">
                {selectedImage ? <img src={coverImageSource(selectedImage.filePath)} alt="" /> : <UserRound size={34} />}
              </div>
              <div>
                <p className="eyebrow">{selectedCharacter ? "Profil postaci" : "Nowa postać"}</p>
                <h3>{draft.name || "Bez nazwy"}</h3>
                <p className="muted-text">{draft.role || "Określ rolę fabularną i najważniejsze napięcie."}</p>
              </div>
              <div className="button-row">
                {selectedCharacter ? (
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => deleteCharacterMutation.mutate(selectedCharacter.id)}
                  >
                    <Trash2 size={15} />
                    Usuń
                  </button>
                ) : null}
                <button type="submit" className="primary-button" disabled={characterMutation.isPending}>
                  <Save size={15} />
                  {characterMutation.isPending ? "Zapisuję" : "Zapisz"}
                </button>
              </div>
            </div>

            <div className="character-tabs" role="tablist" aria-label="Sekcje postaci">
              {characterTabs.map(({ key, label, icon: Icon }) => (
                <button
                  type="button"
                  key={key}
                  className={activeTab === key ? "character-tab active" : "character-tab"}
                  onClick={() => setActiveTab(key)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "profile" ? (
              <div className="character-profile-groups">
                {characterFieldGroups.map((group) => {
                  const Icon = group.icon;

                  return (
                    <section className="character-profile-group" key={group.title}>
                      <div className="character-profile-group-heading">
                        <span className="character-profile-group-icon">
                          <Icon size={17} />
                        </span>
                        <div>
                          <h4>{group.title}</h4>
                          <p>{group.description}</p>
                        </div>
                      </div>
                      <div className="character-field-grid">
                        {group.fields.map((item) => (
                          <CharacterField
                            key={item.field}
                            field={item.field}
                            value={String(draft[item.key] ?? "")}
                            rows={item.rows}
                            list={item.list}
                            target={selectedCharacter ?? draftCharacterPreview(draft)}
                            onChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))}
                            onGenerate={queueCharacterGeneration}
                            onActivate={activateCharacterPromptContext}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : null}

            {activeTab === "relations" ? (
              <RelationsSection
                character={selectedCharacter}
                workspace={workspace}
                onCreate={() => selectedCharacter && setRelationModal({ mode: "create", fromCharacterId: selectedCharacter.id })}
                onGenerate={() => selectedCharacter && generateRelationForCharacter(selectedCharacter)}
                onEdit={(relationId) => setRelationModal({ mode: "edit", relationId })}
                onDelete={(relationId) => deleteRelationMutation.mutate(relationId)}
              />
            ) : null}

            {activeTab === "memories" ? (
              <MemoriesSection
                character={selectedCharacter}
                workspace={workspace}
                onCreate={() => selectedCharacter && setMemoryModal({ mode: "create", characterId: selectedCharacter.id })}
                onGenerate={() => selectedCharacter && generateMemoryForCharacter(selectedCharacter)}
                onEdit={(memoryId) => setMemoryModal({ mode: "edit", memoryId })}
                onDelete={(memoryId) => deleteMemoryMutation.mutate(memoryId)}
                onCreateLink={(memoryId) => setMemoryLinkModal({ mode: "create", fromMemoryId: memoryId })}
                onEditLink={(linkId) => setMemoryLinkModal({ mode: "edit", linkId })}
                onDeleteLink={(linkId) => deleteMemoryLinkMutation.mutate(linkId)}
              />
            ) : null}

            {activeTab === "image" ? (
              <CharacterImageSection
                character={selectedCharacter}
                image={selectedImage}
                onGenerate={() => selectedCharacter && queueCharacterGeneration("characterImage", selectedCharacter)}
              />
            ) : null}
          </form>

          {message ? <p className="success-text">{message}</p> : null}
          {errorMessage ? <p className="warning-text">{errorMessage}</p> : null}
        </main>
      </div>

      {relationModal ? (
        <RelationModal
          state={relationModal}
          workspace={workspace}
          onClose={() => setRelationModal(null)}
          onSubmit={(input) => relationMutation.mutate(input)}
          onGenerate={queueCharacterGeneration}
          onActivate={activateCharacterPromptContext}
        />
      ) : null}

      {memoryModal ? (
        <MemoryModal
          state={memoryModal}
          workspace={workspace}
          onClose={() => setMemoryModal(null)}
          onSubmit={(input) => memoryMutation.mutate(input)}
          onGenerate={queueCharacterGeneration}
          onActivate={activateCharacterPromptContext}
        />
      ) : null}

      {memoryLinkModal ? (
        <MemoryLinkModal
          state={memoryLinkModal}
          workspace={workspace}
          onClose={() => setMemoryLinkModal(null)}
          onSubmit={(input) => memoryLinkMutation.mutate(input)}
          onGenerate={queueCharacterGeneration}
          onActivate={activateCharacterPromptContext}
        />
      ) : null}
    </section>
  );
}

function CharacterField({
  field,
  value,
  rows,
  list,
  target,
  onChange,
  onGenerate,
  onActivate
}: {
  field: CharacterFieldKey;
  value: string;
  rows?: number;
  list?: boolean;
  target: CharacterPromptEntity;
  onChange: (value: string) => void;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onActivate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
}) {
  const config = characterFieldConfigs[field];
  const activeTargetId = useAiPromptContextStore((state) => state.activeTargetId);
  const activeTarget = useAiPromptContextStore((state) => activeTargetId ? state.targets[activeTargetId] : null);
  const addContextSourceToActiveTarget = useAiPromptContextStore((state) => state.addContextSourceToActiveTarget);
  const fieldAlreadyInContext = Boolean(activeTarget?.sources.some((source) => source.key === characterPromptContextSource(field, target).key || source.key === field));

  return (
    <div
      className={rows ? "field-shell character-field wide" : "field-shell character-field"}
      onClick={(event) => {
        if (isEditablePromptTarget(event.target)) {
          onActivate(field, target);
        }
      }}
      onFocusCapture={(event) => {
        if (isEditablePromptTarget(event.target)) {
          onActivate(field, target);
        }
      }}
    >
      <div className="field-heading">
        <span className="field-label-text">{config.label}</span>
        <AiActions
          field={field}
          target={target}
          disabled={false}
          onGenerate={onGenerate}
          addDisabled={!activeTarget || fieldAlreadyInContext}
          onAddContext={() => addContextSourceToActiveTarget(characterPromptContextSource(field, target))}
        />
      </div>
      {rows ? (
        <textarea value={list ? listDisplay(value) : value} onChange={(event) => onChange(event.target.value)} rows={rows} aria-label={config.label} />
      ) : field === "characterType" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={config.label}>
          {characterTypeOptions.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input value={list ? listDisplay(value) : value} onChange={(event) => onChange(event.target.value)} aria-label={config.label} />
      )}
    </div>
  );
}

function AiActions({
  field,
  target,
  disabled,
  addDisabled,
  onGenerate,
  onAddContext
}: {
  field: CharacterFieldKey;
  target: CharacterPromptEntity;
  disabled: boolean;
  addDisabled: boolean;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onAddContext: () => void;
}) {
  const loading = useProposalStore((state) =>
    pendingProposalStatus(state.proposals, {
      field: field === "characterImage" ? CHARACTER_IMAGE_FIELD : field,
      scope: "characters",
      targetEntityId: characterEntityId(target)
    })
  );
  return (
    <div className="ai-field-actions">
      <button
        type="button"
        className="icon-button ai-field-button"
        disabled={disabled || Boolean(loading)}
        onClick={(event) => {
          event.stopPropagation();
          onGenerate(field, target);
        }}
        title={`Generuj pole "${characterFieldConfigs[field].label}" z AI`}
        aria-label={`Generuj ${characterFieldConfigs[field].label} z AI`}
      >
        {loading === "running" ? <Loader2 size={15} className="spin-icon" /> : loading === "queued" ? <Clock3 size={15} /> : <Sparkles size={15} />}
      </button>
      <button
        type="button"
        className="icon-button ai-context-add-button"
        disabled={addDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAddContext();
        }}
        title={addDisabled ? "Pole jest juz w kontekscie albo nie ma aktywnego promptu." : "Dodaj pole do kontekstu promptu."}
        aria-label={`Dodaj ${characterFieldConfigs[field].label} do kontekstu promptu`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function CharacterCard({
  character,
  image,
  relations,
  active,
  onSelect,
  onDetachRelation
}: {
  character: Character;
  image: VisualAsset | null;
  relations: CharacterRelation[];
  active: boolean;
  onSelect: () => void;
  onDetachRelation: (relationId: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" className={active ? "character-card active" : "character-card"} onClick={onSelect}>
      <span className="character-card-image">
        {image ? <img src={coverImageSource(image.filePath)} alt="" /> : <UserRound size={28} />}
      </span>
      <span className="character-card-body">
        <strong>{character.name}</strong>
        <small>{typeLabel(character.characterType)} / {character.role || "Bez roli"}</small>
        <span className="character-card-description">{character.shortDescription || "Brak opisu."}</span>
        <span className="relation-chip-row">
          {relations.slice(0, 3).map((relation) => (
            <span className="relation-chip" key={relation.id} title={relation.description}>
              {relation.relationType}
              <button type="button" title="Odepnij relację" aria-label="Odepnij relację" onClick={(event) => onDetachRelation(relation.id, event)}>
                <Minus size={11} />
              </button>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function RelationsSection({ character, workspace, onCreate, onGenerate, onEdit, onDelete }: {
  character: Character | null;
  workspace: CharacterWorkspace;
  onCreate: () => void;
  onGenerate: () => void;
  onEdit: (relationId: string) => void;
  onDelete: (relationId: string) => void;
}) {
  if (!character) {
    return <PanelEmpty icon={<Users size={22} />} text="Zapisz postać, aby dodawać relacje." />;
  }
  const relations = relationsForCharacter(workspace, character.id);
  const canGenerateRelation = workspace.characters.some((item) => item.id !== character.id);
  return (
    <section className="character-section">
      <SectionHeading
        title="Relacje"
        icon={<Users size={18} />}
        actionLabel="Dodaj relację"
        onAction={onCreate}
        aiActionLabel="AI relacja"
        onAiAction={onGenerate}
        aiActionDisabled={!canGenerateRelation}
        aiActionTitle={canGenerateRelation ? "Wygeneruj szkic relacji z AI" : "Dodaj drugą postać, aby wygenerować relację"}
      />
      <div className="character-relation-list">
        {relations.map((relation) => {
          const other = workspace.characters.find((item) => item.id === (relation.fromCharacterId === character.id ? relation.toCharacterId : relation.fromCharacterId));
          return (
            <article
              className="character-relation-card clickable"
              key={relation.id}
              role="button"
              tabIndex={0}
              onClick={() => onEdit(relation.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEdit(relation.id);
                }
              }}
              title="Otwórz relację"
            >
              <div>
                <strong>{other?.name ?? "Postać"} <span>{relation.relationType}</span></strong>
                <p>{relation.description || relation.opinion || "Brak opisu relacji."}</p>
              </div>
              <div className="relation-trust"><span style={{ width: `${relation.trustLevel}%` }} /></div>
              <div className="button-row">
                <button
                  type="button"
                  className="icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(relation.id);
                  }}
                  title="Usuń tylko relację"
                  aria-label="Usuń tylko relację"
                >
                  <Minus size={14} />
                </button>
              </div>
            </article>
          );
        })}
        {relations.length === 0 ? <p className="character-empty">Brak relacji tej postaci.</p> : null}
      </div>
    </section>
  );
}

function MemoriesSection({ character, workspace, onCreate, onGenerate, onEdit, onDelete, onCreateLink, onEditLink, onDeleteLink }: {
  character: Character | null;
  workspace: CharacterWorkspace;
  onCreate: () => void;
  onGenerate: () => void;
  onEdit: (memoryId: string) => void;
  onDelete: (memoryId: string) => void;
  onCreateLink: (memoryId: string) => void;
  onEditLink: (linkId: string) => void;
  onDeleteLink: (linkId: string) => void;
}) {
  if (!character) {
    return <PanelEmpty icon={<Brain size={22} />} text="Zapisz postać, aby dodawać wspomnienia." />;
  }
  const memories = workspace.memories.filter((memory) => memory.characterId === character.id);
  return (
    <section className="character-section">
      <SectionHeading
        title="Wspomnienia"
        icon={<Brain size={18} />}
        actionLabel="Dodaj wspomnienie"
        onAction={onCreate}
        aiActionLabel="AI wspomnienie"
        onAiAction={onGenerate}
        aiActionTitle="Wygeneruj szkic wspomnienia z AI"
      />
      <div className="memory-grid">
        {memories.map((memory) => {
          const links = linksForMemory(workspace, memory.id);
          return (
            <article className="memory-card" key={memory.id}>
              <div className="memory-card-heading">
                <strong>{memory.title}</strong>
                <span>{memory.importance}</span>
              </div>
              <p>{memory.summary || memory.details || "Brak opisu."}</p>
              <small>{[memory.memoryType, memory.subject, memory.emotion].filter(Boolean).join(" / ")}</small>
              <div className="memory-link-row">
                {links.map((link) => (
                  <span className="memory-link-chip" key={link.id} title={link.description}>
                    <Network size={12} />
                    {link.strength}
                    <button type="button" onClick={() => onEditLink(link.id)} title="Edytuj połączenie" aria-label="Edytuj połączenie"><Link2 size={11} /></button>
                    <button type="button" onClick={() => onDeleteLink(link.id)} title="Usuń połączenie" aria-label="Usuń połączenie"><Minus size={11} /></button>
                  </span>
                ))}
              </div>
              <div className="button-row">
                <button type="button" className="ghost-button" onClick={() => onEdit(memory.id)}>Edytuj</button>
                <button type="button" className="ghost-button" onClick={() => onCreateLink(memory.id)}><Plus size={14} /> Połącz</button>
                <button type="button" className="icon-button" onClick={() => onDelete(memory.id)} title="Usuń wspomnienie" aria-label="Usuń wspomnienie"><Trash2 size={14} /></button>
              </div>
            </article>
          );
        })}
        {memories.length === 0 ? <p className="character-empty">Brak wspomnień tej postaci.</p> : null}
      </div>
    </section>
  );
}

function CharacterImageSection({ character, image, onGenerate }: {
  character: Character | null;
  image: VisualAsset | null;
  onGenerate: () => void;
}) {
  if (!character) {
    return <PanelEmpty icon={<Camera size={22} />} text="Zapisz postać, aby wygenerować obraz." />;
  }
  return (
    <section className="character-image-section">
      <div className="character-image-preview">
        {image ? <img src={coverImageSource(image.filePath)} alt={`Obraz postaci ${character.name}`} /> : <UserRound size={54} />}
      </div>
      <div>
        <p className="eyebrow">Obraz referencyjny</p>
        <h3>{character.name}</h3>
        <p className="muted-text">{character.visualPrompt || "Prompt obrazu powstanie z profilu postaci i kontekstu książki."}</p>
        <button type="button" className="primary-button" onClick={onGenerate}>
          <Camera size={16} />
          Generuj obraz
        </button>
      </div>
    </section>
  );
}

function RelationModal({ state, workspace, onClose, onSubmit, onGenerate, onActivate }: {
  state: RelationModalState;
  workspace: CharacterWorkspace;
  onClose: () => void;
  onSubmit: (input: UpsertCharacterRelationInput) => void;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onActivate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
}) {
  const existing = state.mode === "edit" ? workspace.relations.find((item) => item.id === state.relationId) : null;
  const [draft, setDraft] = useState<UpsertCharacterRelationInput>(() => relationToInput(existing, state, workspace));
  const target = existing ?? relationPreview(draft);
  useDraftRegistration(characterEntityId(target), (field, value) => {
    setDraft((current) => applyRelationValue(current, field, value));
    return true;
  });
  return (
    <PortalModal title={existing ? "Edytuj relację" : "Dodaj relację"} eyebrow="Relacja postaci" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
        <label className="field-label">Postać docelowa
          <select value={draft.toCharacterId} onChange={(event) => setDraft({ ...draft, toCharacterId: event.target.value })}>
            <option value="">Wybierz postać</option>
            {workspace.characters.filter((item) => item.id !== draft.fromCharacterId).map((character) => (
              <option key={character.id} value={character.id}>{character.name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">Typ relacji
          <select value={draft.relationType} onChange={(event) => setDraft({ ...draft, relationType: event.target.value })}>
            {relationTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <ModalAiField field="relationDescription" value={draft.description} target={target} onChange={(value) => setDraft({ ...draft, description: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="relationHistory" value={draft.history} target={target} onChange={(value) => setDraft({ ...draft, history: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="relationConflict" value={draft.conflict} target={target} onChange={(value) => setDraft({ ...draft, conflict: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="relationOpinion" value={draft.opinion} target={target} onChange={(value) => setDraft({ ...draft, opinion: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <label className="field-label">Zaufanie
          <input type="range" min={0} max={100} value={draft.trustLevel} onChange={(event) => setDraft({ ...draft, trustLevel: Number(event.target.value) })} />
        </label>
        <ModalAiField field="relationSecret" value={draft.secret} target={target} onChange={(value) => setDraft({ ...draft, secret: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="relationChangeOverTime" value={draft.changeOverTime} target={target} onChange={(value) => setDraft({ ...draft, changeOverTime: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalFooter onClose={onClose} />
      </form>
    </PortalModal>
  );
}

function MemoryModal({ state, workspace, onClose, onSubmit, onGenerate, onActivate }: {
  state: MemoryModalState;
  workspace: CharacterWorkspace;
  onClose: () => void;
  onSubmit: (input: UpsertCharacterMemoryInput) => void;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onActivate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
}) {
  const existing = state.mode === "edit" ? workspace.memories.find((item) => item.id === state.memoryId) : null;
  const [draft, setDraft] = useState<UpsertCharacterMemoryInput>(() => memoryToInput(existing, state, workspace));
  const target = existing ?? memoryPreview(draft);
  useDraftRegistration(characterEntityId(target), (field, value) => {
    setDraft((current) => applyMemoryValue(current, field, value));
    return true;
  });
  return (
    <PortalModal title={existing ? "Edytuj wspomnienie" : "Dodaj wspomnienie"} eyebrow="Pamięć postaci" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
        <ModalAiField field="memoryTitle" value={draft.title} target={target} onChange={(value) => setDraft({ ...draft, title: value })} onGenerate={onGenerate} onActivate={onActivate} rows={1} />
        <label className="field-label">Typ wspomnienia
          <select value={draft.memoryType} onChange={(event) => setDraft({ ...draft, memoryType: event.target.value })}>
            {memoryTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <ModalAiField field="memorySummary" value={draft.summary} target={target} onChange={(value) => setDraft({ ...draft, summary: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="memoryDetails" value={draft.details} target={target} onChange={(value) => setDraft({ ...draft, details: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <ModalAiField field="memorySubject" value={draft.subject} target={target} onChange={(value) => setDraft({ ...draft, subject: value })} onGenerate={onGenerate} onActivate={onActivate} rows={1} />
        <ModalAiField field="memoryEmotion" value={draft.emotion} target={target} onChange={(value) => setDraft({ ...draft, emotion: value })} onGenerate={onGenerate} onActivate={onActivate} rows={1} />
        <label className="field-label">Ważność
          <input type="range" min={0} max={100} value={draft.importance} onChange={(event) => setDraft({ ...draft, importance: Number(event.target.value) })} />
        </label>
        <ModalFooter onClose={onClose} />
      </form>
    </PortalModal>
  );
}

function MemoryLinkModal({ state, workspace, onClose, onSubmit, onGenerate, onActivate }: {
  state: MemoryLinkModalState;
  workspace: CharacterWorkspace;
  onClose: () => void;
  onSubmit: (input: UpsertCharacterMemoryLinkInput) => void;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onActivate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
}) {
  const existing = state.mode === "edit" ? workspace.memoryLinks.find((item) => item.id === state.linkId) : null;
  const [draft, setDraft] = useState<UpsertCharacterMemoryLinkInput>(() => memoryLinkToInput(existing, state, workspace));
  const target = existing ?? memoryLinkPreview(draft);
  useDraftRegistration(characterEntityId(target), (field, value) => {
    setDraft((current) => field === "memoryLinkDescription" ? { ...current, description: value } : current);
    return true;
  });
  return (
    <PortalModal title={existing ? "Edytuj połączenie" : "Połącz wspomnienia"} eyebrow="Sieć wspomnień" onClose={onClose} small>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
        <label className="field-label">Drugie wspomnienie
          <select value={draft.toMemoryId} onChange={(event) => setDraft({ ...draft, toMemoryId: event.target.value })}>
            <option value="">Wybierz wspomnienie</option>
            {workspace.memories.filter((memory) => memory.id !== draft.fromMemoryId).map((memory) => (
              <option key={memory.id} value={memory.id}>{memory.title}</option>
            ))}
          </select>
        </label>
        <label className="field-label">Typ połączenia
          <input value={draft.linkType} onChange={(event) => setDraft({ ...draft, linkType: event.target.value })} />
        </label>
        <ModalAiField field="memoryLinkDescription" value={draft.description} target={target} onChange={(value) => setDraft({ ...draft, description: value })} onGenerate={onGenerate} onActivate={onActivate} />
        <label className="field-label">Siła
          <input type="range" min={0} max={100} value={draft.strength} onChange={(event) => setDraft({ ...draft, strength: Number(event.target.value) })} />
        </label>
        <ModalFooter onClose={onClose} />
      </form>
    </PortalModal>
  );
}

function ModalAiField({ field, value, rows = 3, target, onChange, onGenerate, onActivate }: {
  field: CharacterFieldKey;
  value: string;
  rows?: number;
  target: CharacterPromptEntity;
  onChange: (value: string) => void;
  onGenerate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
  onActivate: (field: CharacterFieldKey, target?: CharacterPromptEntity) => void;
}) {
  return (
    <div className="field-shell character-field wide" onFocusCapture={(event) => isEditablePromptTarget(event.target) && onActivate(field, target)} onClick={(event) => isEditablePromptTarget(event.target) && onActivate(field, target)}>
      <div className="field-heading">
        <span className="field-label-text">{characterFieldConfigs[field].label}</span>
        <AiActions field={field} target={target} disabled={false} addDisabled={false} onGenerate={onGenerate} onAddContext={() => useAiPromptContextStore.getState().addContextSourceToActiveTarget(characterPromptContextSource(field, target))} />
      </div>
      {rows === 1 ? <input value={value} onChange={(event) => onChange(event.target.value)} /> : <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} />}
    </div>
  );
}

function PortalModal({ title, eyebrow, small, children, onClose }: {
  title: string;
  eyebrow: string;
  small?: boolean;
  children: ReactNode;
  onClose: () => void;
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

  const content = (
    <div className="character-modal" role="dialog" aria-modal="true" aria-labelledby="character-modal-title">
      <button type="button" className="character-modal-backdrop" onClick={onClose} aria-label="Zamknij modal" />
      <section className={small ? "character-modal-shell small" : "character-modal-shell"}>
        <header className="character-modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3 id="character-modal-title">{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Zamknij" aria-label="Zamknij">
            <X size={16} />
          </button>
        </header>
        <div className="character-modal-body">{children}</div>
      </section>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function ModalFooter({ onClose }: { onClose: () => void }) {
  return (
    <footer className="character-modal-footer">
      <button type="button" className="ghost-button" onClick={onClose}>Anuluj</button>
      <button type="submit" className="primary-button"><Save size={15} /> Zapisz</button>
    </footer>
  );
}

function SectionHeading({ title, icon, actionLabel, onAction, aiActionLabel, onAiAction, aiActionDisabled, aiActionTitle }: {
  title: string;
  icon: ReactNode;
  actionLabel: string;
  onAction: () => void;
  aiActionLabel?: string;
  onAiAction?: () => void;
  aiActionDisabled?: boolean;
  aiActionTitle?: string;
}) {
  return (
    <div className="character-section-heading">
      <h3>{icon}{title}</h3>
      <div className="button-row">
        {onAiAction ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onAiAction}
            disabled={aiActionDisabled}
            title={aiActionTitle}
            aria-label={aiActionLabel}
          >
            <Sparkles size={15} />
            {aiActionLabel}
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={onAction}>
          <Plus size={15} />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function PanelEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="character-panel-empty">{icon}<p>{text}</p></div>;
}

function useDraftRegistration(targetId: string, applier: (field: CharacterFieldKey, value: string) => boolean) {
  useEffect(() => {
    registerCharacterDraftFieldTarget(targetId, applier);
    return () => unregisterCharacterDraftFieldTarget(targetId);
  }, [targetId, applier]);
}

function emptyWorkspace(): CharacterWorkspace {
  return { characters: [], relations: [], memories: [], memoryLinks: [], visualAssets: [] };
}

function emptyCharacterInput(projectId: string, orderIndex: number): UpsertCharacterInput {
  return {
    projectId,
    characterType: "person",
    name: "",
    aliasesJson: "[]",
    role: "",
    shortDescription: "",
    externalGoal: "",
    internalNeed: "",
    wound: "",
    falseBelief: "",
    secret: "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    voiceNotes: "",
    arcSummary: "",
    knowledgeNotes: "",
    visualPrompt: "",
    imageAssetId: null,
    status: "draft",
    orderIndex
  };
}

function characterToInput(character: Character): UpsertCharacterInput {
  return {
    id: character.id,
    projectId: character.projectId,
    characterType: character.characterType,
    name: character.name,
    aliasesJson: character.aliasesJson,
    role: character.role,
    shortDescription: character.shortDescription,
    externalGoal: character.externalGoal,
    internalNeed: character.internalNeed,
    wound: character.wound,
    falseBelief: character.falseBelief,
    secret: character.secret,
    strengthsJson: character.strengthsJson,
    weaknessesJson: character.weaknessesJson,
    voiceNotes: character.voiceNotes,
    arcSummary: character.arcSummary,
    knowledgeNotes: character.knowledgeNotes,
    visualPrompt: character.visualPrompt,
    imageAssetId: character.imageAssetId,
    status: character.status,
    orderIndex: character.orderIndex
  };
}

function draftCharacterPreview(input: UpsertCharacterInput): Character {
  const now = new Date().toISOString();
  return {
    id: input.id ?? "new-character",
    projectId: input.projectId,
    characterType: input.characterType,
    name: input.name,
    aliasesJson: input.aliasesJson,
    role: input.role,
    shortDescription: input.shortDescription,
    externalGoal: input.externalGoal,
    internalNeed: input.internalNeed,
    wound: input.wound,
    falseBelief: input.falseBelief,
    secret: input.secret,
    strengthsJson: input.strengthsJson,
    weaknessesJson: input.weaknessesJson,
    voiceNotes: input.voiceNotes,
    arcSummary: input.arcSummary,
    knowledgeNotes: input.knowledgeNotes,
    visualPrompt: input.visualPrompt,
    imageAssetId: input.imageAssetId ?? null,
    status: input.status,
    orderIndex: input.orderIndex,
    createdAt: now,
    updatedAt: now
  };
}

function applyCharacterValue(input: UpsertCharacterInput, field: CharacterFieldKey, value: string): UpsertCharacterInput {
  if (field === "characterProfile") {
    return applyCharacterProfileValue(input, value);
  }

  const keyMap: Partial<Record<CharacterFieldKey, keyof UpsertCharacterInput>> = Object.fromEntries(
    characterFields.map((fieldItem) => [fieldItem.field, fieldItem.key])
  ) as Partial<Record<CharacterFieldKey, keyof UpsertCharacterInput>>;
  const key = keyMap[field];
  return key ? { ...input, [key]: value } : input;
}

function applyCharacterProfileValue(input: UpsertCharacterInput, value: string): UpsertCharacterInput {
  try {
    const parsed = JSON.parse(value) as {
      character?: Record<string, unknown>;
    };
    const character = parsed.character ?? {};
    return {
      ...input,
      characterType: stringValue(character.characterType, input.characterType),
      name: stringValue(character.name, input.name),
      aliasesJson: arrayJsonValue(character.aliases, input.aliasesJson),
      role: stringValue(character.role, input.role),
      shortDescription: stringValue(character.shortDescription, input.shortDescription),
      externalGoal: stringValue(character.externalGoal, input.externalGoal),
      internalNeed: stringValue(character.internalNeed, input.internalNeed),
      wound: stringValue(character.wound, input.wound),
      falseBelief: stringValue(character.falseBelief, input.falseBelief),
      secret: stringValue(character.secret, input.secret),
      strengthsJson: arrayJsonValue(character.strengths, input.strengthsJson),
      weaknessesJson: arrayJsonValue(character.weaknesses, input.weaknessesJson),
      voiceNotes: stringValue(character.voiceNotes, input.voiceNotes),
      arcSummary: stringValue(character.arcSummary, input.arcSummary),
      knowledgeNotes: stringValue(character.knowledgeNotes, input.knowledgeNotes),
      visualPrompt: stringValue(character.visualPrompt, input.visualPrompt)
    };
  } catch {
    return {
      ...input,
      shortDescription: value
    };
  }
}

function relationsForCharacter(workspace: CharacterWorkspace, characterId: string): CharacterRelation[] {
  return workspace.relations.filter((relation) => relation.fromCharacterId === characterId || relation.toCharacterId === characterId);
}

function linksForMemory(workspace: CharacterWorkspace, memoryId: string): CharacterMemoryLink[] {
  return workspace.memoryLinks.filter((link) => link.fromMemoryId === memoryId || link.toMemoryId === memoryId);
}

function assetForCharacter(workspace: CharacterWorkspace, character: Character): VisualAsset | null {
  return workspace.visualAssets.find((asset) => asset.id === character.imageAssetId) ??
    workspace.visualAssets.find((asset) => asset.relatedType === "character" && asset.relatedId === character.id && asset.status === "canon") ??
    null;
}

function relationToInput(existing: CharacterRelation | null | undefined, state: RelationModalState, workspace: CharacterWorkspace): UpsertCharacterRelationInput {
  if (existing) {
    return { ...existing };
  }
  const fromCharacterId = (state as { fromCharacterId: string }).fromCharacterId;
  const fromCharacter = workspace.characters.find((item) => item.id === fromCharacterId);
  const firstOther = workspace.characters.find((item) => item.id !== fromCharacterId);
  return {
    projectId: fromCharacter?.projectId ?? "",
    fromCharacterId,
    toCharacterId: firstOther?.id ?? "",
    relationType: "inne",
    description: "",
    history: "",
    conflict: "",
    opinion: "",
    trustLevel: 50,
    secret: "",
    changeOverTime: "",
    status: "draft"
  };
}

function relationPreview(input: UpsertCharacterRelationInput): CharacterRelation {
  const now = new Date().toISOString();
  return { id: input.id ?? "new-relation", createdAt: now, updatedAt: now, ...input };
}

function applyRelationValue(input: UpsertCharacterRelationInput, field: CharacterFieldKey, value: string): UpsertCharacterRelationInput {
  if (field === "characterRelation") {
    return applyCharacterRelationValue(input, value);
  }

  const map: Partial<Record<CharacterFieldKey, keyof UpsertCharacterRelationInput>> = {
    relationDescription: "description",
    relationHistory: "history",
    relationConflict: "conflict",
    relationOpinion: "opinion",
    relationSecret: "secret",
    relationChangeOverTime: "changeOverTime"
  };
  const key = map[field];
  return key ? { ...input, [key]: value } : input;
}

function applyCharacterRelationValue(input: UpsertCharacterRelationInput, value: string): UpsertCharacterRelationInput {
  try {
    const parsed = JSON.parse(value) as {
      relation?: Record<string, unknown>;
    };
    const relation = parsed.relation ?? {};
    return {
      ...input,
      relationType: stringValue(relation.relationType, input.relationType),
      description: stringValue(relation.description, input.description),
      history: stringValue(relation.history, input.history),
      conflict: stringValue(relation.conflict, input.conflict),
      opinion: stringValue(relation.opinion, input.opinion),
      trustLevel: numberValue(relation.trustLevel, input.trustLevel),
      secret: stringValue(relation.secret, input.secret),
      changeOverTime: stringValue(relation.changeOverTime, input.changeOverTime)
    };
  } catch {
    return {
      ...input,
      description: value
    };
  }
}

function memoryToInput(existing: CharacterMemory | null | undefined, state: MemoryModalState, workspace?: CharacterWorkspace): UpsertCharacterMemoryInput {
  if (existing) {
    return { ...existing };
  }
  const characterId = (state as { characterId: string }).characterId;
  const character = workspace?.characters.find((item) => item.id === characterId);
  return {
    projectId: character?.projectId ?? "",
    characterId,
    title: "",
    summary: "",
    details: "",
    memoryType: "wydarzenie",
    subject: "",
    emotion: "",
    importance: 50,
    status: "draft"
  };
}

function memoryPreview(input: UpsertCharacterMemoryInput): CharacterMemory {
  const now = new Date().toISOString();
  return { id: input.id ?? "new-memory", createdAt: now, updatedAt: now, ...input };
}

function applyMemoryValue(input: UpsertCharacterMemoryInput, field: CharacterFieldKey, value: string): UpsertCharacterMemoryInput {
  if (field === "characterMemory") {
    return applyCharacterMemoryValue(input, value);
  }

  const map: Partial<Record<CharacterFieldKey, keyof UpsertCharacterMemoryInput>> = {
    memoryTitle: "title",
    memorySummary: "summary",
    memoryDetails: "details",
    memorySubject: "subject",
    memoryEmotion: "emotion"
  };
  const key = map[field];
  return key ? { ...input, [key]: value } : input;
}

function applyCharacterMemoryValue(input: UpsertCharacterMemoryInput, value: string): UpsertCharacterMemoryInput {
  try {
    const parsed = JSON.parse(value) as {
      memory?: Record<string, unknown>;
    };
    const memory = parsed.memory ?? {};
    return {
      ...input,
      title: stringValue(memory.title, input.title),
      summary: stringValue(memory.summary, input.summary),
      details: stringValue(memory.details, input.details),
      memoryType: stringValue(memory.memoryType, input.memoryType),
      subject: stringValue(memory.subject, input.subject),
      emotion: stringValue(memory.emotion, input.emotion),
      importance: numberValue(memory.importance, input.importance)
    };
  } catch {
    return {
      ...input,
      summary: value
    };
  }
}

function memoryLinkToInput(existing: CharacterMemoryLink | null | undefined, state: MemoryLinkModalState, workspace: CharacterWorkspace): UpsertCharacterMemoryLinkInput {
  if (existing) {
    return { ...existing };
  }
  const fromMemoryId = (state as { fromMemoryId: string }).fromMemoryId;
  const other = workspace.memories.find((memory) => memory.id !== fromMemoryId);
  const projectId = workspace.memories.find((memory) => memory.id === fromMemoryId)?.projectId ?? "";
  return {
    projectId,
    fromMemoryId,
    toMemoryId: other?.id ?? "",
    linkType: "association",
    description: "",
    strength: 50
  };
}

function memoryLinkPreview(input: UpsertCharacterMemoryLinkInput): CharacterMemoryLink {
  const now = new Date().toISOString();
  return { id: input.id ?? "new-memory-link", createdAt: now, updatedAt: now, ...input };
}

function serializeListInput(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
  } catch {
    return JSON.stringify([...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))]);
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function arrayJsonValue(value: unknown, fallback: string): string {
  return Array.isArray(value)
    ? JSON.stringify(value.filter((item): item is string => typeof item === "string"))
    : fallback;
}

function listDisplay(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(", ") : value;
  } catch {
    return value;
  }
}

function typeLabel(value: string): string {
  return characterTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function isEditablePromptTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
