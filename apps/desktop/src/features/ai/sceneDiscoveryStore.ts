import { create } from "zustand";
import type { ActiveAiProposal } from "./proposalStore";
import type { SceneStoryBibleAuditCandidate } from "./sceneStoryBibleAuditPromptPackage";

export type SceneDiscovery = SceneStoryBibleAuditCandidate & {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  createdAt: string;
};

export type PendingSceneAuditPrompt = {
  id: string;
  projectId: string;
  bookId: string;
  sceneId: string;
  sceneTitle: string;
  sourceProposal: ActiveAiProposal;
  createdAt: string;
};

type SceneDiscoveryState = {
  discoveries: SceneDiscovery[];
  pendingAuditPrompts: PendingSceneAuditPrompt[];
  addCandidates: (input: {
    projectId: string;
    bookId: string;
    sceneId: string;
    candidates: SceneStoryBibleAuditCandidate[];
  }) => void;
  removeDiscovery: (id: string) => void;
  addAuditPrompt: (input: Omit<PendingSceneAuditPrompt, "id" | "createdAt">) => void;
  removeAuditPrompt: (id: string) => void;
};

export const useSceneDiscoveryStore = create<SceneDiscoveryState>((set) => ({
  discoveries: [],
  pendingAuditPrompts: [],
  addCandidates: ({ projectId, bookId, sceneId, candidates }) =>
    set((state) => {
      const now = new Date().toISOString();
      const next = candidates.map((candidate) => ({
        ...candidate,
        id: candidate.id ?? createDiscoveryId(candidate),
        projectId,
        bookId,
        sceneId,
        createdAt: now
      }));
      const existingKeys = new Set(state.discoveries.map(discoveryKey));
      const uniqueNext = next.filter((candidate) => !existingKeys.has(discoveryKey(candidate)));

      return {
        discoveries: [...uniqueNext, ...state.discoveries].slice(0, 40)
      };
    }),
  removeDiscovery: (id) =>
    set((state) => ({
      discoveries: state.discoveries.filter((discovery) => discovery.id !== id)
    })),
  addAuditPrompt: (input) =>
    set((state) => {
      const existing = state.pendingAuditPrompts.find((prompt) => prompt.sourceProposal.id === input.sourceProposal.id);
      if (existing) {
        return state;
      }

      return {
        pendingAuditPrompts: [
          {
            ...input,
            id: createAuditPromptId(input.sceneId),
            createdAt: new Date().toISOString()
          },
          ...state.pendingAuditPrompts
        ].slice(0, 12)
      };
    }),
  removeAuditPrompt: (id) =>
    set((state) => ({
      pendingAuditPrompts: state.pendingAuditPrompts.filter((prompt) => prompt.id !== id)
    }))
}));

function discoveryKey(discovery: Pick<SceneDiscovery, "sceneId" | "kind" | "title">): string {
  return `${discovery.sceneId}:${discovery.kind}:${discovery.title.toLocaleLowerCase("pl-PL")}`;
}

function createDiscoveryId(candidate: SceneStoryBibleAuditCandidate): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-discovery:${crypto.randomUUID()}`;
  }

  return `scene-discovery:${candidate.kind}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createAuditPromptId(sceneId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-audit-prompt:${crypto.randomUUID()}`;
  }

  return `scene-audit-prompt:${sceneId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}
