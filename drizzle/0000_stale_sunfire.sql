CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"file_original_name" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"raw_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"chunk_index" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_html" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_coverage_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"note_id" uuid,
	"handoff_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_title" text,
	"book_id" uuid,
	"document_id" uuid,
	"chunk_id" uuid,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"tool_name" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_coverage_ranges_bounds_check" CHECK ("reader_coverage_ranges"."start_line" <= "reader_coverage_ranges"."end_line"),
	CONSTRAINT "reader_coverage_ranges_source_identity_check" CHECK ((
        ("reader_coverage_ranges"."source_type" = 'book_raw_content' and "reader_coverage_ranges"."book_id" is not null and "reader_coverage_ranges"."document_id" is null and "reader_coverage_ranges"."chunk_id" is null and "reader_coverage_ranges"."source_id" = "reader_coverage_ranges"."book_id")
        or ("reader_coverage_ranges"."source_type" = 'document' and "reader_coverage_ranges"."document_id" is not null and "reader_coverage_ranges"."chunk_id" is null and "reader_coverage_ranges"."source_id" = "reader_coverage_ranges"."document_id")
        or ("reader_coverage_ranges"."source_type" = 'chunk' and "reader_coverage_ranges"."chunk_id" is not null and "reader_coverage_ranges"."document_id" is not null and "reader_coverage_ranges"."source_id" = "reader_coverage_ranges"."chunk_id")
      ))
);
--> statement-breakpoint
CREATE TABLE "reader_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"status" text NOT NULL,
	"executive_summary" text NOT NULL,
	"conclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caveats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage_summary" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"status" text NOT NULL,
	"ordinal" integer NOT NULL,
	"summary" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unresolved_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_up_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_title" text,
	"book_id" uuid,
	"document_id" uuid,
	"chunk_id" uuid,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"goal" jsonb NOT NULL,
	"cursor" jsonb,
	"recon_summary" jsonb,
	"coverage_summary" jsonb,
	"last_note_id" uuid,
	"handoff_id" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_sessions_source_identity_check" CHECK ((
        ("reader_sessions"."source_type" = 'book_raw_content' and "reader_sessions"."book_id" is not null and "reader_sessions"."document_id" is null and "reader_sessions"."chunk_id" is null and "reader_sessions"."source_id" = "reader_sessions"."book_id")
        or ("reader_sessions"."source_type" = 'document' and "reader_sessions"."document_id" is not null and "reader_sessions"."chunk_id" is null and "reader_sessions"."source_id" = "reader_sessions"."document_id")
        or ("reader_sessions"."source_type" = 'chunk' and "reader_sessions"."chunk_id" is not null and "reader_sessions"."document_id" is not null and "reader_sessions"."source_id" = "reader_sessions"."chunk_id")
      ))
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reader_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_note_id_reader_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."reader_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_handoff_id_reader_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."reader_handoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_coverage_ranges" ADD CONSTRAINT "reader_coverage_ranges_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_handoffs" ADD CONSTRAINT "reader_handoffs_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reader_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_notes" ADD CONSTRAINT "reader_notes_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reader_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_coverage_ranges_session_idx" ON "reader_coverage_ranges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "reader_coverage_ranges_note_idx" ON "reader_coverage_ranges" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "reader_coverage_ranges_handoff_idx" ON "reader_coverage_ranges" USING btree ("handoff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_handoffs_session_id_idx" ON "reader_handoffs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_notes_session_ordinal_idx" ON "reader_notes" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "reader_sessions_source_lookup_idx" ON "reader_sessions" USING btree ("source_type","source_id");