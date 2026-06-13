# StoryForge2 TODO

Glowne miejsce pracy nad implementacja StoryForge2. Ten plik sluzy do
odhaczania wykonanych zadan i jako szybki indeks do dokumentacji zrodlowej.

Gdy kontynuujemy prace, startuj od tego pliku, znajdz pierwsze nieodhaczone
zadanie w najwczesniejszej aktywnej fazie, przeczytaj wskazane dokumenty
zrodlowe i dopiero wtedy implementuj.

## Jak uzywac tego pliku

- [ ] Przed rozpoczeciem fazy przeczytaj dokumenty podane w jej sekcji
      "Zrodla".
- [ ] Po wykonaniu zadania odhacz je w tym pliku.
- [ ] Po zakonczeniu fazy sprawdz jej acceptance criteria w dokumentacji
      zrodlowej oraz przekrojowe testy w
      [19_testy_acceptance.md](docs/blueprint/19_testy_acceptance.md).
- [ ] Nie przeskakuj do pozniejszych providerow ani API, dopoki V1 nie ma
      dzialajacego `codex-cli-bridge`.

## Najwazniejsze dokumenty zrodlowe

### Zalozenia produktu

- [00_README.md](docs/blueprint/00_README.md) - kolejnosc czytania,
  definicja V1, granice V1 i glowny przeplyw AI.
- [01_wizja_produktu.md](docs/blueprint/01_wizja_produktu.md) - wizja,
  obietnica aplikacji, uzytkownik i ton UX.
- [02_proces_pisarski.md](docs/blueprint/02_proces_pisarski.md) - proces
  pisarski od pomyslu do redakcji.

### Architektura i technikalia

- [03_stack_techniczny.md](docs/blueprint/03_stack_techniczny.md) - stack,
  warstwy aplikacji, repo structure i pierwszy scaffold.
- [04_ai_provider_codex_cli_bridge.md](docs/blueprint/04_ai_provider_codex_cli_bridge.md) - provider AI V1,
  detekcja CLI, uruchamianie `codex exec`, bledy i acceptance criteria.
- [05_model_danych.md](docs/blueprint/05_model_danych.md) - model danych,
  encje, minimalne migracje i statusy.
- [06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md) - PromptPackage,
  kontekst, kontrakty odpowiedzi, walidacja i retry.
- [07_ux_i_nawigacja.md](docs/blueprint/07_ux_i_nawigacja.md) - glowny
  uklad UI, dashboard, panele AI, UX i accessibility.

### Fazy, testy i prompty dla implementera

- [08_faza_1_fundament.md](docs/blueprint/08_faza_1_fundament.md)
- [09_faza_2_koncepcja_ksiazki.md](docs/blueprint/09_faza_2_koncepcja_ksiazki.md)
- [10_faza_3_plan_powieści.md](docs/blueprint/10_faza_3_plan_powieści.md)
- [11_faza_4_postacie_relacje.md](docs/blueprint/11_faza_4_postacie_relacje.md)
- [12_faza_5_swiat_reguly.md](docs/blueprint/12_faza_5_swiat_reguly.md)
- [13_faza_6_watki_ciaglosc_wiedza.md](docs/blueprint/13_faza_6_watki_ciaglosc_wiedza.md)
- [14_faza_7_edytor_scen.md](docs/blueprint/14_faza_7_edytor_scen.md)
- [15_faza_8_ekstrakcja_dynamiczna.md](docs/blueprint/15_faza_8_ekstrakcja_dynamiczna.md)
- [16_faza_9_grafika.md](docs/blueprint/16_faza_9_grafika.md)
- [17_faza_10_redakcja_eksport.md](docs/blueprint/17_faza_10_redakcja_eksport.md)
- [18_future_providers.md](docs/blueprint/18_future_providers.md)
- [19_testy_acceptance.md](docs/blueprint/19_testy_acceptance.md)
- [20_prompty_dla_ai_implementera.md](docs/blueprint/20_prompty_dla_ai_implementera.md)

