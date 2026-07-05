export type SceneEditorInsertMode =
  | "replace_selection"
  | "insert_after_selection"
  | "append_to_scene"
  | "save_as_variant";

type SceneEditorProposalHandler = (
  value: string,
  mode: SceneEditorInsertMode,
  selectedText: string
) => void | Promise<void>;

const sceneEditorTargets = new Map<string, SceneEditorProposalHandler>();

export function registerSceneEditorProposalTarget(
  targetId: string,
  handler: SceneEditorProposalHandler
) {
  sceneEditorTargets.set(targetId, handler);
}

export function unregisterSceneEditorProposalTarget(targetId: string) {
  sceneEditorTargets.delete(targetId);
}

export async function applySceneEditorProposal(
  targetId: string,
  value: string,
  mode: SceneEditorInsertMode,
  selectedText: string
): Promise<boolean> {
  const handler = sceneEditorTargets.get(targetId);
  if (!handler) {
    return false;
  }

  await handler(value, mode, selectedText);
  return true;
}
