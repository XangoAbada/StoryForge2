import { create } from "zustand";
import {
  conceptFieldConfigs,
  conceptPromptContextSources,
  type ConceptFieldKey,
  type PromptContextControl,
  type PromptContextSource
} from "./promptPackage";

export type AiPromptContextTarget = {
  targetId: string;
  projectId?: string;
  title: string;
  subtitle: string;
  sources: PromptContextSource[];
  defaultSources: PromptContextSource[];
  submitLabel?: string;
  submitDisabled?: boolean;
  submitDisabledReason?: string;
  onSubmit?: () => void;
};

export type AiPromptContextDraft = {
  selectedContextKeys: Record<string, boolean>;
  authorPriorityComment: string;
};

type PromptContextTargetOptions = Pick<
  AiPromptContextTarget,
  "submitLabel" | "submitDisabled" | "submitDisabledReason" | "onSubmit"
>;

type AiPromptContextState = {
  activeTargetId: string | null;
  targets: Record<string, AiPromptContextTarget>;
  drafts: Record<string, AiPromptContextDraft>;
  activateTarget: (target: AiPromptContextTarget) => void;
  addContextSourceToActiveTarget: (source: PromptContextSource) => void;
  setAuthorPriorityComment: (targetId: string, comment: string) => void;
  toggleContextKey: (targetId: string, key: string) => void;
  resetDraft: (targetId: string) => void;
  submitActiveTarget: () => void;
  clearActiveTarget: () => void;
  closeTarget: (targetId: string) => void;
  closeActiveTarget: () => void;
};

export const NEW_PROJECT_TITLE_PROMPT_TARGET_ID =
  "dashboard:new-project-title";

export const useAiPromptContextStore = create<AiPromptContextState>((set, get) => ({
  activeTargetId: null,
  targets: {},
  drafts: {},
  activateTarget: (target) =>
    set((state) => {
      const defaultSources = target.defaultSources ?? target.sources;
      const currentTarget = state.targets[target.targetId];
      const manualSources =
        currentTarget?.sources.filter(
          (source) => !defaultSources.some((item) => item.key === source.key)
        ) ?? [];

      return {
        activeTargetId: target.targetId,
        targets: {
          ...state.targets,
          [target.targetId]: {
            ...target,
            defaultSources,
            sources: mergeContextSources(defaultSources, manualSources)
          }
        }
      };
    }),
  addContextSourceToActiveTarget: (source) =>
    set((state) => {
      const activeTargetId = state.activeTargetId;
      const target = activeTargetId ? state.targets[activeTargetId] : null;
      if (!activeTargetId || !target || hasContextSource(target.sources, source.key)) {
        return state;
      }

      const nextDraft = state.drafts[activeTargetId] ?? defaultDraft();
      const nextSelectedContextKeys = { ...nextDraft.selectedContextKeys };
      delete nextSelectedContextKeys[source.key];

      return {
        targets: {
          ...state.targets,
          [activeTargetId]: {
            ...target,
            sources: [...target.sources, { ...source, required: false }]
          }
        },
        drafts: {
          ...state.drafts,
          [activeTargetId]: {
            ...nextDraft,
            selectedContextKeys: nextSelectedContextKeys
          }
        }
      };
    }),
  setAuthorPriorityComment: (targetId, authorPriorityComment) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [targetId]: {
          ...defaultDraft(),
          ...(state.drafts[targetId] ?? {}),
          authorPriorityComment
        }
      }
    })),
  toggleContextKey: (targetId, key) =>
    set((state) => {
      const target = state.targets[targetId];
      const source = target?.sources.find((item) => item.key === key);
      if (!source || source.required) {
        return state;
      }

      const currentDraft = state.drafts[targetId] ?? defaultDraft();
      const currentSelected = currentDraft.selectedContextKeys[key] !== false;

      return {
        drafts: {
          ...state.drafts,
          [targetId]: {
            ...currentDraft,
            selectedContextKeys: {
              ...currentDraft.selectedContextKeys,
              [key]: !currentSelected
            }
          }
        }
      };
    }),
  resetDraft: (targetId) =>
    set((state) => {
      const nextDrafts = { ...state.drafts };
      const target = state.targets[targetId];
      delete nextDrafts[targetId];

      return {
        drafts: nextDrafts,
        targets: target
          ? {
              ...state.targets,
              [targetId]: {
                ...target,
                sources: target.defaultSources
              }
            }
          : state.targets
      };
    }),
  submitActiveTarget: () => {
    const state = get();
    const target = state.activeTargetId ? state.targets[state.activeTargetId] : null;
    if (!target?.onSubmit || target.submitDisabled) {
      return;
    }

    target.onSubmit();
  },
  clearActiveTarget: () => set({ activeTargetId: null }),
  closeTarget: (targetId) =>
    set((state) => {
      if (state.activeTargetId !== targetId) {
        return state;
      }

      return closeTargetState(state, targetId);
    }),
  closeActiveTarget: () =>
    set((state) => {
      const activeTargetId = state.activeTargetId;
      if (!activeTargetId) {
        return state;
      }

      return closeTargetState(state, activeTargetId);
    })
}));

