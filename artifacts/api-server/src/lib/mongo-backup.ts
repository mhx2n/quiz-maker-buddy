import { db, quizzesTable, usersTable, accessCodesTable, errorLogsTable } from "@workspace/db";
import { getSettings } from "./settings";
import { reportError } from "./notify";
import { logger } from "./logger";

/**
 * MongoDB is used purely as a backup mirror of the Postgres data.
 * Everything is lazily loaded so the app keeps running when Mongo is absent.
 */
type MongoClientLike = {
  db: (name?: string) => {
    collection: (name: string) => {
      bulkWrite: (ops: unknown[], opts?: unknown) => Promise<unknown>;
      deleteMany: (filter: unknown) => Promise<unknown>;
      insertMany: (docs: unknown[]) => Promise<unknown>;
      countDocuments: () => Promise<number>;
    };
  };
  close: () => Promise<void>;
};

let client: MongoClientLike | null = null;
let connectedUri = "";

async function getClient(): Promise<MongoClientLike | null> {
  const { mongoUri, mongoBackupEnabled } = await getSettings();
  if (!mongoBackupEnabled || !mongoUri) return null;
  if (client && connectedUri === mongoUri) return client;

  try {
    if (client) await client.close().catch(() => {});
    const { MongoClient } = (await import("mongodb")) as unknown as {
      MongoClient: new (uri: string, opts?: unknown) => MongoClientLike & { connect: () => Promise<unknown> };
    };
    const next = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
    await next.connect();
    client = next;
    connectedUri = mongoUri;
    logger.info("MongoDB backup connected");
    return client;
  } catch (err) {
    client = null;
    connectedUri = "";
    await reportError({
      source: "mongo",
      message: "MongoDB backup connection failed",
      context: { detail: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

export type BackupResult = {
  ok: boolean;
  counts: Record<string, number>;
  detail?: string;
  at: string;
};

let lastResult: BackupResult | null = null;
export function lastBackup(): BackupResult | null {
  return lastResult;
}

/** Full snapshot mirror of every table into MongoDB. */
export async function runBackup(): Promise<BackupResult> {
  const at = new Date().toISOString();
  const conn = await getClient();
  if (!conn) {
    lastResult = { ok: false, counts: {}, detail: "MongoDB is not configured", at };
    return lastResult;
  }

  try {
    const database = conn.db();
    const sets: Array<[string, Record<string, unknown>[]]> = [
      ["quizzes", await db.select().from(quizzesTable)],
      ["users", (await db.select().from(usersTable)).map((u) => ({ ...u, passwordHash: undefined }))],
      ["access_codes", await db.select().from(accessCodesTable)],
      ["error_logs", await db.select().from(errorLogsTable)],
    ];

    const counts: Record<string, number> = {};
    for (const [name, rows] of sets) {
      const collection = database.collection(name);
      if (rows.length) {
        await collection.bulkWrite(
          rows.map((row) => ({
            replaceOne: {
              filter: { _id: `${name}:${(row as { id?: number }).id ?? (row as { key?: string }).key}` },
              replacement: { ...row, _id: `${name}:${(row as { id?: number }).id}`, backedUpAt: at },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      }
      counts[name] = rows.length;
    }

    lastResult = { ok: true, counts, at };
    return lastResult;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await reportError({ source: "mongo", message: "MongoDB backup failed", context: { detail } });
    lastResult = { ok: false, counts: {}, detail, at };
    return lastResult;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Backup every 30 minutes while the server is up. */
export function startBackupScheduler(intervalMs = 30 * 60 * 1000) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void runBackup().catch(() => {});
  }, intervalMs);
  setTimeout(() => void runBackup().catch(() => {}), 15000);
}
