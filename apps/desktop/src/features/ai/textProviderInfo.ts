import { useQuery } from "@tanstack/react-query";

import { getAiSettings } from "../../shared/api/commands";
import type { AiSettings } from "../../shared/api/types";
import { CLAUDE_CLI_MODEL_MAP } from "./pricing";

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  "claude-fable-5": "Fable 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-5": "Sonnet 5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5"
};

const ANTHROPIC_MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-haiku-4-5": "Claude Haiku 4.5"
};

/**
 * Stary, zapisany model Claude CLI bywa aliasem ("sonnet"/"opus"/"haiku").
 * Mapujemy go na przypięte pełne ID, żeby <select> trafił w opcję.
 */
export function normalizeClaudeModel(value: string): string {
  return CLAUDE_CLI_MODEL_MAP[value] ?? value;
}

/** Katalogi modeli współdzielone przez ustawienia AI i panel modelu (topbar). */
export const CLAUDE_MODELS: Array<{ value: string; label: string }> = [
  { value: "claude-fable-5", label: "Claude Fable 5 (najmocniejszy)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 (zalecany)" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (1M kontekst)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (najszybszy)" }
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
    case "claude-cli": {
      const model = normalizeClaudeModel(settings.claudeModel);
      return {
        isCodex: false,
        providerLabel: "Claude Code CLI",
        modelLabel: CLAUDE_MODEL_LABELS[model] ?? model,
        providerId: "claude-cli",
        model
      };
    }
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
