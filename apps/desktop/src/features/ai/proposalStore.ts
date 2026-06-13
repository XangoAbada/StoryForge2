import { create } from "zustand";
import { upsertAiProposalSnapshot } from "../../shared/api/commands";
import type { AIAction, AiProposalRecord } from "../../shared/api/types";
import type { NormalizedConceptFieldSuggestion } from "./conceptFieldSuggestion";
import type { NormalizedPremiseDevelopment } from "./premiseDevelopment";
import type { CoverPromptPackage } from "./coverPromptPackage";
import type {
  ConceptFieldKey,
  NewProjectTitlePromptPackage,
  PromptPackage
} from "./promptPackage";
import type { PlanFieldKey, PlanPromptPackage } from "./planPromptPackage";
import type {
  CharacterFieldKey,
  CharacterPromptPackage
} from "./characterPromptPackage";
import type {
  WorldFieldKey,
  WorldPromptPackage
} from "./worldPromptPackage";
import type {
  SceneEditorFieldKey,
  SceneEditorPromptPackage
} from "./sceneEditorPromptPackage";
import {
  SCENE_STORY_BIBLE_AUDIT_FIELD,
  type NormalizedSceneStoryBibleAudit,
  type SceneStoryBibleAuditPromptPackage
} from "./sceneStoryBibleAuditPromptPackage";

export type AiProposalStatus = "queued" | "running" | "success" | "error";
export type PendingAiProposalStatus = Extract<
  AiProposalStatus,
  "queued" | "running"
> | null;
export type AiProposalScope =
  | "bookConcept"
  | "newProject"
  | "bookCover"
  | "bookPlan"
  | "characters"
  | "world"
  | "sceneEditor";
export const BOOK_COVER_FIELD = "__book_cover__";
export const CHARACTER_IMAGE_FIELD = "__character_image__";
export const NEW_PROJECT_PROPOSAL_ID = "__new_project__";
export type AiTaskFieldKey =
  | ConceptFieldKey
  | PlanFieldKey
  | CharacterFieldKey
  | WorldFieldKey
  | SceneEditorFieldKey
  | typeof BOOK_COVER_FIELD
  | typeof CHARACTER_IMAGE_FIELD
  | typeof SCENE_STORY_BIBLE_AUDIT_FIELD;
export type ParsedAiProposal =
  | NormalizedConceptFieldSuggestion
  | NormalizedPremiseDevelopment
  | NormalizedPlanSuggestion
  | NormalizedSceneStoryBibleAudit;

export type NormalizedPlanSuggestion = {
  kind: "book_plan_suggestion";
  summary: string;
  textValue: string;
  value: unknown;
  warnings: string[];
};

export type AiPromptSnapshot = {
  scope?: AiProposalScope;
  projectId: string;
  bookId: string;
  field: AiTaskFieldKey;
  action: AIAction;
  promptPackageId: string;
  promptPackageJson:
    | PromptPackage
    | NewProjectTitlePromptPackage
    | CoverPromptPackage
    | PlanPromptPackage
    | CharacterPromptPackage
    | WorldPromptPackage
    | SceneEditorPromptPackage
    | SceneStoryBibleAuditPromptPackage;
  prompt: string;
  coverPrompt?: string;
  coverNegativePrompt?: string;
};

