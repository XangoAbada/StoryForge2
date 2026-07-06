import type { AiRunUsageGroup, AiTokenUsage } from "../../shared/api/types";

// Jedno źródło prawdy dla wyceny generacji AI. Backend zapisuje wyłącznie
// surowe liczby tokenów/obrazów; tutaj przeliczamy je na koszt wg oficjalnych
// cenników — także dla subskrypcji/CLI, "jakby to było API".

export type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export type CostBreakdown = {
  usd: number;
  estimated: boolean;
  hasPricing: boolean;
};

// Oficjalny cennik Anthropic (USD / 1M tokenów).
const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-8": { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 },
  "claude-sonnet-5": { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 }
};

// Claude CLI ("sonnet"/"opus"/"haiku") → kanoniczne ID modelu API.
const CLAUDE_CLI_MODEL_MAP: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5"
};

// TODO(user): uzupełnić z https://openai.com/api/pricing (USD / 1M tokenów).
// Dopóki wartości = 0, model traktujemy jako "brak cennika".
const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-5.5": { inputPer1M: 0, outputPer1M: 0 }, // TODO(user)
  "gpt-5": { inputPer1M: 0, outputPer1M: 0 }, // TODO(user)
  "gpt-4.1": { inputPer1M: 0, outputPer1M: 0 } // TODO(user)
  // Modele Codex CLI (np. "gpt-5.5-codex") — TODO(user): dodać lub zmapować.
};

// TODO(user): uzupełnić z oficjalnego cennika (USD / 1 obraz), per rozmiar.
// Dostawcy lokalni (SD WebUI / ComfyUI) są darmowi → 0.
const IMAGE_PRICING: Record<string, Record<string, number>> = {
  "gpt-image-1": {
    "1024x1024": 0, // TODO(user)
    "1024x1536": 0 // TODO(user)
  }
};

const LOCAL_IMAGE_PROVIDERS = new Set(["local-sdwebui", "local-comfyui"]);

function isZeroPricing(pricing: ModelPricing): boolean {
  return (
    pricing.inputPer1M === 0 &&
    pricing.outputPer1M === 0 &&
    (pricing.cacheReadPer1M ?? 0) === 0 &&
    (pricing.cacheWritePer1M ?? 0) === 0
  );
}

/// Zwraca cennik tokenowy dla (dostawca, model) lub null, gdy nieznany.
export function pricingFor(providerId: string, model: string | null | undefined): ModelPricing | null {
  const key = (model ?? "").trim();
  let pricing: ModelPricing | undefined;
  switch (providerId) {
    case "anthropic-api":
      pricing = ANTHROPIC_PRICING[key];
      break;
    case "claude-cli":
      pricing = ANTHROPIC_PRICING[CLAUDE_CLI_MODEL_MAP[key] ?? key];
      break;
    case "openai-api":
    case "codex-cli":
      pricing = OPENAI_PRICING[key];
      break;
    default:
      pricing = undefined;
  }
  if (!pricing || isZeroPricing(pricing)) {
    return null;
  }
  return pricing;
}

/// Koszt pojedynczej generacji tekstowej.
export function costOf(
  usage: AiTokenUsage,
  providerId: string,
  model: string | null | undefined
): CostBreakdown {
  const pricing = pricingFor(providerId, model);
  if (!pricing) {
    return { usd: 0, estimated: usage.tokensEstimated, hasPricing: false };
  }
  const usd =
    (usage.inputTokens * pricing.inputPer1M +
      usage.outputTokens * pricing.outputPer1M +
      usage.cacheReadTokens * (pricing.cacheReadPer1M ?? pricing.inputPer1M) +
      usage.cacheCreationTokens * (pricing.cacheWritePer1M ?? pricing.inputPer1M)) /
    1_000_000;
  return { usd, estimated: usage.tokensEstimated, hasPricing: true };
}

/// Koszt generacji obrazów (rozliczanych za sztukę).
export function imageCostOf(
  providerId: string,
  model: string | null | undefined,
  size: string | null | undefined,
  count: number
): CostBreakdown {
  if (LOCAL_IMAGE_PROVIDERS.has(providerId)) {
    return { usd: 0, estimated: false, hasPricing: true };
  }
  const perImage = IMAGE_PRICING[(model ?? "").trim()]?.[(size ?? "").trim()];
  if (perImage === undefined || perImage === 0) {
    return { usd: 0, estimated: false, hasPricing: false };
  }
  return { usd: perImage * count, estimated: false, hasPricing: true };
}

/// Suma kosztu z pogrupowanego zużycia (tokeny + obrazy).
export function totalCostOf(groups: AiRunUsageGroup[]): CostBreakdown {
  let usd = 0;
  let estimated = false;
  let hasAny = false;
  for (const group of groups) {
    if (group.imageCount > 0) {
      const imageCost = imageCostOf(group.providerId, group.model, group.imageSize, group.imageCount);
      usd += imageCost.usd;
      if (imageCost.hasPricing) {
        hasAny = true;
      }
      continue;
    }
    const cost = costOf(
      {
        inputTokens: group.inputTokens,
        outputTokens: group.outputTokens,
        cacheReadTokens: group.cacheReadTokens,
        cacheCreationTokens: group.cacheCreationTokens,
        tokensEstimated: group.anyEstimated !== 0
      },
      group.providerId,
      group.model
    );
    usd += cost.usd;
    if (cost.hasPricing) {
      hasAny = true;
      if (cost.estimated) {
        estimated = true;
      }
    }
  }
  return { usd, estimated, hasPricing: hasAny };
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`;
}

export function formatPln(usd: number, plnPerUsd: number): string {
  const value = usd * (Number.isFinite(plnPerUsd) && plnPerUsd > 0 ? plnPerUsd : 0);
  return `${value.toFixed(2)} zł`;
}

/// Etykieta kosztu pojedynczej generacji: "brak cennika", prefiks ~ dla szacunku.
export function formatCostLabel(cost: CostBreakdown, plnPerUsd?: number): string {
  if (!cost.hasPricing) {
    return "brak cennika";
  }
  const prefix = cost.estimated ? "~" : "";
  const pln = plnPerUsd !== undefined ? ` (${formatPln(cost.usd, plnPerUsd)})` : "";
  return `${prefix}${formatUsd(cost.usd)}${pln}`;
}
