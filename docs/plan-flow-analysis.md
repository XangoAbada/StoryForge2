# StoryForge2: audyt przepływu planu

Data: 14 czerwca 2026  
Zakres: strona Plan, przepływ rozdziały -> sceny -> beaty -> wątki, relacje ze Story Bible oraz nowe zapytania AI.

## Najkrótszy wniosek

Największy zysk UX nie wynika z dodania kolejnych widoków, tylko z jasnego podziału:

- rozdział jest miejscem planowania decyzji fabularnych,
- scena jest miejscem wykonania tych decyzji,
- Story Bible dostaje propozycje wtedy, gdy plan albo tekst ujawni realną potrzebę,
- AI powinno pomagać przechodzić między poziomami, nie tylko generować pojedyncze pola.

Obecny model danych jest blisko dobrego kierunku, ale UI pozwala zmieniać te same relacje w kilku miejscach. To tworzy wrażenie skakania między Planem, Scenami, Beatami, Wątkami, Postaciami i Światem.

## Diagnoza obecnego stanu

Przepływ jest dziś rozbity na kroki: struktura, akty, rozdziały, sceny, beaty, wątki. Dane są sensowne, ale kolejność i miejsca edycji zachęcają do wracania w kółko.

### Co powoduje tarcie

1. **Sceny są przed beatami i wątkami**

   W kreatorze można przejść do scen zanim autor domknie beaty i przebieg wątków, więc scena nie ma jeszcze dobrego kontraktu fabularnego.

2. **Te same relacje żyją w kilku miejscach**

   Wątki można dopinać z rozdziału, mapy wątków i edytora wątku. Sceny mają ustawienia w Planie oraz w Edytorze.

3. **Scena nie dziedziczy decyzji rozdziału w UI**

   Model promptu zna rozdziałowe wątki i reguły, ale interfejs sceny traktuje relacje jak puste ręczne listy do uzupełnienia.

4. **AI jest mocne per pole, słabsze jako przewodnik przepływu**

   Mamy generowanie pól i propozycje scen, ale brakuje akcji typu: przygotuj rozdział do scen, zasiej relacje sceny, wskaż braki Story Bible.

5. **Story Bible pojawia się za wcześnie albo za późno**

   Postacie i świat są osobnymi ekranami. Plan nie pomaga zdecydować, kiedy brak encji blokuje scenę, a kiedy to tylko notatka na później.

## Proponowany przepływ

Najpierw kontrakt rozdziału, potem sceny.

Autor powinien móc pracować z jednym aktywnym rozdziałem: widzieć jego cel, przypięte beaty i wątki, rozbić go na sceny, a dopiero potem doprecyzować lokalne postacie, lokację i reguły świata.

### Docelowa kolejność pracy

1. **Struktura i akty**

   Wybór kręgosłupa historii oraz zakresów aktów. Bez scen.

2. **Wątki główne**

   Lista napięć, pytań dramatycznych i łuków, które mają przejść przez rozdziały.

3. **Beaty**

   Obowiązki strukturalne. Beat ma odpowiadać na pytanie: co musi się wydarzyć?

4. **Rozdziały**

   Kontener decyzji: cel, konflikt, punkt zwrotny, przypięte beaty i wątki.

5. **Sceny**

   Wykonanie rozdziału: kto, gdzie, jaki lokalny konflikt i jaki wynik.

6. **Pisanie i ekstrakcja**

   Edytor prozy, a po akceptacji tekstu propozycje faktów, postaci i świata.

## Rozdział jako kokpit planowania

Zamiast osobno myśleć o widokach Rozdziały, Sceny, Beaty i Wątki jako niezależnych etapach, najważniejsza praca może dziać się wokół aktywnego rozdziału.

Osobne ekrany zostają jako mapy i menedżery, ale nie jako jedyne miejsce decyzyjne.

### Proponowany układ kokpitu

#### Lewa kolumna: mapa rozdziałów

Pokazuje:

- akty,
- kolejność rozdziałów,
- status gotowości,
- liczbę scen,
- liczbę przypiętych beatów,
- liczbę przypiętych wątków.

Przykład:

- R1: Wejście w konflikt, 2 sceny, 1 beat, 2 wątki
- R2: Pierwszy koszt, 3 sceny, 2 beaty, 3 wątki
- R3: Decyzja bez odwrotu, brak scen, 1 beat, 2 wątki

