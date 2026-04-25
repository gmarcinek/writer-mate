# Plan realizacji

## Status: IN PROGRESS

## Zadania

- [x] TASK-A: Bazowy model danych książek jest już wdrożony — `src/lib/schema.ts` zawiera tabele `books`, `documents` i `chunks`, a `documents.bookId` jest powiązane z `books`.

- [x] TASK-B: Bazowa synchronizacja schematu dla uploadu/listowania została już wykonana na poziomie obecnej aplikacji; kolejne zmiany wymagają osobnej migracji dla hierarchii książki.

- [x] TASK-C: Upload książki do Markdown jest już wdrożony — `src/app/actions/books.ts` zapisuje rekord `books`, konwertuje plik do Markdown i trzyma treść w `books.rawContent`.

- [x] TASK-D: Listowanie książek jest już wdrożone — `src/app/actions/books.ts` udostępnia `getBooks()` wraz z podstawowym modelem listy.

- [x] TASK-E: Formularz uploadu jest już wdrożony — `src/modules/tools-panel/UploadBook.tsx` obsługuje wybór pliku i wywołanie `uploadBook()`.

- [x] TASK-F: Lista książek jest już wdrożona — `src/modules/books-list/index.tsx` renderuje bibliotekę i pusty stan.

- [x] TASK-G: Integracja uploadu i listy jest już wdrożona w aktualnym układzie aplikacji.

- [x] TASK-H: Bazowe tłumaczenia sekcji książek są już dodane w `messages/pl.json` i `messages/en.json`.

- [ ] TASK-I: Rozszerz model danych o hierarchię książki — zaprojektuj i dodaj strukturę encji dla jednostek tekstu (`document`/`book_unit` lub równoważną), która przechowuje typ węzła (`chapter`, `paragraph`, opcjonalnie `sentence`), relację `parentId`, kolejność w obrębie rodzica, stabilny identyfikator ścieżki oraz metadane potrzebne do późniejszego odczytu i analizy.

- [ ] TASK-J: Dodaj migrację schematu dla hierarchii i chunków wielopoziomowych — zsynchronizuj bazę z nowymi tabelami/kolumnami dla jednostek książki, relacji parent/child, poziomu chunka oraz statusów przetwarzania.

- [ ] TASK-K: Dodaj etap budowy TOC z Markdown — wyodrębnij spis treści deterministycznie z nagłówków, numeracji i prostych heurystyk, tak aby powstała użyteczna struktura rozdziałów przed właściwym parserem książki.

- [ ] TASK-L: Dodaj fallback naprawczy TOC z użyciem LLM — uruchamiaj go tylko wtedy, gdy ekstrakcja deterministyczna nie daje wiarygodnego TOC dla słabo sformatowanych, OCR-owych lub nieregularnych dokumentów.

- [ ] TASK-M: Zaimplementuj parser Markdown do drzewa książki sterowany TOC — przygotuj moduł, który z `books.rawContent` i zbudowanego TOC tworzy znormalizowaną strukturę rozdziałów i akapitów, a generowanie zdań obsługuje jako opcjonalny etap możliwy do włączenia konfiguracyjnie.

- [ ] TASK-N: Zapisz hierarchię książki i powiązania TOC transakcyjnie — dodaj serwis, który tworzy rekord dokumentu źródłowego dla książki i zapisuje wszystkie jednostki tekstu z jednoznacznymi relacjami parent/child, kolejnością oraz mapowaniem TOC do encji książki.

- [ ] TASK-O: Generuj i zapisuj chunki dla wielu poziomów — po utrwaleniu hierarchii zapisuj chunki co najmniej na poziomie `chapter` i `paragraph`, z możliwością rozszerzenia o `sentence`, tak aby każdy chunk był powiązany z odpowiadającą mu jednostką źródłową i poziomem agregacji.

- [ ] TASK-P: Uruchamiaj pipeline po uzyskaniu Markdown — rozszerz `uploadBook()` lub wydzielony proces aplikacyjny tak, aby po zapisie `rawContent` startowało budowanie TOC, opcjonalna naprawa LLM, parsowanie, zapis hierarchii i generowanie chunków, z aktualizacją statusu książki na etapach `uploaded` / `processing` / `ready` / `failed`.

- [ ] TASK-Q: Dodaj walidację i obsługę błędów przetwarzania — zabezpiecz pipeline przed pustym Markdown, nieprawidłową strukturą TOC i nagłówków, błędami zapisu i częściowym przetworzeniem; zapisuj diagnostykę i stan pozwalający bezpiecznie ponowić lub zdiagnozować proces.

- [ ] TASK-R: Zaktualizuj odczyt książki pod strukturę hierarchiczną i TOC — dostosuj pobieranie i renderowanie widoku książki tak, aby korzystał z zapisanej struktury dokumentu/jednostek i TOC do nawigacji, a `rawContent` pozostawał tylko jako fallback lub surowe źródło.

## Zależności

- TASK-J wymaga TASK-I
- TASK-K wymaga TASK-I
- TASK-L wymaga TASK-K
- TASK-M wymaga TASK-K i TASK-L
- TASK-N wymaga TASK-J i TASK-M
- TASK-O wymaga TASK-J i TASK-N
- TASK-P wymaga TASK-N i TASK-O
- TASK-Q wymaga TASK-P
- TASK-R wymaga TASK-N i TASK-P
