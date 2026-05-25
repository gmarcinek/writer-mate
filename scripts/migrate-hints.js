const { Client } = require('pg');

const sql = `
CREATE TABLE IF NOT EXISTS "reader_hints" (
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

ALTER TABLE "reader_hints" ADD CONSTRAINT IF NOT EXISTS "reader_hints_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "reader_sessions"("id") ON DELETE cascade;
ALTER TABLE "reader_hints" ADD CONSTRAINT IF NOT EXISTS "reader_hints_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE cascade;
CREATE INDEX IF NOT EXISTS "reader_hints_book_id_idx" ON "reader_hints" USING btree ("book_id");
CREATE INDEX IF NOT EXISTS "reader_hints_session_id_idx" ON "reader_hints" USING btree ("session_id");
`;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Split on semicolons but skip empty
  const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    try {
      await client.query(stmt);
      console.log('OK:', stmt.slice(0, 70));
    } catch (e) {
      console.log('SKIP:', e.message.slice(0, 100));
    }
  }
  await client.end();
}

run().catch(console.error);