#### Środek: aktywny rozdział

Pokazuje:

- tytuł,
- cel,
- konflikt,
- punkt zwrotny,
- target słów,
- listę scen,
- CTA do rozbicia rozdziału na sceny,
- CTA do dodania kolejnej sceny.

Scena w tym widoku pokazuje skrót:

- numer,
- tytuł,
- POV,
- lokację,
- wynik,
- chipy wątków,
- chipy beatów jako pokrycie rozdziału,
- chipy postaci,
- chipy świata.

#### Prawa kolumna: pokrycie rozdziału

Pokazuje:

- beaty przypięte do rozdziału,
- które beaty są pokryte scenami,
- wątki rozdziału,
- opis tego, co dzieje się z wątkiem w rozdziale,
- braki Story Bible potrzebne przed pisaniem,
- ostrzeżenia AI.

## Źródła prawdy dla relacji

Zasada: każda relacja ma jedno kanoniczne miejsce edycji. Inne widoki mogą pokazywać chipy, podpowiadać i prowadzić do decyzji, ale nie powinny sprawiać wrażenia osobnych źródeł prawdy.

| Relacja | Kanoniczne miejsce decyzji | Jak pokazywać gdzie indziej | Rekomendacja |
| --- | --- | --- | --- |
| Rozdział -> akt | Mapa rozdziałów | Kolumna aktu, kolor aktu, rail aktów | Zostawić. To dobra relacja do przeciągania i sortowania. |
| Scena -> rozdział | Kokpit rozdziału | W Edytorze jako wybór rozdziału, ale z ostrzeżeniem przy zmianie | Tworzenie sceny domyślnie z aktywnego rozdziału. Bez rozdziału tylko jako roboczy parking. |
| Beat -> rozdział | Kokpit rozdziału | Tablica beatów jako narzędzie porządkowania i przenoszenia | Utrzymać beat jako rozdziałowy kontrakt. Nie zmuszać do przypinania beatu do sceny w V1. |
| Wątek -> rozdział | Kokpit rozdziału | Mapa wątków pokazuje pokrycie i pozwala szybko dodać relację, ale edycja opisu wraca do rozdziału | Wymagać krótkiego opisu relacji: setup, rozwój, komplikacja, payoff albo pauza. |
| Wątek -> scena | Ustawienia sceny | Na karcie sceny jako chipy dziedziczone i ręcznie wybrane | Scena dostaje sugestie z wątków rozdziału. Jeśli autor doda nowy wątek do sceny, UI pyta: dopiąć też do rozdziału? |
| Postać -> scena | Ustawienia sceny | W rozdziale jako podsumowanie obsady scen | POV to pole sceny, obecne postacie to relacje sceny. Postacie rozdziału wyliczać z jego scen. |
| Świat -> scena | Ustawienia sceny | W Świecie jako odwrócona mapa użycia elementu lub reguły | Lokacja jako jedno pole sceny. Pozostałe elementy i reguły jako jawne chipy tylko, gdy są naprawdę potrzebne w promptach. |

## Co przypinać do scen

Scena nie powinna nieść całej struktury książki.

Scena ma być lekka:

- cel,
- konflikt,
- wynik,
- POV,
- lokacja,
- uczestnicy,
- aktywne wątki,
- istotne reguły świata,
- target słów,
- status.

Rozdział trzyma beaty i wątki jako kontrakt. Scena wybiera z tego tylko to, co faktycznie gra w danym fragmencie.

### Przypinamy do sceny zawsze lub prawie zawsze

- POV,
- lokację,
- postacie obecne,
- aktywne wątki sceny,
- cel,
- konflikt,
- wynik,
- target słów,
- status.

### Dziedziczymy z rozdziału jako sugestię

- beaty rozdziału,
- wątki rozdziału,
- opis tego, co ma się zmienić w rozdziale,
- sąsiednie rozdziały,
- sąsiednie sceny.

### Przypinamy tylko, gdy wpływa na pisanie

- reguły świata,
- elementy świata poza lokacją,
- relacje postaci,
- fakty kanoniczne,
- ograniczenia wiedzy postaci.

### Nie zapisujemy automatycznie

- nowych postaci,
- nowego świata,
- nowych reguł,
- faktów z tekstu.

Te elementy powinny przejść przez propozycję i akceptację autora.

