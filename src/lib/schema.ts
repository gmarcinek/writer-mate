import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type {
  ReaderCheckpoint,
  ReaderCoverageDisposition,
  ReaderCoverageReason,
  ReaderCoverageSummary,
  ReaderGoal,
  ReaderHandoffStatus,
  ReaderNoteStatus,
  ReaderSessionStatus,
  ReaderSourceType,
} from "@/lib/reader/types";

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  author: text("author"),
  fileOriginalName: text("file_original_name"),
  status: text("status").notNull().default("ready"),
  rawContent: text("raw_content"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  contentHtml: text("content_html"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  chunkIndex: text("chunk_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const readerSessions = pgTable(
  "reader_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceType: text("source_type").$type<ReaderSourceType>().notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceTitle: text("source_title"),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    chunkId: uuid("chunk_id").references(() => chunks.id, { onDelete: "cascade" }),
    status: text("status").$type<ReaderSessionStatus>().notNull(),
    mode: text("mode").notNull(),
    goal: jsonb("goal").$type<ReaderGoal>().notNull(),
    cursor: jsonb("cursor"),
    reconSummary: jsonb("recon_summary"),
    coverageSummary: jsonb("coverage_summary").$type<ReaderCoverageSummary>(),
    lastNoteId: uuid("last_note_id"),
    handoffId: uuid("handoff_id"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceIdentityCheck: check(
      "reader_sessions_source_identity_check",
      sql`(
        (${table.sourceType} = 'book_raw_content' and ${table.bookId} is not null and ${table.documentId} is null and ${table.chunkId} is null and ${table.sourceId} = ${table.bookId})
        or (${table.sourceType} = 'document' and ${table.documentId} is not null and ${table.chunkId} is null and ${table.sourceId} = ${table.documentId})
        or (${table.sourceType} = 'chunk' and ${table.chunkId} is not null and ${table.documentId} is not null and ${table.sourceId} = ${table.chunkId})
      )`
    ),
    sourceLookupIdx: index("reader_sessions_source_lookup_idx").on(
      table.sourceType,
      table.sourceId
    ),
  })
);

export const readerNotes = pgTable(
  "reader_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => readerSessions.id, { onDelete: "cascade" }),
    status: text("status").$type<ReaderNoteStatus>().notNull(),
    ordinal: integer("ordinal").notNull(),
    summary: text("summary").notNull(),
    facts: jsonb("facts").$type<string[]>().notNull().default([]),
    inferences: jsonb("inferences").$type<string[]>().notNull().default([]),
    unresolvedQuestions: jsonb("unresolved_questions")
      .$type<string[]>()
      .notNull()
      .default([]),
    followUpActions: jsonb("follow_up_actions")
      .$type<string[]>()
      .notNull()
      .default([]),
    evidence: jsonb("evidence").notNull().default([]),
    checkpoint: jsonb("checkpoint").$type<ReaderCheckpoint>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionOrdinalIdx: uniqueIndex("reader_notes_session_ordinal_idx").on(
      table.sessionId,
      table.ordinal
    ),
  })
);

export const readerHandoffs = pgTable(
  "reader_handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => readerSessions.id, { onDelete: "cascade" }),
    status: text("status").$type<ReaderHandoffStatus>().notNull(),
    executiveSummary: text("executive_summary").notNull(),
    conclusions: jsonb("conclusions").notNull().default([]),
    gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
    caveats: jsonb("caveats").$type<string[]>().notNull().default([]),
    limitations: jsonb("limitations").$type<string[]>().notNull().default([]),
    nextQuestions: jsonb("next_questions").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").notNull().default([]),
    coverageSummary: jsonb("coverage_summary")
      .$type<ReaderCoverageSummary>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdIdx: uniqueIndex("reader_handoffs_session_id_idx").on(table.sessionId),
  })
);