## Stale zasady V1

- [ ] V1 uzywa `codex-cli-bridge` jako jedynego aktywnego providera AI.
- [ ] UI zawsze komunikuje sie z AI przez wspolny `AIProvider`.
- [ ] Kazda odpowiedz AI zmieniajaca dane projektu przechodzi przez panel
      propozycji i akceptacje uzytkownika.
- [ ] AI nie zapisuje kanonu automatycznie.
- [ ] Nie przechowujemy tokenow ChatGPT, OAuth ani kluczy Codex w bazie.
- [ ] Nie automatyzujemy ChatGPT web i nie uzywamy prywatnych endpointow.
- [ ] Aplikacja jest lokalnym desktopem, bez kont uzytkownikow i chmury w V1.
- [ ] Pierwszy ekran to dashboard projektow albo ostatni projekt, nie landing page.
- [ ] Kazda faza zostawia aplikacje w stanie uruchamialnym.
- [ ] Teksty widoczne w UI, prompty i odpowiedzi AI po polsku używają
      poprawnych polskich znaków. Nie dotyczy to nazw technicznych, typów,
      pól API ani identyfikatorów w kodzie.
- [ ] Każde generowane albo uzupełniane pole ma własny przycisk AI lub mini
      akcję AI dopasowaną do kontekstu pola.
- [ ] Prompt generujący pojedyncze pole zawiera inne kluczowe pola projektu,
      np. premise, gatunek, ton, odbiorców, style guide, postacie, lokację,
      wątki albo reguły świata, zależnie od ekranu.

## Fazy implementacji

### Faza 1: Fundament aplikacji

Zrodla:
[03_stack_techniczny.md](docs/blueprint/03_stack_techniczny.md),
[04_ai_provider_codex_cli_bridge.md](docs/blueprint/04_ai_provider_codex_cli_bridge.md),
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[07_ux_i_nawigacja.md](docs/blueprint/07_ux_i_nawigacja.md),
[08_faza_1_fundament.md](docs/blueprint/08_faza_1_fundament.md),
[20_prompty_dla_ai_implementera.md](docs/blueprint/20_prompty_dla_ai_implementera.md)

- [x] Zainicjowac repozytorium Git.
- [x] Utworzyc scaffold Tauri 2 + React + Vite + TypeScript w `apps/desktop`.
- [x] Wlaczyc TypeScript strict i podstawowa konfiguracje projektu.
- [x] Dodac routing oraz globalny shell UI z dashboardem i layoutem projektu.
- [x] Dodac SQLite po stronie Tauri/Rust.
- [x] Dodac migracje startowe dla `projects`, `books`, `ai_runs`,
      `ai_proposals`.
- [x] Dodac komendy Tauri: `create_project`, `list_projects`, `get_project`,
      `update_book_concept`.
- [x] Dodac komendy Tauri: `check_codex_cli`, `run_codex_prompt`.
- [x] Dodac ekran ustawien/statusu Codex CLI.
- [x] Dodac ekran koncepcji ksiazki z minimalnymi polami `Book`.
- [x] Dodac pierwszy AI flow `generate_titles` przez `codex exec`.
- [x] Dodac panel propozycji AI i akceptacje wyboru tytulu przed zapisem.
- [x] Dodac testy migracji, tworzenia projektu, parsera tytulow i mockowanego
      UI flow.

### Faza 2: Koncepcja ksiazki

Zrodla:
[02_proces_pisarski.md](docs/blueprint/02_proces_pisarski.md),
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[09_faza_2_koncepcja_ksiazki.md](docs/blueprint/09_faza_2_koncepcja_ksiazki.md)

- [x] Rozbudowac ekran koncepcji o tytul, premise, logline, gatunek,
      podgatunek, odbiorcow, ton, punkt widzenia, style guide i target word
      count.
