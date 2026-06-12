import type { WorldFieldKey } from "./worldPromptPackage";

type WorldDraftFieldApplier = (field: WorldFieldKey, value: string) => boolean;

const draftTargets = new Map<string, WorldDraftFieldApplier>();

export function registerWorldDraftFieldTarget(
  targetId: string,
  applier: WorldDraftFieldApplier
): void {
  draftTargets.set(targetId, applier);
}

export function unregisterWorldDraftFieldTarget(targetId: string): void {
  draftTargets.delete(targetId);
}

export function applyWorldDraftField(
  targetId: string,
  field: WorldFieldKey,
  value: string
): boolean {
  return draftTargets.get(targetId)?.(field, value) ?? false;
}
