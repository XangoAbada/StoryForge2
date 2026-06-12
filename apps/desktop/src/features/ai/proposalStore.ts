import { create } from "zustand";
import type { AIAction } from "../../shared/api/types";
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
  | "world";
export const BOOK_COVER_FIELD = "__book_cover__";
export const CHARACTER_IMAGE_FIELD = "__character_image__";
export const NEW_PROJECT_PROPOSAL_ID = "__new_project__";
export type AiTaskFieldKey =
  | ConceptFieldKey
  | PlanFieldKey
  | CharacterFieldKey
  | WorldFieldKey
  | typeof BOOK_COVER_FIELD
  | typeof CHARACTER_IMAGE_FIELD;
export type ParsedAiProposal =
  | NormalizedConceptFieldSuggestion
  | NormalizedPremiseDevelopment
  | NormalizedPlanSuggestion;

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
    | WorldPromptPackage;
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
  },
  startQueuedProposal: (id) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                status: "running",
                errorMessage: "",
                updatedAt: new Date().toISOString()
              }
            : proposal
        )
      })
    ),
  finishProposal: (id, result) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                ...result,
                status: "success",
                errorMessage: "",
                updatedAt: new Date().toISOString()
              }
            : proposal
        )
      })
    ),
  failProposal: (id, errorMessage, rawOutput = "") =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                status: "error",
                rawOutput,
                errorMessage,
                updatedAt: new Date().toISOString()
              }
            : proposal
        )
      })
    ),
  updateProposalProgress: (id, progress) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                ...progress,
                updatedAt: new Date().toISOString()
              }
            : proposal
        )
      })
    ),
  retryProposal: (id) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
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
              }
            : proposal
        )
      })
    ),
  setEditableValue: (id, editableValue) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id ? { ...proposal, editableValue } : proposal
        )
      })
    ),
  setEditableField: (id, field, value) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                editableFields: {
                  ...proposal.editableFields,
                  [field]: value
                }
              }
            : proposal
        )
      })
    ),
  toggleSelectedField: (id, field) =>
    set((state) =>
      syncActive({
        proposals: state.proposals.map((proposal) =>
          proposal.id === id
            ? {
                ...proposal,
                selectedFields: {
                  ...proposal.selectedFields,
                  [field]: !proposal.selectedFields[field]
                }
              }
            : proposal
        )
      })
    ),
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
