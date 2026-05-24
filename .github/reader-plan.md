# Plan realizacji

## Status: IN PROGRESS

## Zakres i założenia

- Ten plan dotyczy osobnego workstreamu: adaptacyjny system czytania dużych plików z function calling / tool orchestration.
- Istniejący `.github/plan.md` pozostaje źródłem prawdy dla pipeline'u hierarchii książki i nie jest nadpisywany.
- MVP ma działać na `books.rawContent`, bo to jedyne stabilnie zapisane źródło pełnej treści w runtime; implementacja ma jednak wprowadzić adapter źródła, aby później przełączyć się na `documents` i `chunks` bez przebudowy orkiestracji.
- Domyślny happy path produktu zaczyna się od uploadu książki: po ekstrakcji markdown system ma automatycznie uruchamiać pierwszą sesję exhaustive reading bez dodatkowej akcji użytkownika.
- Prymitywem produktu nie są już warstwy analizy, tylko pełnoplikowe czytanie zakończone persisted handoffem; targeted reading jest trybem lub kontekstem czytania uruchamianym na bazie promptu użytkownika i również kończy się handoffem.
- UI opiera się na istniejącym shellu 3-kolumnowym w `src/app/[locale]/layout.tsx`: lewy panel ma stać się zwijalny, prawa kolumna pełni rolę panelu Copilot-like dla promptów, modelu, statusu, logów i podglądu thinking, a centralny obszar strony książki ma ewoluować z pojedynczego widoku source do 2-kolumnowego workspace'u: source content + working files / podglądy artefaktów handoffu.
- Obserwowalność sesji jest wymagana w czasie rzeczywistym: frontend ma konsumować strumień SSE z logami czytania, stanem narzędzi i zdarzeniami myślenia zamiast opierać się wyłącznie na polling lub odświeżaniu widoku.
- Coverage ledger pozostaje artefaktem sesji: zapisujemy wyłącznie `read` / `sampled` / `skipped`, a `unvisited` pozostaje stanem pochodnym wyliczanym z pełnego ledgera zwracanego dla danej sesji.
- Tam, gdzie szczegół implementacyjny jest niepewny, zadanie ma charakter research-first i kończy się decyzją techniczną możliwą do wdrożenia przez Coder.

## Milestones

- M1: Persistence correctness — artefakty czytania są poprawnie modelowane, własność notatek i handoffów jest egzekwowana po `sessionId`, a odczyty coverage zwracają pełny ledger sesji.
- M2: Exhaustive-first runtime — po uploadzie i ekstrakcji markdown system uruchamia sesję exhaustive reading, która dochodzi do checkpointów i formalnego handoffu nad `books.rawContent`.
- M3: Observable reader workspace — prawa kolumna działa jako panel Copilot-like, a frontend otrzymuje na żywo logi, status i thinking przez SSE podczas czytania książki.
- M4: Dual-pane reading workspace — centralny obszar strony książki pokazuje równolegle source content oraz working files / preview persisted handoffu i kolejnych artefaktów powstających podczas pracy nad materiałem.
- M5: Targeted mode on top of handoff — użytkownik może uruchomić targeted-exhaustive reading względem promptu, a następnie przejść do pytań, rewrite i edycji na bazie powstałego handoffu.
- M6: Retrieval + hardening — reader korzysta z retrieval, wspiera różne typy treści, ma diagnostykę i kryteria akceptacji dla długich sesji.

## Zadania

- [x] READER-01: Ustal kontrakt architektoniczny reader runtime — notatka projektowa: `docs/reader-runtime-contract.md` definiuje przebieg sesji (`recon -> adaptive reading -> notes -> synthesis -> finish`), wybór prymitywów AI SDK (`generateText` dla MVP), źródło treści (`books.rawContent` przez adapter) oraz granice odpowiedzialności między promptem, narzędziami, orkiestracją i persistence.

- [x] READER-02: Zdefiniuj model danych artefaktów czytania — `docs/reader-persistence-model.md` domyka kontrakt dla sesji czytania, notatek cząstkowych, końcowego handoffu, zakresów pokrycia i metadanych celu czytania. Source reference przy `reader_sessions` jawnie obejmuje `sourceId` oraz wymagane/optional IDs per `sourceType`, a coverage ledger pozostaje spójny z zasadą, że persisted dispositions to wyłącznie `read` / `sampled` / `skipped`, zaś `unvisited` jest stanem pochodnym. Wynik: `docs/reader-persistence-model.md` i `src/lib/reader/types.ts` opisują jeden spójny kontrakt dla coverage, handoffu i source references.

- [x] READER-03: Domknij migrację i integrację Drizzle dla artefaktów czytania — utrzymaj obecny schemat i relacje do `books`, ale napraw dwie luki wskazane przez Verifier w tej samej iteracji: operacje update dla notatek i handoffów muszą egzekwować własność po `sessionId`, a odczyty coverage dla sesji mają zwracać pełny ledger zakresów zamiast tylko wierszy nieograniczonych zakresem.