## Kiedy generować postacie i świat

Największy błąd to generować pełną encyklopedię zanim wiadomo, czego potrzebuje scena. Drugi błąd to czekać aż do pisania, gdy brakuje POV, głosu albo reguły świata.

### Po koncepcji

Wygenerować tylko rdzeń:

- protagonistę,
- siłę przeciwną,
- 2-4 główne role,
- szkic settingu.

Bez detali scenicznych.

### Po przypięciu wątków i beatów do rozdziału

AI może wskazać brakujące:

- role,
- lokacje,
- reguły,
- frakcje,
- obiekty,
- relacje.

To najlepszy moment na kandydatów do Story Bible, bo rozdział ma już zadania fabularne.

### Podczas rozbijania rozdziału na sceny

Generować lokalnie:

- obsadę sceny,
- POV,
- lokację,
- reguły aktywne w scenie,
- elementy świata potrzebne do konfliktu.

Jeśli czegoś nie ma w Story Bible, UI powinno pokazać akcję typu: utwórz kandydat.

### Po napisaniu sceny

Uruchomić analizę fragmentu:

- nowe fakty,
- wspomnienia,
- relacje,
- elementy świata,
- reguły.

Wszystko jako propozycje, bez automatycznego zapisu.

## Nowe zapytania AI

Obecne prompty dobrze obsługują pojedyncze pola. Brakuje promptów, które pomagają przejść z poziomu rozdziału do sceny oraz z planu do Story Bible.

### `prepare_chapter_for_scenes`

**Przygotuj rozdział do rozbicia**

Audytuje:

- cel,
- konflikt,
- punkt zwrotny,
- przypięte beaty,
- przypięte wątki,
- sąsiednie rozdziały.

Zwraca:

- braki blokujące rozbijanie na sceny,
- pytania do autora,
- ostrzeżenia o słabym konflikcie,
- sugestię kolejnego kroku.

### `generate_chapter_scene_breakdown`

**Rozbij rozdział na sceny**

Tworzy 2-5 propozycji scen z:

- tytułem,
- celem,
- konfliktem,
- wynikiem,
- sugerowanymi wątkami,
- sugerowanym POV,
- sugerowaną lokacją,
- potrzebami Story Bible,
- informacją, który beat lub obowiązek rozdziału scena obsługuje.

Ważne: wynik ma tworzyć propozycje scen, ale nie powinien automatycznie tworzyć postaci ani świata.

### `suggest_scene_relations`

**Zasiej relacje sceny**

Dla istniejącej sceny proponuje:

- postacie,
- POV,
- lokację,
- elementy świata,
- reguły,
- lokalne wątki.

Zwraca istniejące ID oraz powody. Jeśli czegoś brakuje, zwraca kandydat do Story Bible zamiast udawać, że encja istnieje.

### `suggest_chapter_story_bible_needs`

**Wskaż braki w Story Bible**

Na podstawie rozdziału i scen sugeruje brakujące:

- postacie,
- lokacje,
- frakcje,
- obiekty,
- reguły,
- relacje.

Niczego nie zapisuje. Wszystko trafia jako propozycje.

### `audit_chapter_coverage`

**Sprawdź pokrycie rozdziału**

Porównuje sceny z beatami i wątkami rozdziału.

Zwraca:

- co jest pokryte,
- co jest nadmiarowe,
- gdzie brakuje payoffu,
- gdzie brakuje napięcia,
- które sceny nie realizują celu rozdziału.

### `audit_thread_payoff_map`

**Mapa setupu i payoffu wątków**

Patrzy przez całą książkę:

- gdzie wątek startuje,
- gdzie eskaluje,
- gdzie pauzuje,
- gdzie wraca,
- czy ma sensowne domknięcie.

### `promote_scene_discoveries`

**Po scenie: kandydaci do kanonu**

Rozszerzenie istniejącej analizy sceny. Grupuje kandydatów według:

- zapisz teraz,
- pytanie do autora,
- zignoruj,
- istnieje podobna encja.

### `repair_plan_navigation`

**Asystent porządkowania planu**

Proponuje kolejny najlepszy krok:

- uzupełnij wątki,
- dopnij beaty,
- rozbij rozdział,
- dodaj POV,
- uzupełnij brakującą lokację,
- przejdź do pisania.

### `inherit_chapter_context_to_scene`

