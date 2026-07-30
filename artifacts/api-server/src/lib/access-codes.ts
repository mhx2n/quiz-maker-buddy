import { randomBytes } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, accessCodesTable, type AccessCodeRow } from "@workspace/db";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCodeString(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return `QZ-${out}`;
}

export async function createAccessCode(input: {
  note?: string;
  issuedBy?: string;
  telegramUserId?: string | null;
  maxUses?: number;
  expiresAt?: Date | null;
}): Promise<AccessCodeRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCodeString();
    const [existing] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.code, code));
    if (existing) continue;
    const [row] = await db
      .insert(accessCodesTable)
      .values({
        code,
        note: input.note ?? "",
        issuedBy: input.issuedBy ?? "admin",
        telegramUserId: input.telegramUserId ?? null,
        maxUses: Math.max(1, Math.min(10000, input.maxUses ?? 1)),
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return row!;
  }
  throw new Error("Could not generate a unique access code");
}

export type CodeCheck = { ok: true; row: AccessCodeRow } | { ok: false; error: string };

export async function validateAccessCode(rawCode: string): Promise<CodeCheck> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "An access code is required." };
  const [row] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.code, code));
  if (!row) return { ok: false, error: "This access code does not exist." };
  if (!row.isActive) return { ok: false, error: "This access code has been revoked." };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This access code has expired." };
  if (row.useCount >= row.maxUses) return { ok: false, error: "This access code has already been used." };
  return { ok: true, row };
}

export async function consumeAccessCode(row: AccessCodeRow, userId: number): Promise<void> {
  await db
    .update(accessCodesTable)
    .set({
      useCount: sql`${accessCodesTable.useCount} + 1`,
      usedByUserId: row.usedByUserId ?? userId,
      usedAt: new Date(),
      isActive: row.useCount + 1 >= row.maxUses ? false : row.isActive,
    })
    .where(and(eq(accessCodesTable.id, row.id), eq(accessCodesTable.isActive, true)));
}

export function listAccessCodes() {
  return db.select().from(accessCodesTable).orderBy(desc(accessCodesTable.createdAt));
}
