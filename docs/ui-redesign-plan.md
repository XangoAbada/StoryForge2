# Przeprojektowanie UI — StoryForge2 (zrealizowane)

Data planu: 2026-07-02 · Wdrożone: 2026-07-02
Kierunek wizualny: **„redakcyjny jasny"** — wzorzec: `docs/ui-redesign-mockup.html` (zaakceptowany).
Kierunek v2 (ciemny/złoty, `storyforge2-ui-design-system-v2.html`) został **odrzucony** — dokument pozostaje tylko jako archiwum.

## Język wizualny

- **Papier i atrament**: ciepłe tło `--paper #f7f3ec` z subtelnym ziarnem, powierzchnie `--surface`, tekst `--text #211d16`.
- **Typografia**: nagłówki Fraunces (serif, `--font-display`), UI Schibsted Grotesk (`--font-ui`), proza rękopisu Source Serif 4 (`--font-prose`). Fonty bundlowane lokalnie przez @fontsource (działa offline w Tauri).
- **Jeden kolor = jedno znaczenie**: `--accent` (teal #1f5d57) — akcja główna/aktywne/fokus; `--ai` (ochra) — wyłącznie działania AI; `--success` — ukończone; `--danger` — destrukcja; `--rose` nie istnieje (nieużywany pomysł z makiety).
- **Motywy przewodnie**: nawigacja jak spis treści książki (numeracja 01–06, serif), panel AI jako „marginalia redaktora" (✎, kreskowana linia, karty-notatki), rękopis jako kartka z inicjałem i linią korektorską, dashboard jako półka z książkami.

## Co zostało zrobione

1. **Tokeny i fonty** — `apps/desktop/src/styles/tokens.css` (kolory, skala odstępów `--s1..--s7`, promienie, cienie, warstwy z-index); ~150 hardkodowanych kolorów w `styles.css` zmapowane na tokeny; wagi fontów znormalizowane do 400/600/700.
2. **Komponenty współdzielone** — `apps/desktop/src/shared/ui/`: Button (primary/secondary/ghost/ai/danger/icon, prop `busy`), Field, Modal (portal, Escape, sm/md/lg/xl, danger w stopce po lewej), Tabs + Segmented, Chip (plain/accent/ai, `pressed`, `onRemove`), StatusPill, TwoPane, EmptyState, Spinner. Style: `src/styles/components.css` (klasy `ui-*`).
3. **Shell** — `ProjectShell`: jasny rail 240px ze spisem treści, typograficzny brand „Story*Forge*", nagłówek z okruszkiem fazy nad serifowym tytułem, prawy panel AI jako marginalia (resize i log AI bez zmian).
4. **Strony** — wszystkie zmigrowane: Dashboard (masthead + półka), Koncepcja (kroki-kółka, Field, chipy), Plan (kroki, Segmented, karty rozdziałów z rzymską numeracją, wszystkie modale na Modal), Postacie + Świat (ujednolicone przez TwoPane/Tabs, wspólna sekcja CSS „bible"), Edytor scen (rękopis-kartka, pływający toolbar, chipy relacji), Eksport, Ustawienia AI, Log AI, panele AI.
5. **Dostępność** — kontrasty tokenów ≥ WCAG AA dla tekstu (spot-audit); Escape/fokus w Modal; aria-pressed/tablist w chipach i tabach.

Efekt uboczny: `styles.css` zmalał z 9067 do ~7400 linii, strony straciły ~2200 linii martwego kodu.

## Reguły spójności (obowiązujące)

- Kolory wyłącznie tokenami z `tokens.css`; żadnych hex/rgba w CSS stron i TSX.
- Nowe przyciski/pola/modale/chipy/taby wyłącznie z `shared/ui` — nie tworzyć nowych klas przyciskowych.
- Nagłówki `--font-display`, UI `--font-ui`, proza `--font-prose`; odstępy ze skali `--s*`.
- Znaczenia kolorów jak wyżej — nie używać ochry poza AI ani accentu do statusów.

## Świadomie poza zakresem

- i18n (UI po polsku), przełącznik motywów (jeden jasny), zmiany logiki/flow danych.
- Klasy legacy (`.field-label`, `.ai-field-button`, `.chapter-edit-*` dla ThreadEditModal) — retokenizowane, do wymiany przy okazji kolejnych prac.
- 8 zastanych porażek testów na masterze (planPromptPackage ×2, BookConceptPage ×6) — istnieją od commitu 80cdc8f, niezależne od redesignu; wydzielone jako osobne zadanie.
