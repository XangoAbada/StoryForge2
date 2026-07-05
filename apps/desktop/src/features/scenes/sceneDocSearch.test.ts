import { describe, expect, it } from "vitest";
import { findQuoteRangeInDoc, type DocLike } from "./sceneDocSearch";

// Sztuczny dokument PM: akapity jako teksty z pozycjami jak w ProseMirror
// (paragraf na pos p, jego tekst zaczyna się na p+1, kolejny paragraf na końcu+1).
function docFromParagraphs(paragraphs: string[]): DocLike {
  return {
    descendants(callback) {
      let pos = 0;
      for (const text of paragraphs) {
        callback({ isText: false }, pos); // węzeł paragrafu
        callback({ isText: true, text }, pos + 1);
        pos += text.length + 2; // tokeny otwarcia i zamknięcia paragrafu
      }
    }
  };
}

describe("findQuoteRangeInDoc", () => {
  const doc = docFromParagraphs(["Ala ma kota.", "Kot ma Alę — naprawdę."]);

  it("finds an exact quote inside a paragraph", () => {
    const range = findQuoteRangeInDoc(doc, "ma kota");
    expect(range).toEqual({ from: 5, to: 12 });
  });

  it("finds a quote spanning a paragraph boundary", () => {
    const range = findQuoteRangeInDoc(doc, "kota. Kot ma");
    // "kota." kończy się na pos 12 (znak '.'), "ma" kończy się w drugim akapicie.
    expect(range?.from).toBe(8);
    expect(range?.to).toBe(21);
  });

  it("normalizes whitespace and typographic dashes", () => {
    const range = findQuoteRangeInDoc(doc, "Alę   – naprawdę");
    expect(range).not.toBeNull();
  });

  it("falls back to quote prefix when the tail differs", () => {
    const longDoc = docFromParagraphs([
      "To jest bardzo długie zdanie testowe, które ma ponad sześćdziesiąt znaków w pierwszej części i różni się końcówką."
    ]);
    const quote =
      "To jest bardzo długie zdanie testowe, które ma ponad sześćdziesiąt znaków w INNEJ końcówce niż dokument.";
    const range = findQuoteRangeInDoc(longDoc, quote);
    expect(range?.from).toBe(1);
  });

  it("returns null for empty or missing quotes", () => {
    expect(findQuoteRangeInDoc(doc, "")).toBeNull();
    expect(findQuoteRangeInDoc(doc, "nie ma takiego tekstu")).toBeNull();
  });
});
