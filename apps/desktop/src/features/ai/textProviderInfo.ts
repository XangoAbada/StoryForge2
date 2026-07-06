import { useQuery } from "@tanstack/react-query";

import { getAiSettings } from "../../shared/api/commands";
import type { AiSettings } from "../../shared/api/types";

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku"
};

const ANTHROPIC_MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-haiku-4-5": "Claude Haiku 4.5"
};

export type TextProviderInfo = {
  /** Czy aktywny jest Codex CLI (jedyny dostawca z modelem i reasoning sterowanymi z panelu). */
  isCodex: boolean;
  providerLabel: string;
  /** Model efektywny dla dostawców innych niż Codex (pusty dla Codeksa — model bierze się z panelu). */
  modelLabel: string;
  /** Kanoniczne ID dostawcy używane do wyceny (patrz pricing.ts). */
  providerId: string;
  /** Surowy identyfikator modelu do wyceny (pusty dla Codeksa — model z panelu). */
  model: string;
};

/**
 * Opis aktywnego dostawcy tekstu na podstawie zapisanych AiSettings.
 * Panel projektu używa tego, aby pokazać rzeczywistego dostawcę zamiast zawsze Codeksa.
 */
export function describeTextProvider(
  settings: AiSettings | undefined
): TextProviderInfo {
  switch (settings?.textProvider) {
    case "claude-cli":
      return {
        isCodex: false,
        providerLabel: "Claude Code CLI",
        modelLabel: CLAUDE_MODEL_LABELS[settings.claudeModel] ?? settings.claudeModel,
        providerId: "claude-cli",
        model: settings.claudeModel
      };
    case "openai-api":
      return {
        isCodex: false,
        providerLabel: "OpenAI API",
        modelLabel: settings.openaiTextModel,
        providerId: "openai-api",
        model: settings.openaiTextModel
      };
    case "anthropic-api":
      return {
        isCodex: false,
        providerLabel: "Anthropic API",
        modelLabel:
          ANTHROPIC_MODEL_LABELS[settings.anthropicModel] ?? settings.anthropicModel,
        providerId: "anthropic-api",
        model: settings.anthropicModel
      };
    default:
      return {
        isCodex: true,
        providerLabel: "Codex CLI",
        modelLabel: "",
        providerId: "codex-cli",
        model: ""
      };
  }
}

/**
 * Hook zwracający opis aktywnego dostawcy tekstu z zapisanych AiSettings.
 * Współdzieli cache zapytania (`["ai-settings"]`) z resztą aplikacji, więc nie
 * powoduje dodatkowego fetcha.
 */
export function useTextProviderInfo(): TextProviderInfo {
  const { data } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings
  });
  return describeTextProvider(data);
}