export function conceptPromptContextTargetId(
  projectId: string,
  field: ConceptFieldKey
): string {
  return `project:${projectId}:book-concept:${field}`;
}

export function createConceptPromptContextTarget(
  projectId: string,
  field: ConceptFieldKey,
  options: PromptContextTargetOptions = {}
): AiPromptContextTarget {
  const config = conceptFieldConfigs[field];
  const sources = conceptPromptContextSources(field);

  return {
    targetId: conceptPromptContextTargetId(projectId, field),
    projectId,
    title: config.label,
    subtitle: "Pole koncepcji",
    sources,
    defaultSources: sources,
    submitLabel: options.submitLabel,
    submitDisabled: options.submitDisabled,
    submitDisabledReason: options.submitDisabledReason,
    onSubmit: options.onSubmit
  };
}

export function createNewProjectTitlePromptTarget(
  seedTitle: string,
  options: PromptContextTargetOptions = {}
): AiPromptContextTarget {
  const sources: PromptContextSource[] = [
    {
      key: "seedTitle",
      label: "Wpis autora",
      required: true
    }
  ];

  return {
    targetId: NEW_PROJECT_TITLE_PROMPT_TARGET_ID,
    title: "Tytu\u0142 nowego projektu",
    subtitle: seedTitle.trim() || "Nowy projekt",
    sources,
    defaultSources: sources,
    submitLabel: options.submitLabel,
    submitDisabled: options.submitDisabled,
    submitDisabledReason: options.submitDisabledReason,
    onSubmit: options.onSubmit
  };
}

export function promptContextControlForTarget(
  targetId: string
): PromptContextControl | undefined {
  const state = useAiPromptContextStore.getState();
  const target = state.targets[targetId];
  if (!target) {
    return undefined;
  }

  const draft = state.drafts[targetId] ?? defaultDraft();

  return {
    includedContextKeys: target.sources
      .filter((source) => isSourceSelected(source, draft))
      .map((source) => source.key),
    authorPriorityComment: draft.authorPriorityComment.trim(),
    contextSources: target.sources.map((source) => ({
      key: source.key,
      label: source.label,
      required: source.required
    }))
  };
}

export function promptContextControlForActiveTarget(
  targetId: string
): PromptContextControl | undefined {
  const state = useAiPromptContextStore.getState();
  if (state.activeTargetId !== targetId) {
    return undefined;
  }

  return promptContextControlForTarget(targetId);
}

export function isSourceSelected(
  source: PromptContextSource,
  draft: AiPromptContextDraft | undefined
): boolean {
  return source.required || draft?.selectedContextKeys[source.key] !== false;
}

function defaultDraft(): AiPromptContextDraft {
  return {
    selectedContextKeys: {},
    authorPriorityComment: ""
  };
}

function mergeContextSources(
  defaultSources: PromptContextSource[],
  manualSources: PromptContextSource[]
): PromptContextSource[] {
  return [
    ...defaultSources,
    ...manualSources.filter(
      (source) => !defaultSources.some((item) => item.key === source.key)
    )
  ];
}

function closeTargetState(
  state: AiPromptContextState,
  targetId: string
): Partial<AiPromptContextState> {
  const nextDrafts = { ...state.drafts };
  const nextTargets = { ...state.targets };
  delete nextDrafts[targetId];
  delete nextTargets[targetId];

  return {
    activeTargetId: null,
    drafts: nextDrafts,
    targets: nextTargets
  };
}

function hasContextSource(sources: PromptContextSource[], key: string): boolean {
  return sources.some((source) => source.key === key);
}
