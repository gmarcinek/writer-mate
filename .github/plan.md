# Plan realizacji

## Status: IN PROGRESS

## Zadania

- [ ] TASK-A: Rozszerz schemat DB o tabelę `books` — `src/lib/schema.ts`: dodaj `export const books = pgTable("books", { id: uuid("id").primaryKey().defaultRandom(), title: text("title").notNull(), author: text("author"), filePath: text("file_path"), status: text("status").notNull().default("processing"), rawContent: text("raw_content"), createdAt: timestamp("created_at").defaultNow(), updatedAt: timestamp("updated_at").defaultNow() })`. Powiąż `documents` z `books` przez dodanie kolumny `bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" })` do tabeli `documents`.

- [ ] TASK-B: Migracja bazy danych — uruchom `npx drizzle-kit push` aby zsynchronizować nowy schemat (tabela `books`, kolumna `book_id` w `documents`) z bazą PostgreSQL.

- [ ] TASK-C: Server Action — upload książki — utwórz `src/app/actions/books.ts` z funkcją `export async function uploadBook(formData: FormData): Promise<{ id: string; title: string }>`. Kroki: (1) wyciągnij plik z `formData.get("file")`, (2) wyślij POST do `process.env.MARKITDOWN_URL + "/convert"` jako multipart/form-data → odbierz markdown string, (3) wstaw rekord do tabeli `books` z `title` = nazwa pliku bez rozszerzenia, `status = "ready"`, `rawContent` = otrzymany markdown, (4) wywołaj `revalidatePath("/pl")` i `revalidatePath("/en")`, (5) zwróć `{ id, title }`. Użyj `"use server"` na górze pliku.

- [ ] TASK-D: Server Action — listowanie książek — w `src/app/actions/books.ts` dodaj `export type BookItem = { id: string; title: string; author: string | null; status: string; createdAt: Date }` oraz `export async function getBooks(): Promise<BookItem[]>` która wykonuje `db.select({ id, title, author, status, createdAt }).from(books).orderBy(desc(books.createdAt))` i zwraca wynik.

- [ ] TASK-E: Komponent UploadBook (Client) — utwórz `src/modules/tools-panel/UploadBook.tsx` z dyrektywą `"use client"`. Eksportuj `export default function UploadBook()`. Komponent renderuje `<form>` z `action` ustawionym przez `useTransition` + ręczne wywołanie `uploadBook(formData)`. Zawiera `<input type="file" name="file" accept=".txt,.epub,.pdf,.docx">`, button "Wgraj książkę" który pokazuje "Wysyłanie…" podczas `isPending`. Po sukcesie reset formularza.

- [ ] TASK-F: Komponent BookList (Server) — utwórz `src/modules/books-list/index.tsx` jako server component. Wywołuje `getBooks()`, renderuje `<ul>` z elementami `<li>` zawierającymi tytuł i datę (`createdAt.toLocaleDateString()`). Gdy lista jest pusta, wyświetla `<p>` z tekstem "Brak książek".

- [ ] TASK-G: Integracja w layout — w `src/app/[locale]/page.tsx` dodaj import i renderowanie `<BookList />` (umieść w lewym panelu bocznym lub przekaż jako props do layoutu). W `src/modules/tools-panel/index.tsx` zastąp placeholder "Wgraj plik" komponentem `<UploadBook />`.

- [ ] TASK-H: Tłumaczenia — w `messages/pl.json` dodaj sekcję `"Books": { "uploadButton": "Wgraj książkę", "uploading": "Wysyłanie…", "empty": "Brak książek", "title": "Biblioteka" }`. W `messages/en.json` dodaj `"Books": { "uploadButton": "Upload book", "uploading": "Uploading…", "empty": "No books yet", "title": "Library" }`.

## Zależności

- TASK-B wymaga TASK-A (push schematu po dodaniu tabeli)
- TASK-C wymaga TASK-A (insert do tabeli `books`)
- TASK-D wymaga TASK-A (select z tabeli `books`)
- TASK-E wymaga TASK-C (client form wywołuje server action)
- TASK-F wymaga TASK-D (server component wywołuje getBooks)
- TASK-G wymaga TASK-E i TASK-F (integracja gotowych komponentów)
- TASK-H jest niezależny — można realizować równolegle z pozostałymi
