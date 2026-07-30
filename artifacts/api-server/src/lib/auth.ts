import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type UserRow } from "@workspace/db";

const SECRET =
  process.env["AUTH_SECRET"] ??
  process.env["DATABASE_URL"] ??
  "dev-only-insecure-secret-change-me";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ── Password hashing (scrypt, no external deps) ────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ── Signed tokens (compact HMAC-SHA256, JWT-like) ──────────────────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function signToken(userId: number): string {
  const body = b64url(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): number | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      uid?: number;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

// ── Request helpers ────────────────────────────────────────────────────────
export type PublicUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  isBlocked: boolean;
  quizLimit: number;
  createdAt: Date;
  lastLoginAt: Date | null;
};

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isBlocked: user.isBlocked,
    quizLimit: user.quizLimit,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.["auth_token"];
  return cookieToken ?? null;
}

export async function loadUser(req: Request): Promise<UserRow | null> {
  const token = readToken(req);
  if (!token) return null;
  const userId = verifyToken(token);
  if (!userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await loadUser(req);
    if (user) req.user = user;
  } catch {
    /* ignore — treated as anonymous */
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = req.user ?? (await loadUser(req).catch(() => null));
  if (!user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (user.isBlocked) {
    res.status(403).json({ error: "Your account has been blocked by an administrator." });
    return;
  }
  req.user = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user ?? (await loadUser(req).catch(() => null));
  if (!user || user.role !== "admin" || user.isBlocked) {
    // Deliberately vague: the admin panel is unlisted.
    res.status(404).json({ error: "Not found" });
    return;
  }
  req.user = user;
  next();
}