- [x] Dodac zapis i walidacje wszystkich pol koncepcji.
- [x] Dodac liste alternatywnych tytulow i notatke wyboru.
- [x] Zapewnic, ze kazde pole koncepcji ma wlasny przycisk generacji AI.
- [x] Dodac AI action `expand_premise` z kontraktem `premise_development`.
- [x] Dodac AI action `generate_style_guide`.
- [x] Umozliwic czesciowa akceptacje pol z propozycji AI.
- [x] Upewnic sie, ze style guide trafia do pozniejszych promptow.
- [x] Dodac testy walidacji premisy, importu `premise_development` i promptu
      koncepcji.
- [x] Upewnić się, że każde generowane pole koncepcji ma przycisk AI, prompt
      bierze pozostałe kluczowe pola koncepcji, a wynik po polsku zachowuje
      polskie znaki.

### Faza 3: Plan powiesci

Zrodla:
[02_proces_pisarski.md](docs/blueprint/02_proces_pisarski.md),
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[10_faza_3_plan_powieści.md](docs/blueprint/10_faza_3_plan_powieści.md)

- [x] Dodac ekran struktury fabuly z wyborami: trzy akty, Save the Cat,
      Hero's Journey, Mystery outline, Custom.
- [x] Dodac dane dla struktury, aktow i beatow.
- [x] Dodac widok planu rozdzialow z kolejnoscia, tytulem, streszczeniem,
      celem, konfliktem i target word count.
- [x] Dodac podstawowy widok planu scen.
- [x] Dodac AI action `generate_plot_outline` z importem JSON jako oddzielnych
      encji.
- [x] Umozliwic alternatywne plany bez kasowania aktualnego.
- [x] Umozliwic oznaczenie planu jako aktywnego.
- [x] Dodac kontrole jakosci: rozdzial bez konfliktu, brak payoffu,
      final bez przygotowania.
- [ ] Dodac testy importu outline, `orderIndex`, reorder i walidacji konfliktu.
- [x] Upewnić się, że generowanie pól planu uwzględnia kluczowe pola
      koncepcji i Story Bible oraz zachowuje polskie znaki w wynikach po
      polsku.

### Faza 4: Postacie i relacje

Zrodla:
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[11_faza_4_postacie_relacje.md](docs/blueprint/11_faza_4_postacie_relacje.md)

- [x] Dodac liste postaci i ekran profilu postaci.
- [x] Dodac CRUD postaci z polami profilu, motywacji, sekretow, glosu i luku.
- [x] Dodac AI action `generate_character` z kontraktem `character_profile`.
- [x] Umozliwic czesciowa akceptacje pol profilu postaci.
- [x] Dodac relacje kierunkowe miedzy postaciami.
- [x] Dodac AI action dla konfliktu/rozwoju relacji.
- [x] Dodac podstawowy model wiedzy postaci.
- [x] Umozliwic przypisanie postaci do sceny.
- [x] Upewnic sie, ze prompt sceny moze dostac glos i wiedze postaci POV.
- [ ] Dodac testy profilu, importu JSON, relacji i filtrowania postaci w
      promptach.
- [x] Upewnić się, że każde generowane pole profilu postaci ma przycisk AI,
      a prompt uwzględnia kluczowe pola książki, role fabularne, relacje i
      istniejące postacie.

### Faza 5: Swiat i reguly

Zrodla:
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[12_faza_5_swiat_reguly.md](docs/blueprint/12_faza_5_swiat_reguly.md)

- [x] Dodac ekran elementow swiata.
- [x] Dodac CRUD lokacji, frakcji, przedmiotow, kultur, technologii, magii i
      innych elementow swiata.
- [x] Dodac osobny zapis regul swiata.
- [x] Umozliwic powiazanie regul z elementami swiata i scenami.
- [x] Dodac AI action `generate_world_element`.
- [x] Dodac AI action `check_world_rule`.
- [x] Dodac prompty wizualne jako tekst/metadane, bez image API.
- [x] Upewnic sie, ze prompt sceny zawiera tylko istotne reguly i lokacje.
- [ ] Dodac testy importu elementu swiata, powiazan lokacji/regul i promptu
      sceny z lokacja.
