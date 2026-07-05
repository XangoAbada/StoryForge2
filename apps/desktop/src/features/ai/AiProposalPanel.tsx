import { Check, CircleStop, Clock3, FileJson, GitBranch, Link2, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { coverImageSource } from "../../shared/api/assets";
import { isTauriRuntime } from "../../shared/api/browserDevCommands";
import {
  acceptGeneratedBookCover,
  acceptGeneratedCharacterImage,
  acceptGeneratedExportArtwork,
  cancelActiveCodexRun,
  createPlanVersionFromActive,
  generateBookCover,
  generateCharacterImage,
  generateExportArtwork,
  generateNewProjectTitle,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  getBookPlan,
  listActiveCodexRuns,
  listAiProposals,
  listSceneCritiques,
  markAiProposalAccepted,
  markAiProposalRejected,
  saveSceneCritique,
  moveBeatToChapter,
  runCodexPrompt,
  saveStoryStructure,
  setActivePlanVersion,
  setSceneRelations,
  setWorldElementRelations,
  setWorldRuleRelations,
  upsertAct,
  upsertBeat,
  upsertChapter,
  upsertCharacter,
  upsertCharacterMemory,
  upsertCharacterRelation,
  upsertChapterThreadRelation,
  upsertPlotThread,
  upsertScene,
  upsertWorldElement,
  upsertWorldRule,
  updateBookConcept
} from "../../shared/api/commands";
import type {
  BookConceptInput,
  BookPlan,
  Character,
  CharacterMemory,
  CharacterRelation,
  CoverGenerationProgressEvent,
  ActiveCodexRun,
  WorldElement,
  WorldRule,
  UpsertCharacterInput,
  UpsertCharacterMemoryInput,
  UpsertCharacterRelationInput,
  UpsertWorldElementInput,
  UpsertWorldRuleInput,
  WorldWorkspace
} from "../../shared/api/types";
import { parseConceptFieldSuggestion } from "./conceptFieldSuggestion";
import { useCodexSettingsStore } from "./codexSettingsStore";
import { parsePremiseDevelopment } from "./premiseDevelopment";
import {
  conceptFieldConfigs,
  ConceptFieldKey,
  longConceptFields
} from "./promptPackage";
import { planFieldConfigs, PlanFieldKey } from "./planPromptPackage";
import { applyPlanDraftField } from "./planDraftFieldTargets";
import { applyPlanProposalPayload } from "./planProposalApplication";
import {
  buildCharacterPromptPackage,
  characterFieldConfigs,
  CharacterFieldKey,
  renderCharacterPromptPackage
} from "./characterPromptPackage";
import { applyCharacterDraftField } from "./characterDraftFieldTargets";
import {
  buildWorldPromptPackage,
  worldFieldConfigs,
  WorldFieldKey,
  renderWorldPromptPackage
} from "./worldPromptPackage";
import { applyWorldDraftField } from "./worldDraftFieldTargets";
import { parseModelJson } from "./modelJson";
import {
  parseSceneEditorResult,
  sceneEditorFieldLabel,
  SceneEditorFieldKey
} from "./sceneEditorPromptPackage";
import {
  parseSceneStoryBibleAuditResult,
  buildSceneStoryBibleAuditPromptPackage,
  ScenePlanAuditSnapshot,
  renderSceneStoryBibleAuditPromptPackage,
  SCENE_STORY_BIBLE_AUDIT_FIELD
} from "./sceneStoryBibleAuditPromptPackage";
import { buildScenePromptContext } from "./scenePromptContext";
import {
  parseSceneCritiqueResult,
  SCENE_CRITIQUE_CATEGORY_LABELS,
  SCENE_CRITIQUE_FIELD,
  SCENE_CRITIQUE_SEVERITY_LABELS
} from "./sceneCritiquePromptPackage";
import {
  applyCritiqueFinding,
  hasCritiqueApplyTarget,
  SceneCritiqueReport,
  SceneCritiqueReportFinding,
  serializeCritiqueFindings,
  subscribeCritiqueApplyTargets,
  useSceneCritiqueStore
} from "./sceneCritiqueStore";
import {
  PendingSceneAuditPrompt,
  PendingSceneAssignment,
  SceneDiscovery,
  useSceneDiscoveryStore
} from "./sceneDiscoveryStore";
import {
  applySceneEditorProposal,
  SceneEditorInsertMode
} from "./sceneEditorProposalTargets";
import {
  ActiveAiProposal,
  BOOK_COVER_FIELD,
  CHARACTER_IMAGE_FIELD,
  EXPORT_ARTWORK_FIELD,
  ParsedAiProposal,
  useProposalStore
} from "./proposalStore";
import { CoverImageLightbox } from "./CoverImageLightbox";
import { Button } from "../../shared/ui";
import {
  characterPromptContextTargetId,
  conceptPromptContextTargetId,
  planPromptContextTargetId,
  useAiPromptContextStore,
  worldPromptContextTargetId
} from "./aiPromptContextStore";

type AiProposalPanelProps = {
  projectId: string;
  onAcceptValue?: (value: string) => void | Promise<void>;
};

export async function applyAiProposal(
  proposal: ActiveAiProposal,
  options: {
    asNewPlanVersion?: boolean;
    onAcceptValue?: (value: string) => void | Promise<void>;
  } = {}
): Promise<unknown> {
  if (proposal.status !== "success") {
    return null;
  }

  if (proposal.scope === "newProject") {
    const value = proposal.editableValue.trim();
    if (!options.onAcceptValue) {
      throw new Error("Brak obsługi akceptacji propozycji nowego projektu.");
    }

    await options.onAcceptValue(value);
    return null;
  }

  if (isBookCoverProposal(proposal)) {
    const imagePath = (proposal.coverImagePath || proposal.editableValue).trim();
    if (!imagePath || !proposal.coverPrompt || !proposal.coverGeneratedAt) {
      throw new Error("Brak kompletnej propozycji okładki do akceptacji.");
    }

    return acceptGeneratedBookCover({
      bookId: proposal.bookId,
      imagePath,
      coverPrompt: proposal.coverPrompt,
      coverNegativePrompt: proposal.coverNegativePrompt ?? "",
      generatedAt: proposal.coverGeneratedAt
    });
  }

  if (isCharacterImageProposal(proposal)) {
    const imagePath = (
      proposal.characterImagePath ||
      proposal.coverImagePath ||
      proposal.editableValue
    ).trim();
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const characterId =
      typeof scopedPackageContext.targetEntityId === "string"
        ? scopedPackageContext.targetEntityId
        : "";
    if (!imagePath || !characterId || !proposal.coverPrompt || !proposal.characterGeneratedAt) {
      throw new Error("Brak kompletnej propozycji obrazu postaci do akceptacji.");
    }

    return acceptGeneratedCharacterImage({
      projectId: proposal.projectId,
      characterId,
      imagePath,
      imagePrompt: proposal.coverPrompt,
      negativePrompt: proposal.coverNegativePrompt ?? "",
      generatedAt: proposal.characterGeneratedAt
    });
  }

  if (isExportArtworkProposal(proposal)) {
    const imagePath = (
      proposal.exportArtworkPath ||
      proposal.coverImagePath ||
      proposal.editableValue
    ).trim();
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const relatedType =
      scopedPackageContext.relatedType === "chapter" ||
      scopedPackageContext.relatedType === "scene" ||
      scopedPackageContext.relatedType === "book"
        ? scopedPackageContext.relatedType
        : "book";
    const relatedId =
      typeof scopedPackageContext.targetEntityId === "string"
        ? scopedPackageContext.targetEntityId
        : proposal.bookId;
    if (!imagePath || !proposal.coverPrompt || !proposal.exportArtworkGeneratedAt) {
      throw new Error("Brak kompletnej propozycji grafiki eksportu do akceptacji.");
    }

    return acceptGeneratedExportArtwork({
      projectId: proposal.projectId,
      relatedType,
      relatedId,
      imagePath,
      imagePrompt: proposal.coverPrompt,
      negativePrompt: proposal.coverNegativePrompt ?? "",
      generatedAt: proposal.exportArtworkGeneratedAt
    });
  }

  if (proposal.scope === "bookPlan") {
    let plan = await getBookPlan(proposal.bookId);
    const [characters, world] = await Promise.all([
      getCharacterWorkspace(proposal.projectId),
      getWorldWorkspace(proposal.projectId)
    ]);
    const payload = planPayloadFromEditableValue(proposal);
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const planField = proposal.field as PlanFieldKey;
    if (options.asNewPlanVersion && isLargePlanField(planField)) {
      const version = await createPlanVersionFromActive({
        bookId: proposal.bookId,
        name: `Wariant AI: ${planFieldConfigs[planField]?.label ?? "Plan"}`,
        description: "Utworzono z akceptowanej propozycji AI."
      });
      await setActivePlanVersion({
        bookId: proposal.bookId,
        planVersionId: version.id
      });
      plan = await getBookPlan(proposal.bookId);
    }

    if (isDraftPlanField(planField) && isDraftAcceptance(scopedPackageContext)) {
      const targetEntityId =
        typeof scopedPackageContext.targetEntityId === "string"
          ? scopedPackageContext.targetEntityId
          : "";
      const value = planPayloadTextValue(payload);
      if (targetEntityId && applyPlanDraftField(targetEntityId, planField, value)) {
        return null;
      }

      if (isSceneDraftField(planField)) {
        throw new Error("Nie ma już otwartego formularza sceny dla tej propozycji AI.");
      }

      if (
        !targetEntityId ||
        targetEntityId.startsWith("draft-beat:") ||
        targetEntityId.startsWith("draft-scene:")
      ) {
        throw new Error("Nie ma już otwartego formularza beatu dla tej propozycji AI.");
      }
    }

    await applyPlanProposalPayload(payload, planField, packageContext, {
      bookId: proposal.bookId,
      plan,
      saveStructure: saveStoryStructure,
      saveAct: upsertAct,
      saveBeat: upsertBeat,
      moveBeatToChapter,
      saveThread: upsertPlotThread,
      saveChapter: upsertChapter,
      saveChapterThreadRelation: upsertChapterThreadRelation,
      saveScene: upsertScene,
      setSceneRelations,
      characters,
      world
    });
    return null;
  }

  if (proposal.scope === "characters") {
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const targetEntityId =
      typeof scopedPackageContext.targetEntityId === "string"
        ? scopedPackageContext.targetEntityId
        : "";
    const characterField = characterFieldFromProposal(proposal);
    const value = proposal.editableValue.trim();
    if (
      targetEntityId &&
      applyCharacterDraftField(targetEntityId, characterField, value)
    ) {
      return null;
    }

    if (characterField === "characterRelation") {
      return upsertCharacterRelation(characterRelationInputFromProposal(proposal, scopedPackageContext));
    }

    if (characterField === "characterProfile") {
      return upsertCharacter(characterProfileInputFromProposal(proposal, scopedPackageContext));
    }

    if (characterField === "characterMemory") {
      return upsertCharacterMemory(characterMemoryInputFromProposal(proposal, scopedPackageContext));
    }

    if (targetEntityId && isCanonicalCharacterField(characterField)) {
      return upsertCharacter(
        await characterFieldInputFromProposal(proposal, targetEntityId, characterField)
      );
    }

    throw new Error("Nie ma już otwartego formularza dla tej propozycji postaci.");
  }

  if (proposal.scope === "world") {
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const targetEntityId =
      typeof scopedPackageContext.targetEntityId === "string"
        ? scopedPackageContext.targetEntityId
        : "";
    const value = proposal.editableValue.trim();
    if (
      targetEntityId &&
      applyWorldDraftField(targetEntityId, proposal.field as WorldFieldKey, value)
    ) {
      return null;
    }

    if (proposal.field === "worldElement") {
      return upsertWorldElement(worldElementInputFromProposal(proposal, scopedPackageContext));
    }

    if (proposal.field === "worldRule") {
      return upsertWorldRule(worldRuleInputFromProposal(proposal, scopedPackageContext));
    }

    if (proposal.field === "worldRuleAnalysis") {
      return null;
    }

    throw new Error("Nie ma już otwartego formularza dla tej propozycji świata.");
  }

  if (proposal.scope === "sceneEditor") {
    const packageContext =
      "context" in proposal.promptPackageJson
        ? proposal.promptPackageJson.context
        : {};
    const scopedPackageContext =
      packageContext && typeof packageContext === "object"
        ? (packageContext as Record<string, unknown>)
        : {};
    const targetEntityId =
      typeof scopedPackageContext.targetEntityId === "string"
        ? scopedPackageContext.targetEntityId
        : "";
    const value = proposal.editableValue.trim();
    const insertMode = sceneEditorInsertMode(scopedPackageContext.insertMode);
    const selectedText =
      typeof scopedPackageContext.selectedText === "string"
        ? scopedPackageContext.selectedText
        : "";

    if (!targetEntityId) {
      throw new Error("Brak aktywnej sceny dla propozycji edytora.");
    }

    const applied = await applySceneEditorProposal(targetEntityId, value, insertMode, selectedText);
    if (!applied) {
      throw new Error("Nie ma już otwartego edytora sceny dla tej propozycji AI.");
    }

    return null;
  }

  if (isPremiseDevelopment(proposal.parsed)) {
    const input = proposalInputFromFields(proposal.editableFields, proposal.selectedFields);
    return updateBookConcept(proposal.bookId, input);
  }

  const value = proposal.editableValue.trim();
  return updateBookConcept(
    proposal.bookId,
    proposalInputFromValue(value, { field: proposal.field as ConceptFieldKey })
  );
}

export function AiProposalPanel({
  projectId,
  onAcceptValue
}: AiProposalPanelProps) {
  useAiQueueRunner();
  useCoverGenerationProgressListener();

  const queryClient = useQueryClient();
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const proposals = useProposalStore((state) => state.proposals);
  const setEditableValue = useProposalStore((state) => state.setEditableValue);
  const setEditableField = useProposalStore((state) => state.setEditableField);
  const toggleSelectedField = useProposalStore((state) => state.toggleSelectedField);
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const hydratePersistentProposals = useProposalStore((state) => state.hydratePersistentProposals);
  const clearProposal = useProposalStore((state) => state.clearProposal);
  const retryProposal = useProposalStore((state) => state.retryProposal);
  const cancelProposal = useProposalStore((state) => state.cancelProposal);
  const addAuditPrompt = useSceneDiscoveryStore((state) => state.addAuditPrompt);
  const addAssignment = useSceneDiscoveryStore((state) => state.addAssignment);
  const pendingAuditPrompts = useSceneDiscoveryStore((state) => state.pendingAuditPrompts);
  const pendingAssignments = useSceneDiscoveryStore((state) => state.pendingAssignments);
  const visibleProposals = proposals
    .filter((proposal) => proposal.projectId === projectId)
    .sort(compareProposalsForPanel);
  const discoveries = useSceneDiscoveryStore((state) => state.discoveries);
  const visibleDiscoveries = useMemo(
    () => discoveries.filter((discovery) => discovery.projectId === projectId),
    [discoveries, projectId]
  );
  const visibleAuditPrompts = useMemo(
    () => pendingAuditPrompts.filter((prompt) => prompt.projectId === projectId),
    [pendingAuditPrompts, projectId]
  );
  const visibleAssignments = useMemo(
    () => pendingAssignments.filter((assignment) => assignment.projectId === projectId),
    [pendingAssignments, projectId]
  );
  const critiques = useSceneCritiqueStore((state) => state.critiques);
  const visibleCritiques = useMemo(
    () =>
      critiques.filter(
        (critique) =>
          critique.projectId === projectId &&
          critique.findings.some((finding) => finding.status === "open")
      ),
    [critiques, projectId]
  );
  const hydrateCritiques = useSceneCritiqueStore((state) => state.hydrate);
  const panelProjectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const panelBookId = panelProjectQuery.data?.book.id;
  const sceneCritiquesQuery = useQuery({
    queryKey: ["scene-critiques", panelBookId],
    queryFn: () => listSceneCritiques(panelBookId ?? ""),
    enabled: Boolean(panelBookId),
    retry: 0
  });
  useEffect(() => {
    if (sceneCritiquesQuery.data) {
      hydrateCritiques(sceneCritiquesQuery.data);
    }
  }, [hydrateCritiques, sceneCritiquesQuery.data]);
  const persistentProposalQuery = useQuery({
    queryKey: ["ai-proposals", projectId],
    queryFn: () => listAiProposals(projectId),
    retry: 0
  });
  const activeRunsQuery = useQuery({
    queryKey: ["active-codex-runs", projectId],
    queryFn: () => listActiveCodexRuns(projectId),
    retry: 0,
    refetchInterval: 1500
  });

  useEffect(() => {
    if (persistentProposalQuery.data) {
      hydratePersistentProposals(persistentProposalQuery.data);
    }
  }, [hydratePersistentProposals, persistentProposalQuery.data]);

  const acceptMutation = useMutation({
    mutationFn: async ({ proposalId, asNewPlanVersion = false }: { proposalId: string; asNewPlanVersion?: boolean }) => {
      const proposal = useProposalStore
        .getState()
        .proposals.find((item) => item.id === proposalId);

      if (!proposal || proposal.status !== "success") {
        return null;
      }

      if (proposal.scope === "newProject") {
        const value = proposal.editableValue.trim();
        if (!onAcceptValue) {
          throw new Error("Brak obsługi akceptacji propozycji nowego projektu.");
        }

        await onAcceptValue(value);
        return null;
      }

      if (isBookCoverProposal(proposal)) {
        const imagePath = (proposal.coverImagePath || proposal.editableValue).trim();
        if (!imagePath || !proposal.coverPrompt || !proposal.coverGeneratedAt) {
          throw new Error("Brak kompletnej propozycji okładki do akceptacji.");
        }

        return acceptGeneratedBookCover({
          bookId: proposal.bookId,
          imagePath,
          coverPrompt: proposal.coverPrompt,
          coverNegativePrompt: proposal.coverNegativePrompt ?? "",
          generatedAt: proposal.coverGeneratedAt
        });
      }

      if (isCharacterImageProposal(proposal)) {
        const imagePath = (
          proposal.characterImagePath ||
          proposal.coverImagePath ||
          proposal.editableValue
        ).trim();
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const characterId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        if (!imagePath || !characterId || !proposal.coverPrompt || !proposal.characterGeneratedAt) {
          throw new Error("Brak kompletnej propozycji obrazu postaci do akceptacji.");
        }

        return acceptGeneratedCharacterImage({
          projectId: proposal.projectId,
          characterId,
          imagePath,
          imagePrompt: proposal.coverPrompt,
          negativePrompt: proposal.coverNegativePrompt ?? "",
          generatedAt: proposal.characterGeneratedAt
        });
      }

      if (isExportArtworkProposal(proposal)) {
        const imagePath = (
          proposal.exportArtworkPath ||
          proposal.coverImagePath ||
          proposal.editableValue
        ).trim();
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const relatedType =
          scopedPackageContext.relatedType === "chapter" ||
          scopedPackageContext.relatedType === "scene" ||
          scopedPackageContext.relatedType === "book"
            ? scopedPackageContext.relatedType
            : "book";
        const relatedId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : proposal.bookId;
        if (!imagePath || !proposal.coverPrompt || !proposal.exportArtworkGeneratedAt) {
          throw new Error("Brak kompletnej propozycji grafiki eksportu do akceptacji.");
        }

        return acceptGeneratedExportArtwork({
          projectId: proposal.projectId,
          relatedType,
          relatedId,
          imagePath,
          imagePrompt: proposal.coverPrompt,
          negativePrompt: proposal.coverNegativePrompt ?? "",
          generatedAt: proposal.exportArtworkGeneratedAt
        });
      }

      if (proposal.scope === "bookPlan") {
        let plan = await getBookPlan(proposal.bookId);
        const [characters, world] = await Promise.all([
          getCharacterWorkspace(proposal.projectId),
          getWorldWorkspace(proposal.projectId)
        ]);
        const payload = planPayloadFromEditableValue(proposal);
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const planField = proposal.field as PlanFieldKey;
        if (asNewPlanVersion && isLargePlanField(planField)) {
          const version = await createPlanVersionFromActive({
            bookId: proposal.bookId,
            name: `Wariant AI: ${planFieldConfigs[planField]?.label ?? "Plan"}`,
            description: "Utworzono z akceptowanej propozycji AI."
          });
          await setActivePlanVersion({
            bookId: proposal.bookId,
            planVersionId: version.id
          });
          plan = await getBookPlan(proposal.bookId);
        }

        if (isDraftPlanField(planField) && isDraftAcceptance(scopedPackageContext)) {
          const targetEntityId =
            typeof scopedPackageContext.targetEntityId === "string"
              ? scopedPackageContext.targetEntityId
              : "";
          const value = planPayloadTextValue(payload);
          if (targetEntityId && applyPlanDraftField(targetEntityId, planField, value)) {
            return null;
          }

          if (isSceneDraftField(planField)) {
            throw new Error("Nie ma już otwartego formularza sceny dla tej propozycji AI.");
          }

          if (
            !targetEntityId ||
            targetEntityId.startsWith("draft-beat:") ||
            targetEntityId.startsWith("draft-scene:")
          ) {
            throw new Error(
              "Nie ma już otwartego formularza beatu dla tej propozycji AI."
            );
          }
        }

        return applyPlanProposalPayload(
          payload,
          planField,
          packageContext,
          {
            bookId: proposal.bookId,
            plan,
            saveStructure: saveStoryStructure,
            saveAct: upsertAct,
            saveBeat: upsertBeat,
            moveBeatToChapter,
            saveThread: upsertPlotThread,
            saveChapter: upsertChapter,
            saveChapterThreadRelation: upsertChapterThreadRelation,
            saveScene: upsertScene,
            setSceneRelations,
            characters,
            world
          }
        );
      }

      if (proposal.scope === "characters") {
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const targetEntityId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        const characterField = characterFieldFromProposal(proposal);
        const value = proposal.editableValue.trim();
        if (
          targetEntityId &&
          applyCharacterDraftField(targetEntityId, characterField, value)
        ) {
          return null;
        }

        if (characterField === "characterRelation") {
          return upsertCharacterRelation(
            characterRelationInputFromProposal(proposal, scopedPackageContext)
          );
        }

        if (characterField === "characterProfile") {
          return upsertCharacter(
            characterProfileInputFromProposal(proposal, scopedPackageContext)
          );
        }

        if (characterField === "characterMemory") {
          return upsertCharacterMemory(
            characterMemoryInputFromProposal(proposal, scopedPackageContext)
          );
        }

        if (targetEntityId && isCanonicalCharacterField(characterField)) {
          return upsertCharacter(
            await characterFieldInputFromProposal(proposal, targetEntityId, characterField)
          );
        }

        throw new Error("Nie ma już otwartego formularza dla tej propozycji postaci.");
      }

      if (proposal.scope === "world") {
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const targetEntityId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        const value = proposal.editableValue.trim();
        if (
          targetEntityId &&
          applyWorldDraftField(targetEntityId, proposal.field as WorldFieldKey, value)
        ) {
          return null;
        }

        if (proposal.field === "worldElement") {
          return upsertWorldElement(worldElementInputFromProposal(proposal, scopedPackageContext));
        }

        if (proposal.field === "worldRule") {
          return upsertWorldRule(worldRuleInputFromProposal(proposal, scopedPackageContext));
        }

        if (proposal.field === "worldRuleAnalysis") {
          return null;
        }

        throw new Error("Nie ma już otwartego formularza dla tej propozycji świata.");
      }

      if (proposal.scope === "sceneEditor") {
        const packageContext =
          "context" in proposal.promptPackageJson
            ? proposal.promptPackageJson.context
            : {};
        const scopedPackageContext =
          packageContext && typeof packageContext === "object"
            ? (packageContext as Record<string, unknown>)
            : {};
        const targetEntityId =
          typeof scopedPackageContext.targetEntityId === "string"
            ? scopedPackageContext.targetEntityId
            : "";
        const value = proposal.editableValue.trim();
        const insertMode = sceneEditorInsertMode(scopedPackageContext.insertMode);
        const selectedText =
          typeof scopedPackageContext.selectedText === "string"
            ? scopedPackageContext.selectedText
            : "";

        if (!targetEntityId) {
          throw new Error("Brak aktywnej sceny dla propozycji edytora.");
        }

        const applied = await applySceneEditorProposal(targetEntityId, value, insertMode, selectedText);
        if (!applied) {
          throw new Error("Nie ma już otwartego edytora sceny dla tej propozycji AI.");
        }

        return null;
      }

      if (isPremiseDevelopment(proposal.parsed)) {
        const input = proposalInputFromFields(
          proposal.editableFields,
          proposal.selectedFields
        );
        return updateBookConcept(proposal.bookId, input);
      }

      const value = proposal.editableValue.trim();
      return updateBookConcept(
        proposal.bookId,
        proposalInputFromValue(value, { field: proposal.field as ConceptFieldKey })
      );
    },
    onSuccess: async (payload, variables) => {
      const proposalId = variables.proposalId;
      const proposal = useProposalStore
        .getState()
        .proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        return;
      }

      await markAiProposalAccepted(proposalId);
      clearProposal(proposalId);
      closePromptContextForProposal(proposal);
      await queryClient.invalidateQueries({ queryKey: ["ai-runs", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["ai-proposals", projectId] });
      if (proposal.scope !== "newProject") {
        await queryClient.invalidateQueries({ queryKey: ["book-plan", proposal.bookId] });
        await queryClient.invalidateQueries({ queryKey: ["character-workspace", projectId] });
        await queryClient.invalidateQueries({ queryKey: ["world-workspace", projectId] });
        await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      for (const prompt of sceneAuditPromptsFromPlanResult(proposal, payload)) {
        addAuditPrompt(prompt);
      }
      const assignment = sceneAssignmentFromAcceptedProposal(proposal, payload);
      if (assignment) {
        addAssignment(assignment);
      }
      if (proposal.scope === "sceneEditor" && proposal.field !== SCENE_STORY_BIBLE_AUDIT_FIELD) {
        addAuditPrompt(sceneAuditPromptFromProposal(proposal));
      }
    }
  });

  const cancelMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      const proposal = useProposalStore
        .getState()
        .proposals.find((item) => item.id === proposalId);
      if (!proposal || proposal.status !== "running") {
        return false;
      }

      const activeRun = activeRunsQuery.data?.find((run) =>
        runMatchesProposal(run, proposal)
      );
      const cancelled = await cancelActiveCodexRun({
        projectId: proposal.projectId,
        aiRunId: activeRun?.aiRunId ?? proposal.aiRunId
      });
      cancelProposal(proposalId, "Generowanie Codex CLI zostało przerwane.");
      await queryClient.invalidateQueries({ queryKey: ["active-codex-runs", projectId] });
      return cancelled;
    }
  });

  if (
    visibleProposals.length === 0 &&
    visibleDiscoveries.length === 0 &&
    visibleAuditPrompts.length === 0 &&
    visibleAssignments.length === 0 &&
    visibleCritiques.length === 0
  ) {
    return (
      <section className="context-section compact">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Propozycje</p>
            <h2>Panel AI</h2>
          </div>
          <FileJson size={18} aria-hidden="true" />
        </div>
        <p className="muted-text">
          Wyniki AI pojawią się tutaj po wysłaniu promptu z panelu kontekstu.
        </p>
      </section>
    );
  }

  return (
    <section className="context-section compact proposal-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Codex CLI</p>
          <h2>Kolejka AI</h2>
        </div>
        <span className="status-pill">
          <Clock3 size={14} aria-hidden="true" />
          {visibleProposals.length}
        </span>
      </div>

      <SceneAuditPromptPanel prompts={visibleAuditPrompts} />
      <SceneAssignmentPanel projectId={projectId} assignments={visibleAssignments} />
      <SceneDiscoveryPanel projectId={projectId} discoveries={visibleDiscoveries} />
      <SceneCritiquePanel critiques={visibleCritiques} />

      <div className="proposal-queue-list">
        {visibleProposals.map((proposal) => (
          <ProposalQueueItem
            key={proposal.id}
            proposal={proposal}
            accepting={acceptMutation.isPending && acceptMutation.variables?.proposalId === proposal.id}
            retrying={proposal.status === "queued"}
            cancelling={cancelMutation.isPending && cancelMutation.variables === proposal.id}
            activeRun={activeRunsQuery.data?.find((run) => runMatchesProposal(run, proposal)) ?? null}
            onAccept={() => acceptMutation.mutate({ proposalId: proposal.id })}
            onAcceptAsPlanVersion={() => acceptMutation.mutate({ proposalId: proposal.id, asNewPlanVersion: true })}
            onCancel={() => cancelMutation.mutate(proposal.id)}
            onClear={() => {
              void markAiProposalRejected(proposal.id).finally(() => {
                clearProposal(proposal.id);
                void queryClient.invalidateQueries({ queryKey: ["ai-runs", projectId] });
                void queryClient.invalidateQueries({ queryKey: ["ai-proposals", projectId] });
              });
            }}
            onRetry={() => retryProposal(proposal.id)}
            onPreview={(src, alt) => setPreviewImage({ src, alt })}
            onEditableValueChange={(value) => setEditableValue(proposal.id, value)}
            onEditableFieldChange={(field, value) =>
              setEditableField(proposal.id, field, value)
            }
            onToggleField={(field) => toggleSelectedField(proposal.id, field)}
          />
        ))}
      </div>

      {acceptMutation.isError ? (
        <p className="warning-text">Nie udało się zapisać propozycji.</p>
      ) : null}

      <CoverImageLightbox
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </section>
  );
}

