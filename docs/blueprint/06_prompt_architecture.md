# Prompt Architecture

Prompt Architecture okresla, jak StoryForge2 komunikuje sie z Codex CLI Bridge. Celem jest powtarzalnosc, latwe parsowanie i dobre wykorzystanie kontekstu ksiazki.

## Zasada Glowna

Nie wysylac do AI calej bazy. Wysylac tylko kontekst potrzebny do danej akcji.

## PromptPackage

```ts
type PromptPackage = {
  id: string;
  projectId: string;
  action: AIAction;
  locale: "pl" | "en";
  userInstruction: string;
  context: PromptContext;
  outputContract: OutputContract;
  generationOptions: GenerationOptions;
};
```

## PromptContext

```ts
type PromptContext = {
  book?: BookContext;
  styleGuide?: string;
  selectedText?: string;
  currentScene?: SceneContext;
  previousScene?: SceneContext;
  nextScene?: SceneContext;
  relevantCharacters?: CharacterContext[];
  relevantWorldElements?: WorldElementContext[];
  relevantRules?: WorldRuleContext[];
  relevantThreads?: PlotThreadContext[];
  knownFacts?: StoryFactContext[];
  characterKnowledge?: CharacterKnowledgeContext[];
  userNotes?: string;
};
```

## Globalna Kontrola Kontekstu Promptu

Kazdy tekstowy prompt moze dostac `contextControl`, czyli snapshot decyzji
autora z prawego panelu przed wyslaniem najblizszego requestu AI.

```ts
type PromptContextControl = {
  includedContextKeys: string[];
  authorPriorityComment: string;
  contextSources: {
    key: string;
    label: string;
    required: boolean;
  }[];
};
```

Zasady:

- brak `contextControl` oznacza domyslny prompt bez filtrowania kontekstu;
- zrodla `required: true` zawsze trafiaja do promptu, nawet jesli nie ma ich w
  `includedContextKeys`;
- opcjonalne zrodla trafiaja do promptu tylko wtedy, gdy ich `key` jest w
  `includedContextKeys`;
- target deklaruje domyslny podzbior zrodel dla swojej akcji, a UI moze
  recznie dopiac dodatkowe zrodla z katalogu ekranu przed wyslaniem requestu;
- `authorPriorityComment` trafia do sekcji `# Author Priority` i ma najwyzszy
  priorytet merytoryczny po Hard Rules i Output Contract;
- draft kontekstu jest stanem sesyjnym UI, resetowanym po dodaniu zadania AI do
  kolejki albo po zamknieciu aktywnego kontekstu przez autora.

Wysylka z panelu uzywa tego samego `PromptContextControl`, co przycisk AI przy
polu. Przycisk `Zamknij` anuluje aktywny target, usuwa komentarz autora,
usuwa recznie dodane zrodla i przy kolejnej aktywacji wraca do domyslnego
zestawu zrodel danego pola.

## Kategorie Promptow

### Ideation

Uzywane do:

- tytulow;
- premisy;
- gatunku;
- tematow;
- stylu.

Wymaga:

- jasnej liczby wariantow;
- krotkiego uzasadnienia;
- mozliwosci wyboru przez uzytkownika.

### Structured Planning

Uzywane do:

- planu rozdzialow;
- watkow;
- profili postaci;
- elementow swiata.

Wymaga JSON.

### Drafting

Uzywane do:

- scen;
- rozdzialow;
- fragmentow prozy;
- dialogow.

Wymaga Markdown.

### Editing

Uzywane do:

- rewrite;
- expand;
- shorten;
- tone shift;
- line edit.

Wymaga zachowania intencji autora i pokazania ewentualnych uwag.

### Extraction

Uzywane do:

- wykrycia nowych faktow;
- aktualizacji Story Bible;
- wiedzy postaci;
- konfliktow ciaglosci.

Wymaga JSON z lista propozycji.

## Szablon Promptu

Kazdy prompt powinien miec ten porzadek:

```md
# Role
Jestes asystentem pisarskim pracujacym wewnatrz StoryForge2.

# Task
...

# Hard Rules
- Pisz po polsku, chyba ze projekt ma inny jezyk.
- Dla `locale: "pl"` używaj poprawnych polskich znaków w treści widocznej dla
  użytkownika i w odpowiedzi AI.
- Nie zmieniaj kanonu bez oznaczenia propozycji.
- Nie wprowadzaj nowych glownych faktow, jesli zadanie tego nie wymaga.
- Odpowiedz tylko w wymaganym formacie.

# Author Priority
Opcjonalny komentarz autora z globalnej kontroli kontekstu promptu.

# Book Context
...

# Relevant Story Bible
...

# Current Work
...

# Output Contract
...
```

