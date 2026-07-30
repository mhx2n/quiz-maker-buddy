import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { reportError, notifyGroup } from "./lib/notify";
import { startBot } from "./lib/bot";
import { startBackupScheduler } from "./lib/mongo-backup";

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id             SERIAL PRIMARY KEY,
        provider       TEXT NOT NULL,
        label          TEXT NOT NULL DEFAULT '',
        api_key        TEXT NOT NULL,
        model          TEXT,
        base_url       TEXT,
        priority       INTEGER NOT NULL DEFAULT 100,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        status         TEXT NOT NULL DEFAULT 'unknown',
        last_error     TEXT,
        success_count  INTEGER NOT NULL DEFAULT 0,
        fail_count     INTEGER NOT NULL DEFAULT 0,
        last_used_at   TIMESTAMP,
        cooldown_until TIMESTAMP,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        id               SERIAL PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        note             TEXT NOT NULL DEFAULT '',
        issued_by        TEXT NOT NULL DEFAULT 'admin',
        telegram_user_id TEXT,
        used_by_user_id  INTEGER,
        max_uses         INTEGER NOT NULL DEFAULT 1,
        use_count        INTEGER NOT NULL DEFAULT 0,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at       TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        used_at          TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id         SERIAL PRIMARY KEY,
        source     TEXT NOT NULL DEFAULT 'server',
        level      TEXT NOT NULL DEFAULT 'error',
        message    TEXT NOT NULL,
        stack      TEXT,
        context    JSONB,
        user_id    INTEGER,
        notified   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS error_logs_created_idx ON error_logs (created_at DESC);`);

    logger.info("DB schema ready");
  } finally {
    client.release();
  }
}

// ── Never crash silently: every fatal reaches the private Telegram group ────
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  const err = reason instanceof Error ? reason : new Error(String(reason));
  void reportError({ source: "server", message: `Unhandled rejection: ${err.message}`, stack: err.stack ?? null });
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  void reportError({ source: "server", message: `Uncaught exception: ${err.message}`, stack: err.stack ?? null });
});

ensureSchema()
  .then(() => {
    app.listen(port, (err) => {
      if (err) { logger.error({ err }, "Error starting server"); process.exit(1); }
      logger.info({ port }, "Server listening");
      startBot();
      startBackupScheduler();
      void notifyGroup(`🚀 <b>Quiz Creator API online</b>\nPort ${port} · ${new Date().toISOString()}`);
    });
  })
  .catch((err) => {
    logger.error({ err }, "DB schema init failed");
    void reportError({ source: "server", message: `DB schema init failed: ${String(err)}` });
    process.exit(1);
  });