type ProposalQueueItemProps = {
  proposal: ActiveAiProposal;
  accepting: boolean;
  retrying: boolean;
  cancelling: boolean;
  activeRun: ActiveCodexRun | null;
  onAccept: () => void;
  onAcceptAsPlanVersion: () => void;
  onCancel: () => void;
  onClear: () => void;
  onRetry: () => void;
  onPreview: (src: string, alt: string) => void;
  onEditableValueChange: (value: string) => void;
  onEditableFieldChange: (field: ConceptFieldKey, value: string) => void;
  onToggleField: (field: ConceptFieldKey) => void;
};

function SceneAuditPromptPanel({ prompts }: { prompts: PendingSceneAuditPrompt[] }) {
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const removeAuditPrompt = useSceneDiscoveryStore((state) => state.removeAuditPrompt);

  if (prompts.length === 0) {
    return null;
  }

  return (
    <div className="scene-discovery-list" aria-label="Pytania o analizę sceny">
      {prompts.map((prompt) => (
        <article className="scene-discovery-card scene-audit-prompt-card" key={prompt.id}>
          <div>
            <span className="scene-discovery-kind">Analiza sceny</span>
            <h3>{prompt.sceneTitle || "Scena"}</h3>
            <p>Przeanalizować scenę pod kątem nowych postaci i elementów świata?</p>
            <small>Analiza doda znalezione rzeczy jako osobne karty w tym panelu. Nic nie zapisze się w kanonie bez akceptacji.</small>
          </div>
          <div className="scene-discovery-actions">
            <Button
              variant="ai"
              size="sm"
              onClick={() => {
                void queueSceneAuditFromPrompt(prompt, enqueueProposal);
                removeAuditPrompt(prompt.id);
              }}
            >
              <Sparkles size={14} />
              Analizuj
            </Button>
            <Button variant="ghost" size="sm" onClick={() => removeAuditPrompt(prompt.id)}>
              Pomiń
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

function SceneAssignmentPanel({
  projectId,
  assignments
}: {
  projectId: string;
  assignments: PendingSceneAssignment[];
}) {
  const queryClient = useQueryClient();
  const removeAssignment = useSceneDiscoveryStore((state) => state.removeAssignment);
  const assignmentMutation = useMutation({
    mutationFn: assignPendingSceneAssignment,
    onSuccess: async (_result, assignment) => {
      removeAssignment(assignment.id);
      await queryClient.invalidateQueries({ queryKey: ["book-plan", assignment.bookId] });
      await queryClient.invalidateQueries({ queryKey: ["world-workspace", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["character-workspace", projectId] });
    }
  });

  if (assignments.length === 0) {
    return null;
  }

  return (
    <div className="scene-discovery-list" aria-label="Elementy do przypisania do sceny">
      <div className="scene-discovery-heading">
        <p className="eyebrow">Przypisanie</p>
        <span className="status-pill">{assignments.length}</span>
      </div>
      {assignments.map((assignment) => (
        <article className="scene-discovery-card" key={assignment.id}>
          <div>
            <span className="scene-discovery-kind">{assignmentKindLabel(assignment.kind)}</span>
            <h3>{assignment.entityTitle}</h3>
            <p>Przypisać do sceny: {assignment.sceneTitle || "Scena"}?</p>
            <small>Przypisanie zmieni tylko relacje tej sceny albo relacje elementu świata. Kanon encji zostaje bez zmian.</small>
          </div>
          <div className="scene-discovery-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => assignmentMutation.mutate(assignment)}
              disabled={assignmentMutation.isPending}
              title="Przypisz element do źródłowej sceny"
            >
              <Link2 size={14} />
              Przypisz
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeAssignment(assignment.id)}
              disabled={assignmentMutation.isPending}
            >
              Pomiń
            </Button>
          </div>
        </article>
      ))}
      {assignmentMutation.isError ? (
        <p className="warning-text">Nie udało się przypisać elementu do sceny.</p>
      ) : null}
    </div>
  );
}

async function persistCritiqueReport(
  report: SceneCritiqueReport,
  aiRunId?: string
): Promise<void> {
  try {
    await saveSceneCritique({
      id: report.id,
      projectId: report.projectId,
      bookId: report.bookId,
      sceneId: report.sceneId,
      aiRunId: aiRunId ?? null,
      summary: report.summary,
      findingsJson: serializeCritiqueFindings(report.findings),
      sourceHash: report.sourceHash
    });
  } catch (error) {
    console.warn("Nie udało się zapisać raportu krytyki sceny.", error);
  }
}

function SceneCritiquePanel({ critiques }: { critiques: SceneCritiqueReport[] }) {
  const setFindingStatus = useSceneCritiqueStore((state) => state.setFindingStatus);
  // Rejestr celów "Zastosuj" żyje poza Zustand — subskrybujemy zmiany, żeby
  // przyciski odblokowały się po otwarciu sceny w edytorze.
  const [, forceRender] = useState(0);
  useEffect(
    () => subscribeCritiqueApplyTargets(() => forceRender((value) => value + 1)),
    []
  );

  if (critiques.length === 0) {
    return null;
  }

  function updateFinding(
    critique: SceneCritiqueReport,
    findingId: string,
    status: SceneCritiqueReportFinding["status"]
  ) {
    setFindingStatus(critique.sceneId, findingId, status);
    const current = useSceneCritiqueStore
      .getState()
      .critiques.find((item) => item.sceneId === critique.sceneId);
    if (current) {
      void persistCritiqueReport(current);
    }
  }

  return (
    <div className="scene-discovery-list" aria-label="Uwagi redaktora">
      {critiques.map((critique) => {
        const openFindings = critique.findings.filter((finding) => finding.status === "open");
        const canApply = hasCritiqueApplyTarget(critique.sceneId);
        return (
          <article className="scene-discovery-card" key={critique.id}>
            <div>
              <span className="scene-discovery-kind">Redaktor</span>
              <h3>{critique.sceneTitle || "Scena"}</h3>
              {critique.summary ? <p>{critique.summary}</p> : null}
            </div>
            {openFindings.map((finding) => (
              <div className="scene-critique-finding" key={finding.id}>
                <p>
                  <strong>
                    {SCENE_CRITIQUE_CATEGORY_LABELS[finding.category]} ·{" "}
                    {SCENE_CRITIQUE_SEVERITY_LABELS[finding.severity]}
                  </strong>{" "}
                  — {finding.title}
                </p>
                <p>{finding.description}</p>
                {finding.quote ? (
                  <blockquote className="scene-critique-quote">„{finding.quote}"</blockquote>
                ) : null}
                <div className="scene-discovery-actions">
                  {finding.quote ? (
                    <Button
                      variant="ai"
                      size="sm"
                      disabled={!canApply}
                      title={
                        canApply
                          ? "Zaznacz cytowany fragment i wyślij do przepisania"
                          : "Otwórz tę scenę w edytorze, aby zastosować uwagę"
                      }
                      onClick={() => {
                        void applyCritiqueFinding(critique.sceneId, finding).then((applied) => {
                          if (applied) {
                            updateFinding(critique, finding.id, "applied");
                          }
                        });
                      }}
                    >
                      <Sparkles size={14} />
                      Zastosuj
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateFinding(critique, finding.id, "dismissed")}
                  >
                    Odrzuć
                  </Button>
                </div>
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function SceneDiscoveryPanel({
  projectId,
  discoveries
}: {
  projectId: string;
  discoveries: SceneDiscovery[];
}) {
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const removeDiscovery = useSceneDiscoveryStore((state) => state.removeDiscovery);
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

  if (discoveries.length === 0) {
    return null;
  }

  function queueDiscovery(discovery: SceneDiscovery) {
    const project = projectQuery.data?.project;
    const book = projectQuery.data?.book;
    const characters = characterQuery.data;
    const world = worldQuery.data;
    const plan = planQuery.data;
    if (!project || !book || !characters || !world || !plan) {
      return;
    }

    if (discovery.kind === "character") {
      const target = characterDraftFromDiscovery(discovery);
      const promptPackage = withSourceSceneDiscovery(
        buildCharacterPromptPackage(
          project,
          book,
          characters,
          "characterProfile",
          target
        ),
        discovery
      );
      enqueueProposal({
        scope: "characters",
        projectId,
        bookId: book.id,
        field: "characterProfile",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderCharacterPromptPackage(promptPackage)
      });
      removeDiscovery(discovery.id);
      return;
    }

    if (discovery.kind === "characterMemory") {
      const character = discovery.targetExistingCharacterId
        ? characters.characters.find((item) => item.id === discovery.targetExistingCharacterId)
        : null;
      if (!character) {
        return;
      }
      const target = characterMemoryDraftFromDiscovery(discovery, character);
      const promptPackage = withSourceSceneDiscovery(
        buildCharacterPromptPackage(
          project,
          book,
          characters,
          "characterMemory",
          target
        ),
        discovery
      );
      enqueueProposal({
        scope: "characters",
        projectId,
        bookId: book.id,
        field: "characterMemory",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderCharacterPromptPackage(promptPackage)
      });
      removeDiscovery(discovery.id);
      return;
    }

    if (discovery.kind === "characterRelation") {
      const target = characterRelationDraftFromDiscovery(discovery, characters.characters);
      if (!target) {
        return;
      }
      const promptPackage = withSourceSceneDiscovery(
        buildCharacterPromptPackage(
          project,
          book,
          characters,
          "characterRelation",
          target
        ),
        discovery
      );
      enqueueProposal({
        scope: "characters",
        projectId,
        bookId: book.id,
        field: "characterRelation",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderCharacterPromptPackage(promptPackage)
      });
      removeDiscovery(discovery.id);
      return;
    }

    if (discovery.kind === "worldElement") {
      const target = worldElementDraftFromDiscovery(discovery);
      const promptPackage = withSourceSceneDiscovery(
        buildWorldPromptPackage(
          project,
          book,
          plan,
          characters,
          world,
          "worldElement",
          target
        ),
        discovery
      );
      enqueueProposal({
        scope: "world",
        projectId,
        bookId: book.id,
        field: "worldElement",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderWorldPromptPackage(promptPackage)
      });
      removeDiscovery(discovery.id);
      return;
    }

    if (discovery.kind === "worldRule") {
      const target = worldRuleDraftFromDiscovery(discovery);
      const promptPackage = withSourceSceneDiscovery(
        buildWorldPromptPackage(
          project,
          book,
          plan,
          characters,
          world,
          "worldRule",
          target
        ),
        discovery
      );
      enqueueProposal({
        scope: "world",
        projectId,
        bookId: book.id,
        field: "worldRule",
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderWorldPromptPackage(promptPackage)
      });
      removeDiscovery(discovery.id);
    }
  }

  return (
    <div className="scene-discovery-list" aria-label="Znalezione elementy sceny">
      <div className="scene-discovery-heading">
        <p className="eyebrow">Analiza sceny</p>
        <span className="status-pill">{discoveries.length}</span>
      </div>
      {discoveries.map((discovery) => {
        const canGenerate =
          discoveryCanGenerate(discovery, characterQuery.data?.characters ?? []);
        return (
          <article className="scene-discovery-card" key={discovery.id}>
            <div>
              <span className="scene-discovery-kind">{discoveryKindLabel(discovery.kind)}</span>
              <h3>{discovery.title}</h3>
              <p>{discovery.reason}</p>
              <small>{discovery.evidence}</small>
            </div>
            <div className="scene-discovery-actions">
              <Button
                variant="ai"
                size="sm"
                onClick={() => queueDiscovery(discovery)}
                disabled={
                  !canGenerate ||
                  projectQuery.isLoading ||
                  planQuery.isLoading ||
                  characterQuery.isLoading ||
                  worldQuery.isLoading
                }
                title={canGenerate ? "Dodaj pełną propozycję do kolejki AI" : discoveryGenerateDisabledReason(discovery)}
              >
                <Sparkles size={14} />
                Generuj
              </Button>
              <Button variant="ghost" size="sm" onClick={() => removeDiscovery(discovery.id)}>
                Odrzuć
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

async function queueSceneAuditFromPrompt(
  prompt: PendingSceneAuditPrompt,
  enqueueProposal: ReturnType<typeof useProposalStore.getState>["enqueueProposal"]
) {
  const [projectDetails, plan, characters, world] = await Promise.all([
    getProject(prompt.projectId),
    getBookPlan(prompt.bookId),
    getCharacterWorkspace(prompt.projectId),
    getWorldWorkspace(prompt.projectId)
  ]);
  const scene = plan.scenes.find((item) => item.id === prompt.sceneId);
  if (!scene) {
    return;
  }
  const sceneContext = buildScenePromptContext({
    book: projectDetails.book,
    plan,
    characters,
    world,
    sceneId: scene.id
  });
  if (!sceneContext) {
    return;
  }

  const scenePlan =
    prompt.sourceKind === "scenePlan"
      ? scenePlanSnapshotFromScene(scene, prompt.analysisText)
      : null;
  const promptPackage = buildSceneStoryBibleAuditPromptPackage({
    project: projectDetails.project,
    book: projectDetails.book,
    scene,
    sceneContext,
    characters,
    world,
    acceptedText: prompt.sourceKind === "acceptedText" ? prompt.analysisText : "",
    scenePlan,
    sourceKind: prompt.sourceKind
  });

  enqueueProposal({
    scope: "sceneEditor",
    projectId: prompt.projectId,
    bookId: prompt.bookId,
    field: SCENE_STORY_BIBLE_AUDIT_FIELD,
    action: promptPackage.action,
    promptPackageId: promptPackage.id,
    promptPackageJson: promptPackage,
    prompt: renderSceneStoryBibleAuditPromptPackage(promptPackage)
  });
}

function sceneAuditPromptFromProposal(
  proposal: ActiveAiProposal
): Omit<PendingSceneAuditPrompt, "id" | "createdAt"> {
  const context =
    "context" in proposal.promptPackageJson
      ? proposal.promptPackageJson.context
      : {};
  const scopedContext =
    context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : {};
  const sceneSnapshot =
    "sceneContext" in scopedContext &&
    scopedContext.sceneContext &&
    typeof scopedContext.sceneContext === "object" &&
    !Array.isArray(scopedContext.sceneContext) &&
    "scene" in scopedContext.sceneContext
      ? (scopedContext.sceneContext.scene as Record<string, unknown>)
      : {};
  const sceneId =
    typeof scopedContext.targetEntityId === "string"
      ? scopedContext.targetEntityId
      : "";
  const sceneTitle =
    typeof sceneSnapshot.title === "string" && sceneSnapshot.title.trim()
      ? sceneSnapshot.title.trim()
      : "Scena";

  return {
    projectId: proposal.projectId,
    bookId: proposal.bookId,
    sceneId,
    sceneTitle,
    analysisText: proposal.editableValue.trim(),
    sourceKind: "acceptedText"
  };
}

function sceneAuditPromptsFromPlanResult(
  proposal: ActiveAiProposal,
  payload: unknown
): Array<Omit<PendingSceneAuditPrompt, "id" | "createdAt">> {
  const record = recordValue(payload);
  if (!Array.isArray(record.createdScenes)) {
    return [];
  }

  const prompts: Array<Omit<PendingSceneAuditPrompt, "id" | "createdAt">> = [];
  for (const item of record.createdScenes) {
    const scene = recordValue(item);
    const sceneId = stringRecordValue(scene.id);
    if (!sceneId) {
      continue;
    }

    prompts.push({
      projectId: proposal.projectId,
      bookId: proposal.bookId,
      sceneId,
      sceneTitle: stringRecordValue(scene.title, "Scena"),
      analysisText: stringRecordValue(scene.analysisText),
      sourceKind: "scenePlan"
    });
  }

  return prompts;
}

function scenePlanSnapshotFromScene(
  scene: {
    title: string;
    summary: string;
    goal: string;
    conflict: string;
    outcome: string;
    targetWordCount: number | null;
  },
  analysisText: string
): ScenePlanAuditSnapshot {
  return {
    title: scene.title,
    summary: scene.summary,
    goal: scene.goal,
    conflict: scene.conflict,
    outcome: scene.outcome,
    targetWordCount: scene.targetWordCount,
    analysisText
  };
}

function withSourceSceneDiscovery<T extends { context: object }>(
  promptPackage: T,
  discovery: SceneDiscovery
): T {
  return {
    ...promptPackage,
    context: {
      ...promptPackage.context,
      sourceSceneDiscovery: sourceSceneDiscoverySnapshot(discovery)
    }
  } as T;
}

function sourceSceneDiscoverySnapshot(discovery: SceneDiscovery): Record<string, unknown> {
  return {
    id: discovery.id,
    projectId: discovery.projectId,
    bookId: discovery.bookId,
    sceneId: discovery.sceneId,
    sceneTitle: discovery.sceneTitle ?? "Scena",
    kind: discovery.kind,
    title: discovery.title,
    reason: discovery.reason,
    evidence: discovery.evidence,
    targetExistingCharacterId: discovery.targetExistingCharacterId,
    relatedCharacterIds: discovery.relatedCharacterIds,
    suggestedType: discovery.suggestedType
  };
}

function sceneAssignmentFromAcceptedProposal(
  proposal: ActiveAiProposal,
  payload: unknown
): Omit<PendingSceneAssignment, "id" | "createdAt"> | null {
  const source = sourceSceneDiscoveryFromProposal(proposal);
  if (!source) {
    return null;
  }

  const base = {
    projectId: proposal.projectId,
    bookId: proposal.bookId,
    sceneId: source.sceneId,
    sceneTitle: source.sceneTitle
  };

  if (proposal.scope === "characters") {
    const field = characterFieldFromProposal(proposal);
    const record = recordValue(payload);

    if (field === "characterProfile") {
      const characterId = stringRecordValue(record.id);
      if (!characterId) {
        return null;
      }
      return {
        ...base,
        kind: "character",
        entityId: characterId,
        entityTitle: stringRecordValue(record.name, "Nowa postać"),
        characterIds: [characterId]
      };
    }

    if (field === "characterMemory") {
      const memoryId = stringRecordValue(record.id);
      const characterId = stringRecordValue(record.characterId);
      if (!memoryId || !characterId) {
        return null;
      }
      return {
        ...base,
        kind: "characterMemory",
        entityId: memoryId,
        entityTitle: stringRecordValue(record.title, "Nowe wspomnienie"),
        characterIds: [characterId]
      };
    }

    if (field === "characterRelation") {
      const relationId = stringRecordValue(record.id);
      const characterIds = [
        stringRecordValue(record.fromCharacterId),
        stringRecordValue(record.toCharacterId)
      ].filter(Boolean);
      if (!relationId || characterIds.length === 0) {
        return null;
      }
      return {
        ...base,
        kind: "characterRelation",
        entityId: relationId,
        entityTitle: stringRecordValue(record.relationType, "Relacja postaci"),
        characterIds
      };
    }
  }

  if (proposal.scope === "world") {
    const record = recordValue(payload);
    const entityId = stringRecordValue(record.id);
    if (!entityId) {
      return null;
    }

    if (proposal.field === "worldElement") {
      return {
        ...base,
        kind: "worldElement",
        entityId,
        entityTitle: stringRecordValue(record.name, "Nowy element świata")
      };
    }

    if (proposal.field === "worldRule") {
      return {
        ...base,
        kind: "worldRule",
        entityId,
        entityTitle: stringRecordValue(record.name, "Nowa reguła świata")
      };
    }
  }

  return null;
}

function sourceSceneDiscoveryFromProposal(
  proposal: ActiveAiProposal
): { sceneId: string; sceneTitle: string } | null {
  const context =
    "context" in proposal.promptPackageJson
      ? recordValue(proposal.promptPackageJson.context)
      : {};
  const source = recordValue(context.sourceSceneDiscovery);
  const sceneId = stringRecordValue(source.sceneId);
  if (!sceneId) {
    return null;
  }

  return {
    sceneId,
    sceneTitle: stringRecordValue(source.sceneTitle, "Scena")
  };
}

async function assignPendingSceneAssignment(
  assignment: PendingSceneAssignment
): Promise<void> {
  const [plan, world] = await Promise.all([
    getBookPlan(assignment.bookId),
    getWorldWorkspace(assignment.projectId)
  ]);
  const scene = plan.scenes.find((item) => item.id === assignment.sceneId);
  if (!scene) {
    throw new Error("Nie znaleziono sceny do przypisania.");
  }

  if (
    assignment.kind === "character" ||
    assignment.kind === "characterMemory" ||
    assignment.kind === "characterRelation"
  ) {
    await assignCharactersToScene(plan, assignment, assignment.characterIds ?? []);
    return;
  }

  if (assignment.kind === "worldElement") {
    await assignWorldElementToScene(world, assignment, scene.chapterId);
    return;
  }

  await assignWorldRuleToScene(world, assignment, scene.chapterId);
}

async function assignCharactersToScene(
  plan: BookPlan,
  assignment: PendingSceneAssignment,
  characterIds: string[]
): Promise<void> {
  const sceneId = assignment.sceneId;
  await setSceneRelations({
    bookId: assignment.bookId,
    sceneId,
    characterIds: uniqueStrings([...sceneCharacterIds(plan, sceneId), ...characterIds]),
    threadIds: sceneThreadIds(plan, sceneId),
    elementIds: sceneElementIds(plan, sceneId),
    ruleIds: sceneRuleIds(plan, sceneId)
  });
}

async function assignWorldElementToScene(
  world: WorldWorkspace,
  assignment: PendingSceneAssignment,
  chapterId: string | null
): Promise<void> {
  const elementId = assignment.entityId;
  await setWorldElementRelations({
    projectId: assignment.projectId,
    elementId,
    characterIds: world.elementCharacters
      .filter((item) => item.elementId === elementId)
      .map((item) => item.characterId),
    threadIds: world.elementThreads
      .filter((item) => item.elementId === elementId)
      .map((item) => item.threadId),
    chapterIds: uniqueStrings([
      ...world.elementChapters
        .filter((item) => item.elementId === elementId)
        .map((item) => item.chapterId),
      ...(chapterId ? [chapterId] : [])
    ]),
    sceneIds: uniqueStrings([
      ...world.elementScenes
        .filter((item) => item.elementId === elementId)
        .map((item) => item.sceneId),
      assignment.sceneId
    ]),
    ruleIds: world.elementRules
      .filter((item) => item.elementId === elementId)
      .map((item) => item.ruleId)
  });
}

async function assignWorldRuleToScene(
  world: WorldWorkspace,
  assignment: PendingSceneAssignment,
  chapterId: string | null
): Promise<void> {
  const ruleId = assignment.entityId;
  await setWorldRuleRelations({
    projectId: assignment.projectId,
    ruleId,
    elementIds: world.elementRules
      .filter((item) => item.ruleId === ruleId)
      .map((item) => item.elementId),
    threadIds: world.ruleThreads
      .filter((item) => item.ruleId === ruleId)
      .map((item) => item.threadId),
    chapterIds: uniqueStrings([
      ...world.ruleChapters
        .filter((item) => item.ruleId === ruleId)
        .map((item) => item.chapterId),
      ...(chapterId ? [chapterId] : [])
    ]),
    sceneIds: uniqueStrings([
      ...world.ruleScenes
        .filter((item) => item.ruleId === ruleId)
        .map((item) => item.sceneId),
      assignment.sceneId
    ])
  });
}

function sceneCharacterIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneCharacters
    .filter((item) => item.sceneId === sceneId)
    .map((item) => item.characterId);
}

function sceneThreadIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneThreads
    .filter((item) => item.sceneId === sceneId)
    .map((item) => item.threadId);
}

function sceneElementIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneWorldElements
    .filter((item) => item.sceneId === sceneId)
    .map((item) => item.elementId);
}

function sceneRuleIds(plan: BookPlan, sceneId: string): string[] {
  return plan.sceneWorldRules
    .filter((item) => item.sceneId === sceneId)
    .map((item) => item.ruleId);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function ProposalQueueItem({
  proposal,
  accepting,
  retrying,
  cancelling,
  activeRun,
  onAccept,
  onAcceptAsPlanVersion,
  onCancel,
  onClear,
  onRetry,
  onPreview,
  onEditableValueChange,
  onEditableFieldChange,
  onToggleField
}: ProposalQueueItemProps) {
  const coverProposal = isBookCoverProposal(proposal);
  const characterImageProposal = isCharacterImageProposal(proposal);
  const exportArtworkProposal = isExportArtworkProposal(proposal);
  const planProposal = proposal.scope === "bookPlan";
  const characterProposal = proposal.scope === "characters";
  const worldProposal = proposal.scope === "world";
  const sceneEditorProposal = proposal.scope === "sceneEditor";
  const sceneAuditProposal = proposal.field === SCENE_STORY_BIBLE_AUDIT_FIELD;
  const sceneCritiqueProposal = proposal.field === SCENE_CRITIQUE_FIELD;
  const label = sceneAuditProposal
    ? "Analiza sceny"
    : sceneCritiqueProposal
    ? "Krytyka sceny"
    : exportArtworkProposal
    ? "Grafika eksportu"
    : coverProposal
    ? "Okładka"
    : planProposal
      ? planFieldConfigs[proposal.field as PlanFieldKey]?.label ?? "Plan"
        : characterImageProposal
          ? "Obraz postaci"
        : characterProposal
          ? characterFieldConfigs[proposal.field as CharacterFieldKey]?.label ?? "Postać"
          : worldProposal
            ? worldFieldConfigs[proposal.field as WorldFieldKey]?.label ?? "Świat"
            : sceneEditorProposal && !sceneCritiqueProposal
              ? sceneEditorFieldLabel(proposal.field as SceneEditorFieldKey)
              : conceptFieldConfigs[proposal.field as ConceptFieldKey]?.label ?? "Pole";
  const running = proposal.status === "running";
  const queued = proposal.status === "queued";
  const success = proposal.status === "success";
  const error = proposal.status === "error";
  const premiseProposal = isPremiseDevelopment(proposal.parsed)
    ? proposal.parsed
    : null;
  const structured = premiseProposal !== null;
  const proposalRows =
    !coverProposal &&
    !exportArtworkProposal &&
    !characterProposal &&
    !worldProposal &&
    !sceneAuditProposal &&
    !sceneCritiqueProposal &&
    !sceneEditorProposal &&
    !planProposal &&
    (longConceptFields.includes(proposal.field as ConceptFieldKey) || structured)
      ? 8
      : 3;
  const canAccept = proposalCanAccept(proposal);
  const canAcceptAsPlanVersion =
    planProposal &&
    isLargePlanField(proposal.field as PlanFieldKey) &&
    success &&
    canAccept;

  return (
    <article className={`proposal-queue-item ${proposal.status}`}>
      <div className="proposal-queue-heading">
        <div>
          <p className="eyebrow">
            {coverProposal
              ? "Okładka"
              : proposal.scope === "newProject"
                ? "Nowy projekt"
                : planProposal
                  ? "Plan"
                  : characterProposal
                    ? "Postacie"
                    : worldProposal
                      ? "Świat"
                      : sceneAuditProposal
                        ? "Analiza"
                        : sceneCritiqueProposal
                          ? "Redaktor"
                          : "Pole"}
          </p>
          <h3>{label}</h3>
        </div>
        <span className={statusClassName(proposal.status)}>
          {running ? <Loader2 size={14} className="spin-icon" /> : null}
          {statusLabel(proposal.status)}
        </span>
      </div>

      {proposal.parsed?.summary ? (
        <p className="muted-text">{proposal.parsed.summary}</p>
      ) : null}

      {queued ? (
        <p className="muted-text">
          Zadanie czeka, aż poprzednia generacja w kolejce się zakończy.
        </p>
      ) : null}

      {running ? (
        <p className="muted-text">
          {coverProposal
            ? proposal.progressMessage ?? "Codex CLI generuje okładkę."
            : "Codex CLI generuje wynik. Propozycja nie zapisze się bez akceptacji."}
        </p>
      ) : null}

      {running && activeRun ? (
        <p className="muted-text">
          Aktywny proces: {activeRun.action} / {activeRun.phase}
        </p>
      ) : null}

      {coverProposal && proposal.progressMessage && !running ? (
        <p className="muted-text">{proposal.progressMessage}</p>
      ) : null}

      {(coverProposal || characterImageProposal || exportArtworkProposal) &&
      (proposal.partialImageDataUrl || proposal.coverImagePath || proposal.characterImagePath || proposal.exportArtworkPath) ? (
        <button
          type="button"
          className="proposal-cover-preview proposal-cover-preview-button"
          onClick={() =>
            onPreview(
              coverImageSource(
                proposal.partialImageDataUrl ||
                  proposal.coverImagePath ||
                  proposal.characterImagePath ||
                  proposal.exportArtworkPath
              ),
              "Podgląd okładki z AI"
            )
          }
          title="Otwórz okładkę w pełnym podglądzie"
        >
          <img
            src={coverImageSource(
              proposal.partialImageDataUrl ||
                proposal.coverImagePath ||
                proposal.characterImagePath ||
                proposal.exportArtworkPath
            )}
            alt="Podgląd okładki z AI"
          />
        </button>
      ) : null}

      {coverProposal && running ? (
        <div className="cover-progress active" role="status" aria-live="polite">
          <div className="cover-progress-track" aria-hidden="true">
            <span />
          </div>
        </div>
      ) : null}

      {(coverProposal || characterImageProposal || exportArtworkProposal) && success ? (
        <p className="success-text">
          Okładka jest gotowa do akceptacji.
        </p>
      ) : null}

      {success && premiseProposal ? (
        <div className="proposal-field-list">
          {premiseProposal.fieldValues.map((item) => {
            const selected = proposal.selectedFields[item.field] !== false;
            const rows = longConceptFields.includes(item.field) ? 5 : 3;
            return (
              <div className="proposal-field-item" key={item.field}>
                <label className="proposal-field-toggle">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleField(item.field)}
                  />
                  <span>{item.label}</span>
                </label>
                <textarea
                  aria-label={`Edytuj ${item.label}`}
                  value={proposal.editableFields[item.field] ?? item.value}
                  onChange={(event) =>
                    onEditableFieldChange(item.field, event.target.value)
                  }
                  rows={rows}
                  disabled={!selected}
                  title={`Możesz poprawić propozycję dla pola ${item.label} przed zapisem.`}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {success && !structured && !coverProposal && !characterImageProposal && !sceneAuditProposal && !sceneCritiqueProposal ? (
        <label className="field-label">
          {sceneEditorProposal
            ? "Tekst do wstawienia po akceptacji"
            : planProposal
              ? "Propozycja do zastosowania w widoku Plan"
              : "Propozycja do akceptacji"}
          <textarea
            value={proposal.editableValue}
            onChange={(event) => onEditableValueChange(event.target.value)}
            rows={sceneEditorProposal ? 10 : planProposal ? 8 : proposalRows}
            title={`Możesz poprawić propozycję dla pola ${label} przed zapisem.`}
          />
        </label>
      ) : null}

      {planProposal && success ? (
        <p className="muted-text">
          Akceptacja zapisze tylko zakres tego widoku planu. Pozostałe sekcje z
          odpowiedzi AI zostaną pominięte.
        </p>
      ) : null}

      {sceneEditorProposal && !sceneAuditProposal && !sceneCritiqueProposal && success ? (
        <p className="muted-text">
          Akceptacja zastosuje tekst w aktywnym edytorze sceny zgodnie z trybem
          wstawiania zapisanym w prompcie. Do tego momentu manuskrypt się nie zmieni.
        </p>
      ) : null}

      {sceneAuditProposal && success ? (
        <p className="muted-text">Analiza zakończona. Znalezione elementy dodano do kart w prawym panelu.</p>
      ) : null}

      {sceneCritiqueProposal && success ? (
        <p className="muted-text">Krytyka zakończona. Uwagi redaktora pojawiły się jako karty w tym panelu.</p>
      ) : null}

      {proposal.parsed && "rationale" in proposal.parsed && proposal.parsed.rationale ? (
        <p className="muted-text">{proposal.parsed.rationale}</p>
      ) : null}

      {proposal.errorMessage ? (
        <p className="warning-text">{proposal.errorMessage}</p>
      ) : null}

      {proposal.parsed && proposal.parsed.warnings.length > 0 ? (
        <div className="warning-box">
          {proposal.parsed.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {premiseProposal && premiseProposal.questionsForAuthor.length > 0 ? (
        <details className="raw-output">
          <summary>Pytania dla autora</summary>
          <ul>
            {premiseProposal.questionsForAuthor.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {proposal.rawOutput ? (
        <details className="raw-output">
          <summary>Surowy wynik</summary>
          <pre>{proposal.rawOutput}</pre>
        </details>
      ) : null}

      <div className="button-row">
        {!sceneAuditProposal && !sceneCritiqueProposal ? (
          <Button
            variant="primary"
            busy={accepting}
            onClick={onAccept}
            disabled={running || queued || error || !canAccept}
          >
            {accepting ? null : <Check size={16} />}
            {accepting ? "Zapisuję" : "Akceptuj"}
          </Button>
        ) : null}
        {canAcceptAsPlanVersion ? (
          <Button
            onClick={onAcceptAsPlanVersion}
            disabled={accepting || running || queued || error || !canAccept}
          >
            <GitBranch size={16} />
            Akceptuj jako wariant
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={onClear}
          disabled={accepting || running}
        >
          <X size={16} />
          {sceneAuditProposal || sceneCritiqueProposal ? "Zamknij" : "Odrzuć"}
        </Button>
        {running ? (
          <Button
            variant="ghost"
            busy={cancelling}
            onClick={onCancel}
            title="Przerwij aktualną generację Codex CLI."
          >
            {cancelling ? null : <CircleStop size={16} />}
            Przerwij
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={onRetry}
          disabled={running || queued || accepting || retrying}
          title="Ponownie uruchom ten sam prompt z zapisanym snapshotem kontekstu."
        >
          <RotateCcw size={16} />
          Ponów
        </Button>
      </div>
    </article>
  );
}

function useAiQueueRunner() {
  const queuedProposal = useProposalStore((state) =>
    state.proposals.find((proposal) => proposal.status === "queued")
  );
  const hasRunningProposal = useProposalStore((state) =>
    state.proposals.some((proposal) => proposal.status === "running")
  );
  const startQueuedProposal = useProposalStore((state) => state.startQueuedProposal);
  const finishProposal = useProposalStore((state) => state.finishProposal);
  const failProposal = useProposalStore((state) => state.failProposal);
  const cancelProposal = useProposalStore((state) => state.cancelProposal);
  const updateProposalProgress = useProposalStore(
    (state) => state.updateProposalProgress
  );
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const model = useCodexSettingsStore((state) => state.model);
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );

  useEffect(() => {
    if (!queuedProposal || hasRunningProposal) {
      return;
    }

    const proposalId = queuedProposal.id;
    startQueuedProposal(proposalId);

    async function runQueuedProposal() {
      const snapshot = useProposalStore
        .getState()
        .proposals.find((proposal) => proposal.id === proposalId);
      if (!snapshot) {
        return;
      }

      try {
        if (isBookCoverProposal(snapshot)) {
          updateProposalProgress(proposalId, {
            progressMessage: "Przygotowuję prompt okładki..."
          });

          if (!snapshot.coverPrompt || !snapshot.coverNegativePrompt) {
            throw new QueueRunError("Brak promptu okładki w zadaniu kolejki.");
          }

          const result = await generateBookCover({
            projectId: snapshot.projectId,
            bookId: snapshot.bookId,
            promptPackageId: snapshot.promptPackageId,
            promptPackageJson: snapshot.promptPackageJson,
            prompt: snapshot.prompt,
            coverPrompt: snapshot.coverPrompt,
            coverNegativePrompt: snapshot.coverNegativePrompt,
            codexPath,
            timeoutSeconds,
            model,
            reasoningEffort
          });

          if (result.aiRun.status !== "success") {
            if (result.aiRun.status === "cancelled") {
              cancelProposal(proposalId, result.aiRun.errorMessage ?? "Generowanie Codex CLI zostało przerwane.");
              return;
            }
            throw new QueueRunError(
              result.aiRun.errorMessage || "Nie udało się utworzyć okładki.",
              result.aiRun.rawOutput ?? ""
            );
          }

          finishProposal(proposalId, {
            aiRunId: result.aiRun.id,
            rawOutput: result.aiRun.rawOutput ?? "",
            editableValue: result.imagePath,
            durationMs: result.aiRun.durationMs,
            coverImagePath: result.imagePath,
            coverGeneratedAt: result.generatedAt,
            progressMessage: "Okładka gotowa do akceptacji.",
            progress: 100,
            partialImageDataUrl: null
          });
          return;
        }

        if (isCharacterImageProposal(snapshot)) {
          updateProposalProgress(proposalId, {
            progressMessage: "Przygotowuję prompt obrazu postaci..."
          });

          if (!snapshot.coverPrompt || !snapshot.coverNegativePrompt) {
            throw new QueueRunError("Brak promptu obrazu postaci w zadaniu kolejki.");
          }

          const context =
            "context" in snapshot.promptPackageJson
              ? snapshot.promptPackageJson.context
              : {};
          const scopedContext =
            context && typeof context === "object"
              ? (context as Record<string, unknown>)
              : {};
          const characterId =
            typeof scopedContext.targetEntityId === "string"
              ? scopedContext.targetEntityId
              : "";
          if (!characterId) {
            throw new QueueRunError("Brak docelowej postaci dla obrazu.");
          }

          const result = await generateCharacterImage({
            projectId: snapshot.projectId,
            characterId,
            promptPackageId: snapshot.promptPackageId,
            promptPackageJson: snapshot.promptPackageJson,
            prompt: snapshot.prompt,
            imagePrompt: snapshot.coverPrompt,
            negativePrompt: snapshot.coverNegativePrompt,
            codexPath,
            timeoutSeconds,
            model,
            reasoningEffort
          });

          if (result.aiRun.status !== "success") {
            if (result.aiRun.status === "cancelled") {
              cancelProposal(proposalId, result.aiRun.errorMessage ?? "Generowanie Codex CLI zostało przerwane.");
              return;
            }
            throw new QueueRunError(
              result.aiRun.errorMessage || "Nie udało się utworzyć obrazu postaci.",
              result.aiRun.rawOutput ?? ""
            );
          }

          finishProposal(proposalId, {
            aiRunId: result.aiRun.id,
            rawOutput: result.aiRun.rawOutput ?? "",
            editableValue: result.imagePath,
            durationMs: result.aiRun.durationMs,
            coverImagePath: result.imagePath,
            characterImagePath: result.imagePath,
            characterGeneratedAt: result.generatedAt,
            progressMessage: "Obraz postaci gotowy do akceptacji.",
            progress: 100,
            partialImageDataUrl: null
          });
          return;
        }

        if (isExportArtworkProposal(snapshot)) {
          updateProposalProgress(proposalId, {
            progressMessage: "Przygotowuję prompt grafiki eksportu..."
          });

          if (!snapshot.coverPrompt || !snapshot.coverNegativePrompt) {
            throw new QueueRunError("Brak promptu grafiki eksportu w zadaniu kolejki.");
          }

          const context =
            "context" in snapshot.promptPackageJson
              ? snapshot.promptPackageJson.context
              : {};
          const scopedContext =
            context && typeof context === "object"
              ? (context as Record<string, unknown>)
              : {};
          const relatedType =
            scopedContext.relatedType === "chapter" ||
            scopedContext.relatedType === "scene" ||
            scopedContext.relatedType === "book"
              ? scopedContext.relatedType
              : "book";
          const relatedId =
            typeof scopedContext.targetEntityId === "string"
              ? scopedContext.targetEntityId
              : snapshot.bookId;

          const result = await generateExportArtwork({
            projectId: snapshot.projectId,
            bookId: snapshot.bookId,
            relatedType,
            relatedId,
            promptPackageId: snapshot.promptPackageId,
            promptPackageJson: snapshot.promptPackageJson,
            prompt: snapshot.prompt,
            imagePrompt: snapshot.coverPrompt,
            negativePrompt: snapshot.coverNegativePrompt,
            codexPath,
            timeoutSeconds,
            model,
            reasoningEffort
          });

          if (result.aiRun.status !== "success") {
            if (result.aiRun.status === "cancelled") {
              cancelProposal(proposalId, result.aiRun.errorMessage ?? "Generowanie Codex CLI zostało przerwane.");
              return;
            }
            throw new QueueRunError(
              result.aiRun.errorMessage || "Nie udało się utworzyć grafiki eksportu.",
              result.aiRun.rawOutput ?? ""
            );
          }

          finishProposal(proposalId, {
            aiRunId: result.aiRun.id,
            rawOutput: result.aiRun.rawOutput ?? "",
            editableValue: result.imagePath,
            durationMs: result.aiRun.durationMs,
            coverImagePath: result.imagePath,
            exportArtworkPath: result.imagePath,
            exportArtworkGeneratedAt: result.generatedAt,
            progressMessage: "Grafika eksportu gotowa do akceptacji.",
            progress: 100,
            partialImageDataUrl: null
          });
          return;
        }

        const result =
          snapshot.scope === "newProject"
            ? await generateNewProjectTitle({
                action: "generate_working_title",
                promptPackageId: snapshot.promptPackageId,
                promptPackageJson: snapshot.promptPackageJson,
                prompt: snapshot.prompt,
                codexPath,
                timeoutSeconds,
                model,
                reasoningEffort
              })
            : await runCodexPrompt({
                projectId: snapshot.projectId,
                action: snapshot.action,
                promptPackageId: snapshot.promptPackageId,
                promptPackageJson: snapshot.promptPackageJson,
                prompt: snapshot.prompt,
                codexPath,
                timeoutSeconds,
                model,
                reasoningEffort
              });

        if (result.status !== "success" || !result.rawOutput) {
          if (result.status === "cancelled") {
            cancelProposal(proposalId, result.errorMessage ?? "Generowanie Codex CLI zostało przerwane.");
            return;
          }
          throw new QueueRunError(
            result.errorMessage || "Codex CLI nie zwrócił wyniku.",
            result.rawOutput ?? ""
          );
        }

        const parsed = parseProposalResult(
          result.rawOutput,
          snapshot.field as ConceptFieldKey | PlanFieldKey | CharacterFieldKey | WorldFieldKey | SceneEditorFieldKey | typeof SCENE_STORY_BIBLE_AUDIT_FIELD | typeof SCENE_CRITIQUE_FIELD,
          snapshot.action
        );
        if (parsed.kind === "scene_critique") {
          const context =
            "context" in snapshot.promptPackageJson
              ? snapshot.promptPackageJson.context
              : {};
          const scopedContext =
            context && typeof context === "object"
              ? (context as Record<string, unknown>)
              : {};
          const sceneId =
            typeof scopedContext.targetEntityId === "string"
              ? scopedContext.targetEntityId
              : "";
          const sceneSnapshot = recordValue(scopedContext.scene);
          const sceneTitle = stringRecordValue(sceneSnapshot.title, "Scena");
          const sourceHash =
            typeof scopedContext.sourceHash === "string" ? scopedContext.sourceHash : "";
          if (sceneId) {
            const report = useSceneCritiqueStore.getState().setCritique({
              projectId: snapshot.projectId,
              bookId: snapshot.bookId,
              sceneId,
              sceneTitle,
              summary: parsed.summary,
              findings: parsed.findings,
              sourceHash
            });
            void persistCritiqueReport(report, result.id);
          }
        }
        if (parsed.kind === "scene_story_bible_audit") {
          const context =
            "context" in snapshot.promptPackageJson
              ? snapshot.promptPackageJson.context
              : {};
          const scopedContext =
            context && typeof context === "object"
              ? (context as Record<string, unknown>)
              : {};
          const sceneId =
            typeof scopedContext.targetEntityId === "string"
              ? scopedContext.targetEntityId
              : "";
          const sceneSnapshot = recordValue(scopedContext.scene);
          const sceneTitle = stringRecordValue(sceneSnapshot.title, "Scena");
          if (sceneId) {
            useSceneDiscoveryStore.getState().addCandidates({
              projectId: snapshot.projectId,
              bookId: snapshot.bookId,
              sceneId,
              sceneTitle,
              candidates: parsed.candidates
            });
          }
        }
        finishProposal(proposalId, {
          aiRunId: result.id,
          rawOutput: result.rawOutput ?? "",
          parsed,
          editableValue: parsed.textValue,
          editableFields: editableFieldsFromParsed(parsed),
          selectedFields: selectedFieldsFromParsed(parsed),
          durationMs: result.durationMs
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rawOutput = error instanceof QueueRunError ? error.rawOutput : "";
        failProposal(proposalId, message, rawOutput);
      }
    }

    void runQueuedProposal();
  }, [
    queuedProposal?.id,
    hasRunningProposal,
    startQueuedProposal,
    finishProposal,
    failProposal,
    cancelProposal,
    updateProposalProgress,
    codexPath,
    timeoutSeconds,
    model,
    reasoningEffort
  ]);
}

function useCoverGenerationProgressListener() {
  const updateProposalProgress = useProposalStore(
    (state) => state.updateProposalProgress
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<CoverGenerationProgressEvent>(
      "cover-generation-progress",
      (event) => {
        const payload = event.payload;
        const proposal = useProposalStore
          .getState()
          .proposals.find(
            (item) =>
              isBookCoverProposal(item) &&
              item.projectId === payload.projectId &&
              item.bookId === payload.bookId &&
              (item.status === "running" ||
                item.status === "queued" ||
                item.aiRunId === payload.aiRunId)
          );

        if (!proposal) {
          return;
        }

        updateProposalProgress(proposal.id, {
          progressMessage: payload.message,
          progress: payload.progress ?? null,
          ...(payload.partialImageDataUrl
            ? { partialImageDataUrl: payload.partialImageDataUrl }
            : {})
        });
      }
    );

    return () => {
      cancelled = true;
      unlistenPromise
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          }
        })
        .catch(() => undefined);
    };
  }, [updateProposalProgress]);
}

export function parseProposalResult(
  rawOutput: string,
  expectedField: ConceptFieldKey | PlanFieldKey | CharacterFieldKey | WorldFieldKey | SceneEditorFieldKey | typeof SCENE_STORY_BIBLE_AUDIT_FIELD | typeof SCENE_CRITIQUE_FIELD,
  action: string
): ParsedAiProposal {
  if (action === "analyze_scene_story_bible_opportunities") {
    return parseSceneStoryBibleAuditResult(rawOutput);
  }

  if (action === "critique_scene") {
    return parseSceneCritiqueResult(rawOutput);
  }

  if (isPlanAction(action)) {
    return parsePlanSuggestion(rawOutput, expectedField as PlanFieldKey);
  }

  if (isCharacterAction(action)) {
    return parseCharacterSuggestion(rawOutput, expectedField as CharacterFieldKey);
  }

  if (isWorldAction(action)) {
    return parseWorldSuggestion(rawOutput, expectedField as WorldFieldKey);
  }

  if (isSceneEditorAction(action)) {
    return {
      kind: "book_plan_suggestion",
      summary: "Propozycja tekstu sceny",
      textValue: parseSceneEditorResult(rawOutput),
      value: rawOutput,
      warnings: []
    };
  }

  if (action === "expand_premise") {
    return parsePremiseDevelopment(rawOutput);
  }

  return parseConceptFieldSuggestion(rawOutput, expectedField as ConceptFieldKey);
}

function parseCharacterSuggestion(
  rawOutput: string,
  expectedField: CharacterFieldKey
): ParsedAiProposal {
  const parsed = parseModelJson(rawOutput, "Propozycja postaci");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (expectedField === "characterProfile" && record.kind === "character_profile") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowa postać",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (expectedField === "characterRelation" && record.kind === "character_relation") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowa relacja",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (expectedField === "characterMemory" && record.kind === "character_memory") {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string" ? record.summary : "Nowe wspomnienie",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (record.kind !== "character_field_suggestion") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ propozycji postaci (kind: ${JSON.stringify(record.kind ?? null)}).`
    );
  }
  if (record.field !== expectedField) {
    throw new Error(
      `AI zwróciło propozycję dla pola ${JSON.stringify(record.field ?? null)}, oczekiwano ${expectedField}.`
    );
  }
  const rawValue = record.value;
  const textValue = expectedField.endsWith("Json")
    ? coerceProposalJsonArrayText(rawValue)
    : coerceProposalText(rawValue);

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja postaci",
    textValue,
    value: parsed,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function parseWorldSuggestion(
  rawOutput: string,
  expectedField: WorldFieldKey
): ParsedAiProposal {
  const parsed = parseModelJson(rawOutput, "Propozycja świata");
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  if (
    (expectedField === "worldElement" && record.kind === "world_element") ||
    (expectedField === "worldRule" && record.kind === "world_rule") ||
    (expectedField === "worldRuleAnalysis" && record.kind === "world_rule_analysis")
  ) {
    return {
      kind: "book_plan_suggestion",
      summary: typeof record.summary === "string"
        ? record.summary
        : typeof record.ruleName === "string"
          ? record.ruleName
          : "Propozycja świata",
      textValue: JSON.stringify(parsed, null, 2),
      value: parsed,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  if (record.kind !== "world_field_suggestion") {
    throw new Error(
      `AI zwróciło nieprawidłowy typ propozycji świata (kind: ${JSON.stringify(record.kind ?? null)}).`
    );
  }
  if (record.field !== expectedField) {
    throw new Error(
      `AI zwróciło propozycję dla pola ${JSON.stringify(record.field ?? null)}, oczekiwano ${expectedField}.`
    );
  }

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja świata",
    textValue: coerceProposalText(record.value),
    value: parsed,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

export function characterProfileInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertCharacterInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const character = recordValue(parsed.character);
  const projectId = stringRecordValue(snapshot.projectId, proposal.projectId);

  if (!projectId) {
    throw new Error("Brak projektu dla zapisu postaci AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-character"),
    projectId,
    characterType: stringRecordValue(character.characterType, stringRecordValue(snapshot.characterType, "person")),
    name: stringRecordValue(character.name, stringRecordValue(snapshot.name, "Nowa postać")),
    aliasesJson: arrayJsonRecordValue(character.aliases, stringRecordValue(snapshot.aliasesJson, "[]")),
    role: stringRecordValue(character.role, stringRecordValue(snapshot.role)),
    shortDescription: stringRecordValue(character.shortDescription, stringRecordValue(snapshot.shortDescription)),
    externalGoal: stringRecordValue(character.externalGoal, stringRecordValue(snapshot.externalGoal)),
    internalNeed: stringRecordValue(character.internalNeed, stringRecordValue(snapshot.internalNeed)),
    wound: stringRecordValue(character.wound, stringRecordValue(snapshot.wound)),
    falseBelief: stringRecordValue(character.falseBelief, stringRecordValue(snapshot.falseBelief)),
    secret: stringRecordValue(character.secret, stringRecordValue(snapshot.secret)),
    strengthsJson: arrayJsonRecordValue(character.strengths, stringRecordValue(snapshot.strengthsJson, "[]")),
    weaknessesJson: arrayJsonRecordValue(character.weaknesses, stringRecordValue(snapshot.weaknessesJson, "[]")),
    voiceNotes: stringRecordValue(character.voiceNotes, stringRecordValue(snapshot.voiceNotes)),
    arcSummary: stringRecordValue(character.arcSummary, stringRecordValue(snapshot.arcSummary)),
    knowledgeNotes: stringRecordValue(character.knowledgeNotes, stringRecordValue(snapshot.knowledgeNotes)),
    visualPrompt: stringRecordValue(character.visualPrompt, stringRecordValue(snapshot.visualPrompt)),
    imageAssetId: stringRecordValue(snapshot.imageAssetId) || null,
    status: stringRecordValue(snapshot.status, "draft"),
    orderIndex: boundedNumberRecordValue(snapshot.orderIndex, 0)
  };
}

async function characterFieldInputFromProposal(
  proposal: ActiveAiProposal,
  characterId: string,
  field: CharacterFieldKey
): Promise<UpsertCharacterInput> {
  const workspace = await getCharacterWorkspace(proposal.projectId);
  const character = workspace.characters.find((item) => item.id === characterId);
  if (!character) {
    throw new Error("Nie znaleziono postaci dla tej propozycji AI.");
  }

  const input: UpsertCharacterInput = {
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
    imageAssetId: character.imageAssetId || null,
    status: character.status,
    orderIndex: character.orderIndex
  };
  const value = proposal.editableValue.trim();

  if (field === "aliasesJson" || field === "strengthsJson" || field === "weaknessesJson") {
    input[field] = normalizeJsonArrayString(value);
    return input;
  }

  switch (field) {
    case "characterType":
      input.characterType = value;
      break;
    case "name":
      input.name = value;
      break;
    case "role":
      input.role = value;
      break;
    case "shortDescription":
      input.shortDescription = value;
      break;
    case "externalGoal":
      input.externalGoal = value;
      break;
    case "internalNeed":
      input.internalNeed = value;
      break;
    case "wound":
      input.wound = value;
      break;
    case "falseBelief":
      input.falseBelief = value;
      break;
    case "secret":
      input.secret = value;
      break;
    case "voiceNotes":
      input.voiceNotes = value;
      break;
    case "arcSummary":
      input.arcSummary = value;
      break;
    case "knowledgeNotes":
      input.knowledgeNotes = value;
      break;
    case "visualPrompt":
      input.visualPrompt = value;
      break;
  }
  return input;
}

function characterFieldFromProposal(proposal: ActiveAiProposal): CharacterFieldKey {
  if (typeof proposal.field === "string" && proposal.field in characterFieldConfigs) {
    return proposal.field as CharacterFieldKey;
  }

  const context =
    "context" in proposal.promptPackageJson
      ? proposal.promptPackageJson.context
      : {};
  if (
    context &&
    typeof context === "object" &&
    "targetField" in context &&
    typeof context.targetField === "string" &&
    context.targetField in characterFieldConfigs
  ) {
    return context.targetField as CharacterFieldKey;
  }

  return proposal.field as CharacterFieldKey;
}

function isCanonicalCharacterField(
  field: CharacterFieldKey
): field is keyof Pick<
  UpsertCharacterInput,
  | "characterType"
  | "name"
  | "aliasesJson"
  | "role"
  | "shortDescription"
  | "externalGoal"
  | "internalNeed"
  | "wound"
  | "falseBelief"
  | "secret"
  | "strengthsJson"
  | "weaknessesJson"
  | "voiceNotes"
  | "arcSummary"
  | "knowledgeNotes"
  | "visualPrompt"
> {
  return [
    "characterType",
    "name",
    "aliasesJson",
    "role",
    "shortDescription",
    "externalGoal",
    "internalNeed",
    "wound",
    "falseBelief",
    "secret",
    "strengthsJson",
    "weaknessesJson",
    "voiceNotes",
    "arcSummary",
    "knowledgeNotes",
    "visualPrompt"
  ].includes(field);
}

function normalizeJsonArrayString(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    // Fall through to single-value array normalization.
  }

  return value ? JSON.stringify([value]) : "[]";
}

/**
 * Sprowadza wartość zwróconą przez model do czytelnego tekstu dla pól
 * tekstowych. Model bywa nieprzewidywalny (string, tablica, obiekt), a autor
 * musi zobaczyć treść, a nie surowe `[]` czy `[object Object]`. Nigdy nie
 * zwraca literalnego `"[]"` — pusta tablica staje się pustym stringiem.
 */
function coerceProposalText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw === null || raw === undefined) {
    return "";
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(raw);
}

/**
 * Sprowadza wartość do stringa tablicy JSON (`["a","b"]`) dla pól typu *Json,
 * których ścieżka akceptacji ponownie parsuje wartość przez `JSON.parse`
 * (patrz `normalizeJsonArrayString`). `"[]"` pojawia się tylko dla naprawdę
 * pustej listy, co poprawnie się round-tripuje.
 */
function coerceProposalJsonArrayText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return JSON.stringify(raw.filter((item): item is string => typeof item === "string"));
  }
  if (typeof raw === "string") {
    return normalizeJsonArrayString(raw);
  }
  return "[]";
}

export function characterRelationInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertCharacterRelationInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const relation = recordValue(parsed.relation);
  const projectId = stringRecordValue(snapshot.projectId);
  const fromCharacterId = stringRecordValue(snapshot.fromCharacterId);
  const toCharacterId = stringRecordValue(snapshot.toCharacterId);

  if (!projectId || !fromCharacterId || !toCharacterId) {
    throw new Error("Brak danych postaci dla zapisu relacji AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-relation"),
    projectId,
    fromCharacterId,
    toCharacterId,
    relationType: stringRecordValue(relation.relationType, stringRecordValue(snapshot.relationType, "inne")),
    description: stringRecordValue(relation.description, stringRecordValue(snapshot.description)),
    history: stringRecordValue(relation.history, stringRecordValue(snapshot.history)),
    conflict: stringRecordValue(relation.conflict, stringRecordValue(snapshot.conflict)),
    opinion: stringRecordValue(relation.opinion, stringRecordValue(snapshot.opinion)),
    trustLevel: boundedNumberRecordValue(relation.trustLevel, boundedNumberRecordValue(snapshot.trustLevel, 50)),
    secret: stringRecordValue(relation.secret, stringRecordValue(snapshot.secret)),
    changeOverTime: stringRecordValue(relation.changeOverTime, stringRecordValue(snapshot.changeOverTime)),
    status: stringRecordValue(snapshot.status, "draft")
  };
}

function characterMemoryInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertCharacterMemoryInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const memory = recordValue(parsed.memory);
  const projectId = stringRecordValue(snapshot.projectId);
  const characterId = stringRecordValue(snapshot.characterId);

  if (!projectId || !characterId) {
    throw new Error("Brak danych postaci dla zapisu wspomnienia AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-memory"),
    projectId,
    characterId,
    title: stringRecordValue(memory.title, stringRecordValue(snapshot.title)),
    summary: stringRecordValue(memory.summary, stringRecordValue(snapshot.summary)),
    details: stringRecordValue(memory.details, stringRecordValue(snapshot.details)),
    memoryType: stringRecordValue(memory.memoryType, stringRecordValue(snapshot.memoryType, "wydarzenie")),
    subject: stringRecordValue(memory.subject, stringRecordValue(snapshot.subject)),
    emotion: stringRecordValue(memory.emotion, stringRecordValue(snapshot.emotion)),
    importance: boundedNumberRecordValue(memory.importance, boundedNumberRecordValue(snapshot.importance, 50)),
    status: stringRecordValue(snapshot.status, "draft")
  };
}

function worldElementInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertWorldElementInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const projectId = stringRecordValue(snapshot.projectId, proposal.projectId);

  if (!projectId) {
    throw new Error("Brak projektu dla zapisu elementu świata AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-world-element"),
    projectId,
    elementType: stringRecordValue(parsed.type, stringRecordValue(snapshot.elementType, "location")),
    name: stringRecordValue(parsed.name, stringRecordValue(snapshot.name, "Nowy element świata")),
    summary: stringRecordValue(parsed.summary, stringRecordValue(snapshot.summary)),
    details: stringRecordValue(parsed.details, stringRecordValue(snapshot.details)),
    storyPurpose: stringRecordValue(parsed.storyPurpose, stringRecordValue(snapshot.storyPurpose)),
    constraints: stringRecordValue(parsed.constraints, stringRecordValue(snapshot.constraints)),
    visualPrompt: stringRecordValue(parsed.visualPrompt, stringRecordValue(snapshot.visualPrompt)),
    imageAssetId: stringRecordValue(snapshot.imageAssetId) || null,
    status: stringRecordValue(snapshot.status, "draft"),
    orderIndex: boundedNumberRecordValue(snapshot.orderIndex, 0)
  };
}

function worldRuleInputFromProposal(
  proposal: ActiveAiProposal,
  packageContext: Record<string, unknown>
): UpsertWorldRuleInput {
  const snapshot = recordValue(packageContext.targetEntitySnapshot);
  const parsed = recordValue(JSON.parse(proposal.editableValue || proposal.rawOutput));
  const projectId = stringRecordValue(snapshot.projectId, proposal.projectId);

  if (!projectId) {
    throw new Error("Brak projektu dla zapisu reguły świata AI.");
  }

  return {
    id: optionalStringRecordValue(snapshot.id, "new-world-rule"),
    projectId,
    name: stringRecordValue(parsed.name, stringRecordValue(snapshot.name, "Nowa reguła świata")),
    description: stringRecordValue(parsed.description, stringRecordValue(snapshot.description)),
    scope: stringRecordValue(parsed.scope, stringRecordValue(snapshot.scope)),
    cost: stringRecordValue(parsed.cost, stringRecordValue(snapshot.cost)),
    limitation: stringRecordValue(parsed.limitation, stringRecordValue(snapshot.limitation)),
    exceptions: stringRecordValue(parsed.exceptions, stringRecordValue(snapshot.exceptions)),
    violationConsequences: stringRecordValue(parsed.violationConsequences, stringRecordValue(snapshot.violationConsequences)),
    sceneExamples: stringRecordValue(parsed.sceneExamples, stringRecordValue(snapshot.sceneExamples)),
    status: stringRecordValue(snapshot.status, "draft"),
    orderIndex: boundedNumberRecordValue(snapshot.orderIndex, 0)
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringRecordValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStringRecordValue(value: unknown, ignoredValue: string): string | undefined {
  const parsed = stringRecordValue(value);
  return parsed && parsed !== ignoredValue ? parsed : undefined;
}

function arrayJsonRecordValue(value: unknown, fallback = "[]"): string {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return JSON.stringify(value.filter((item): item is string => typeof item === "string"));
}

function boundedNumberRecordValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function parsePlanSuggestion(
  rawOutput: string,
  expectedField: PlanFieldKey
): ParsedAiProposal {
  const parsed = parseModelJson(rawOutput, "Propozycja planu");
  const value =
    parsed && typeof parsed === "object"
      ? parsed
      : {
          version: 1,
          kind: "book_plan_suggestion",
          value: String(parsed ?? "")
        };
  const record = value as {
    structure?: unknown;
    summary?: unknown;
    value?: unknown;
    warnings?: unknown;
  };
  const textValue = planProposalTextValue(value, expectedField);

  return {
    kind: "book_plan_suggestion",
    summary: typeof record.summary === "string" ? record.summary : "Propozycja planu",
    textValue,
    value,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function planProposalTextValue(value: unknown, field: PlanFieldKey): string {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  if (isPlanTextField(field) && typeof record.value === "string") {
    return record.value;
  }

  if (field === "storyStructure" && record.structure && typeof record.structure === "object") {
    const structure = record.structure as Record<string, unknown>;
    if (typeof structure.structureType === "string") {
      return structure.structureType;
    }
  }

  return JSON.stringify(value, null, 2);
}

function planPayloadFromEditableValue(proposal: ActiveAiProposal): unknown {
  const field = proposal.field as PlanFieldKey;
  const editableValue = proposal.editableValue.trim();

  if (isPlanTextField(field)) {
    return {
      version: 1,
      kind: "book_plan_suggestion",
      field,
      value: editableValue
    };
  }

  if (field === "storyStructure" && !editableValue.startsWith("{")) {
    return {
      version: 1,
      kind: "book_plan_suggestion",
      field,
      structure: {
        structureType: editableValue
      }
    };
  }

  return JSON.parse(editableValue || proposal.rawOutput);
}

function isPlanTextField(field: PlanFieldKey): boolean {
  return [
    "storyStructureDescription",
    "storyStructureNotes",
    "actPurpose",
    "actSummary",
    "chapterSummary",
    "chapterPurpose",
    "chapterConflict",
    "chapterTurningPoint",
    "beatName",
    "beatRole",
    "beatDescription",
    "sceneTitle",
    "sceneSummary",
    "sceneGoal",
    "sceneConflict",
    "sceneOutcome",
    "threadDescription",
    "threadChapterDescription"
  ].includes(field);
}

function isPlanAction(action: string): boolean {
  return [
    "suggest_story_structure",
    "generate_acts",
    "generate_act_field",
    "generate_beat_sheet",
    "generate_beat_field",
    "generate_plot_threads",
    "generate_thread_chapter_field",
    "generate_chapter_plan",
    "generate_chapter_field",
    "generate_scene_field",
    "suggest_chapter_relations",
    "prepare_chapter_for_scenes",
    "generate_chapter_scene_breakdown",
    "suggest_scene_relations",
    "find_plan_gaps"
  ].includes(action);
}

function isCharacterAction(action: string): boolean {
  return [
    "generate_character_field",
    "generate_character_relation_field",
    "generate_character_memory_field"
  ].includes(action);
}

function isWorldAction(action: string): boolean {
  return [
    "generate_world_element_field",
    "generate_world_rule_field",
    "generate_world_rule_analysis"
  ].includes(action);
}

function isSceneEditorAction(action: string): boolean {
  return [
    "draft_scene",
    "continue_scene",
    "rewrite_selection",
    "expand_selection"
  ].includes(action);
}

function sceneEditorInsertMode(value: unknown): SceneEditorInsertMode {
  return value === "replace_selection" ||
    value === "insert_after_selection" ||
    value === "append_to_scene" ||
    value === "save_as_variant"
    ? value
    : "append_to_scene";
}

function isLargePlanField(field: PlanFieldKey): boolean {
  return ["acts", "beatSheet", "plotThreads", "chapterPlan"].includes(field);
}

function isBeatDraftField(field: PlanFieldKey): boolean {
  return ["beatName", "beatRole", "beatDescription"].includes(field);
}

function isSceneDraftField(field: PlanFieldKey): boolean {
  return ["sceneTitle", "sceneSummary", "sceneGoal", "sceneConflict", "sceneOutcome"].includes(field);
}

function isDraftPlanField(field: PlanFieldKey): boolean {
  return isBeatDraftField(field) || isSceneDraftField(field);
}

function planPayloadTextValue(payload: unknown): string {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  return typeof record.value === "string" ? record.value : "";
}

function isDraftAcceptance(packageContext: Record<string, unknown>): boolean {
  const snapshot = packageContext.targetEntitySnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false;
  }

  return (snapshot as Record<string, unknown>).draftAcceptance === true;
}

export function editableFieldsFromParsed(
  parsed: ParsedAiProposal
): Partial<Record<ConceptFieldKey, string>> {
  if (!isPremiseDevelopment(parsed)) {
    return {};
  }

  return Object.fromEntries(
    parsed.fieldValues.map((item) => [item.field, item.value])
  ) as Partial<Record<ConceptFieldKey, string>>;
}

export function selectedFieldsFromParsed(
  parsed: ParsedAiProposal
): Partial<Record<ConceptFieldKey, boolean>> {
  if (!isPremiseDevelopment(parsed)) {
    return {};
  }

  return Object.fromEntries(
    parsed.fieldValues.map((item) => [item.field, true])
  ) as Partial<Record<ConceptFieldKey, boolean>>;
}

export function proposalInputFromValue(
  value: string,
  proposal: { field: ConceptFieldKey }
): BookConceptInput {
  return proposalInputForField(proposal.field, value);
}

export function proposalInputFromFields(
  editableFields: Partial<Record<ConceptFieldKey, string>>,
  selectedFields: Partial<Record<ConceptFieldKey, boolean>>
): BookConceptInput {
  const input: BookConceptInput = {};

  for (const [field, selected] of Object.entries(selectedFields)) {
    if (!selected) {
      continue;
    }

    Object.assign(
      input,
      proposalInputForField(
        field as ConceptFieldKey,
        editableFields[field as ConceptFieldKey] ?? ""
      )
    );
  }

  if (Object.keys(input).length === 0) {
    throw new Error("Wybierz co najmniej jedno pole do zapisania.");
  }

  return input;
}

function proposalInputForField(
  field: ConceptFieldKey,
  value: string
): BookConceptInput {
  switch (field) {
    case "title":
      return { title: value };
    case "workingTitle":
      return { workingTitle: value };
    case "premise":
      return { premise: value };
    case "protagonistSummary":
      return { protagonistSummary: value };
    case "protagonistGoal":
      return { protagonistGoal: value };
    case "expandedPremise":
      return { expandedPremise: value };
    case "centralConflict":
      return { centralConflict: value };
    case "antagonistForce":
      return { antagonistForce: value };
    case "stakes":
      return { stakes: value };
    case "settingSketch":
      return { settingSketch: value };
    case "endingDirection":
      return { endingDirection: value };
    case "genre":
      return { genre: value };
    case "subgenre":
      return { subgenre: value };
    case "targetAudience":
      return { targetAudience: value };
    case "tone":
      return { tone: value };
    case "pointOfView":
      return { pointOfView: value };
    case "targetWordCount":
      return { targetWordCount: parseTargetWordCount(value) };
    case "themesJson":
      return { themesJson: serializeListValue(value) };
    case "unwantedThemes":
      return { unwantedThemes: value };
    case "alternativeTitlesJson":
      return { alternativeTitlesJson: serializeListValue(value) };
    case "styleGuide":
      return { styleGuide: value };
  }
}

function isPremiseDevelopment(
  parsed: ParsedAiProposal | undefined
): parsed is Extract<ParsedAiProposal, { kind: "premise_development" }> {
  return parsed?.kind === "premise_development";
}

function isBookCoverProposal(
  proposal: Pick<ActiveAiProposal, "field" | "scope">
): boolean {
  return proposal.scope === "bookCover" || proposal.field === BOOK_COVER_FIELD;
}

function closePromptContextForProposal(proposal: ActiveAiProposal): void {
  const targetId = promptContextTargetIdFromProposal(proposal);
  if (!targetId) {
    return;
  }

  useAiPromptContextStore.getState().closeTarget(targetId);
}

function runMatchesProposal(run: ActiveCodexRun, proposal: ActiveAiProposal): boolean {
  if (proposal.aiRunId) {
    return run.aiRunId === proposal.aiRunId;
  }

  return run.projectId === proposal.projectId && run.action === proposal.action;
}

function promptContextTargetIdFromProposal(proposal: ActiveAiProposal): string | null {
  const packageContext =
    "context" in proposal.promptPackageJson
      ? proposal.promptPackageJson.context
      : {};
  const scopedContext =
    packageContext && typeof packageContext === "object"
      ? (packageContext as Record<string, unknown>)
      : {};
  const targetEntityId =
    typeof scopedContext.targetEntityId === "string"
      ? scopedContext.targetEntityId
      : undefined;

  if (proposal.scope === "bookConcept" || !proposal.scope) {
    return conceptPromptContextTargetId(proposal.projectId, proposal.field as ConceptFieldKey);
  }

  if (proposal.scope === "bookPlan") {
    return planPromptContextTargetId(proposal.projectId, proposal.field as PlanFieldKey, targetEntityId);
  }

  if (proposal.scope === "characters" && proposal.field !== CHARACTER_IMAGE_FIELD) {
    return characterPromptContextTargetId(proposal.projectId, proposal.field as CharacterFieldKey, targetEntityId);
  }

  if (proposal.scope === "world") {
    return worldPromptContextTargetId(proposal.projectId, proposal.field as WorldFieldKey, targetEntityId);
  }

  if (proposal.scope === "sceneEditor" && targetEntityId) {
    return `project:${proposal.projectId}:scene-editor:continueScene:${targetEntityId}`;
  }

  return null;
}

function isCharacterImageProposal(
  proposal: Pick<ActiveAiProposal, "field" | "scope">
): boolean {
  return proposal.scope === "characters" && proposal.field === CHARACTER_IMAGE_FIELD;
}

function isExportArtworkProposal(
  proposal: Pick<ActiveAiProposal, "field" | "scope">
): boolean {
  return proposal.scope === "export" && proposal.field === EXPORT_ARTWORK_FIELD;
}

function hasSelectedEditableField(proposal: ActiveAiProposal): boolean {
  return Object.entries(proposal.selectedFields).some(([field, selected]) => {
    const value = proposal.editableFields[field as ConceptFieldKey] ?? "";
    return selected && value.trim().length > 0;
  });
}

export function proposalCanAccept(proposal: ActiveAiProposal): boolean {
  if (proposal.status !== "success") {
    return false;
  }

  if (isBookCoverProposal(proposal)) {
    return Boolean((proposal.coverImagePath || proposal.editableValue).trim());
  }

  if (isCharacterImageProposal(proposal)) {
    return Boolean((proposal.characterImagePath || proposal.coverImagePath || proposal.editableValue).trim());
  }

  if (isExportArtworkProposal(proposal)) {
    return Boolean((proposal.exportArtworkPath || proposal.coverImagePath || proposal.editableValue).trim());
  }

  if (proposal.field === SCENE_STORY_BIBLE_AUDIT_FIELD) {
    return false;
  }

  if (proposal.field === SCENE_CRITIQUE_FIELD) {
    return false;
  }

  if (isPremiseDevelopment(proposal.parsed)) {
    return hasSelectedEditableField(proposal);
  }

  return proposal.editableValue.trim().length > 0;
}

function parseTargetWordCount(value: string): number | null {
  const normalized = value.replace(/\s+/g, "");
  const match = normalized.match(/\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function discoveryKindLabel(kind: SceneDiscovery["kind"]): string {
  if (kind === "character") return "Postać";
  if (kind === "characterMemory") return "Wspomnienie";
  if (kind === "worldElement") return "Element świata";
  if (kind === "worldRule") return "Reguła świata";
  return "Relacja";
}

function assignmentKindLabel(kind: PendingSceneAssignment["kind"]): string {
  if (kind === "character") return "Postać";
  if (kind === "characterMemory") return "Wspomnienie";
  if (kind === "worldElement") return "Element świata";
  if (kind === "worldRule") return "Reguła świata";
  return "Relacja";
}

function characterDraftFromDiscovery(discovery: SceneDiscovery): Character {
  const now = new Date().toISOString();
  return {
    id: `audit-character:${discovery.id}`,
    projectId: discovery.projectId,
    characterType: discovery.suggestedType || "person",
    name: discovery.title,
    aliasesJson: "[]",
    role: "",
    shortDescription: discovery.reason,
    externalGoal: "",
    internalNeed: "",
    wound: "",
    falseBelief: "",
    secret: "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    voiceNotes: "",
    arcSummary: "",
    knowledgeNotes: discovery.evidence,
    visualPrompt: "",
    imageAssetId: null,
    status: "draft",
    orderIndex: 0,
    createdAt: now,
    updatedAt: now
  };
}

function characterMemoryDraftFromDiscovery(
  discovery: SceneDiscovery,
  character: Character
): CharacterMemory {
  const now = new Date().toISOString();
  return {
    id: `audit-memory:${discovery.id}`,
    projectId: discovery.projectId,
    characterId: character.id,
    title: discovery.title,
    summary: discovery.reason,
    details: discovery.evidence,
    memoryType: discovery.suggestedType || "wydarzenie",
    subject: discovery.title,
    emotion: "",
    importance: 50,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

export function characterRelationDraftFromDiscovery(
  discovery: SceneDiscovery,
  characters: Character[]
): CharacterRelation | null {
  const [fromCharacterId, toCharacterId] = relationCharacterIdsFromDiscovery(discovery, characters);
  if (!fromCharacterId || !toCharacterId) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: `audit-relation:${discovery.id}`,
    projectId: discovery.projectId,
    fromCharacterId,
    toCharacterId,
    relationType: discovery.suggestedType || "inne",
    description: discovery.reason,
    history: discovery.evidence,
    conflict: "",
    opinion: "",
    trustLevel: 50,
    secret: "",
    changeOverTime: "",
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

export function discoveryCanGenerate(
  discovery: SceneDiscovery,
  characters: Character[]
): boolean {
  if (discovery.kind === "characterMemory") {
    return Boolean(
      discovery.targetExistingCharacterId &&
        characters.some((item) => item.id === discovery.targetExistingCharacterId)
    );
  }

  if (discovery.kind === "characterRelation") {
    const [fromCharacterId, toCharacterId] = relationCharacterIdsFromDiscovery(discovery, characters);
    return Boolean(fromCharacterId && toCharacterId);
  }

  return true;
}

function discoveryGenerateDisabledReason(discovery: SceneDiscovery): string {
  if (discovery.kind === "characterRelation") {
    return "Relacja wymaga dwóch istniejących postaci wskazanych przez analizę.";
  }

  return "Wspomnienie wymaga wskazania istniejącej postaci.";
}

function relationCharacterIdsFromDiscovery(
  discovery: SceneDiscovery,
  characters: Character[]
): [string | null, string | null] {
  const characterIds = new Set(characters.map((character) => character.id));
  const relatedIds = (discovery.relatedCharacterIds ?? [])
    .filter((id, index, ids) => characterIds.has(id) && ids.indexOf(id) === index)
    .slice(0, 2);

  return [relatedIds[0] ?? null, relatedIds[1] ?? null];
}

function worldElementDraftFromDiscovery(discovery: SceneDiscovery): WorldElement {
  const now = new Date().toISOString();
  return {
    id: `audit-world-element:${discovery.id}`,
    projectId: discovery.projectId,
    elementType: discovery.suggestedType || "location",
    name: discovery.title,
    summary: discovery.reason,
    details: discovery.evidence,
    storyPurpose: "",
    constraints: "",
    visualPrompt: "",
    imageAssetId: null,
    status: "draft",
    orderIndex: 0,
    createdAt: now,
    updatedAt: now
  };
}

function worldRuleDraftFromDiscovery(discovery: SceneDiscovery): WorldRule {
  const now = new Date().toISOString();
  return {
    id: `audit-world-rule:${discovery.id}`,
    projectId: discovery.projectId,
    name: discovery.title,
    description: discovery.reason,
    scope: discovery.evidence,
    cost: "",
    limitation: "",
    exceptions: "",
    violationConsequences: "",
    sceneExamples: "",
    status: "draft",
    orderIndex: 0,
    createdAt: now,
    updatedAt: now
  };
}

function serializeListValue(value: string): string {
  const items = value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return JSON.stringify([...new Set(items)]);
}

function statusLabel(status: ActiveAiProposal["status"]): string {
  switch (status) {
    case "queued":
      return "W kolejce";
    case "running":
      return "Generuje";
    case "success":
      return "Gotowe";
    case "cancelled":
      return "Przerwane";
    case "error":
      return "Błąd";
  }
}

function statusClassName(status: ActiveAiProposal["status"]): string {
  if (status === "success") {
    return "status-pill ready";
  }

  if (status === "error" || status === "cancelled") {
    return "status-pill muted";
  }

  return "status-pill";
}

function compareProposalsForPanel(
  left: ActiveAiProposal,
  right: ActiveAiProposal
): number {
  const statusDiff = statusRank(left.status) - statusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function statusRank(status: ActiveAiProposal["status"]): number {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "success":
      return 2;
    case "cancelled":
      return 3;
    case "error":
      return 4;
  }
}

class QueueRunError extends Error {
  rawOutput: string;

  constructor(message: string, rawOutput = "") {
    super(message);
    this.name = "QueueRunError";
    this.rawOutput = rawOutput;
  }
}