- [x] READER-04: Domknij adapter źródła treści dla bezpiecznie ograniczonych odczytów i kanonicznych metadanych tytułu — `src/lib/reader/source-adapter.ts` egzekwuje jawny limit okna dla `readLines` i `readSlice`, więc kontrakt adaptera zwraca bounded payloads zgodne z `docs/reader-runtime-contract.md`, oraz zwraca jeden kanoniczny tytuł źródła bez rozjazdu między `source.title` i top-level `title`; ten krok nie zamyka jeszcze tematu true bounded IO, dopóki ścieżka adaptera / data access dla metadanych i bounded reads nadal materializuje pełne `books.rawContent`.

- [x] READER-05: Domknij rzeczywiście bounded ścieżkę rekonesansu dla dużych plików po uwagach Verifiera — rekonesans w `src/lib/reader/reconnaissance.ts` nadal opiera się na adapter metadata plus bounded line windows i zachowuje obecne heurystyki TOC (`spis treści` / `spis tresci`, proste wzorce numerowane), ale blocker large-file został usunięty przez przeniesienie metadanych i bounded reads dla `books.rawContent` na zapytania DB-side (`char_length` / `regexp_count` / `substring` / `regexp_instr`) bez pełnej materializacji treści w procesie aplikacji.

- [x] READER-06: Domknij semantykę kursora w podstawowych narzędziach nawigacji — `src/lib/reader/navigation-tools.ts` reprezentuje EOF przez continuation sentinel `totalLines + 1` zamiast zawijania `nextLine` do ostatniej linii, `skipLines` przy EOF pozostaje stacjonarne zamiast ponownie „skipować” ostatnią linię, a `skipLines(0)` nie przesuwa kursora jak po realnym skipie i zachowuje bounded kontrakt `readLines` / `jumpToLine` / `inspectSlice`.

- [x] READER-07: Domknij poprawność ownership i walidacji final checkpointu w handoffie — `src/lib/reader/persistence.ts` przywraca ownership runtime contract tak, że `saveReaderHandoff` zapisuje wyłącznie linkage i coverage summary bez terminalnego zamknięcia sesji, a `src/lib/reader/checkpoint-tools.ts` wymaga przed `finish` final checkpointu z niepustymi, ustrukturyzowanymi zakresami `read` / `skipped` / `gap` zamiast samego markera `kind`.

- [x] READER-08: Domknij minimalną orkiestrację AI dla exhaustive-first reading — istniejący loop w `src/lib/reader/orchestration.ts` zachowuje start nowej sesji i wznowienie po `sessionId`, a ścieżka error handling nie nadpisuje już kursora sesji przestarzałymi danymi startowymi po błędzie orkiestracji, tylko zachowuje ostatni wiarygodnie zapisany progress potrzebny do poprawnego resume. `src/app/api/reader/sessions/route.ts` pozostaje na razie minimalnym, synchronicznym entrypointem; READER-09 / READER-10 domkną później rozdzielenie triggera od długiego wykonania lub dodanie hooków zdarzeń orkiestracji potrzebnych do auto-startu po uploadzie i SSE.

- [x] READER-09: Podłącz start pierwszej sesji exhaustive reading bezpośrednio po uploadzie — flow w `src/app/actions/books.ts` po udanej ekstrakcji markdown i zapisie książki uruchamia synchronicznie `runReaderOrchestration` z jawnym celem exhaustive-first baseline handoff, a wynik uploadu zwraca również identyfikator i stan startowej sesji readera bez potrzeby osobnego kliknięcia „start reading”.

- [x] READER-10: Domknij ostatnią lukę kontraktu błędów SSE dla nowej sesji — streaming `POST /api/reader/sessions/stream` pre-tworzy teraz prawdziwą sesję przed wejściem w długie `runReaderOrchestration`, a sam stream uruchamia dalej orkiestrację już ścieżką opartą o `sessionId`, dzięki czemu fallback SSE może zawsze domknąć startup failure kontraktowym zdarzeniem `error` zamiast cichego zamknięcia. GET resume i synchroniczny `POST /api/reader/sessions` pozostają bez zmian.

- [x] READER-11: Zastąp placeholder prawego panelu workbenchem readera — `src/modules/entities-panel/index.tsx` działa już jako panel Copilot-like na stronach książki: ładuje latest session dla bieżącej książki, pokazuje prompt, wybór modelu, status sesji, live logi SSE i końcowy handoff, a poza book routes renderuje lekki empty state bez naruszania centralnego widoku książki. Dalsze dopracowanie shella i coverage ledger presentation pozostaje zakresem READER-12 i READER-13.

- [x] READER-12: Dopasuj shell produktu do docelowego układu 3-kolumnowego — `src/modules/workspace-shell/index.tsx` przejął kontrolę nad stanem zwinięcia lewego panelu, `src/modules/sidebar/index.tsx` renderuje zwinięty rail i toggle, a `src/app/globals.css` rozróżnia układ expanded/collapsed także na breakpointach średnich, dzięki czemu środkowy widok książki odzyskuje przestrzeń po zwinięciu sidebaru.