export type ActiveAiProposal = AiPromptSnapshot & {
  id: string;
  status: AiProposalStatus;
  aiRunId?: string;
  rawOutput: string;
  parsed?: ParsedAiProposal;
  editableValue: string;
  editableFields: Partial<Record<ConceptFieldKey, string>>;
  selectedFields: Partial<Record<ConceptFieldKey, boolean>>;
  errorMessage: string;
  durationMs?: number;
  coverImagePath?: string;
  coverGeneratedAt?: string;
  characterImagePath?: string;
  characterGeneratedAt?: string;
  progressMessage?: string;
  progress?: number | null;
  partialImageDataUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiProposalTarget = {
  projectId?: string;
  bookId?: string;
  field?: AiTaskFieldKey;
  action?: AIAction;
  scope?: AiProposalScope;
  targetEntityId?: string;
};

type ProposalResult = Pick<
  ActiveAiProposal,
  "aiRunId" | "rawOutput" | "parsed" | "editableValue" | "durationMs"
> &
  Partial<
    Pick<
      ActiveAiProposal,
      | "editableFields"
      | "selectedFields"
      | "coverImagePath"
      | "coverGeneratedAt"
      | "characterImagePath"
      | "characterGeneratedAt"
      | "progressMessage"
      | "progress"
      | "partialImageDataUrl"
    >
  >;

type ProposalProgress = Partial<
  Pick<
    ActiveAiProposal,
    "progressMessage" | "progress" | "partialImageDataUrl"
  >
>;

type ProposalState = {
  proposals: ActiveAiProposal[];
  activeProposal: ActiveAiProposal | null;
  enqueueProposal: (snapshot: AiPromptSnapshot) => string;
  startProposal: (snapshot: AiPromptSnapshot) => void;
  startQueuedProposal: (id: string) => void;
  finishProposal: (id: string, result: ProposalResult) => void;
  failProposal: (id: string, errorMessage: string, rawOutput?: string) => void;
  updateProposalProgress: (id: string, progress: ProposalProgress) => void;
  retryProposal: (id: string) => void;
  setEditableValue: (id: string, value: string) => void;
  setEditableField: (id: string, field: ConceptFieldKey, value: string) => void;
  toggleSelectedField: (id: string, field: ConceptFieldKey) => void;
  hydratePersistentProposals: (records: AiProposalRecord[]) => void;
  clearProposal: (id: string) => void;
  clearAllProposals: () => void;
};

export const useProposalStore = create<ProposalState>((set) => ({
  proposals: [],
  activeProposal: null,
  enqueueProposal: (snapshot) => {
    const existing = findActiveDuplicate(useProposalStore.getState().proposals, snapshot);
    if (existing) {
      return existing.id;
    }

    const now = new Date().toISOString();
    const proposal: ActiveAiProposal = {
      ...snapshot,
      id: createProposalId(snapshot.action),
      status: "queued",
      rawOutput: "",
      editableValue: "",
      editableFields: {},
      selectedFields: {},
      errorMessage: "",
      createdAt: now,
      updatedAt: now
    };

    set((state) => syncActive({ proposals: [...state.proposals, proposal] }));
    persistProposalSnapshot(proposal);
    return proposal.id;
  },
  startProposal: (snapshot) => {
    const now = new Date().toISOString();
    const proposal: ActiveAiProposal = {
      ...snapshot,
      id: createProposalId(snapshot.action),
      status: "running",
      rawOutput: "",
      editableValue: "",
      editableFields: {},
      selectedFields: {},
      errorMessage: "",
      createdAt: now,
      updatedAt: now
    };

    set((state) => syncActive({ proposals: [...state.proposals, proposal] }));
    persistProposalSnapshot(proposal);
  },
  startQueuedProposal: (id) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                status: "running",
                errorMessage: "",
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  finishProposal: (id, result) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                ...result,
                status: "success",
                errorMessage: "",
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  failProposal: (id, errorMessage, rawOutput = "") => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                status: "error",
                rawOutput,
                errorMessage,
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  updateProposalProgress: (id, progress) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                ...progress,
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  retryProposal: (id) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                status: "queued",
                aiRunId: undefined,
                rawOutput: "",
                parsed: undefined,
                editableValue: "",
                editableFields: {},
                selectedFields: {},
                errorMessage: "",
                durationMs: undefined,
                coverImagePath: undefined,
                coverGeneratedAt: undefined,
                characterImagePath: undefined,
                characterGeneratedAt: undefined,
                progressMessage: undefined,
                progress: undefined,
                partialImageDataUrl: undefined,
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  setEditableValue: (id, editableValue) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                editableValue,
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  setEditableField: (id, field, value) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                editableFields: {
                  ...proposal.editableFields,
                  [field]: value
                },
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  toggleSelectedField: (id, field) => {
    let updated: ActiveAiProposal | undefined;
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? (updated = {
                ...proposal,
                selectedFields: {
                  ...proposal.selectedFields,
                  [field]: !proposal.selectedFields[field]
                },
                updatedAt: new Date().toISOString()
              })
            : proposal
        )
      })
    );
    persistProposalSnapshot(updated);
  },
  hydratePersistentProposals: (records) =>
    set((state) => {
      const existingIds = new Set(state.proposals.map((proposal) => proposal.id));
      const hydrated = records
        .map((record) => activeProposalFromRecord(record))
        .filter((proposal): proposal is ActiveAiProposal => Boolean(proposal))
        .filter((proposal) => !existingIds.has(proposal.id));

      return syncActive({ proposals: [...state.proposals, ...hydrated] });
    }),
  clearProposal: (id) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.filter((proposal) => proposal.id !== id)
      })
    ),
  clearAllProposals: () => set({ proposals: [], activeProposal: null })
}));

