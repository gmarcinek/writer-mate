CREATE TABLE "reader_master_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "book_id" uuid NOT NULL,
  "status" text NOT NULL,
  "executive_summary" text NOT NULL,
  "conclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "caveats" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "next_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "session_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reader_master_handoffs" ADD CONSTRAINT "reader_master_handoffs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "reader_master_handoffs_book_id_idx" ON "reader_master_handoffs" USING btree ("book_id");
