import { pgTable, uuid, text, vector, timestamp, jsonb } from "drizzle-orm/pg-core";

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
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
  // 1536 dim = text-embedding-3-small / text-embedding-ada-002
  embedding: vector("embedding", { dimensions: 1536 }),
  chunkIndex: text("chunk_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