- [x] Upewnić się, że generowanie pól świata i reguł ma akcje AI per pole oraz
      używa kluczowego kontekstu książki, postaci, wątków i istniejących reguł.

### Faza 6: Watki, ciaglosc i wiedza

Zrodla:
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[13_faza_6_watki_ciaglosc_wiedza.md](docs/blueprint/13_faza_6_watki_ciaglosc_wiedza.md)

- [ ] Dodac ekran watkow z typem, pytaniem dramatycznym, setupem, rozwojem,
      payoffem i statusem.
- [ ] Dodac timeline zdarzen historii.
- [ ] Dodac fakty kanoniczne z `truthStatus`.
- [ ] Dodac wiedze postaci z `knowledgeStatus`.
- [ ] Dodac raport ciaglosci.
- [ ] Dodac AI action `extract_story_facts`.
- [ ] Dodac AI action `review_continuity`.
- [ ] Upewnic sie, ze prompt sceny filtruje wiedze wedlug miejsca w timeline.
- [ ] Dodac testy izolacji wiedzy postaci, odrzucania propozycji i severity w
      raporcie ciaglosci.

### Faza 7: Edytor scen i rozdzialow

Zrodla:
[06_prompt_architecture.md](docs/blueprint/06_prompt_architecture.md),
[07_ux_i_nawigacja.md](docs/blueprint/07_ux_i_nawigacja.md),
[14_faza_7_edytor_scen.md](docs/blueprint/14_faza_7_edytor_scen.md)

- [ ] Dodac TipTap jako edytor scen.
- [ ] Dodac widok rozdzialu z lista scen, statusem i licznikami slow.
- [ ] Dodac widok sceny z celem, konfliktem, wynikiem, POV, lokacja,
      postaciami, watkami i tekstem.
- [ ] Dodac autosave i odtwarzanie danych po restarcie.
- [ ] Dodac licznik slow i target word count.
- [ ] Dodac popup AI dla zaznaczenia tekstu.
- [ ] Dodac AI actions `draft_scene`, `continue_scene`, `rewrite_selection`,
      `expand_selection`.
- [ ] Dodac warianty odpowiedzi AI i tryby wstawiania wyniku.
- [ ] Wymagac decyzji uzytkownika przed zmiana tekstu przez AI.
- [ ] Dodac testy licznika, zaznaczenia, promptu sceny, anulowania i rewrite.
- [ ] Upewnić się, że generowanie pól sceny i akcje edytora uwzględniają
      kluczowe pola sceny, rozdziału, Story Bible i style guide.

### Faza 8: Ekstrakcja dynamiczna

Zrodla:
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[13_faza_6_watki_ciaglosc_wiedza.md](docs/blueprint/13_faza_6_watki_ciaglosc_wiedza.md),
[15_faza_8_ekstrakcja_dynamiczna.md](docs/blueprint/15_faza_8_ekstrakcja_dynamiczna.md)

- [ ] Dodac subtelna akcje "Zaktualizuj Story Bible" po zapisaniu sceny albo
      na zadanie autora.
- [ ] Dodac AI action `dynamic_extraction`.
- [ ] Pokazywac propozycje ekstrakcji jako pojedyncze decyzje.
- [ ] Obslugiwac nowe postacie, aktualizacje postaci, relacje, swiat, reguly,
      fakty, wiedze, timeline i watki.
- [ ] Wykrywac mozliwe duplikaty i pokazywac ostrzezenia.
- [ ] Umozliwic edycje propozycji przed akceptacja.
- [ ] Zapisywac akceptowane propozycje transakcyjnie.
- [ ] Zapisywac odrzucone propozycje, zeby nie wracaly natychmiast bez zmiany
      tekstu.
- [ ] Dodac testy nowej postaci, duplikatu, wiedzy jednej postaci, odrzucenia
      i transakcyjnej akceptacji wielu propozycji.

### Faza 9: Grafika i ilustracje

