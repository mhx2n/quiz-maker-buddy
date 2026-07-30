import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  toPublicUser,
} from "../lib/auth";
import { getSettings } from "../lib/settings";
import { validateAccessCode, consumeAccessCode } from "../lib/access-codes";
import { reportError, notifyGroup } from "../lib/notify";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(200),
  name: z.string().trim().max(100).optional(),
  accessCode: z.string().trim().max(60).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

/** Tells the login screen whether an access code field is needed. */
router.get("/auth/config", async (_req, res) => {
  const settings = await getSettings();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  res.json({
    requireAccessCode: settings.requireAccessCode && (count ?? 0) > 0,
    firstRun: (count ?? 0) === 0,
  });
});

router.post("/auth/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email and a password of 6+ characters are required." });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "This email is already registered." });
    return;
  }

  // First account ever created becomes the admin. ADMIN_EMAIL also grants admin.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);
  const adminEmail = process.env["ADMIN_EMAIL"]?.trim().toLowerCase();
  const isFirstUser = (count ?? 0) === 0;
  const role = isFirstUser || (adminEmail && adminEmail === email) ? "admin" : "user";

  // Every user (except the very first/owner account) needs a bot-issued code.
  const settings = await getSettings();
  let codeRow = null;
  if (settings.requireAccessCode && !isFirstUser) {
    const check = await validateAccessCode(parsed.data.accessCode ?? "");
    if (!check.ok) {
      res.status(403).json({ error: check.error });
      return;
    }
    codeRow = check.row;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: parsed.data.name || email.split("@")[0]!,
      passwordHash: hashPassword(parsed.data.password),
      role,
      lastLoginAt: new Date(),
    })
    .returning();

  if (codeRow) await consumeAccessCode(codeRow, user!.id);

  void notifyGroup(
    `🆕 <b>New user registered</b>\n${email}${codeRow ? `\ncode: <code>${codeRow.code}</code>` : ""}`,
  );

  res.status(201).json({ token: signToken(user.id), user: toPublicUser(user) });
});

router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "Wrong email or password." });
    return;
  }
  if (user.isBlocked) {
    res.status(403).json({ error: "Your account has been blocked by an administrator." });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  res.json({ token: signToken(user.id), user: toPublicUser(user) });
});

/** Dedicated admin entrance used by /secure-admin-login. Non-admins get the same generic error. */
router.post("/auth/admin-login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const valid = user && verifyPassword(parsed.data.password, user.passwordHash);

  if (!valid || user!.role !== "admin" || user!.isBlocked) {
    void reportError({
      source: "auth",
      level: "warn",
      message: "Failed admin login attempt",
      context: { email, ip: req.ip, userAgent: req.headers["user-agent"] },
    });
    res.status(401).json({ error: "Invalid administrator credentials." });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user!.id));
  void notifyGroup(`🔐 <b>Admin signed in</b>\n${email}\nIP: <code>${req.ip ?? "unknown"}</code>`);

  res.json({ token: signToken(user!.id), user: toPublicUser(user!) });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(6).max(200),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "New password must be at least 6 characters." });
    return;
  }

  const user = req.user!;
  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect." });
    return;
  }

  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(parsed.data.newPassword) })
    .where(eq(usersTable.id, user.id));

  res.json({ success: true });
});

export default router;
