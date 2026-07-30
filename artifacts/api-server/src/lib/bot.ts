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
type TgCallback = {
  id: string;
  from: TgUser;
  data?: string;
  message?: { message_id: number; chat: TgChat };
};
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallback;
};

/** Access-code requests waiting for the owner's approval. */
type PendingRequest = {
  id: string;
  userId: number;
  chatId: number;
  name: string;
  username: string;
  at: number;
};
const pendingRequests = new Map<string, PendingRequest>();
/** One open request per Telegram user, so nobody can spam the owner. */
const requestByUser = new Map<number, string>();

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

async function ownerIds(): Promise<string[]> {
  const { ownerTelegramIds } = await getSettings();
  return ownerTelegramIds.split(",").map((s) => s.trim()).filter(Boolean);
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
          : `/getcode — request a website access code (owner must approve)\n\n` +
            `অনুমোদনের পর আপনি একটি একবার-ব্যবহারযোগ্য code পাবেন। সেই code দিয়েই ওয়েবসাইটে রেজিস্ট্রেশন করুন।`),
    );
    return;
  }

  if (command === "/getcode" || command === "/request") {
    if (owner) {
      await reply(botToken, chatId, "You are an owner — use /newcode to mint a code directly.");
      return;
    }
    const owners = await ownerIds();
    if (!owners.length) {
      await reply(botToken, chatId, "⚠️ No owner is configured yet. Please try again later.");
      return;
    }
    const userId = msg.from?.id ?? chatId;
    const existing = requestByUser.get(userId);
    if (existing && pendingRequests.has(existing)) {
      await reply(botToken, chatId, "⏳ আপনার আবেদন ইতিমধ্যে owner-এর কাছে পাঠানো হয়েছে। অনুমোদনের জন্য অপেক্ষা করুন।");
      return;
    }

    const req: PendingRequest = {
      id: `${userId}-${Date.now().toString(36)}`,
      userId,
      chatId,
      name: msg.from?.first_name ?? "Unknown",
      username: msg.from?.username ? `@${msg.from.username}` : "—",
      at: Date.now(),
    };
    pendingRequests.set(req.id, req);
    requestByUser.set(userId, req.id);

    const note = args.join(" ").slice(0, 150);
    for (const oid of owners) {
      await telegramCall(botToken, "sendMessage", {
        chat_id: oid,
        text:
          `🔐 <b>Access code request</b>\n` +
          `Name: <b>${req.name}</b>\n` +
          `Username: ${req.username}\n` +
          `Telegram ID: <code>${req.userId}</code>\n` +
          (note ? `Note: ${note}\n` : "") +
          `\nApprove to generate a one-time code and send it to this user.`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `ac:ok:${req.id}` },
            { text: "🚫 Reject", callback_data: `ac:no:${req.id}` },
          ]],
        },
      });
    }
    await reply(
      botToken,
      chatId,
      "📨 আপনার আবেদন owner-এর কাছে পাঠানো হয়েছে।\nঅনুমোদিত হলে এখানেই আপনার একবার-ব্যবহারযোগ্য access code পাঠানো হবে।",
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

async function handleCallback(botToken: string, cb: TgCallback) {
  const data = cb.data ?? "";
  if (!data.startsWith("ac:")) return;

  const answer = async (text: string) => {
    await telegramCall(botToken, "answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: false });
  };

  if (!(await isOwner(cb.from.id))) {
    await answer("Not allowed.");
    return;
  }

  const [, action, reqId] = data.split(":");
  const req = reqId ? pendingRequests.get(reqId) : undefined;
  if (!req) {
    await answer("This request is no longer pending.");
    return;
  }
  pendingRequests.delete(req.id);
  requestByUser.delete(req.userId);

  let resultLine: string;
  if (action === "ok") {
    const row = await createAccessCode({
      note: `telegram:${req.name} ${req.username}`,
      issuedBy: `telegram:${cb.from.id}`,
      telegramUserId: String(req.userId),
      maxUses: 1,
    });
    await telegramCall(botToken, "sendMessage", {
      chat_id: req.chatId,
      text:
        `✅ <b>আপনার আবেদন অনুমোদিত হয়েছে</b>\n\n` +
        `আপনার access code:\n<code>${row.code}</code>\n\n` +
        `⚠️ এই code শুধু <b>একবার</b> ব্যবহার করা যাবে এবং শুধুমাত্র আপনার জন্য। ` +
        `রেজিস্ট্রেশনের পর এটি নিষ্ক্রিয় হয়ে যাবে — অন্য কেউ ব্যবহার করতে পারবে না।`,
      parse_mode: "HTML",
    });
    resultLine = `✅ Approved — code <code>${row.code}</code> sent to ${req.name} (${req.userId}).`;
    await answer("Approved and code sent.");
  } else {
    await telegramCall(botToken, "sendMessage", {
      chat_id: req.chatId,
      text: "🚫 দুঃখিত, আপনার access code আবেদনটি অনুমোদিত হয়নি।",
    });
    resultLine = `🚫 Rejected request from ${req.name} (${req.userId}).`;
    await answer("Rejected.");
  }

  if (cb.message) {
    await telegramCall(botToken, "editMessageReplyMarkup", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    await telegramCall(botToken, "sendMessage", {
      chat_id: cb.message.chat.id,
      text: resultLine,
      parse_mode: "HTML",
    });
  }
}

async function poll() {
  if (running) return;
  running = true;

  let lastToken = "";

  while (!stopped) {
    try {
      const { errorBotToken } = await getSettings();
      if (!errorBotToken) {
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }

      // A leftover webhook silently blocks getUpdates — clear it once per token.
      if (errorBotToken !== lastToken) {
        lastToken = errorBotToken;
        const me = await telegramCall<{ username?: string }>(errorBotToken, "getMe", {});
        if (!me.ok) {
          logger.error({ detail: me.description }, "Telegram bot token rejected");
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        await telegramCall(errorBotToken, "deleteWebhook", { drop_pending_updates: false });
        logger.info({ bot: me.result?.username }, "Telegram bot connected");
      }

      const res = await telegramCall<TgUpdate[]>(
        errorBotToken,
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
        35000,
      );

      if (!res.ok || !res.result) {
        if (res.description) logger.warn({ detail: res.description }, "getUpdates failed");
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }


      for (const update of res.result) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          if (update.callback_query) {
            await handleCallback(errorBotToken, update.callback_query);
            continue;
          }
          const msg = update.message;
          if (!msg?.text) continue;
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
