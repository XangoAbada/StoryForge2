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

/** Katalogi modeli współdzielone przez ustawienia AI i panel modelu (topbar). */
export const CLAUDE_MODELS: Array<{ value: string; label: string }> = [
  { value: "sonnet", label: "Sonnet (zalecany)" },
  { value: "opus", label: "Opus (najmocniejszy)" },
  { value: "haiku", label: "Haiku (najszybszy)" }
];

export const OPENAI_TEXT_MODELS = ["gpt-5.5", "gpt-5", "gpt-4.1"];

export const ANTHROPIC_MODELS: Array<{ value: string; label: string }> = [
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (zalecany)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
];

export type TextModelChoice = {
  field: keyof AiSettings;
  options: Array<{ value: string; label: string }>;
};

/**
 * Zwraca pole AiSettings i listę modeli do wyboru dla aktywnego dostawcy.
 * Dla Codeksa zwraca null — jego model bierze się z osobnego katalogu
 * (`listCodexModels`) i `useCodexSettingsStore`.
 */
export function textModelChoices(settings: AiSettings): TextModelChoice | null {
  switch (settings.textProvider) {
    case "claude-cli":
      return { field: "claudeModel", options: CLAUDE_MODELS };
    case "openai-api":
      return {
        field: "openaiTextModel",
        options: [...new Set([settings.openaiTextModel, ...OPENAI_TEXT_MODELS])].map(
          (model) => ({ value: model, label: model })
        )
      };
    case "anthropic-api":
      return { field: "anthropicModel", options: ANTHROPIC_MODELS };
    default:
      return null;
  }
}

export type TextProviderInfo = {
  /** Czy aktywny jest Codex CLI (model z `useCodexSettingsStore`, nie z AiSettings). */
  isCodex: boolean;
  providerLabel: string;
  /** Model efektywny dla dostawców innych niż Codex (pusty dla Codeksa — model bierze się z panelu). */
  modelLabel: string;
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
        modelLabel: CLAUDE_MODEL_LABELS[settings.claudeModel] ?? settings.claudeModel
      };
    case "openai-api":
      return {
        isCodex: false,
        providerLabel: "OpenAI API",
        modelLabel: settings.openaiTextModel
      };
    case "anthropic-api":
      return {
        isCodex: false,
        providerLabel: "Anthropic API",
        modelLabel:
          ANTHROPIC_MODEL_LABELS[settings.anthropicModel] ?? settings.anthropicModel
      };
    default:
      return { isCodex: true, providerLabel: "Codex CLI", modelLabel: "" };
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
