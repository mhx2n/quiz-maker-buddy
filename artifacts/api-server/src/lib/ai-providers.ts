import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db, apiKeysTable, type ApiKeyRow } from "@workspace/db";
import { reportError } from "./notify";
import { getSettings } from "./settings";
import { logger } from "./logger";

export type AIMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: AIMessageContent;
};

export type ChatParams = {
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  max_completion_tokens?: number;
};

export type ChatResult = {
  choices: [{ message: { content: string } }];
  provider?: string;
};

// ── Provider registry ──────────────────────────────────────────────────────
type ProviderDef = {
  id: string;
  label: string;
  kind: "openai" | "gemini";
  baseUrl: string;
  defaultModel: string;
  vision: boolean;
};

export const PROVIDERS: ProviderDef[] = [
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", vision: true },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", vision: false },
  { id: "mistral", label: "Mistral AI", kind: "openai", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", vision: false },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", vision: true },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "google/gemini-2.0-flash-001", vision: true },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", vision: false },
  { id: "together", label: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", vision: false },
  { id: "cerebras", label: "Cerebras", kind: "openai", baseUrl: "https://api.cerebras.ai/v1", defaultModel: "llama-3.3-70b", vision: false },
  { id: "custom", label: "Custom (OpenAI compatible)", kind: "openai", baseUrl: "", defaultModel: "gpt-3.5-turbo", vision: false },
];

export function providerDef(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1]!;
}

const QUOTA_PATTERNS = [
  "quota", "rate limit", "rate_limit", "insufficient", "billing", "exceeded",
  "too many requests", "resource_exhausted", "credit",
];

function isQuotaError(status: number, body: string): boolean {
  if (status === 429 || status === 402) return true;
  const lower = body.toLowerCase();
  return QUOTA_PATTERNS.some((p) => lower.includes(p));
}

function textOf(content: AIMessageContent): string {
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
}

function imagesOf(content: AIMessageContent): string[] {
  if (typeof content === "string") return [];
  return content
    .filter((p) => p.type === "image_url")
    .map((p) => (p as { image_url: { url: string } }).image_url.url);
}

// ── Provider calls ─────────────────────────────────────────────────────────
async function callOpenAiCompatible(
  key: ApiKeyRow,
  def: ProviderDef,
  params: ChatParams,
  timeoutMs: number,
): Promise<string> {
  const baseUrl = (key.baseUrl || def.baseUrl).replace(/\/$/, "");
  if (!baseUrl) throw new Error("Missing base URL for custom provider");
  const model = key.model || params.model || def.defaultModel;

  const messages = params.messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    if (def.vision) return { role: m.role, content: m.content };
    return { role: m.role, content: textOf(m.content) };
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: params.temperature ?? 0.5,
        max_tokens: Math.min(params.max_completion_tokens ?? 8000, 16000),
      }),
      signal: controller.signal,
    });
    const body = await resp.text();
    if (!resp.ok) {
      const error = new Error(`${def.label} ${resp.status}: ${body.slice(0, 300)}`);
      (error as Error & { quota?: boolean }).quota = isQuotaError(resp.status, body);
      throw error;
    }
    const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error(`${def.label} returned an empty response`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(
  key: ApiKeyRow,
  def: ProviderDef,
  params: ChatParams,
  timeoutMs: number,
): Promise<string> {
  const model = key.model || def.defaultModel;
  const baseUrl = (key.baseUrl || def.baseUrl).replace(/\/$/, "");

  const systemText = params.messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n\n");

  const contents = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        { text: textOf(m.content) },
        ...imagesOf(m.content).map((url) => {
          const [meta, data] = url.split(",");
          return {
            inline_data: {
              mime_type: meta?.match(/data:(.*?);/)?.[1] ?? "image/jpeg",
              data: data ?? "",
            },
          };
        }),
      ],
    }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/models/${model}:generateContent?key=${key.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents.length ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        generationConfig: {
          temperature: params.temperature ?? 0.5,
          maxOutputTokens: Math.min(params.max_completion_tokens ?? 8192, 32768),
        },
      }),
      signal: controller.signal,
    });
    const body = await resp.text();
    if (!resp.ok) {
      const error = new Error(`Gemini ${resp.status}: ${body.slice(0, 300)}`);
      (error as Error & { quota?: boolean }).quota = isQuotaError(resp.status, body);
      throw error;
    }
    const data = JSON.parse(body) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("Gemini returned an empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callKey(key: ApiKeyRow, params: ChatParams, timeoutMs: number): Promise<string> {
  const def = providerDef(key.provider);
  return def.kind === "gemini"
    ? callGemini(key, def, params, timeoutMs)
    : callOpenAiCompatible(key, def, params, timeoutMs);
}

