import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { books } from "@/lib/schema";
import {
  ReaderSourceType,
  type ReaderBookSourceRef,
  type ReaderSourceRef,
} from "@/lib/reader/types";

type ReaderResolvedSource = {
  source: ReaderSourceRef;
  title: string;
  text: string;
};

type ReaderBookSourceIdentityRow = {
  id: string;
  title: string;
};

type ReaderBookSourceMetadataRow = ReaderBookSourceIdentityRow & {
  total_characters: number;
  total_lines: number;
};

type ReaderBookSourceReadRow = ReaderBookSourceMetadataRow & {
  start_line: number;
  end_line: number;
  start_offset: number;
  end_offset: number;
  text: string;
};

const MAX_READ_LINES = 200;
const MAX_READ_SLICE_CHARACTERS = 12_000;

export interface ReaderSourceMetadata {
  source: ReaderSourceRef;
  title: string;
  totalLines: number;
  totalCharacters: number;
}

export interface ReaderSourceLineIndex extends ReaderSourceMetadata {
  lineStartOffsets: number[];
}

export interface ReaderSourceReadResult extends ReaderSourceMetadata {
  text: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  charCount: number;
}

export interface ReaderSourceAdapter {
  supports(source: ReaderSourceRef): boolean;
  getSource(source: ReaderSourceRef): Promise<ReaderResolvedSource>;
  getMetadata(source: ReaderSourceRef): Promise<ReaderSourceMetadata>;
  getLineIndex(source: ReaderSourceRef): Promise<ReaderSourceLineIndex>;
  readLines(
    source: ReaderSourceRef,
    startLine: number,
    endLine: number
  ): Promise<ReaderSourceReadResult>;
  readSlice(
    source: ReaderSourceRef,
    startOffset: number,
    endOffset: number
  ): Promise<ReaderSourceReadResult>;
}

function toLineStartOffsets(text: string): number[] {
  const lineStartOffsets = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStartOffsets.push(index + 1);
    }
  }

  return lineStartOffsets;
}

function normalizeLineNumber(value: number, totalLines: number): number {
  const safeValue = Math.trunc(Number.isFinite(value) ? value : 1);
  return Math.min(totalLines, Math.max(1, safeValue));
}

function normalizeOffset(value: number, totalCharacters: number): number {
  const safeValue = Math.trunc(Number.isFinite(value) ? value : 0);
  return Math.min(totalCharacters, Math.max(0, safeValue));
}

function getRangeOffsets(
  lineStartOffsets: number[],
  totalCharacters: number,
  startLine: number,
  endLine: number
) {
  const startOffset = lineStartOffsets[startLine - 1] ?? 0;
  const endOffset = lineStartOffsets[endLine] ?? totalCharacters;

  return { startOffset, endOffset };
}

function clampLineWindow(startLine: number, endLine: number) {
  const windowSize = endLine - startLine + 1;

  if (windowSize <= MAX_READ_LINES) {
    return { startLine, endLine };
  }

  return {
    startLine,
    endLine: startLine + MAX_READ_LINES - 1,
  };
}

function clampOffsetWindow(startOffset: number, endOffset: number) {
  const windowSize = endOffset - startOffset;

  if (windowSize <= MAX_READ_SLICE_CHARACTERS) {
    return { startOffset, endOffset };
  }

  return {
    startOffset,
    endOffset: startOffset + MAX_READ_SLICE_CHARACTERS,
  };
}