**Dziedziczenie kontekstu**

Nie generuje nowej treści. Sugeruje, które chipy rozdziału powinny wejść do aktywnej sceny:

- wątki,
- reguły,
- elementy świata,
- potencjalne postacie,
- ograniczenia wynikające z sąsiednich scen.

## Priorytety wdrożenia

To nie musi zaczynać się od migracji. Najpierw można uporządkować UI i prompty wokół aktywnego rozdziału, wykorzystując istniejące:

- `chapterThreads`,
- `chapterBeats`,
- `sceneThreads`,
- `sceneCharacters`,
- `sceneWorldElements`,
- `sceneWorldRules`.

### 1. Przestawić narrację kreatora

W UI prowadzić: wątki i beaty przed scenami.

Same zakładki mogą zostać, ale CTA powinny sugerować właściwą kolejność.

### 2. Zrobić kokpit aktywnego rozdziału

Jedno miejsce:

- cel,
- konflikt,
- punkt zwrotny,
- beaty,
- wątki,
- sceny,
- gotowość do pisania.

### 3. Traktować tablice jako mapy, nie osobne źródła prawdy

Beat board i thread map są świetne do przeglądu, ale edycja szczegółu powinna wracać do aktywnego rozdziału.

### 4. Dodać sugestie dziedziczenia dla scen

Przy tworzeniu sceny pokazać wątki i beaty rozdziału jako kandydatów z przyciskiem “użyj w scenie”.

### 5. Rozszerzyć AI o prompty przejścia

Najpierw:

- `prepare_chapter_for_scenes`,
- `generate_chapter_scene_breakdown`,
- `suggest_scene_relations`.

### 6. Ujednolicić modale scen

Plan i Edytor mają bardzo podobne modale sceny. Jeden wspólny komponent zmniejszy rozjazdy.

### 7. Naprawiać polskie znaki przy dotykanych obszarach

W kodzie Plan page i części promptów widać mojibake. Każda przyszła zmiana UI powinna naprawiać pobliskie etykiety.

### 8. Nie dodawać `sceneBeats` od razu

Najpierw wystarczy pokrycie beatów przez sceny jako sugestia lub audyt. Relacja scena-beat ma sens dopiero, gdy autor realnie potrzebuje raportu pokrycia.

## Uwaga o migracjach

Jeśli kiedyś zdecydujemy się dodać relację `sceneBeats`, powinna powstać nowa migracja.

Nie należy poprawiać istniejących migracji, które mogły już zostać użyte lokalnie.

## Proponowana semantyka ekranów

To praktyczny podział odpowiedzialności, żeby autor wiedział, gdzie wrócić, gdy chce zmienić daną decyzję.

| Ekran | Rola | Nie powinien być głównym miejscem |
| --- | --- | --- |
| Plan | Projektowanie struktury, rozdziałów, scen jako planu, przypięcie beatów i wątków do rozdziału | Pełne profile postaci, pełna encyklopedia świata, pisanie prozy |
| Edytor | Pisanie scen, szybka korekta ustawień sceny, AI dla tekstu i ekstrakcja faktów po akceptacji | Projektowanie całej mapy wątków lub beat sheet |
| Postacie | Kanon profilu, głos, wiedza, relacje i wspomnienia | Decydowanie, w których scenach postać występuje. To wynika ze scen |
| Świat | Kanon lokacji, elementów świata, reguł i konsekwencji | Ręczne planowanie każdej sceny. Świat pokazuje odwróconą mapę użycia |
| Log/propozycje AI | Akceptacja, edycja, odrzucanie i audyt tego, co AI zaproponowało | Ukryte automatyczne zmiany. Autor musi zatwierdzić trwałe dane |

## Źródła przeglądu

Raport powstał po szybkim przeglądzie:

- `apps/desktop/src/features/book/BookPlanPage.tsx`,
- `apps/desktop/src/features/book/ChapterEditModal.tsx`,
- `apps/desktop/src/features/scenes/SceneEditorPage.tsx`,
- `apps/desktop/src/features/ai/planPromptPackage.ts`,
- `apps/desktop/src/features/ai/planProposalApplication.ts`,
- `apps/desktop/src/features/ai/scenePromptContext.ts`,
- blueprintów faz 3-7,
- zasad z `AGENTS.md`.

Nie uruchamiano testów ani automatycznej weryfikacji UI.
