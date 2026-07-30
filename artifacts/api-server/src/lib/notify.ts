import { db, errorLogsTable } from "@workspace/db";
import { getSettings } from "./settings";
import { logger } from "./logger";

export type ErrorSource = "server" | "client" | "ai" | "telegram" | "mongo" | "auth";

export type ReportInput = {
  source?: ErrorSource;
  level?: "error" | "warn" | "info";
  message: string;
  stack?: string | null;
  context?: Record<string, unknown>;
  userId?: number | null;
};

// ── De-duplication so a crash loop cannot flood the private group ──────────
const RECENT_WINDOW_MS = 60_000;
const recent = new Map<string, number>();

function shouldSend(signature: string): boolean {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > RECENT_WINDOW_MS) recent.delete(key);
  if (recent.has(signature)) return false;
  recent.set(signature, now);
  return true;
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(input: string, max: number): string {
  return input.length > max ? `${input.slice(0, max)}…` : input;
}

/** Low-level Telegram send used by the notifier and the bot. */
export async function telegramCall<T = unknown>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return (await resp.json()) as { ok: boolean; result?: T; description?: string };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Send a plain message to the private owner group. */
export async function notifyGroup(html: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.errorBotToken || !settings.errorGroupId) return false;
  const res = await telegramCall(settings.errorBotToken, "sendMessage", {
    chat_id: settings.errorGroupId,
    text: truncate(html, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return res.ok;
}

/**
 * Records an error in Postgres and pushes it to the private Telegram group.
 * Never throws — reporting must not be able to break a request.
 */
export async function reportError(input: ReportInput): Promise<void> {
  const source = input.source ?? "server";
  const level = input.level ?? "error";
  const message = truncate(String(input.message ?? "Unknown error"), 2000);

  let notified = false;
  try {
    const settings = await getSettings();
    const signature = `${source}:${level}:${message.slice(0, 160)}`;
    if (settings.notifyOnError && shouldSend(signature)) {
      const icon = level === "error" ? "🚨" : level === "warn" ? "⚠️" : "ℹ️";
      const ctx = input.context && Object.keys(input.context).length
        ? `\n<pre>${escapeHtml(truncate(JSON.stringify(input.context, null, 2), 900))}</pre>`
        : "";
      const stack = input.stack ? `\n<pre>${escapeHtml(truncate(input.stack, 900))}</pre>` : "";
      notified = await notifyGroup(
        `${icon} <b>${escapeHtml(source.toUpperCase())} ${escapeHtml(level)}</b>\n` +
          `<b>${escapeHtml(message)}</b>\n` +
          `<i>${new Date().toISOString()}</i>${ctx}${stack}`,
      );
    }
  } catch (err) {
    logger.warn({ err }, "Telegram error notification failed");
  }

  try {
    await db.insert(errorLogsTable).values({
      source,
      level,
      message,
      stack: input.stack ?? null,
      context: input.context ?? null,
      userId: input.userId ?? null,
      notified,
    });
  } catch (err) {
    logger.warn({ err }, "Could not persist error log");
  }
}

/** Convenience wrapper for unexpected exceptions. */
export function reportException(err: unknown, extra: Omit<ReportInput, "message" | "stack"> = {}) {
  const error = err instanceof Error ? err : new Error(String(err));
  void reportError({ ...extra, message: error.message, stack: error.stack ?? null });
}
