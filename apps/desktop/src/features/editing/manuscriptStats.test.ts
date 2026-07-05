import { describe, expect, it } from "vitest";
import {
  computeBookStats,
  computeChapterStats,
  computeSceneStats,
  htmlToParagraphs,
  isDialogueParagraph,
  isLikelyAdverb
} from "./manuscriptStats";

const sceneHtml = [
  "<p>Marek wszedł do izby. Nagle poczuł chłód.</p>",
  "<p>— Zamknij drzwi — powiedziała cicho Hanna.</p>",
  "<p>— Już zamykam.</p>"
].join("");

describe("computeSceneStats", () => {
  it("counts words, sentences and dialogue ratio", () => {
    const stats = computeSceneStats({ id: "s1", manuscriptContent: sceneHtml });
    expect(stats.wordCount).toBe(14);
    expect(stats.sentenceCount).toBe(4);
    // Dialogi: "Zamknij drzwi powiedziała cicho Hanna" (5) + "Już zamykam" (2) = 7/14.
    expect(stats.dialogueRatio).toBeCloseTo(7 / 14, 2);
    expect(stats.adverbRate).toBeGreaterThan(0); // "nagle", "cicho"
  });

  it("returns zeros for an empty scene", () => {
    const stats = computeSceneStats({ id: "s2", manuscriptContent: "" });
    expect(stats.wordCount).toBe(0);
    expect(stats.dialogueRatio).toBe(0);
    expect(stats.avgSentenceLength).toBe(0);
  });

  it("detects repeated phrases", () => {
    const html = `<p>${"było bardzo zimno i ".repeat(4)}koniec.</p>`;
    const stats = computeSceneStats({ id: "s3", manuscriptContent: html });
    expect(stats.repeatedPhrases.length).toBeGreaterThan(0);
    expect(stats.repeatedPhrases[0].count).toBeGreaterThanOrEqual(3);
  });
});

describe("aggregations", () => {
  it("aggregates chapter and book stats from scenes", () => {
    const scenes = [
      { id: "s1", manuscriptContent: sceneHtml },
      { id: "s2", manuscriptContent: "<p>Krótka scena bez dialogów w treści.</p>" }
    ];
    const sceneStats = scenes.map(computeSceneStats);
    const chapter = computeChapterStats({ id: "ch1" }, sceneStats);
    expect(chapter.sceneCount).toBe(2);
    expect(chapter.wordCount).toBe(sceneStats[0].wordCount + sceneStats[1].wordCount);

    const book = computeBookStats(scenes, 1);
    expect(book.wordCount).toBe(chapter.wordCount);
    expect(book.sceneCount).toBe(2);
    expect(book.avgSceneLength).toBe(Math.round(book.wordCount / 2));
  });
});

describe("helpers", () => {
  it("splits html into paragraphs", () => {
    expect(htmlToParagraphs(sceneHtml)).toHaveLength(3);
  });

  it("recognizes Polish dialogue paragraphs", () => {
    expect(isDialogueParagraph("— Zamknij drzwi.")).toBe(true);
    expect(isDialogueParagraph("„Cisza” — pomyślał.")).toBe(true);
    expect(isDialogueParagraph("Marek wszedł do izby.")).toBe(false);
  });

  it("flags common adverbs but not suffix-lookalike nouns", () => {
    expect(isLikelyAdverb("nagle")).toBe(true);
    expect(isLikelyAdverb("cicho")).toBe(true);
    expect(isLikelyAdverb("spotkanie")).toBe(false);
    expect(isLikelyAdverb("zdanie")).toBe(false);
  });
});
