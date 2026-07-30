import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, usersTable, quizzesTable } from "@workspace/db";
import { z } from "zod";
import { requireAdmin, toPublicUser, hashPassword } from "../lib/auth";

const router = Router();

// Every /admin route is admin-only and answers 404 to everyone else.
router.use("/admin", requireAdmin);

router.get("/admin/stats", async (_req, res) => {
  const users = await db.select().from(usersTable);
  const quizzes = await db.select().from(quizzesTable);

  res.json({
    totalUsers: users.length,
    blockedUsers: users.filter((u) => u.isBlocked).length,
    admins: users.filter((u) => u.role === "admin").length,
    totalQuizzes: quizzes.length,
    totalQuestions: quizzes.reduce((sum, q) => sum + (q.questionCount ?? 0), 0),
    postedToTelegram: quizzes.filter((q) => q.postedToTelegram).length,
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

export default router;