Zrodla:
[05_model_danych.md](docs/blueprint/05_model_danych.md),
[16_faza_9_grafika.md](docs/blueprint/16_faza_9_grafika.md)

- [ ] Dodac model i ekran assetow wizualnych.
- [ ] Umozliwic zapis promptu wizualnego bez pliku obrazu.
- [ ] Umozliwic przypisanie lokalnego pliku obrazu do postaci, lokacji albo
      sceny.
- [ ] Dodac typy assetow: portret, lokacja, obiekt, mapa, scena, bajka,
      visual style guide, okladka robocza.
- [ ] Dodac AI action do generowania promptu portretu postaci.
- [ ] Dodac AI actions dla promptu mapy i ilustracji sceny.
- [ ] Wspierac spojny styl ilustracji dla bajek jako metadane/prompt.
- [ ] Nie implementowac image API w V1.
- [ ] Dodac testy assetu bez pliku, assetu z plikiem, promptu portretu i
      promptu mapy.

### Faza 10: Redakcja i eksport

Zrodla:
[17_faza_10_redakcja_eksport.md](docs/blueprint/17_faza_10_redakcja_eksport.md),
[19_testy_acceptance.md](docs/blueprint/19_testy_acceptance.md)

- [ ] Dodac ekran redakcji strukturalnej, watkow, ciaglosci, scen, line edit i
      korekty.
- [ ] Dodac AI action `chapter_review`.
- [ ] Pokazywac raport rozdzialu bez automatycznej zmiany tekstu.
- [ ] Dodac line edit dla zaznaczenia tekstu.
- [ ] Dodac eksport Markdown.
- [ ] Dodac eksport plain text.
- [ ] Umozliwic eksport calej ksiazki albo wybranych rozdzialow.
- [ ] Umozliwic eksport tylko manuskryptu albo manuskryptu ze streszczeniami.
- [ ] Upewnic sie, ze plain text nie zawiera danych Story Bible.
- [ ] Dodac testy pustej ksiazki, kolejnosci rozdzialow, line edit, raportu
      ciaglosci i odrzucenia sugestii.

## Acceptance V1

Zrodla:
[00_README.md](docs/blueprint/00_README.md),
[19_testy_acceptance.md](docs/blueprint/19_testy_acceptance.md)

- [ ] Aplikacja uruchamia sie jako desktop.
- [ ] Projekt zapisuje sie lokalnie w SQLite.
- [ ] Po restarcie projekt jest widoczny.
- [ ] Codex CLI Bridge dziala dla co najmniej trzech akcji: tytuly, postac,
      scena.
- [ ] Panel propozycji wymaga akceptacji uzytkownika.
- [ ] Edytor scen jest uzywalny.
- [ ] Story Bible zasila prompt sceny.
- [ ] Brak Codex CLI jest obsluzony bez crasha.
- [ ] Eksport Markdown dziala.

## Poza V1 / nie implementowac teraz

Zrodla:
[00_README.md](docs/blueprint/00_README.md),
[16_faza_9_grafika.md](docs/blueprint/16_faza_9_grafika.md),
[17_faza_10_redakcja_eksport.md](docs/blueprint/17_faza_10_redakcja_eksport.md),
[18_future_providers.md](docs/blueprint/18_future_providers.md)

- [ ] Nie implementowac platnosci, kont uzytkownikow ani chmury.
- [ ] Nie implementowac wspolpracy wielu autorow.
- [ ] Nie implementowac `manual-chatgpt` jako aktywnego providera w V1.
- [ ] Nie implementowac OpenAI API ani Anthropic API w V1.
- [ ] Nie implementowac provider selection UI poza statusem Codex CLI.
- [ ] Nie implementowac generowania obrazow przez API.
- [ ] Nie implementowac prywatnych endpointow ChatGPT.
- [ ] Nie przechwytywac tokenow sesji z przegladarki.
- [ ] Nie robic DOCX, EPUB ani PDF jako wymaganego eksportu poczatkowego.
- [ ] Nie implementowac automatycznej publikacji ksiazki.
