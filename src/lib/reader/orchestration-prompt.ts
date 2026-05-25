import {
  ReaderMode,
  ReaderIntentType,
  type ReaderGoal,
  type ReaderHandoff,
  type ReaderIntent,
  type ReaderReconBrief,
  type ReaderSession,
} from "@/lib/reader/types";

const INTENT_TYPE_LABELS: Record<ReaderIntentType, string> = {
  [ReaderIntentType.ExhaustiveRead]: "Pełne czytanie",
  [ReaderIntentType.QuestionAnswering]: "Odpowiedź na pytanie",
  [ReaderIntentType.TargetedExtraction]: "Ekstrakcja danych",
  [ReaderIntentType.Analysis]: "Analiza tematyczna",
  [ReaderIntentType.StructureSurvey]: "Rozpoznanie struktury",
};

function formatIntentSection(intent: ReaderIntent): string {
  const intermediateGoals = intent.intermediateGoals.length > 0
    ? `\nCele pośrednie:\n${intent.intermediateGoals.map((g, i) => `  ${i + 1}. ${g}`).join("\n")}`
    : "";
  const focusAreas = intent.focusAreas.length > 0
    ? `\nObszary fokusowania: ${intent.focusAreas.join(", ")}`
    : "";
  const prioritySignals = intent.prioritySignals.length > 0
    ? `\nSygnały priorytetu: ${intent.prioritySignals.join(", ")}`
    : "";
  const skipHeuristics = intent.skipHeuristics.length > 0
    ? `\nCo pomijać: ${intent.skipHeuristics.join(", ")}`
    : "";

  return `INTENCJA UŻYTKOWNIKA (rozpoznana przez router):
Typ: ${INTENT_TYPE_LABELS[intent.intentType]}
Cel strategiczny: ${intent.strategicGoal}${intermediateGoals}${focusAreas}${prioritySignals}${skipHeuristics}`;
}

function formatGoal(goal: ReaderGoal) {
  const questions = goal.questions?.length
    ? `\nQuestions: ${goal.questions.join(" | ")}`
    : "";
  const targetEntities = goal.targetEntities?.length
    ? `\nTarget entities: ${goal.targetEntities.join(" | ")}`
    : "";
  const requiredCoverage = goal.requiredCoverage
    ? `\nRequired coverage: minimumLineCoveragePercent=${goal.requiredCoverage.minimumLineCoveragePercent ?? "n/a"}, requireEndToEndRead=${goal.requiredCoverage.requireEndToEndRead ?? false}`
    : "";
  const stopWhenSatisfied = goal.stopWhenSatisfied !== undefined
    ? `\nStop when satisfied: ${goal.stopWhenSatisfied}`
    : "";

  return `Mode: ${goal.mode}\nPrompt: ${goal.prompt}${questions}${targetEntities}${requiredCoverage}${stopWhenSatisfied}`;
}

function formatRecon(recon: ReaderReconBrief) {
  const headingLines = recon.structure.headings
    .slice(0, 12)
    .map((h) => `L${h.line} [h${h.level}] ${h.text}`)
    .join("\n") || "none";
  const sampleLines = recon.samples
    .map((s) => `${s.label} L${s.startLine}-${s.endLine}: ${s.excerpt}`)
    .join("\n") || "none";

  return `Title: ${recon.title}
Total lines: ${recon.stats.totalLines}
Total characters: ${recon.stats.totalCharacters}
Classification: ${recon.classification.primaryType}
Suggested strategy: ${recon.classification.suggestedStrategy}
Structure hints: ${recon.structure.structureHints.join(" | ") || "none"}
Brief: ${recon.briefLines.join(" | ")}
Headings:
${headingLines}
Samples:
${sampleLines}`;
}

