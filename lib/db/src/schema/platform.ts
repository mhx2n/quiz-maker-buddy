import { pgTable, serial, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/** Free-form key/value settings edited from the admin panel (bot token, group id, defaults…). */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().$type<unknown>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** AI provider keys added from the admin panel — rotated automatically. */
export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // gemini | groq | mistral | openai | openrouter | cohere | together | custom
  label: text("label").notNull().default(""),
  apiKey: text("api_key").notNull(),
  model: text("model"),
  baseUrl: text("base_url"),
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("unknown"), // unknown | ok | error | exhausted
  lastError: text("last_error"),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  cooldownUntil: timestamp("cooldown_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Unique invite codes issued through the Telegram bot; required to register. */
export const accessCodesTable = pgTable("access_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  note: text("note").notNull().default(""),
  issuedBy: text("issued_by").notNull().default("admin"), // admin | telegram:<id>
  telegramUserId: text("telegram_user_id"),
  usedByUserId: integer("used_by_user_id"),
  maxUses: integer("max_uses").notNull().default(1),
  useCount: integer("use_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"),
});

/** Every captured error (server, client, AI, telegram) — also pushed to the private group. */
export const errorLogsTable = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("server"), // server | client | ai | telegram | mongo
  level: text("level").notNull().default("error"), // error | warn | info
  message: text("message").notNull(),
  stack: text("stack"),
  context: jsonb("context").$type<Record<string, unknown>>(),
  userId: integer("user_id"),
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AppSettingRow = typeof appSettingsTable.$inferSelect;
export type ApiKeyRow = typeof apiKeysTable.$inferSelect;
export type AccessCodeRow = typeof accessCodesTable.$inferSelect;
export type ErrorLogRow = typeof errorLogsTable.$inferSelect;
