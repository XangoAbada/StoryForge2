// Proza AI (akapity rozdzielone pustą linią) -> HTML z realnymi <p>, żeby TipTap
// tworzył węzły akapitów przetrwające round-trip getHTML/setContent. Bez konwersji
// surowe "\n\n" nie stają się akapitami i po ponownym wczytaniu tekst zbija się w blok.

export function proseToEditorHtml(prose: string): string {
  return prose
    .trim()
    .split(/\n{2,}/) // blok = akapit
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`) // pojedynczy \n -> <br>
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
