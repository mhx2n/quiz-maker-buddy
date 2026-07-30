import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quizzesTable = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sourceContent: text("source_content").notNull(),
  questions: jsonb("questions").notNull().$type<QuizQuestion[]>(),
  questionCount: integer("question_count").notNull().default(0),
  postedToTelegram: boolean("posted_to_telegram").notNull().default(false),
  telegramChannel: text("telegram_channel"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

export const insertQuizSchema = createInsertSchema(quizzesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type QuizRow = typeof quizzesTable.$inferSelect;
