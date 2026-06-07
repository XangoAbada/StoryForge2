# UX I Nawigacja

StoryForge2 ma byc aplikacja do codziennej, dlugiej pracy. UI powinien dawac poczucie kontroli, nie widowiska.

## Uklad Glowny

Po otwarciu projektu:

```text
Lewy sidebar       Srodek                         Prawy panel
Etapy pisania      Aktualny ekran/edytor          Kontekst, AI, propozycje
```

Sidebar:

- Koncepcja;
- Plan;
- Postacie;
- Relacje;
- Swiat;
- Watki;
- Rozdzialy;
- Edytor;
- Ciaglosc;
- Redakcja;
- Assety.

Srodek:

- formularze;
- listy;
- edytor;
- timeline.

Prawy panel:

- kontekst wybranej encji;
- przyciski AI;
- status Codex CLI;
- propozycje do akceptacji.

## Globalny Panel Kontekstu Promptu

Prawy panel ma wspolna sekcje `Kontekst promptu`, widoczna po aktywowaniu
tekstowego pola edycyjnego. Zwykly przycisk AI nigdy sam nie otwiera ani nie
przelacza tej sekcji. Kazdy ekran deklaruje w niej wlasne zrodla kontekstu;
panel nie zgaduje danych samodzielnie.

Sekcja pokazuje:

- nazwe aktywnego pola albo akcji AI;
- zrodla wymagane, ktorych nie mozna odznaczyc;
- zrodla opcjonalne jako checkboxy;
- komentarz autora dla najblizszego promptu.
- przycisk wysylki requestu AI dla aktywnego targetu;
- przycisk zamkniecia kontekstu.

Zachowanie:

- aktywny kontekst zostaje widoczny po utracie fokusu i po przejsciu na inny
  widok, dopoki autor go nie zamknie albo nie aktywuje innego pola tekstowego;
- aktywacja innego pola tekstowego przelacza target i pokazuje jego domyslny
  zestaw zrodel;
- klikniecie zwyklego przycisku AI bez aktywnego targetu dla tego pola uzywa
  domyslnego promptu i nie pokazuje panelu;
- klikniecie zwyklego przycisku AI przy innym polu nie przelacza istniejacego
  panelu i nie uzywa kontekstu poprzedniego pola;
- domyslnie wlaczone sa opcjonalne zrodla przewidziane przez dany target, nie
  cala koncepcja;
- przy przyciskach AI pol tekstowych jest maly przycisk `+`, ktory dopina dane
  pole do aktualnego kontekstu promptu;
- przycisk `+` jest wyszarzony, gdy kontekst promptu nie jest aktywny albo dane
  pole juz znajduje sie w aktywnym kontekscie;
- klikniecie `+` nie przelacza aktywnego targetu;
- draft nie znika po utracie fokusu albo przejsciu do innego widoku;
- po dodaniu zadania AI do kolejki panel zamyka sie tylko wtedy, gdy request
  faktycznie uzyl aktywnego kontekstu promptu;
- zamkniecie kontekstu usuwa draft, komentarz i recznie dodane zrodla dla
  aktywnego targetu;
- generowanie obrazow i okladek moze miec osobny przeplyw, ale tekstowe prompty
  wizualne powinny uzywac tego samego panelu.

## Dashboard Projektow

Pierwszy ekran:

- lista projektow;
- ostatnio otwierany projekt;
- przycisk nowego projektu;
- import/backup pozniej.

Nie robic strony marketingowej.

## Przyciski AI

Kazdy ekran ma miec przycisk AI dopasowany do kontekstu.
Każde generowane albo uzupełniane pole ma mieć własny widoczny i dostępny
przycisk AI lub mini akcję AI. Autor musi móc wygenerować pojedyncze pole bez
generowania całej sekcji.

Przyklady:

- Koncepcja: "Generuj tytuly", "Rozwin premise", "Dopasuj gatunek".
- Postacie: "Generuj postac", "Pogleb motywacje", "Stworz konflikt".
- Swiat: "Generuj lokacje", "Sprawdz konsekwencje reguly".
- Plan: "Rozbij na akty", "Generuj rozdzialy".
- Edytor: "Kontynuuj", "Rozwin zaznaczenie", "Przepisz", "Popraw dialog".

Przycisk AI powinien miec:

- ikone;
- tooltip;
- stan loading;
- jasny blad, gdy Codex CLI nie jest gotowy.

Przycisk AI dla pola powinien:

- działać per-field;
- budować prompt z kluczowych pól sąsiednich i Story Bible;
- pokazywać propozycję przed zapisem;
- nie nadpisywać pola bez akceptacji autora.

## Panel Propozycji AI

Po generowaniu pokaz:

- nazwe akcji;
- provider: Codex CLI;
- czas generowania;
- wynik;
- ostrzezenia;
- przyciski: Akceptuj, Edytuj, Ponow, Odrzuc.

Dla danych strukturalnych pokaz roznice:

- dodane pola;
- zmienione pola;
- nowe encje;
- konflikty.

Dla prozy pokaz:

- tekst wynikowy;
- opcje wstawienia: zastap zaznaczenie, wstaw po zaznaczeniu, dodaj jako wariant.

## Edytor

Edytor scen opiera sie o TipTap.

Funkcje V1:

- naglowek sceny;
- status sceny;
- target word count;
- licznik slow;
- tekst sceny;
- zaznaczenie tekstu;
- popup AI dla zaznaczenia;
- historia wariantow AI dla sceny.

Popup zaznaczenia:

- Kontynuuj po tym fragmencie;
- Rozwin;
- Skroc;
- Przepisz prosciej;
- Przepisz bardziej literacko;
- Popraw dialog;
- Dodaj napiecie;
- Wlasna instrukcja.

## Panel Kontekstu Sceny

Przy edytorze pokaz:

- POV;
- obecne postacie;
- lokacja;
- aktywne watki;
- fakty ujawniane w scenie;
- wiedza postaci;
- reguly swiata dotyczace sceny.

Kazda sekcja ma mini akcje AI:

- "uzupelnij";
- "sprawdz spojnosc";
- "zaproponuj".

## Status Codex CLI

W prawym panelu lub ustawieniach:

- status: gotowy, brak CLI, wymaga logowania, blad, limit;
- wersja CLI;
- ostatnie generowanie;
- link do ustawien.

Nie pokazywac tokenow ani sciezek auth.

## Nawigacja Miedzy Etapami

Etapy nie sa sztywna blokada. Autor moze:

- zaczac od sceny;
- wrocic do postaci;
- dynamicznie dodac lokacje;
- pozniej uporzadkowac Story Bible.

Aplikacja powinna jednak sugerowac brakujace elementy:

- brak premisy;
- brak POV;
- brak celu sceny;
- postac bez motywacji;
- rozdzial bez konfliktu.

## Design

Kierunek:

- spokojny edytorski desktop;
- wysoka czytelnosc;
- kompaktowe panele;
- zero ozdobnego chaosu;
- jasny i ciemny motyw pozniej.

Elementy:

- ikony w toolbarach;
- segmented controls dla trybow;
- tabs dla podwidokow;
- checkboxy/toggle dla statusow;
- listy i tabele dla encji;
- karty tylko dla pojedynczych powtarzalnych elementow, nie jako layout calej strony.

## Accessibility

V1 minimum:

- wszystkie przyciski z etykieta lub tooltipem;
- widoczny focus;
- kontrast tekstu;
- nawigacja klawiatura w edytorze;
- komunikaty bledow nie tylko kolorem.