export function buildReaderSystemPrompt(args: {
  recon: ReaderReconBrief;
  session: ReaderSession;
  intent?: ReaderIntent;
}) {
  const filename = args.recon.title;
  const totalSize = args.recon.stats.totalCharacters;
  const totalLines = args.recon.stats.totalLines;
  const analysisGoal = formatGoal(args.session.goal);
  const intentSection = args.intent ? `\n${formatIntentSection(args.intent)}\n` : "";

  return `\
Czytasz duży plik '${filename}' (${totalSize} znaków, ${totalLines} linii).
Masz do dyspozycji narzędzia nawigacji — SAM decydujesz ile czytać, co pomijać, gdzie skakać.
Twoje notatki będą zapisane do plików roboczych i wykorzystane później przez innego agenta.
Traktuj każde saveNotes() jak FORMALNY HANDOFF, nie jak prywatny szkic.

CEL CZYTANIA:
${analysisGoal}
${intentSection}
TWOJE NARZĘDZIA:
- readLines(startLine, endLine) — czyta linie od startLine do endLine. Max 3000 linii na raz. Dla dużych plików czytaj odważnie (500-2000).
- skipLines(count) — przesuwa kursor bez czytania. Używaj gdy treść się powtarza.
- jumpToLine(requestedLine) — skok na konkretną linię. Używaj do próbkowania środka/końca.
- jumpToGap() — skok do pierwszego nieodwiedzonego zakresu. Używaj do uzupełniania luk w pokryciu.
- searchPhrases(query) — szuka fraz w tekście. Używaj do szybkiego zlokalizowania kluczowych terminów.
- saveNotes(...) — zapisuje notatkę. WYWOŁUJ ZAWSZE. Dodawaj odniesienia do linii!
- finish() — kończy sesję. Upewnij się że wcześniej zapisałeś notatki.

ZASADA — NARZĘDZI UŻYWAJ TYLKO GDY ADEKWATNE:
Przed pierwszą akcją oceń: czy istniejące notatki i handoff wystarczają do realizacji celu?
- Jeśli tak → wywołaj finish() bezpośrednio. Nie czytaj nic więcej.
- Jeśli potrzebujesz konkretnych danych → preferuj searchPhrases() nad readLines() gdy lokalizujesz fragmenty.
- Jeśli pytanie wymaga nowej lektury → czytaj, ale tylko tyle ile potrzeba.
Nie uruchamiaj readLines gdy odpowiedź jest już w notatkach.

STRATEGIA CZYTANIA:
1. Zacznij od readLines(1, 200) — zorientuj się w strukturze i formacie.
2. Dostosuj tempo do treści:
   - Powtarzalne dane (JSON array, CSV) → przeczytaj próbkę (500-1000 linii), skip duże bloki, próbkuj środek i koniec.
   - Tekst narracyjny → czytaj porcjami 200-500, notuj kluczowe informacje.
   - Tekst prawny → czytaj porcjami 200-500, notuj kluczowe informacje, ewidencje.
   - Logi/kod → szukaj wzorców, błędów, kluczowych sekcji.
   - Mieszany format → adaptuj się do każdej sekcji.
3. Próbkuj: początek → 25% → 50% → 75% → koniec. Nie musisz czytać linia po linii.
4. Jeśli zebrałeś wystarczające informacje — finish(). Nie musisz czytać WSZYSTKIEGO.

FORMAT NOTATEK (saveNotes) — FORMALNY HANDOFF z odniesieniami:
Każda notatka powinna być samowystarczalna. Pola narzędzia saveNotes:

summary (max 800 znaków):
  Zacznij od zakresu pokrycia: 'Zakres: L{start}-{end} przeczytane[, L{x}-{y} pominięte jako powtarzalne][, skok do L{z}]'.
  Następnie mapa struktury: 'Struktura: L{a}: nagłówek, L{b}-{c}: dane, ...'.
  Zakończ zwięzłym obrazem ogólnym fragmentu.

facts (max 8, każdy max 240 znaków):
  Każdy fakt MUSI zaczynać się od numeru linii: '[L{nr}] treść faktu' lub '[L{start}-{end}] treść'.
  Oznacz: [FAKT] — wynika wprost z tekstu.

inferences (max 6, każdy max 240 znaków):
  Wnioski interpretacyjne i hipotezy — z numerem linii jako podstawą.
  Oznacz: [WNIOSEK] — wniosek logiczny, [PYTANIE] — spekulacja/nierozstrzygnięte.

evidence (max 4):
  Kluczowe cytaty dosłowne (krótkie, 1 linia) z zakresu linii. Używaj pola quote TYLKO gdy cytat jest istotny.

unresolvedQuestions (max 5):
  Luki — czego jeszcze nie wiesz. Podaj konkretne linie do sprawdzenia: 'Nieznane: L{x}-{y} — co zawiera ta sekcja?'

followUpActions (max 5):
  Dalsze kroki — jakie linie warto przeczytać dalej i dlaczego.

Przykład dobrej notatki (summary):
  'Zakres: L1-200 przeczytane, potem skip L201-1200, skok do L1201.
  Struktura: L1-5 nagłówek JSON array, L6-5000 rekordy, brak osobnego podsumowania.
  Pierwsze 50 rekordów: statusy Open(32), Closed(12), InProgress(6). Wzorzec: ~4 linie/rekord.'

Używaj saveNotes:
- po pierwszym rozpoznaniu struktury (początek pliku),
- po każdej istotnej sekcji,
- po dużym skipie lub jumpie,
- gdy znajdziesz ważne ustalenia,
- przed finish() — zapisz NOTATKĘ KOŃCOWĄ z pełnym pokryciem i głównymi ustaleniami.

ZASADY:
- Pisz notatki w języku tekstu źródłowego.
- Bądź efektywny — nie czytaj linia po linii tego co jest powtarzalne.
- ZAWSZE dodawaj numery linii w notatkach.
- Nie pisz metakomentarzy o procesie — tylko fakty użyteczne dla następnego agenta.
- Jeśli zrobiłeś skip lub jump, odnotuj to jawnie w summary.
- Jeśli treść jest nieczytelna lub uszkodzona — zanotuj i idź dalej.
- Nie generalizuj wyników z próbek bez oznaczenia jako PRÓBKA lub HIPOTEZA.
- Gdy wywołujesz saveNotes dla nowej notatki, ustaw noteId na null.
- Nie generuj treści poza wywołaniami narzędzi.`;
}

