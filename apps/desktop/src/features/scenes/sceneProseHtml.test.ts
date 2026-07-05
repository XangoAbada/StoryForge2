import { describe, expect, it } from "vitest";
import { proseToEditorHtml } from "./sceneProseHtml";

describe("proseToEditorHtml", () => {
  it("zamienia akapity rozdzielone pustą linią na osobne <p>", () => {
    const prose = "Pierwszy akapit.\n\nDrugi akapit.\n\nTrzeci akapit.";
    expect(proseToEditorHtml(prose)).toBe(
      "<p>Pierwszy akapit.</p><p>Drugi akapit.</p><p>Trzeci akapit.</p>"
    );
  });

  it("traktuje wiele pustych linii jako jedną granicę akapitu", () => {
    expect(proseToEditorHtml("A.\n\n\n\nB.")).toBe("<p>A.</p><p>B.</p>");
  });

  it("zamienia pojedynczy \\n wewnątrz akapitu na <br>", () => {
    expect(proseToEditorHtml("Linia jeden.\nLinia dwa.")).toBe(
      "<p>Linia jeden.<br>Linia dwa.</p>"
    );
  });

  it("escapuje znaki HTML", () => {
    expect(proseToEditorHtml("a < b & c > d")).toBe("<p>a &lt; b &amp; c &gt; d</p>");
  });

  it("zwraca pusty string dla pustego wejścia", () => {
    expect(proseToEditorHtml("")).toBe("");
    expect(proseToEditorHtml("   \n\n  ")).toBe("");
  });

  it("zachowuje polskie znaki i pauzy dialogowe", () => {
    expect(proseToEditorHtml("— Zamknij drzwi — powiedziała Hanna.")).toBe(
      "<p>— Zamknij drzwi — powiedziała Hanna.</p>"
    );
  });
});
