import { beforeEach, describe, expect, it } from "vitest";
import { useSceneDiscoveryStore } from "./sceneDiscoveryStore";

describe("sceneDiscoveryStore", () => {
  beforeEach(() => {
    useSceneDiscoveryStore.setState({
      discoveries: [],
      pendingAuditPrompts: []
    });
  });

  it("stores a pending scene audit prompt for the sidebar", () => {
    useSceneDiscoveryStore.getState().addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-1",
      sceneTitle: "Nowa scena",
      sourceProposal: {
        id: "proposal-1",
        status: "success",
        scope: "sceneEditor",
        projectId: "project-1",
        bookId: "book-1",
        field: "continueScene",
        action: "continue_scene",
        promptPackageId: "prompt-1",
        promptPackageJson: {} as never,
        prompt: "",
        rawOutput: "",
        editableValue: "Tekst sceny",
        editableFields: {},
        selectedFields: {},
        errorMessage: "",
        createdAt: "",
        updatedAt: ""
      }
    });

    expect(useSceneDiscoveryStore.getState().pendingAuditPrompts).toHaveLength(1);
    expect(useSceneDiscoveryStore.getState().pendingAuditPrompts[0]).toMatchObject({
      projectId: "project-1",
      sceneTitle: "Nowa scena"
    });
  });
});