function getLineNumberForOffset(
  lineStartOffsets: number[],
  totalCharacters: number,
  offset: number
): number {
  const clampedOffset = normalizeOffset(offset, totalCharacters);
  let low = 0;
  let high = lineStartOffsets.length - 1;
  let lineIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateOffset = lineStartOffsets[mid] ?? 0;

    if (candidateOffset <= clampedOffset) {
      lineIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return lineIndex + 1;
}

function buildLineIndex(source: ReaderResolvedSource): ReaderSourceLineIndex {
  const lineStartOffsets = toLineStartOffsets(source.text);

  return {
    source: source.source,
    title: source.title,
    totalLines: lineStartOffsets.length,
    totalCharacters: source.text.length,
    lineStartOffsets,
  };
}

function buildBookSourceRef(
  source: ReaderBookSourceRef,
  row: ReaderBookSourceIdentityRow
): ReaderBookSourceRef {
  return {
    ...source,
    sourceId: row.id,
    bookId: row.id,
    title: row.title,
  };
}

function metadataFromBookRow(
  source: ReaderBookSourceRef,
  row: ReaderBookSourceMetadataRow
): ReaderSourceMetadata {
  return {
    source: buildBookSourceRef(source, row),
    title: row.title,
    totalLines: row.total_lines,
    totalCharacters: row.total_characters,
  };
}

function readResultFromBookRow(
  source: ReaderBookSourceRef,
  row: ReaderBookSourceReadRow
): ReaderSourceReadResult {
  return {
    source: buildBookSourceRef(source, row),
    title: row.title,
    totalLines: row.total_lines,
    totalCharacters: row.total_characters,
    startLine: row.start_line,
    endLine: row.end_line,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    text: row.text,
    charCount: row.text.length,
  };
}

function createReadResult(
  source: ReaderResolvedSource,
  lineIndex: ReaderSourceLineIndex,
  startLine: number,
  endLine: number,
  startOffset: number,
  endOffset: number
): ReaderSourceReadResult {
  const text = source.text.slice(startOffset, endOffset);

  return {
    source: lineIndex.source,
    title: lineIndex.title,
    totalLines: lineIndex.totalLines,
    totalCharacters: lineIndex.totalCharacters,
    startLine,
    endLine,
    startOffset,
    endOffset,
    text,
    charCount: text.length,
  };
}

async function resolveBookRawContentSource(
  source: ReaderBookSourceRef
): Promise<ReaderResolvedSource> {
  const rows = await db
    .select({ id: books.id, title: books.title, rawContent: books.rawContent })
    .from(books)
    .where(eq(books.id, source.bookId))
    .limit(1);

  const book = rows[0];

  if (!book) {
    throw new Error(`Reader source not found for book ${source.bookId}`);
  }

  const title = book.title;

  return {
    source: buildBookSourceRef(source, book),
    title,
    text: book.rawContent ?? "",
  };
}

async function resolveBookRawContentMetadata(
  source: ReaderBookSourceRef
): Promise<ReaderBookSourceMetadataRow> {
  const result = await db.execute<ReaderBookSourceMetadataRow>(sql`
    select
      ${books.id} as id,
      ${books.title} as title,
      char_length(coalesce(${books.rawContent}, ''))::int as total_characters,
      (regexp_count(coalesce(${books.rawContent}, ''), E'\n') + 1)::int as total_lines
    from ${books}
    where ${books.id} = ${source.bookId}
    limit 1
  `);

  const book = result.rows[0];

  if (!book) {
    throw new Error(`Reader source not found for book ${source.bookId}`);
  }

  return book;
}

async function readBookRawContentLines(
  source: ReaderBookSourceRef,
  startLine: number,
  endLine: number
): Promise<ReaderBookSourceReadRow> {
  const safeStartLine = Math.trunc(Number.isFinite(startLine) ? startLine : 1);
  const safeEndLine = Math.trunc(Number.isFinite(endLine) ? endLine : 1);

  const result = await db.execute<ReaderBookSourceReadRow>(sql`
    with source_row as (
      select
        ${books.id} as id,
        ${books.title} as title,
        coalesce(${books.rawContent}, '') as text,
        char_length(coalesce(${books.rawContent}, ''))::int as total_characters,
        (regexp_count(coalesce(${books.rawContent}, ''), E'\n') + 1)::int as total_lines
      from ${books}
      where ${books.id} = ${source.bookId}
      limit 1
    ),
    normalized as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        least(total_lines, greatest(1, ${safeStartLine}))::int as normalized_start_line,
        least(total_lines, greatest(1, ${safeEndLine}))::int as normalized_end_line
      from source_row
    ),
    windowed as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        least(normalized_start_line, normalized_end_line)::int as first_line,
        greatest(normalized_start_line, normalized_end_line)::int as last_line
      from normalized
    ),
    bounded as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        first_line as start_line,
        least(last_line, first_line + ${MAX_READ_LINES} - 1)::int as end_line
      from windowed
    ),
    offsets as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        start_line,
        end_line,
        case
          when start_line <= 1 then 0
          else regexp_instr(text, E'\n', 1, start_line - 1)
        end::int as start_offset,
        case
          when end_line >= total_lines then total_characters
          else regexp_instr(text, E'\n', 1, end_line)
        end::int as end_offset
      from bounded
    )
    select
      id,
      title,
      total_characters,
      total_lines,
      start_line,
      end_line,
      start_offset,
      end_offset,
      substring(text from start_offset + 1 for end_offset - start_offset) as text
    from offsets
  `);

  const readResult = result.rows[0];

  if (!readResult) {
    throw new Error(`Reader source not found for book ${source.bookId}`);
  }

  return readResult;
}

async function readBookRawContentSlice(
  source: ReaderBookSourceRef,
  startOffset: number,
  endOffset: number
): Promise<ReaderBookSourceReadRow> {
  const safeStartOffset = Math.trunc(
    Number.isFinite(startOffset) ? startOffset : 0
  );
  const safeEndOffset = Math.trunc(Number.isFinite(endOffset) ? endOffset : 0);

  const result = await db.execute<ReaderBookSourceReadRow>(sql`
    with source_row as (
      select
        ${books.id} as id,
        ${books.title} as title,
        coalesce(${books.rawContent}, '') as text,
        char_length(coalesce(${books.rawContent}, ''))::int as total_characters,
        (regexp_count(coalesce(${books.rawContent}, ''), E'\n') + 1)::int as total_lines
      from ${books}
      where ${books.id} = ${source.bookId}
      limit 1
    ),
    normalized as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        least(total_characters, greatest(0, ${safeStartOffset}))::int as normalized_start_offset,
        least(total_characters, greatest(0, ${safeEndOffset}))::int as normalized_end_offset
      from source_row
    ),
    windowed as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        least(normalized_start_offset, normalized_end_offset)::int as first_offset,
        greatest(normalized_start_offset, normalized_end_offset)::int as last_offset
      from normalized
    ),
    bounded as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        first_offset as start_offset,
        least(last_offset, first_offset + ${MAX_READ_SLICE_CHARACTERS})::int as end_offset
      from windowed
    ),
    lines as (
      select
        id,
        title,
        text,
        total_characters,
        total_lines,
        start_offset,
        end_offset,
        (regexp_count(substring(text from 1 for start_offset), E'\n') + 1)::int as start_line,
        (
          regexp_count(
            substring(
              text
              from 1
              for case
                when end_offset > start_offset then end_offset - 1
                else end_offset
              end
            ),
            E'\n'
          ) + 1
        )::int as end_line
      from bounded
    )
    select
      id,
      title,
      total_characters,
      total_lines,
      start_line,
      end_line,
      start_offset,
      end_offset,
      substring(text from start_offset + 1 for end_offset - start_offset) as text
    from lines
  `);

  const readResult = result.rows[0];

  if (!readResult) {
    throw new Error(`Reader source not found for book ${source.bookId}`);
  }

  return readResult;
}

class BookRawContentSourceAdapter implements ReaderSourceAdapter {
  supports(source: ReaderSourceRef): boolean {
    return source.sourceType === ReaderSourceType.BookRawContent;
  }

  async getSource(source: ReaderSourceRef): Promise<ReaderResolvedSource> {
    if (source.sourceType !== ReaderSourceType.BookRawContent) {
      throw new Error(`Unsupported source type: ${source.sourceType}`);
    }

    return resolveBookRawContentSource(source);
  }

  async getMetadata(source: ReaderSourceRef): Promise<ReaderSourceMetadata> {
    if (source.sourceType !== ReaderSourceType.BookRawContent) {
      throw new Error(`Unsupported source type: ${source.sourceType}`);
    }

    const metadata = await resolveBookRawContentMetadata(source);
    return metadataFromBookRow(source, metadata);
  }

  async getLineIndex(source: ReaderSourceRef): Promise<ReaderSourceLineIndex> {
    const resolvedSource = await this.getSource(source);
    return buildLineIndex(resolvedSource);
  }

  async readLines(
    source: ReaderSourceRef,
    startLine: number,
    endLine: number
  ): Promise<ReaderSourceReadResult> {
    if (source.sourceType !== ReaderSourceType.BookRawContent) {
      throw new Error(`Unsupported source type: ${source.sourceType}`);
    }

    const readResult = await readBookRawContentLines(source, startLine, endLine);
    return readResultFromBookRow(source, readResult);
  }

  async readSlice(
    source: ReaderSourceRef,
    startOffset: number,
    endOffset: number
  ): Promise<ReaderSourceReadResult> {
    if (source.sourceType !== ReaderSourceType.BookRawContent) {
      throw new Error(`Unsupported source type: ${source.sourceType}`);
    }

    const readResult = await readBookRawContentSlice(source, startOffset, endOffset);
    return readResultFromBookRow(source, readResult);
  }
}

const readerSourceAdapters: ReaderSourceAdapter[] = [
  new BookRawContentSourceAdapter(),
];

export function getReaderSourceAdapter(source: ReaderSourceRef): ReaderSourceAdapter {
  const adapter = readerSourceAdapters.find((candidate) =>
    candidate.supports(source)
  );

  if (!adapter) {
    throw new Error(`No reader source adapter for source type: ${source.sourceType}`);
  }

  return adapter;
}

export const readerSourceAdapter = {
  getSource(source: ReaderSourceRef) {
    return getReaderSourceAdapter(source).getSource(source);
  },
  getMetadata(source: ReaderSourceRef) {
    return getReaderSourceAdapter(source).getMetadata(source);
  },
  getLineIndex(source: ReaderSourceRef) {
    return getReaderSourceAdapter(source).getLineIndex(source);
  },
  readLines(source: ReaderSourceRef, startLine: number, endLine: number) {
    return getReaderSourceAdapter(source).readLines(source, startLine, endLine);
  },
  readSlice(source: ReaderSourceRef, startOffset: number, endOffset: number) {
    return getReaderSourceAdapter(source).readSlice(source, startOffset, endOffset);
  },
};

export {
  buildLineIndex,
  getLineNumberForOffset,
  MAX_READ_LINES,
  MAX_READ_SLICE_CHARACTERS,
  normalizeLineNumber,
  normalizeOffset,
  toLineStartOffsets,
};