- [x] READER-13: Dodaj raportowanie pełnego coverage ledger i stanu sesji — `src/modules/entities-panel/index.tsx` trzyma już typowany pełny ledger zakresów, aktualizuje go także z eventów SSE i renderuje read / sampled / skipped / unvisited wraz z licznikami, procentami, pełną listą gapów oraz pełnym ledgerem zakresów zwracanych przez persistence.

- [x] READER-14: Dodaj narzędzia eksploracji ukierunkowanej dla targeted mode — orkiestracja wystawia już `searchPhrases` i `jumpToGap`, phrase search działa jako bounded windowed scan przez istniejący adapter linii, zwraca lokalny kontekst wokół trafień, a gap navigation korzysta z persisted coverage ledger sesji do powrotu w nieodwiedzone zakresy.

- [x] READER-15: Przenieś podgląd handoffu i artefaktów do centralnego 2-kolumnowego workspace'u książki — `src/modules/book-workspace/index.tsx` buduje już dual-pane central workspace dla strony książki: lewy panel renderuje source przez istniejący `PaperToggle`, a prawy pokazuje live-aktualizowany preview latest session artifacts, listę working files z final handoffem i wszystkimi persisted notes oraz detal wybranego artefaktu bez polegania wyłącznie na wąskim prawym workbenchu.

- [ ] READER-16: Zaimplementuj targeted reading jako następną warstwę nad dual-pane handoff workflow — użytkownik podaje prompt celu, system uruchamia targeted-exhaustive reading przeciwko książce lub istniejącemu handoffowi, a centralny workspace potrafi pokazać odpowiedni zakres source oraz powiązany working artifact / preview wyniku; pytania, rewrite i edycja pozostają oparte o powstały handoff, a flow zatwierdzania zmian pozostaje osobnym, późniejszym etapem.

- [ ] ? do rozważenia (wyjaśnij to ze mną) READER-17: Dodaj retrieval semantyczny dla podobnych fragmentów — wykorzystaj istniejące `chunks` i `pgvector` jako opcjonalne narzędzie `searchSimilar`, wraz z decyzją skąd brać embeddingi i kiedy fallbackować do wyszukiwania leksykalnego, tak aby agent mógł skakać do semantycznie podobnych miejsc w dużym dokumencie bez zmiany kontraktu handoffu. Moze lepiej zrobić Line marker oparty na handoff z backofficem w json niż semantic search.

- [ ] READER-18: Rozszerz reader o różne typy treści — uzupełnij klasyfikację i strategie czytania dla dokumentów narracyjnych, technicznych, prawnych, logów, danych tabelarycznych i treści mieszanych, tak aby prompt i narzędzia zwracały format notatek adekwatny do typu źródła.

- [ ] READER-19: Dodaj odporność operacyjną i diagnostykę (retry, obsł błędów) — zabezpiecz sesje przed zbyt długimi (20min) odpowiedziami modelu, błędami narzędzi, nieprawidłowymi skokami zakresów, pustymi notatkami i częściowo zapisanym stanem; zapisuj błędy oraz umożliwiaj bezpieczne wznowienie lub zamknięcie sesji jako PARTIAL, również w przypadku zerwania strumienia SSE.

- [ ] READER-20: Przygotuj ewaluację promptów i kryteria akceptacji — dodaj zestaw scenariuszy testowych na małych i dużych plikach, sprawdzających poprawność coverage, jakość handoffu, komfort pracy w dual-pane workspace, obserwowalność live logów, jakość targeted-exhaustive reading oraz gotowość pod późniejszy approval flow.


## Zależności

- READER-02 wymaga READER-01
- READER-03 wymaga READER-02
- READER-04 wymaga READER-01
- READER-05 wymaga READER-04
- READER-06 wymaga READER-05
- READER-07 wymaga READER-03 i READER-06
- READER-08 wymaga READER-05 i READER-07
- READER-09 wymaga READER-08
- READER-10 wymaga READER-08
- READER-11 wymaga READER-10
- READER-12 wymaga READER-11
- READER-13 wymaga READER-07 i READER-08
- READER-14 wymaga READER-05 i READER-06
- READER-15 wymaga READER-11 i READER-12 i READER-13
- READER-16 wymaga READER-14 i READER-15
- READER-17 wymaga READER-03 i READER-08 i READER-16
- READER-18 wymaga READER-05 i READER-08
- READER-19 wymaga READER-08 i READER-10
- READER-20 wymaga READER-13 i READER-15 i READER-16 i READER-19

## MVP slice

- MVP-1 obejmuje READER-01 do READER-13.
- Wynik MVP-1: upload książki uruchamia pierwszą sesję exhaustive reading, agent wykonuje rekonesans i czyta pełny plik przez tool calling, zapisuje notatki z odniesieniami do linii, kończy sesję formalnym handoffem, a użytkownik obserwuje logi i coverage w prawym panelu bez opuszczania widoku książki.
- MVP-2 zaczyna się od READER-14 i najpierw domyka centralny dual-pane workspace dla source + handoff/artifact preview, a dopiero potem targeted reading jako tryb pracy nad promptem użytkownika oraz podbudowę pod późniejszy approval flow.