export const readerCoverageRanges = pgTable(
  "reader_coverage_ranges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => readerSessions.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").references(() => readerNotes.id, { onDelete: "cascade" }),
    handoffId: uuid("handoff_id").references(() => readerHandoffs.id, {
      onDelete: "cascade",
    }),
    sourceType: text("source_type").$type<ReaderSourceType>().notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceTitle: text("source_title"),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    chunkId: uuid("chunk_id").references(() => chunks.id, { onDelete: "cascade" }),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    disposition: text("disposition")
      .$type<ReaderCoverageDisposition>()
      .notNull(),
    reason: text("reason").$type<ReaderCoverageReason>().notNull(),
    toolName: text("tool_name"),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => ({
    rangeBoundsCheck: check(
      "reader_coverage_ranges_bounds_check",
      sql`${table.startLine} <= ${table.endLine}`
    ),
    sourceIdentityCheck: check(
      "reader_coverage_ranges_source_identity_check",
      sql`(
        (${table.sourceType} = 'book_raw_content' and ${table.bookId} is not null and ${table.documentId} is null and ${table.chunkId} is null and ${table.sourceId} = ${table.bookId})
        or (${table.sourceType} = 'document' and ${table.documentId} is not null and ${table.chunkId} is null and ${table.sourceId} = ${table.documentId})
        or (${table.sourceType} = 'chunk' and ${table.chunkId} is not null and ${table.documentId} is not null and ${table.sourceId} = ${table.chunkId})
      )`
    ),
    sessionIdx: index("reader_coverage_ranges_session_idx").on(table.sessionId),
    noteIdx: index("reader_coverage_ranges_note_idx").on(table.noteId),
    handoffIdx: index("reader_coverage_ranges_handoff_idx").on(table.handoffId),
  })
);

export const booksRelations = relations(books, ({ many }) => ({
  documents: many(documents),
  readerSessions: many(readerSessions),
  readerCoverageRanges: many(readerCoverageRanges),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  book: one(books, {
    fields: [documents.bookId],
    references: [books.id],
  }),
  chunks: many(chunks),
  readerSessions: many(readerSessions),
  readerCoverageRanges: many(readerCoverageRanges),
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
  readerSessions: many(readerSessions),
  readerCoverageRanges: many(readerCoverageRanges),
}));

export const readerSessionsRelations = relations(
  readerSessions,
  ({ one, many }) => ({
    book: one(books, {
      fields: [readerSessions.bookId],
      references: [books.id],
    }),
    document: one(documents, {
      fields: [readerSessions.documentId],
      references: [documents.id],
    }),
    chunk: one(chunks, {
      fields: [readerSessions.chunkId],
      references: [chunks.id],
    }),
    notes: many(readerNotes),
    handoffs: many(readerHandoffs),
    coverageRanges: many(readerCoverageRanges),
  })
);

export const readerNotesRelations = relations(readerNotes, ({ one, many }) => ({
  session: one(readerSessions, {
    fields: [readerNotes.sessionId],
    references: [readerSessions.id],
  }),
  coverageRanges: many(readerCoverageRanges),
}));

export const readerHandoffsRelations = relations(
  readerHandoffs,
  ({ one, many }) => ({
    session: one(readerSessions, {
      fields: [readerHandoffs.sessionId],
      references: [readerSessions.id],
    }),
    coverageRanges: many(readerCoverageRanges),
  })
);

export const readerCoverageRangesRelations = relations(
  readerCoverageRanges,
  ({ one }) => ({
    session: one(readerSessions, {
      fields: [readerCoverageRanges.sessionId],
      references: [readerSessions.id],
    }),
    note: one(readerNotes, {
      fields: [readerCoverageRanges.noteId],
      references: [readerNotes.id],
    }),
    handoff: one(readerHandoffs, {
      fields: [readerCoverageRanges.handoffId],
      references: [readerHandoffs.id],
    }),
    book: one(books, {
      fields: [readerCoverageRanges.bookId],
      references: [books.id],
    }),
    document: one(documents, {
      fields: [readerCoverageRanges.documentId],
      references: [documents.id],
    }),
    chunk: one(chunks, {
      fields: [readerCoverageRanges.chunkId],
      references: [chunks.id],
    }),
  })
);
