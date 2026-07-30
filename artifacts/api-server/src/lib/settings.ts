import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";

/**
 * Runtime settings live in the DB so the owner can change everything
 * (bot token, private group, default channel…) from the admin panel
 * without a redeploy. Env vars act as a fallback / bootstrap value.
 */
export type AppSettings = {
  errorBotToken: string;
  errorGroupId: string;
  ownerTelegramIds: string; // comma separated
  defaultBotToken: string;
  defaultChannelId: string;
  requireAccessCode: boolean;
  mongoUri: string;
  mongoBackupEnabled: boolean;
  notifyOnError: boolean;
  aiTimeoutMs: number;
};

const ENV_FALLBACK: AppSettings = {
  errorBotToken: process.env["TELEGRAM_BOT_TOKEN"] ?? "",
  errorGroupId: process.env["TELEGRAM_ERROR_GROUP_ID"] ?? "",
  ownerTelegramIds: process.env["TELEGRAM_OWNER_IDS"] ?? "",
  defaultBotToken: process.env["TELEGRAM_DEFAULT_BOT_TOKEN"] ?? "",
  defaultChannelId: process.env["TELEGRAM_DEFAULT_CHANNEL_ID"] ?? "",
  requireAccessCode: (process.env["REQUIRE_ACCESS_CODE"] ?? "true") !== "false",
  mongoUri: process.env["MONGODB_URI"] ?? "",
  mongoBackupEnabled: Boolean(process.env["MONGODB_URI"]),
  notifyOnError: true,
  aiTimeoutMs: 120000,
};

const SETTINGS_KEY = "platform";
const CACHE_TTL_MS = 5000;

let cache: { value: AppSettings; at: number } | null = null;

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let stored: Partial<AppSettings> = {};
  try {
    const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, SETTINGS_KEY));
    if (row?.value && typeof row.value === "object") stored = row.value as Partial<AppSettings>;
  } catch {
    /* table may not exist yet — fall back to env */
  }
  const merged: AppSettings = { ...ENV_FALLBACK, ...stripEmpty(stored) };
  cache = { value: merged, at: Date.now() };
  return merged;
}

function stripEmpty(input: Partial<AppSettings>): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as Partial<AppSettings>;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(true);
  const next = { ...current, ...patch };
  await db
    .insert(appSettingsTable)
    .values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: next, updatedAt: new Date() },
    });
  cache = { value: next, at: Date.now() };
  return next;
}

/** Values that must never leave the server in plain text. */
export function redactSettings(settings: AppSettings) {
  const mask = (value: string) => (value ? `${value.slice(0, 6)}••••${value.slice(-4)}` : "");
  return {
    ...settings,
    errorBotToken: mask(settings.errorBotToken),
    defaultBotToken: mask(settings.defaultBotToken),
    mongoUri: settings.mongoUri ? "••••configured••••" : "",
    hasErrorBotToken: Boolean(settings.errorBotToken),
    hasDefaultBotToken: Boolean(settings.defaultBotToken),
    hasMongoUri: Boolean(settings.mongoUri),
  };
}