// ── Key selection + rotation ───────────────────────────────────────────────
async function usableKeys(): Promise<ApiKeyRow[]> {
  const now = new Date();
  return db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.isActive, true),
        or(isNull(apiKeysTable.cooldownUntil), sql`${apiKeysTable.cooldownUntil} <= ${now}`),
      ),
    )
    .orderBy(asc(apiKeysTable.priority), asc(apiKeysTable.lastUsedAt), asc(apiKeysTable.id));
}

async function markSuccess(key: ApiKeyRow) {
  await db
    .update(apiKeysTable)
    .set({
      status: "ok",
      lastError: null,
      cooldownUntil: null,
      lastUsedAt: new Date(),
      successCount: sql`${apiKeysTable.successCount} + 1`,
    })
    .where(eq(apiKeysTable.id, key.id));
}

const COOLDOWN_QUOTA_MS = 30 * 60 * 1000;
const COOLDOWN_ERROR_MS = 2 * 60 * 1000;

async function markFailure(key: ApiKeyRow, err: Error, quota: boolean) {
  await db
    .update(apiKeysTable)
    .set({
      status: quota ? "exhausted" : "error",
      lastError: err.message.slice(0, 500),
      lastUsedAt: new Date(),
      failCount: sql`${apiKeysTable.failCount} + 1`,
      cooldownUntil: new Date(Date.now() + (quota ? COOLDOWN_QUOTA_MS : COOLDOWN_ERROR_MS)),
    })
    .where(eq(apiKeysTable.id, key.id));

  await reportError({
    source: "ai",
    level: quota ? "warn" : "error",
    message: quota
      ? `API limit reached — ${key.provider}${key.label ? ` (${key.label})` : ""}`
      : `AI provider failed — ${key.provider}${key.label ? ` (${key.label})` : ""}`,
    context: {
      provider: key.provider,
      keyId: key.id,
      label: key.label,
      detail: err.message.slice(0, 500),
      cooldownMinutes: quota ? 30 : 2,
    },
  });
}

/** Rotates through every stored key until one answers. */
export async function chatComplete(params: ChatParams): Promise<ChatResult> {
  const settings = await getSettings();
  const keys = await usableKeys();

  if (!keys.length) {
    await reportError({
      source: "ai",
      level: "error",
      message: "No usable AI API key — every key is missing, disabled, or in cooldown.",
    });
    throw new Error("All AI providers exhausted: add an API key from the admin panel.");
  }

  const errors: string[] = [];
  for (const key of keys) {
    try {
      const text = await callKey(key, params, settings.aiTimeoutMs);
      await markSuccess(key);
      return { choices: [{ message: { content: text } }], provider: key.provider };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const quota = Boolean((error as Error & { quota?: boolean }).quota);
      logger.warn({ provider: key.provider, keyId: key.id, err: error.message }, "AI key failed");
      errors.push(`${key.provider}#${key.id}: ${error.message}`);
      await markFailure(key, error, quota).catch(() => {});
    }
  }

  throw new Error(`All AI providers exhausted or rate-limited. ${errors.slice(0, 3).join(" | ")}`);
}

/** Single-key smoke test used by the admin panel "Test" button. */
export async function testKey(key: ApiKeyRow): Promise<{ ok: boolean; detail: string }> {
  try {
    const text = await callKey(
      key,
      { messages: [{ role: "user", content: "Reply with the single word: OK" }], max_completion_tokens: 20 },
      20000,
    );
    await markSuccess(key);
    return { ok: true, detail: text.trim().slice(0, 120) };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await markFailure(key, error, Boolean((error as Error & { quota?: boolean }).quota)).catch(() => {});
    return { ok: false, detail: error.message.slice(0, 300) };
  }
}