export function pendingProposalStatus(
  proposals: ActiveAiProposal[],
  target: AiProposalTarget
): PendingAiProposalStatus {
  const pendingProposals = proposals.filter(
    (
      proposal
    ): proposal is ActiveAiProposal & { status: "queued" | "running" } =>
      isPendingProposal(proposal) && proposalMatchesTarget(proposal, target)
  );
  const running = pendingProposals.find(
    (proposal) => proposal.status === "running"
  );

  return running?.status ?? pendingProposals[0]?.status ?? null;
}

export function useAiProposalTargetStatus(
  target: AiProposalTarget
): PendingAiProposalStatus {
  return useProposalStore((state) => pendingProposalStatus(state.proposals, target));
}

function findActiveDuplicate(
  proposals: ActiveAiProposal[],
  snapshot: AiPromptSnapshot
): ActiveAiProposal | undefined {
  return proposals.find(
    (proposal) =>
      isPendingProposal(proposal) &&
      proposalMatchesTarget(proposal, {
        projectId: snapshot.projectId,
        bookId: snapshot.bookId,
        field: snapshot.field,
        action: snapshot.action,
        scope: snapshot.scope ?? "bookConcept",
        targetEntityId: promptPackageTargetEntityId(snapshot.promptPackageJson)
      })
  );
}

function isPendingProposal(
  proposal: ActiveAiProposal
): proposal is ActiveAiProposal & { status: "queued" | "running" } {
  return proposal.status === "queued" || proposal.status === "running";
}

function proposalMatchesTarget(
  proposal: ActiveAiProposal,
  target: AiProposalTarget
): boolean {
  const proposalScope = proposal.scope ?? "bookConcept";

  return (
    (target.projectId === undefined || proposal.projectId === target.projectId) &&
    (target.bookId === undefined || proposal.bookId === target.bookId) &&
    (target.field === undefined || proposal.field === target.field) &&
    (target.action === undefined || proposal.action === target.action) &&
    (target.scope === undefined || proposalScope === target.scope) &&
    (target.targetEntityId === undefined ||
      promptPackageTargetEntityId(proposal.promptPackageJson) === target.targetEntityId)
  );
}

function promptPackageTargetEntityId(
  promptPackageJson: ActiveAiProposal["promptPackageJson"]
): string | undefined {
  if (
    promptPackageJson &&
    typeof promptPackageJson === "object" &&
    "context" in promptPackageJson
  ) {
    const context = promptPackageJson.context;
    if (
      context &&
      typeof context === "object" &&
      "targetEntityId" in context &&
      typeof context.targetEntityId === "string"
    ) {
      return context.targetEntityId;
    }
  }

  return undefined;
}

function syncActive(
  state: Pick<ProposalState, "proposals">
): Pick<ProposalState, "proposals" | "activeProposal"> {
  return {
    proposals: state.proposals,
    activeProposal:
      state.proposals.find((proposal) => proposal.status === "running") ??
      state.proposals.find((proposal) => proposal.status === "queued") ??
      state.proposals.find((proposal) => proposal.status === "success") ??
      state.proposals.find((proposal) => proposal.status === "error") ??
      null
  };
}

function createProposalId(action: AIAction): string {
  if ("randomUUID" in crypto) {
    return `${action}:${crypto.randomUUID()}`;
  }

  return `${action}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function persistProposalSnapshot(proposal: ActiveAiProposal | undefined): void {
  if (!proposal) {
    return;
  }

  void upsertAiProposalSnapshot({
    id: proposal.id,
    aiRunId: proposal.aiRunId ?? null,
    projectId: proposal.projectId,
    proposalType: proposal.scope ?? "bookConcept",
    payloadJson: proposal,
    status: proposal.status
  }).catch(() => undefined);
}

function activeProposalFromRecord(record: AiProposalRecord): ActiveAiProposal | null {
  if (
    record.status === "running" ||
    record.status === "terminated" ||
    record.decisionStatus !== "pending" ||
    !record.payloadJson ||
    typeof record.payloadJson !== "object"
  ) {
    return null;
  }

  const proposal = record.payloadJson as ActiveAiProposal;
  if (
    !proposal.id ||
    !proposal.projectId ||
    !proposal.bookId ||
    !proposal.field ||
    !proposal.action ||
    !proposal.promptPackageId ||
    !proposal.promptPackageJson ||
    !proposal.prompt
  ) {
    return null;
  }

  return {
    ...proposal,
    status: record.status as AiProposalStatus,
    aiRunId: record.aiRunId ?? proposal.aiRunId,
    updatedAt: record.updatedAt || proposal.updatedAt
  };
}
