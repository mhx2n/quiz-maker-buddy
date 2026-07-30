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

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(200),
  name: z.string().trim().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
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
  const role = count === 0 || (adminEmail && adminEmail === email) ? "admin" : "user";

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
