import { describe, expect, it } from "vitest";
import type { AiRunUsageGroup, AiTokenUsage } from "../../shared/api/types";
import {
  costOf,
  formatCostLabel,
  formatPln,
  imageCostOf,
  sumCosts,
  totalCostOf
} from "./pricing";

const oneMillion: AiTokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  tokensEstimated: false
};

describe("costOf", () => {
  it("prices Anthropic Sonnet 5 at 1M/1M input/output (intro pricing)", () => {
    const cost = costOf(oneMillion, "anthropic-api", "claude-sonnet-5");
    expect(cost.hasPricing).toBe(true);
    expect(cost.usd).toBeCloseTo(12, 6); // 2 + 10 (cena wprowadzająca do 2026-08-31)
  });

  it("prices Anthropic Opus 4.8 at 1M/1M input/output", () => {
    const cost = costOf(oneMillion, "anthropic-api", "claude-opus-4-8");
    expect(cost.usd).toBeCloseTo(30, 6); // 5 + 25
  });

  it("maps Claude CLI aliases to canonical Anthropic pricing", () => {
    const cost = costOf(oneMillion, "claude-cli", "opus");
    expect(cost.hasPricing).toBe(true);
    expect(cost.usd).toBeCloseTo(30, 6);
  });

  it("prices OpenAI gpt-5.5 at 5/30 input/output", () => {
    const cost = costOf(oneMillion, "openai-api", "gpt-5.5");
    expect(cost.hasPricing).toBe(true);
    expect(cost.usd).toBeCloseTo(35, 6); // 5 + 30
  });

  it("returns no pricing for unknown OpenAI models", () => {
    const cost = costOf(oneMillion, "openai-api", "gpt-nonexistent");
    expect(cost.hasPricing).toBe(false);
    expect(formatCostLabel(cost)).toBe("brak cennika");
  });

  it("carries the estimated flag through", () => {
    const cost = costOf(
      { ...oneMillion, tokensEstimated: true },
      "anthropic-api",
      "claude-haiku-4-5"
    );
    expect(cost.estimated).toBe(true);
    expect(formatCostLabel(cost).startsWith("~")).toBe(true);
  });
});

describe("imageCostOf", () => {
  it("treats local providers as free", () => {
    const cost = imageCostOf("local-sdwebui", "", "1024x1024", 3);
    expect(cost.hasPricing).toBe(true);
    expect(cost.usd).toBe(0);
  });

  it("prices OpenAI gpt-image-1 per image by size", () => {
    const cost = imageCostOf("openai-api", "gpt-image-1", "1024x1536", 2);
    expect(cost.hasPricing).toBe(true);
    expect(cost.usd).toBeCloseTo(0.126, 6); // 2 × 0.063
  });

  it("returns no pricing for an unknown image size", () => {
    const cost = imageCostOf("openai-api", "gpt-image-1", "512x512", 1);
    expect(cost.hasPricing).toBe(false);
  });
});

describe("totalCostOf", () => {
  it("sums token groups and skips unpriced ones", () => {
    const groups: AiRunUsageGroup[] = [
      {
        projectId: "p1",
        providerId: "anthropic-api",
        model: "claude-sonnet-5",
        imageSize: null,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        imageCount: 0,
        anyEstimated: 0,
        runCount: 1
      },
      {
        projectId: "p1",
        providerId: "openai-api",
        model: "gpt-5.5",
        imageSize: null,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        imageCount: 0,
        anyEstimated: 1,
        runCount: 1
      }
    ];
    const total = totalCostOf(groups);
    expect(total.usd).toBeCloseTo(7, 6); // Sonnet 2/1M + gpt-5.5 5/1M input
    expect(total.hasPricing).toBe(true);
    expect(total.estimated).toBe(true); // grupa gpt-5.5 ma anyEstimated = 1
  });
});

describe("sumCosts", () => {
  it("sums priced costs and OR-s the estimated flag", () => {
    const total = sumCosts([
      { usd: 0.01, estimated: false, hasPricing: true },
      { usd: 0.02, estimated: true, hasPricing: true },
      { usd: 0, estimated: false, hasPricing: false } // pominięty
    ]);
    expect(total.usd).toBeCloseTo(0.03, 6);
    expect(total.hasPricing).toBe(true);
    expect(total.estimated).toBe(true);
  });

  it("reports no pricing when every cost lacks pricing", () => {
    const total = sumCosts([{ usd: 0, estimated: false, hasPricing: false }]);
    expect(total.hasPricing).toBe(false);
  });
});

describe("formatPln", () => {
  it("multiplies by the configured rate", () => {
    expect(formatPln(10, 4)).toBe("40.00 zł");
  });
});
