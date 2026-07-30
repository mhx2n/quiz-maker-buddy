import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const port = Number(process.env["PORT"] ?? "10000");
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// ── Auto-create DB tables on startup (safe for Neon + Render) ───────────────
async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id              SERIAL PRIMARY KEY,
        title           TEXT NOT NULL,
        source_content  TEXT NOT NULL DEFAULT '',
        questions       JSONB NOT NULL DEFAULT '[]',
        question_count  INTEGER NOT NULL DEFAULT 0,
        posted_to_telegram BOOLEAN NOT NULL DEFAULT FALSE,
        telegram_channel TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        email          TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL DEFAULT '',
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'user',
        is_blocked     BOOLEAN NOT NULL DEFAULT FALSE,
        quiz_limit     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        last_login_at  TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS user_id INTEGER;`);
    await client.query(`CREATE INDEX IF NOT EXISTS quizzes_user_id_idx ON quizzes (user_id);`);
    logger.info("DB schema ready");
  } finally {
    client.release();
  }
}

ensureSchema()
  .then(() => {
    app.listen(port, (err) => {
      if (err) { logger.error({ err }, "Error starting server"); process.exit(1); }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "DB schema init failed");
    process.exit(1);
  });
