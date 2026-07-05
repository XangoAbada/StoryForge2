import { beforeEach, describe, expect, it } from "vitest";
import { useSceneDiscoveryStore } from "./sceneDiscoveryStore";

describe("sceneDiscoveryStore", () => {
  beforeEach(() => {
    useSceneDiscoveryStore.setState({
      discoveries: [],
      pendingAuditPrompts: [],
      pendingAssignments: []
    });
  });

  it("stores a pending scene audit prompt for the sidebar", () => {
    useSceneDiscoveryStore.getState().addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-1",
      sceneTitle: "Nowa scena",
      analysisText: "Tekst sceny",
      sourceKind: "acceptedText"
    });

    expect(useSceneDiscoveryStore.getState().pendingAuditPrompts).toHaveLength(1);
    expect(useSceneDiscoveryStore.getState().pendingAuditPrompts[0]).toMatchObject({
      projectId: "project-1",
      sceneTitle: "Nowa scena"
    });
  });

  it("keeps a single audit prompt per scene and refreshes it on each edit", () => {
    const store = useSceneDiscoveryStore.getState();
    store.addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-1",
      sceneTitle: "Scena",
      analysisText: "Pierwsza wersja",
      sourceKind: "acceptedText"
    });
    store.addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-1",
      sceneTitle: "Scena",
      analysisText: "Druga wersja po edycji",
      sourceKind: "acceptedText"
    });

    const prompts = useSceneDiscoveryStore.getState().pendingAuditPrompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0].analysisText).toBe("Druga wersja po edycji");
  });

  it("keeps separate audit prompts for different scenes", () => {
    const store = useSceneDiscoveryStore.getState();
    store.addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-1",
      sceneTitle: "Scena 1",
      analysisText: "Tekst 1",
      sourceKind: "acceptedText"
    });
    store.addAuditPrompt({
      projectId: "project-1",
      bookId: "book-1",
      sceneId: "scene-2",
      sceneTitle: "Scena 2",
      analysisText: "Tekst 2",
      sourceKind: "acceptedText"
    });

    expect(useSceneDiscoveryStore.getState().pendingAuditPrompts).toHaveLength(2);
  });
});
