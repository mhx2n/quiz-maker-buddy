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
