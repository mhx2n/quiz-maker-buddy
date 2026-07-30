import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"), // "user" | "admin"
  isBlocked: boolean("is_blocked").notNull().default(false),
  quizLimit: integer("quiz_limit").notNull().default(0), // 0 = unlimited
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  lastLoginAt: true,
});

export type UserRow = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