export function buildReaderRunPrompt(args: {
  recon: ReaderReconBrief;
  session: ReaderSession;
  existingNoteCount: number;
  hasExistingHandoff?: boolean;
}) {
  const modeInstruction =
    args.session.goal.mode === ReaderMode.Exhaustive
      ? "Ten przebieg jest wyczerpujący — osiągnij formalne pokrycie całego źródła przed zakończeniem."
      : "Ten przebieg jest zorientowany na cel — czytaj efektywnie, zatrzymaj się gdy cel zostanie zrealizowany."

  const resumeInstruction =
    args.existingNoteCount > 0
      ? args.hasExistingHandoff
        ? `Wznów istniejącą sesję. Masz już ${args.existingNoteCount} notatek oraz ukończony handoff. NAJPIERW oceń: czy handoff już odpowiada na cel. Jeśli tak — wywołaj finish() bez dalszego czytania.`
        : `Wznów istniejącą sesję. Masz już ${args.existingNoteCount} notatek. Kontynuuj od zapisanego kursora, nie duplikuj poprzednich notatek.`
      : "To jest nowa sesja. Zacznij od początku źródła — readLines(1, 200)."

  return `${modeInstruction}\n${resumeInstruction}`;
}

export function buildReaderSynthesisPrompt(args: {
  session: ReaderSession;
  recon: ReaderReconBrief;
  notesDigest: string;
  coverageDigest: string;
  intent?: ReaderIntent;
}) {
  const filename = args.recon.title;
  const totalSize = args.recon.stats.totalCharacters;
  const analysisGoal = formatGoal(args.session.goal);
  const intentSection = args.intent ? `\n${formatIntentSection(args.intent)}\n` : "";

  return `\
Przeczytałeś duży plik '${filename}' (${totalSize} znaków).
Poniżej są notatki z czytania.

CEL CZYTANIA:
${analysisGoal}
${intentSection}
ZADANIE: Stwórz jeden syntetyczny HANDOFF — tak żeby kolejny agent mógł go przeczytać i natychmiast odtworzyć kontekst BEZ ponownego czytania całego pliku.

Zwróć ścisły JSON bez markdown fences, bez komentarzy.
JSON musi zawierać: status, executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions.
Każdy element conclusions musi zawierać: title, summary, statementKind, confidence, evidenceIds.

Pole executiveSummary — pełny syntetyczny dokument zawierający WSZYSTKIE poniższe sekcje:

**Status:** COMPLETE albo PARTIAL.
COMPLETE gdy notatki pokrywają wszystko potrzebne do celu. PARTIAL gdy zostały istotne luki.

**Podsumowanie:** 2-3 zdania — co zawiera plik, jaki rodzaj treści, ogólny obraz.

**Cel czytania:** 1 zdanie — czego dokładnie szukano.

**Pokrycie czytania:**
- Jakie zakresy zostały przeczytane, jakie pominięte, jakie tylko próbkowane.
- Jeśli czytanie było częściowe, napisz to wprost.

**Spis treści pliku (TOC):** TYLKO dla dokumentów z rozdziałami/sekcjami (regulaminy, raporty, umowy, dokumentacja).
POMIŃ dla danych tabelarycznych (JSON array, CSV, logi) — tam wystarczy mapa struktury.
Format: Nazwa rozdziału/sekcji — L{start}-L{end}

**Mapa struktury pliku:**
- Jakie sekcje/bloki zawiera plik i w których liniach.
- Format danych, kluczowe kolumny/pola.
- Dla danych tabelarycznych: schemat rekordu, kluczowe pola, szacowana liczba rekordów.

**Kluczowe ustalenia:** wypunktowane konkrety odpowiadające celowi czytania. Przy każdym — odniesienie do linii.
Przy ważnych punktach oznacz: [FAKT] — wynika wprost z tekstu, [WNIOSEK] — logiczny wniosek, [PYTANIE] — otwarte/niepewne.

**Ważne cytaty:** dosłowne fragmenty z pliku, które mogą być potrzebne (z numerami linii).

**Uwagi i anomalie:** cokolwiek nietypowego wykrytego w treści (lub 'brak').

**Granice zakresu / czego nie zakładać:**
- Co zostało potwierdzone.
- Czego nie pokrywa czytanie.
- Co było tylko próbkowane.
- Jakich wniosków NIE należy uogólniać bez powrotu do źródła.

Pole conclusions — kluczowe wnioski tematyczne:
  Każdy wniosek: title, summary (z markerami [FAKT]/[WNIOSEK]/[PYTANIE]), statementKind ('fact'|'inference'|'open_question'), confidence (0.0-1.0), evidenceIds.

Pole gaps — lista istotnych luk tematycznych (string[]).
Pole caveats — uwagi i anomalie (string[]).
Pole limitations — ograniczenia pokrycia (string[]).
Pole nextQuestions — otwarte pytania i linie/sekcje warte dalszego czytania (string[]).
  Jeśli dalsze czytanie nie jest potrzebne, wstaw 'brak'.

Wybierz status='complete' tylko gdy coverage digest pokazuje wysokie pokrycie bez istotnych luk.
Pisz w języku tekstu źródłowego.

Recon summary:
${formatRecon(args.recon)}

Coverage digest:
${args.coverageDigest}

Notes digest:
${args.notesDigest}`;
}

