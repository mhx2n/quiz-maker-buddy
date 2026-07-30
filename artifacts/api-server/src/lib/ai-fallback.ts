import { logger } from "./logger";
import type { AIMessage, AIMessageContent, ChatParams } from "./ai-providers";

/**
 * Keyless fallback providers.
 *
 * These need no API key and are used automatically when every stored key is
 * exhausted, rate-limited or failing, so quiz generation keeps working.
 * They are best-effort: any failure is swallowed and the next one is tried.
 */

function textOf(content: AIMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
}

function flatten(messages: AIMessage[]): { system: string; user: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${textOf(m.content)}`)
    .join("\n\n");
  return { system, user };
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ── ChatSmith (Vulcan Labs) — GPT-4o, keyless ──────────────────────────────
const VULCAN_DEVICE_ID = "52CAB9370AEBB1ED";
const VULCAN_STATIC_TOKEN =
  "Lhee9Yb9VhLLV/vAZsOdKSRc7/m9Jc2IlEV0nnPLEMh+AnkGsk9p6QnTO2zqSs0mTxNW4SMZvQWQff2Nyu4/it7qHZU7i7MSRaXhXe30ZnFxGMwInrxQnWHjIkfKhN0yEJZiwOaUXyVAJaZ6quroAS6Kvycz6OeXYG0u3AM7/9g=";
const VULCAN_HEADERS = {
  "X-Vulcan-Application-Id": "com.smartwidgetlabs.chatgpt",
  Accept: "application/json",
  "User-Agent": "Chat Smith Android, Version 3.9.27(949)",
  "Content-Type": "application/json; charset=utf-8",
};

let vulcanToken: { value: string; at: number } | null = null;

async function vulcanAccessToken(timeoutMs: number): Promise<string> {
  if (vulcanToken && Date.now() - vulcanToken.at < 30 * 60 * 1000) return vulcanToken.value;

  const data = await withTimeout(timeoutMs, async (signal) => {
    const resp = await fetch("https://api.vulcanlabs.co/smith-auth/api/v1/token", {
      method: "POST",
      headers: VULCAN_HEADERS,
      body: JSON.stringify({
        device_id: VULCAN_DEVICE_ID,
        order_id: "",
        product_id: "",
        purchase_token: "",
        subscription_id: "",
      }),
      signal,
    });
    if (!resp.ok) throw new Error(`auth ${resp.status}`);
    return (await resp.json()) as { AccessToken?: string };
  });

  const token = data.AccessToken;
  if (!token) throw new Error("no AccessToken");
  vulcanToken = { value: token, at: Date.now() };
  return token;
}

async function callVulcan(params: ChatParams, timeoutMs: number): Promise<string> {
  const token = await vulcanAccessToken(Math.min(timeoutMs, 20000));
  const messages = params.messages.map((m) => ({ role: m.role, content: textOf(m.content) }));

  const data = await withTimeout(timeoutMs, async (signal) => {
    const resp = await fetch("https://api.vulcanlabs.co/smith-v2/api/v7/chat_android", {
      method: "POST",
      headers: {
        ...VULCAN_HEADERS,
        Authorization: `Bearer ${token}`,
        "X-Auth-Token": VULCAN_STATIC_TOKEN,
      },
      body: JSON.stringify({
        usage_model: { provider: "openai", model: "gpt-4o" },
        user: VULCAN_DEVICE_ID,
        messages,
        nsfw_check: false,
      }),
      signal,
    });
    if (!resp.ok) {
      vulcanToken = null; // force re-auth next time
      throw new Error(`chat ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    return (await resp.json()) as {
      choices?: Array<{ Message?: { content?: string }; message?: { content?: string } }>;
    };
  });

  const choice = data.choices?.[0];
  const text = choice?.Message?.content ?? choice?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty response");
  return text;
}

// ── Pollinations (OpenAI-compatible, keyless) ──────────────────────────────
async function callPollinations(params: ChatParams, timeoutMs: number): Promise<string> {
  const messages = params.messages.map((m) => ({ role: m.role, content: textOf(m.content) }));

  const text = await withTimeout(timeoutMs, async (signal) => {
    const resp = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages,
        temperature: params.temperature ?? 0.5,
      }),
      signal,
    });
    if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const body = await resp.text();
    try {
      const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    } catch {
      return body; // plain-text mode
    }
  });

  if (!text.trim()) throw new Error("empty response");
  return text;
}

// ── DuckDuckGo AI chat (keyless) ───────────────────────────────────────────
async function callDuckDuckGo(params: ChatParams, timeoutMs: number): Promise<string> {
  const { system, user } = flatten(params.messages);
  const prompt = system ? `${system}\n\n${user}` : user;

  return withTimeout(timeoutMs, async (signal) => {
    const status = await fetch("https://duckduckgo.com/duckchat/v1/status", {
      headers: { "x-vqd-accept": "1", "User-Agent": "Mozilla/5.0" },
      signal,
    });
    const vqd = status.headers.get("x-vqd-4");
    if (!vqd) throw new Error("no vqd token");

    const resp = await fetch("https://duckduckgo.com/duckchat/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vqd-4": vqd,
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] }),
      signal,
    });
    if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);

    // Server-sent events: collect every {"message": "..."} chunk.
    let out = "";
    for (const line of (await resp.text()).split("\n")) {
      const raw = line.trim();
      if (!raw.startsWith("data:")) continue;
      const payload = raw.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as { message?: string };
        if (chunk.message) out += chunk.message;
      } catch {
        /* ignore partial chunk */
      }
    }
    if (!out.trim()) throw new Error("empty response");
    return out;
  });
}

export type FallbackProvider = {
  id: string;
  label: string;
  call: (params: ChatParams, timeoutMs: number) => Promise<string>;
};

export const FALLBACK_PROVIDERS: FallbackProvider[] = [
  { id: "free-chatsmith", label: "Free GPT-4o (ChatSmith)", call: callVulcan },
  { id: "free-pollinations", label: "Free Pollinations", call: callPollinations },
  { id: "free-duckduckgo", label: "Free DuckDuckGo AI", call: callDuckDuckGo },
];

/** Tries every keyless provider in order. Returns null only if all fail. */
export async function freeFallbackChat(
  params: ChatParams,
  timeoutMs: number,
): Promise<{ text: string; provider: string } | null> {
  for (const provider of FALLBACK_PROVIDERS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await provider.call(params, timeoutMs);
        logger.info({ provider: provider.id, attempt }, "keyless AI fallback succeeded");
        return { text, provider: provider.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ provider: provider.id, attempt, err: message }, "keyless AI fallback failed");
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  return null;
}
