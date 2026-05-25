CREATE TABLE "reader_hints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "book_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "description" text NOT NULL,
  "start_line" integer NOT NULL,
  "end_line" integer NOT NULL,
  "fragment" text NOT NULL,
  "proposed_change" text NOT NULL,
  "applied_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reader_hints" ADD CONSTRAINT "reader_hints_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reader_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reader_hints" ADD CONSTRAINT "reader_hints_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reader_hints_book_id_idx" ON "reader_hints" USING btree ("book_id");
--> statement-breakpoint
CREATE INDEX "reader_hints_session_id_idx" ON "reader_hints" USING btree ("session_id");