export function buildReaderFinishPrompt(sessionId: string) {
  return `The server has persisted the final handoff for session ${sessionId}.
Call the finish tool exactly once to close the session formally.
Do not emit any prose. Do not call any other tool.`;
}

export function buildReaderAnswerSystemPrompt() {
  return "You are a precise, concise analyst. Answer the user's reading goal directly based on the provided handoff. Format your response as Markdown: use headers (##), bullet lists, bold for key terms. Write in the same language as the handoff content. Do not begin with meta-phrases like 'Based on the handoff\u2026' \u2014 answer directly and substantively.";
}

export function buildReaderAnswerPrompt(args: {
  session: ReaderSession;
  handoff: ReaderHandoff;
}) {
  const conclusionLines =
    args.handoff.conclusions.length > 0
      ? `Wnioski:\n${args.handoff.conclusions
          .map((c) => `- [${c.statementKind}] ${c.title}: ${c.summary}`)
          .join("\n")}`
      : "";
  const gapLines =
    args.handoff.gaps.length > 0
      ? `Luki: ${args.handoff.gaps.join("; ")}`
      : "";
  const questionLines =
    args.handoff.nextQuestions.length > 0
      ? `Pytania otwarte: ${args.handoff.nextQuestions.join("; ")}`
      : "";

  const extras = [conclusionLines, gapLines, questionLines].filter(Boolean).join("\n");
  return `Cel czytania:\n${formatGoal(args.session.goal)}\n\nPodsumowanie wykonawcze:\n${args.handoff.executiveSummary}${extras ? `\n${extras}` : ""}`;
}

export function buildMasterHandoffSynthesisPrompt(args: {
  sessions: { goal: ReaderGoal; status: string }[];
  handoffs: ReaderHandoff[];
}): string {
  const layersSummary = args.sessions.map((session, index) => {
    const handoff = args.handoffs[index];
    const summary = handoff ? `Executive summary: ${handoff.executiveSummary}` : "No handoff";
    const conclusions = handoff?.conclusions.length
      ? `\nConclusions:\n${handoff.conclusions.map((c) => `  - [${c.statementKind}] ${c.title}: ${c.summary}`).join("\n")}`
      : "";
    const gaps = handoff?.gaps.length ? `\nGaps: ${handoff.gaps.join("; ")}` : "";
    return `=== Layer ${index + 1}: ${session.goal.prompt} ===\nStatus: ${session.status}\n${summary}${conclusions}${gaps}`;
  });

  return `Synthesize a master reader handoff integrating findings from all reading layers.

Write all content in the same language as the source text.

Return strict JSON only. No markdown fences, no commentary.

The JSON must contain: status, executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions.

Each conclusion must contain: title, summary, statementKind ('fact'|'inference'|'open_question'), confidence, evidenceIds.

Integrate findings from all layers. Highlight agreements and contradictions between layers where relevant.

Choose status='complete' only if together the layers provide comprehensive coverage. Otherwise choose 'partial'.

Number of reading layers: ${args.sessions.length}

Reading layers:

${layersSummary.join("\n\n")}`;
}