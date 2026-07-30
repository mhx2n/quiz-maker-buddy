import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  quizzesTable,
  apiKeysTable,
  errorLogsTable,
  accessCodesTable,
} from "@workspace/db";
import { z } from "zod";
import { requireAdmin, toPublicUser, hashPassword } from "../lib/auth";
import { getSettings, saveSettings, redactSettings } from "../lib/settings";
import { PROVIDERS, providerDef, testKey } from "../lib/ai-providers";
import { createAccessCode, listAccessCodes } from "../lib/access-codes";
import { runBackup, lastBackup } from "../lib/mongo-backup";
import { notifyGroup } from "../lib/notify";

const router = Router();

// Every /admin route is admin-only and answers 404 to everyone else.
router.use("/admin", requireAdmin);

router.get("/admin/stats", async (_req, res) => {
  const users = await db.select().from(usersTable);
  const quizzes = await db.select().from(quizzesTable);
  const keys = await db.select().from(apiKeysTable);
  const [{ errors }] = await db
    .select({ errors: sql<number>`count(*)::int` })
    .from(errorLogsTable);

  res.json({
    totalUsers: users.length,
    blockedUsers: users.filter((u) => u.isBlocked).length,
    admins: users.filter((u) => u.role === "admin").length,
    totalQuizzes: quizzes.length,
    totalQuestions: quizzes.reduce((sum, q) => sum + (q.questionCount ?? 0), 0),
    postedToTelegram: quizzes.filter((q) => q.postedToTelegram).length,
    apiKeys: keys.length,
    activeApiKeys: keys.filter((k) => k.isActive && k.status !== "exhausted").length,
    exhaustedApiKeys: keys.filter((k) => k.status === "exhausted").length,
    errorCount: errors ?? 0,
    lastBackup: lastBackup(),
  });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      user: usersTable,
      quizCount: sql<number>`(
        select count(*)::int from quizzes where quizzes.user_id = ${usersTable.id}
      )`,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  res.json(rows.map((row) => ({ ...toPublicUser(row.user), quizCount: row.quizCount ?? 0 })));
});

const updateUserSchema = z.object({
  role: z.enum(["user", "admin"]).optional(),
  isBlocked: z.boolean().optional(),
  quizLimit: z.number().int().min(0).max(100000).optional(),
  name: z.string().trim().max(100).optional(),
  newPassword: z.string().min(6).max(200).optional(),
});

router.patch("/admin/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // An admin can never lock themselves out.
  if (target.id === req.user!.id && (parsed.data.role === "user" || parsed.data.isBlocked)) {
    res.status(400).json({ error: "You cannot demote or block your own account." });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.role) updates.role = parsed.data.role;
  if (parsed.data.isBlocked !== undefined) updates.isBlocked = parsed.data.isBlocked;
  if (parsed.data.quizLimit !== undefined) updates.quizLimit = parsed.data.quizLimit;
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.newPassword) updates.passwordHash = hashPassword(parsed.data.newPassword);

  if (Object.keys(updates).length === 0) {
    res.json(toPublicUser(target));
    return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  res.json(toPublicUser(updated));
});

router.delete("/admin/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  await db.delete(quizzesTable).where(eq(quizzesTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

router.get("/admin/quizzes", async (_req, res) => {
  const rows = await db
    .select({
      id: quizzesTable.id,
      title: quizzesTable.title,
      questionCount: quizzesTable.questionCount,
      postedToTelegram: quizzesTable.postedToTelegram,
      createdAt: quizzesTable.createdAt,
      userId: quizzesTable.userId,
      ownerEmail: usersTable.email,
    })
    .from(quizzesTable)
    .leftJoin(usersTable, eq(usersTable.id, quizzesTable.userId))
    .orderBy(desc(quizzesTable.createdAt));

  res.json(rows.map((row) => ({ ...row, ownerEmail: row.ownerEmail ?? null })));
});

router.delete("/admin/quizzes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(quizzesTable).where(eq(quizzesTable.id, id));
  res.status(204).send();
});

// ── Platform settings (bot, group, defaults, Mongo) ────────────────────────
const settingsSchema = z.object({
  errorBotToken: z.string().trim().max(200).optional(),
  errorGroupId: z.string().trim().max(64).optional(),
  ownerTelegramIds: z.string().trim().max(500).optional(),
  defaultBotToken: z.string().trim().max(200).optional(),
  defaultChannelId: z.string().trim().max(120).optional(),
  requireAccessCode: z.boolean().optional(),
  mongoUri: z.string().trim().max(500).optional(),
  mongoBackupEnabled: z.boolean().optional(),
  notifyOnError: z.boolean().optional(),
  aiTimeoutMs: z.number().int().min(5000).max(300000).optional(),
});

router.get("/admin/settings", async (_req, res) => {
  res.json(redactSettings(await getSettings(true)));
});

router.put("/admin/settings", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const saved = await saveSettings(parsed.data);
  res.json(redactSettings(saved));
});