## Kontrakt JSON

Kazdy JSON powinien zawierac:

```json
{
  "version": 1,
  "kind": "specific_kind",
  "summary": "short summary",
  "items": [],
  "warnings": []
}
```

Zasady:

- `version` zawsze liczba;
- `kind` musi pasowac do akcji;
- `warnings` zawiera problemy, nie zwykle komentarze;
- nie uzywac trailing commas;
- nie dodawac tekstu poza JSON.

## Przyklad: Generate Titles

Oczekiwany JSON:

```json
{
  "version": 1,
  "kind": "title_suggestions",
  "summary": "20 propozycji tytulow dla mrocznej powiesci fantasy",
  "items": [
    {
      "title": "Tytul",
      "subtitle": "Opcjonalny podtytul",
      "rationale": "Dlaczego pasuje",
      "tone": "mroczny",
      "risk": "Czy brzmi zbyt generycznie"
    }
  ],
  "warnings": []
}
```

## Przyklad: Draft Scene

Oczekiwany Markdown:

```md
## Result

Tekst sceny.

## Notes

- Ujawnione fakty: ...
- Potencjalne aktualizacje Story Bible: ...
```

## Budowanie Kontekstu

### Dla pojedynczego pola

Każde generowane pole powinno mieć prompt z kluczowym kontekstem sąsiednim.
Nie generować pola w izolacji, jeśli istnieją dane, które zmieniają sens
odpowiedzi.

Wysłać zależnie od ekranu:

- premise, gatunek, ton, odbiorców i style guide dla koncepcji;
- aktywne postacie, relacje, role fabularne i wątki dla postaci;
- lokację, reguły świata, postacie i wątki dla scen;
- istniejące elementy świata, reguły i konsekwencje fabularne dla świata;
- dotychczasowy plan, rozdziały, konflikty i payoffy dla outline.

### Dla tytulow

Wyslac:

- premise;
- gatunek;
- ton;
- odbiorcow;
- tematy;
- przyklady tytulow lub antyprzyklady od uzytkownika.

### Dla sceny

Wyslac:

- cel sceny;
- poprzednia scena;
- nastepna scena;
- POV;
- postacie obecne;
- wiedza postaci w tej chwili;
- lokacja;
- aktywne watki;
- reguly swiata dotyczace sceny;
- styl guide;
- target word count.

### Dla ekstrakcji

Wyslac:

- tekst sceny;
- istniejace postacie;
- istniejace fakty;
- istniejace reguly;
- prosbe o propozycje zmian, nie automatyczne nadpisanie.

## Walidacja Odpowiedzi

Po otrzymaniu wyniku:

1. Sprawdz, czy wynik nie jest pusty.
2. Jesli oczekiwano JSON, wyodrebnij JSON z fenced block albo calego tekstu.
3. Waliduj Zod.
4. Jesli walidacja nie przejdzie, pokaz blad i opcje naprawy formatowania.
5. Nie stosuj zmian bez akceptacji.

## Retry

Retry powinien zachowac:

- oryginalny prompt;
- blad parsera;
- surowa odpowiedz;
- prosbe o naprawe tylko formatu, nie tresci.

Prompt retry:

```md
Poprzednia odpowiedz nie pasowala do wymaganego formatu.
Nie zmieniaj merytorycznej tresci.
Zwroc poprawny JSON zgodny z kontraktem.
```

## Testowanie Promptow

Snapshot promptu powinien sprawdzać nie tylko format, ale też to, czy prompt
zawiera inne kluczowe pola wymagane do wygenerowania danego pola oraz czy
reguły językowe wymuszają polskie znaki dla `locale: "pl"`.

## Token Hygiene

Nie wysylac:

- calej historii projektu bez potrzeby;
- prywatnych notatek niezwiązanych z akcja;
- tokenow, sciezek auth, ustawien konta;
- logow technicznych.

Wysylac:

- streszczenia;
- tylko relewantne encje;
- ostatnie sceny;
- fakty potrzebne do spójnosci.
