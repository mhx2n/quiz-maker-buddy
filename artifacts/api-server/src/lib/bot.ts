import { desc, eq, sql } from "drizzle-orm";
import { db, usersTable, quizzesTable, apiKeysTable, errorLogsTable } from "@workspace/db";
import { getSettings } from "./settings";
import { telegramCall, notifyGroup } from "./notify";
import { createAccessCode, listAccessCodes } from "./access-codes";
import { runBackup, lastBackup } from "./mongo-backup";
import { logger } from "./logger";

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string };
type TgUpdate = { update_id: number; message?: TgMessage; channel_post?: TgMessage };

let offset = 0;
let running = false;
let stopped = false;

async function isOwner(userId?: number): Promise<boolean> {
  if (!userId) return false;
  const { ownerTelegramIds } = await getSettings();
  const ids = ownerTelegramIds.split(",").map((s) => s.trim()).filter(Boolean);
  // No owner configured yet → the bot only answers /id so the owner can bootstrap.
  if (!ids.length) return false;
  return ids.includes(String(userId));
}

async function reply(botToken: string, chatId: number, text: string) {
  await telegramCall(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function handleCommand(botToken: string, msg: TgMessage) {
  const text = (msg.text ?? "").trim();
  if (!text.startsWith("/")) return;

  const [rawCmd, ...args] = text.split(/\s+/);
  const command = rawCmd!.split("@")[0]!.toLowerCase();
  const chatId = msg.chat.id;
  const owner = await isOwner(msg.from?.id);

  if (command === "/id" || command === "/chatid") {
    await reply(
      botToken,
      chatId,
      `👤 Your Telegram ID: <code>${msg.from?.id ?? "unknown"}</code>\n` +
        `💬 This chat ID: <code>${chatId}</code>\n\n` +
        `Paste these into the admin panel (Bot settings) to receive error alerts here.`,
    );
    return;
  }

  if (command === "/start" || command === "/help") {
    await reply(
      botToken,
      chatId,
      `🤖 <b>Quiz Creator Control Bot</b>\n\n` +
        `/id — show your Telegram ID and this chat ID\n` +
        (owner
          ? `/newcode [note] — create an access code for a new user\n` +
            `/codes — list the 10 newest access codes\n` +
            `/status — platform health (users, quizzes, API keys)\n` +
            `/errors — last 5 errors\n` +
            `/backup — run a MongoDB backup now\n` +
            `/test — send a test alert to the private group`
          : `⚠️ You are not registered as an owner. Ask the admin to add your ID.`),
    );
    return;
  }

  if (!owner) return; // silent for non-owners

  if (command === "/newcode") {
    const row = await createAccessCode({
      note: args.join(" ").slice(0, 200),
      issuedBy: `telegram:${msg.from?.id}`,
      telegramUserId: String(msg.from?.id ?? ""),
    });
    await reply(
      botToken,
      chatId,
      `✅ <b>New access code</b>\n<code>${row.code}</code>\n\nShare it with the user — it works for one registration.`,
    );
    return;
  }

  if (command === "/codes") {
    const rows = (await listAccessCodes()).slice(0, 10);
    const lines = rows.length
      ? rows
          .map(
            (r) =>
              `<code>${r.code}</code> — ${r.isActive ? "active" : "used/revoked"}${r.note ? ` · ${r.note}` : ""}`,
          )
          .join("\n")
      : "No codes yet. Use /newcode.";
    await reply(botToken, chatId, `🔑 <b>Access codes</b>\n${lines}`);
    return;
  }

  if (command === "/status") {
    const [{ users }] = await db.select({ users: sql<number>`count(*)::int` }).from(usersTable);
    const [{ quizzes }] = await db.select({ quizzes: sql<number>`count(*)::int` }).from(quizzesTable);
    const keys = await db.select().from(apiKeysTable);
    const backup = lastBackup();
    await reply(
      botToken,
      chatId,
      `📊 <b>Platform status</b>\n` +
        `Users: <b>${users ?? 0}</b>\n` +
        `Quizzes: <b>${quizzes ?? 0}</b>\n` +
        `API keys: <b>${keys.length}</b> (ok: ${keys.filter((k) => k.status === "ok").length}, exhausted: ${keys.filter((k) => k.status === "exhausted").length})\n` +
        `Last backup: ${backup ? `${backup.ok ? "✅" : "❌"} ${backup.at}` : "not run yet"}`,
    );
    return;
  }

  if (command === "/errors") {
    const rows = await db.select().from(errorLogsTable).orderBy(desc(errorLogsTable.createdAt)).limit(5);
    await reply(
      botToken,
      chatId,
      rows.length
        ? `🧾 <b>Recent errors</b>\n${rows.map((r) => `• [${r.source}] ${r.message.slice(0, 120)}`).join("\n")}`
        : "✅ No errors recorded.",
    );
    return;
  }

  if (command === "/backup") {
    const result = await runBackup();
    await reply(
      botToken,
      chatId,
      result.ok
        ? `✅ Backup done: ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`
        : `❌ Backup failed: ${result.detail}`,
    );
    return;
  }

  if (command === "/test") {
    const sent = await notifyGroup("✅ Test alert — error reporting is wired up correctly.");
    await reply(botToken, chatId, sent ? "Sent to the configured group." : "Group not configured yet.");
    return;
  }

  if (command === "/deletecode") {
    const code = (args[0] ?? "").toUpperCase();
    if (!code) {
      await reply(botToken, chatId, "Usage: /deletecode QZ-XXXX-XXXX-XXXX");
      return;
    }
    const { accessCodesTable } = await import("@workspace/db");
    await db.update(accessCodesTable).set({ isActive: false }).where(eq(accessCodesTable.code, code));
    await reply(botToken, chatId, `🚫 Code <code>${code}</code> revoked.`);
  }
}

async function poll() {
  if (running) return;
  running = true;

  while (!stopped) {
    try {
      const { errorBotToken } = await getSettings();
      if (!errorBotToken) {
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }

      const res = await telegramCall<TgUpdate[]>(
        errorBotToken,
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message"] },
        35000,
      );

      if (!res.ok || !res.result) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const update of res.result) {
        offset = Math.max(offset, update.update_id + 1);
        const msg = update.message;
        if (!msg?.text) continue;
        try {
          await handleCommand(errorBotToken, msg);
        } catch (err) {
          logger.warn({ err }, "Bot command failed");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Bot polling error");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  running = false;
}

/** Long-polling bot — works on Render free tier and any always-on host. */
export function startBot() {
  stopped = false;
  void poll();
  logger.info("Telegram control bot started (long polling)");
}

export function stopBot() {
  stopped = true;
}