router.post("/admin/settings/test-telegram", async (_req, res) => {
  const sent = await notifyGroup("✅ Test alert from the admin panel — alerts are working.");
  res.json({ ok: sent, error: sent ? undefined : "Bot token or group ID is missing/invalid." });
});

// ── AI API keys ────────────────────────────────────────────────────────────
router.get("/admin/providers", (_req, res) => {
  res.json(PROVIDERS.map((p) => ({ id: p.id, label: p.label, defaultModel: p.defaultModel, vision: p.vision })));
});

function maskKey(value: string) {
  return value.length > 10 ? `${value.slice(0, 6)}••••${value.slice(-4)}` : "••••";
}

function normalizeModel(value?: string | null) {
  const model = value?.trim();
  if (!model) return null;
  if (["auto", "default", "provider-default"].includes(model.toLowerCase())) return null;
  return model;
}

router.get("/admin/api-keys", async (_req, res) => {
  const rows = await db.select().from(apiKeysTable).orderBy(apiKeysTable.priority, apiKeysTable.id);
  res.json(
    rows.map((row) => ({
      ...row,
      apiKey: maskKey(row.apiKey),
      model: normalizeModel(row.model) ?? providerDef(row.provider).defaultModel,
    })),
  );
});

const apiKeySchema = z.object({
  provider: z.string().trim().min(1).max(40),
  label: z.string().trim().max(80).optional(),
  apiKey: z.string().trim().min(8).max(400),
  model: z.string().trim().max(120).optional().nullable(),
  baseUrl: z.string().trim().max(300).optional().nullable(),
  priority: z.number().int().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
});

router.post("/admin/api-keys", async (req, res) => {
  const parsed = apiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      provider: parsed.data.provider,
      label: parsed.data.label ?? "",
      apiKey: parsed.data.apiKey,
        model: normalizeModel(parsed.data.model),
      baseUrl: parsed.data.baseUrl || null,
      priority: parsed.data.priority ?? 100,
      isActive: parsed.data.isActive ?? true,
    })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Could not save API key" });
    return;
  }
  res.status(201).json({ ...row, apiKey: maskKey(row.apiKey) });
});

router.patch("/admin/api-keys/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = apiKeySchema.partial().safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updates: Record<string, unknown> = {};
  for (const field of ["provider", "label", "baseUrl", "priority", "isActive"] as const) {
    if (parsed.data[field] !== undefined) updates[field] = parsed.data[field];
  }
  if (parsed.data.model !== undefined) updates.model = normalizeModel(parsed.data.model);
  if (parsed.data.apiKey) updates.apiKey = parsed.data.apiKey;
  const changedProviderConfig = ["provider", "model", "baseUrl", "apiKey"].some(
    (field) => parsed.data[field as keyof typeof parsed.data] !== undefined,
  );
  // Re-enabling or fixing provider config clears cooldown so the key is retried immediately.
  if (parsed.data.isActive || changedProviderConfig) {
    updates.cooldownUntil = null;
    updates.status = "unknown";
    updates.lastError = null;
  }
  const [row] = await db.update(apiKeysTable).set(updates).where(eq(apiKeysTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ ...row, apiKey: maskKey(row.apiKey) });
});

router.delete("/admin/api-keys/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(apiKeysTable).where(eq(apiKeysTable.id, id));
  res.status(204).send();
});

router.post("/admin/api-keys/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json(await testKey(row));
});

// ── Access codes ───────────────────────────────────────────────────────────
router.get("/admin/access-codes", async (_req, res) => {
  res.json(await listAccessCodes());
});

router.post("/admin/access-codes", async (req, res) => {
  const parsed = z
    .object({
      note: z.string().trim().max(200).optional(),
      maxUses: z.number().int().min(1).max(10000).optional(),
      count: z.number().int().min(1).max(50).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const created = [];
  for (let i = 0; i < (parsed.data.count ?? 1); i++) {
    created.push(
      await createAccessCode({
        note: parsed.data.note,
        maxUses: parsed.data.maxUses,
        issuedBy: `admin:${req.user!.email}`,
      }),
    );
  }
  res.status(201).json(created);
});

router.patch("/admin/access-codes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [row] = await db
    .update(accessCodesTable)
    .set({ isActive: parsed.data.isActive })
    .where(eq(accessCodesTable.id, id))
    .returning();
  res.json(row ?? null);
});

router.delete("/admin/access-codes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(accessCodesTable).where(eq(accessCodesTable.id, id));
  res.status(204).send();
});

// ── Error log ──────────────────────────────────────────────────────────────
router.get("/admin/errors", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const rows = await db.select().from(errorLogsTable).orderBy(desc(errorLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.delete("/admin/errors", async (_req, res) => {
  await db.delete(errorLogsTable);
  res.status(204).send();
});

// ── MongoDB backup ─────────────────────────────────────────────────────────
router.post("/admin/backup", async (_req, res) => {
  res.json(await runBackup());
});

router.get("/admin/backup", (_req, res) => {
  res.json(lastBackup() ?? { ok: false, counts: {}, detail: "No backup has run yet.", at: null });
});

export default router;
