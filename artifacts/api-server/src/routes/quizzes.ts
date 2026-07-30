import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, quizzesTable } from "@workspace/db";
import {
  GenerateQuizBody,
  GetQuizParams,
  UpdateQuizParams,
  UpdateQuizBody,
  DeleteQuizParams,
  PostQuizToTelegramParams,
  PostQuizToTelegramBody,
  ExportQuizParams,
  ExportQuizQueryParams,
} from "@workspace/api-zod";
import { aiClient as openai, AI_MODEL, AI_SUPPORTS_VISION, type AIMessage } from "../lib/ai";

const router = Router();

function plainTextify(input: string): string {
  return input
    .replace(/\$\s*([^$]+?)\s*\$/g, "$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times/g, "×")
    .replace(/\\pi/g, "pi")
    .replace(/\\theta/g, "theta")
    .replace(/\\ln/g, "ln")
    .replace(/\\log/g, "log")
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\tan/g, "tan")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLatexNoise(text: string): boolean {
  return /\\[a-zA-Z]+|\$|\\frac|\\sqrt/.test(text);
}

function normalizeQuestion(q: QuizQuestion): QuizQuestion | null {
  const question = String(q.question ?? "").trim();
  const options = Array.isArray(q.options)
    ? q.options.map((opt) => String(opt ?? "").trim())
    : [];

  if (!question) return null;
  if (options.length !== 4) return null;
  if (options.some((opt) => !opt)) return null;
  if (typeof q.correctOptionIndex !== "number") return null;
  if (q.correctOptionIndex < 0 || q.correctOptionIndex > 3) return null;

  return {
    question,
    options,
    correctOptionIndex: q.correctOptionIndex,
    explanation: q.explanation?.trim() || undefined,
  };
}

function sanitizeQuestion(q: QuizQuestion): QuizQuestion | null {
  const normalized = normalizeQuestion(q);
  if (!normalized) return null;

  const originalJoined = [
    normalized.question,
    ...normalized.options,
    normalized.explanation ?? "",
  ].join(" ");

  if (hasLatexNoise(originalJoined)) return null;

  return {
    question: plainTextify(normalized.question),
    options: normalized.options.map(plainTextify),
    correctOptionIndex: normalized.correctOptionIndex,
    explanation: normalized.explanation ? plainTextify(normalized.explanation) : undefined,
  };
}

function cleanQuestionsForStorage(questions: QuizQuestion[]): QuizQuestion[] {
  return questions
    .map(sanitizeQuestion)
    .filter((q): q is QuizQuestion => Boolean(q));
}

function shuffleQuestionOptions(q: QuizQuestion): QuizQuestion {
  const items = q.options.map((option, originalIndex) => ({
    option,
    originalIndex,
  }));

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  const correctIndex = items.findIndex(
    (item) => item.originalIndex === q.correctOptionIndex
  );

  return {
    ...q,
    options: items.map((item) => item.option),
    correctOptionIndex: correctIndex >= 0 ? correctIndex : q.correctOptionIndex,
  };
}

function finalizeQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return cleanQuestionsForStorage(questions).map(shuffleQuestionOptions);
}

function toRenderableQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return cleanQuestionsForStorage(questions);
}

const CATEGORY_PROMPTS: Record<string, string> = {
  engineering: `
CATEGORY: Engineering Admission (BUET, CUET, RUET, KUET, DUET standard)
- Focus: Physics (mechanics, electricity, optics, modern physics), Chemistry (organic, inorganic, physical), Mathematics (calculus, vectors, trigonometry), ICT
- Difficulty: High — university entrance level
- Include: numerical calculations with exact values, conceptual trap questions
- Physics/Chemistry: equations, formulas, unit conversions must be exact
- Math: step-by-step solvable within 2 minutes
`,
  medical: `
CATEGORY: Medical Admission (MBBS/BDS Bangladesh standard)
- Focus: Biology (cell biology, genetics, physiology, anatomy, ecology), Chemistry (organic reactions, biochemistry), Physics (basic)
- Difficulty: High — MBBS entrance level
- Include: anatomical facts, physiological processes, biochemical pathways, genetic problems
- Biological nomenclature must be accurate (Latin/scientific names where needed)
- Avoid vague options — each wrong option must be a plausible misconception
`,
  varsity: `
CATEGORY: University Admission (DU, RU, CU, JU, NSU, BRAC standard)
- Focus: Subject-specific analytical questions, reading comprehension, general knowledge, critical thinking
- Difficulty: Medium-High — general university entrance level
- Include: analytical reasoning, current affairs, subject theory questions
- Test deeper understanding, not surface memorization
`,
  hsc: `
CATEGORY: HSC / A-Level standard
- Focus: Core HSC curriculum — Physics, Chemistry, Biology, Math, Bangla, English, ICT
- Difficulty: Medium — HSC board exam level
- Include: chapter-specific conceptual questions, formula-based problems
- Align with NCTB Bangladesh curriculum
`,
  ssc: `
CATEGORY: SSC / O-Level standard
- Focus: Core SSC curriculum subjects
- Difficulty: Medium — SSC board exam level
- Align with NCTB Bangladesh curriculum for classes 9-10
`,
  general: `
CATEGORY: General Knowledge / Mixed
- Include diverse topics: science, history, geography, current affairs, language, mathematics
- Difficulty: Medium — suitable for competitive exams (BCS, bank jobs)
- Test both factual knowledge and reasoning
`,
};

async function generateQuestionsFromMessages(
  messages: AIMessage[],
  count: number,
  language: string,
  category: string,
  existingQuestions: QuizQuestion[] = []
): Promise<QuizQuestion[]> {
  const catPrompt = CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS["general"];

  const existingCtx =
    existingQuestions.length > 0
      ? `\n\nDo NOT repeat these questions (already exist):\n${existingQuestions
          .slice(-20)
          .map((q) => `- ${q.question}`)
          .join("\n")}`
      : "";

  const systemMsg: AIMessage = {
    role: "system",
    content: `You are an expert quiz creator for Bangladesh academic and competitive exams.
Generate exactly ${count} multiple choice questions from the provided content.
Output language: ${language}.

${catPrompt}

STRICT RULES:
1. Each question MUST have exactly 4 options (A, B, C, D)
2. correctOptionIndex is 0-based (0=A, 1=B, 2=C, 3=D) — VERIFY THIS IS CORRECT before outputting
3. The correct answer MUST be factually/scientifically accurate — double-check numerical answers
4. All 3 wrong options must be plausible distractors (common misconceptions or close values), NOT random
5. explanation must clearly explain WHY the correct answer is right and why others are wrong (in ${language})
6. Questions must test UNDERSTANDING, not just memory
7. For numerical problems: show the correct calculated value in explanation
8. NEVER make the correct option obviously different in length/style from wrong options
9. Randomize the order of options for every question so the correct answer does not stay in the same position repeatedly
10. Keep the correct answer factually accurate after randomization
11. Output ONLY a valid JSON array — no markdown, no extra text, no comments
12. Do NOT use LaTeX, TeX, Markdown math, or dollar signs.
13. Write all formulas in plain text only, like x^2, sqrt(x), pi, dx/dy.
14. Every question must be directly answerable from the provided content.
15. If the answer is uncertain, do not generate that question.

Return format:
[{"question":"...","options":["A text","B text","C text","D text"],"correctOptionIndex":0,"explanation":"..."}]
${existingCtx}`,
  };

  const callMessages: AIMessage[] = [systemMsg, ...messages];

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 16000,
    temperature: 0.5,
    messages: callMessages,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";

  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
if (!jsonMatch) {
  console.log("AI gave invalid format, retrying...");
  
  // retry once
  const retryResponse = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 8000,
    temperature: 0.3,
    messages: messages,
  });

  const retryRaw = retryResponse.choices[0]?.message?.content ?? "[]";
  const retryMatch = retryRaw.match(/\[[\s\S]*\]/);

  if (!retryMatch) return [];

  jsonStr = retryMatch[0];
}
  let jsonStr = jsonMatch[0];

  jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  jsonStr = jsonStr.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");

  let parsed: QuizQuestion[];
  try {
    parsed = JSON.parse(jsonStr) as QuizQuestion[];
  } catch {
    const objMatches = jsonStr.match(/\{[^{}]*"question"[^{}]*\}/g) ?? [];
    parsed = [];
    for (const objStr of objMatches) {
      try {
        parsed.push(JSON.parse(objStr) as QuizQuestion);
      } catch {}
    }
  }
  const unique = new Set();

  parsed = parsed.filter(q => {
    const key = q.question.replace(/\s+/g, "").toLowerCase();
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });

  return finalizeQuestions(parsed);
}

router.get("/quizzes", async (req, res) => {
  const quizzes = await db.select().from(quizzesTable).orderBy(quizzesTable.createdAt);
  res.json(quizzes.map(formatQuiz));
});

router.get("/quizzes/stats", async (req, res) => {
  const all = await db.select().from(quizzesTable).orderBy(quizzesTable.createdAt);
  const totalQuizzes = all.length;
  const totalQuestions = all.reduce((s, q) => s + (q.questionCount ?? 0), 0);
  const postedToTelegram = all.filter((q) => q.postedToTelegram).length;
  const recentQuizzes = all.slice(-5).reverse().map(formatQuiz);
  res.json({ totalQuizzes, totalQuestions, postedToTelegram, recentQuizzes });
});

router.post("/quizzes", async (req, res) => {
  const parsed = GenerateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const { content = "", title, imageBase64, questionCount = 5, language = "Bengali" } = parsed.data;
  const category = (req.body as Record<string, string>).category ?? "general";

  if (!content.trim() && !imageBase64) {
    res.status(400).json({ error: "Please provide text content or an image." });
    return;
  }

  try {
    const userText = content?.trim()
      ? `Generate quiz questions from this content:\n\n${content}`
      : `Generate quiz questions from the image.`;

    const baseUserContent: AIMessage["content"] = imageBase64 && AI_SUPPORTS_VISION
      ? [
          { type: "text" as const, text: userText },
          { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ]
      : userText;

    const userMessage: AIMessage = { role: "user", content: baseUserContent };

    const BATCH = 20;
    let allQuestions: QuizQuestion[] = [];

    if (questionCount <= BATCH) {
      allQuestions = await generateQuestionsFromMessages([userMessage], questionCount, language, category, []);
    } else {
      let batchNum = 0;
      while (allQuestions.length < questionCount) {
        const remaining = questionCount - allQuestions.length;
        const batchSize = Math.min(BATCH, remaining);

        const batchUserContent: AIMessage["content"] = imageBase64
          ? [
              {
                type: "text" as const,
                text: `Generate ${batchSize} quiz questions (batch ${batchNum + 1}) from this content:\n\n${content || "the image"}`,
              },
              { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ]
          : `Generate ${batchSize} quiz questions (batch ${batchNum + 1}) from this content:\n\n${content}`;

        const batchMsg: AIMessage = { role: "user", content: batchUserContent };
        const batchResult = await generateQuestionsFromMessages([batchMsg], batchSize, language, category, allQuestions);
        allQuestions = [...allQuestions, ...batchResult];
        batchNum++;
        if (batchResult.length === 0) {
          console.log("Batch failed, retrying once...");
  
          const retry = await generateQuestionsFromMessages(
            [batchMsg],
            batchSize,
            language,
            category,
            allQuestions
          );

          if (retry.length === 0) break;

          allQuestions = [...allQuestions, ...retry];
        }
      }
    }

    allQuestions = finalizeQuestions(allQuestions);

    if (!allQuestions || allQuestions.length === 0) {
      res.status(500).json({ error: "AI returned no questions. Try with more detailed content." });
      return;
    }

    const quizTitle = title || `Quiz - ${new Date().toLocaleDateString("bn-BD")}`;
    const [quiz] = await db
      .insert(quizzesTable)
      .values({
        title: quizTitle,
        sourceContent: content,
        questions: allQuestions,
        questionCount: allQuestions.length,
        postedToTelegram: false,
      })
      .returning();

    res.status(201).json(formatQuiz(quiz));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Quiz generation failed");

    if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      res.status(504).json({ error: "Request timed out. Try fewer questions or smaller image." });
      return;
    }

    if (message.includes("All AI providers exhausted") || message.includes("rate-limited")) {
      res.status(503).json({
        error: "All AI keys are exhausted or rate-limited right now. Please try again later.",
      });
      return;
    }

    res.status(500).json({ error: "Quiz generation failed: " + message });
  }
});

router.post("/quizzes/:id/add-questions", async (req, res) => {
  const idNum = parseInt(req.params.id ?? "0", 10);
  if (!idNum) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { additionalCount = 5, language = "Bengali", category = "general" } = req.body as {
    additionalCount?: number;
    language?: string;
    category?: string;
  };

  const count = Math.max(1, Math.min(50, Number(additionalCount) || 5));

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, idNum));
  if (!quiz) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const existingQuestions = toRenderableQuestions((quiz.questions ?? []) as QuizQuestion[]);
    const sourceContent = quiz.sourceContent ?? "";

    const userText = sourceContent.trim()
      ? `Generate more quiz questions from this content:\n\n${sourceContent}`
      : `Generate ${count} more diverse quiz questions on the same topics as these existing questions.`;

    const userMessage: AIMessage = { role: "user", content: userText };

    const BATCH = 20;
    let newQuestions: QuizQuestion[] = [];

    if (count <= BATCH) {
      newQuestions = await generateQuestionsFromMessages([userMessage], count, language, category, existingQuestions);
    } else {
      let batchNum = 0;
      const allExisting = [...existingQuestions];
      while (newQuestions.length < count) {
        const remaining = count - newQuestions.length;
        const batchSize = Math.min(BATCH, remaining);
        const batchMsg: AIMessage = {
          role: "user",
          content: `Generate more quiz questions (batch ${batchNum + 1}) from this content:\n\n${sourceContent}`,
        };
        const batchResult = await generateQuestionsFromMessages([batchMsg], batchSize, language, category, [
          ...allExisting,
          ...newQuestions,
        ]);
        newQuestions = [...newQuestions, ...batchResult];
        batchNum++;
        if (batchResult.length === 0) break;
      }
    }

    newQuestions = finalizeQuestions(newQuestions);

    if (newQuestions.length === 0) {
      return res.json({
        addedCount: 0,
        warning: "AI couldn't generate new questions"
      });
    }

    const merged = finalizeQuestions([...existingQuestions, ...newQuestions]);

    const [updated] = await db
      .update(quizzesTable)
      .set({ questions: merged, questionCount: merged.length, updatedAt: new Date() })
      .where(eq(quizzesTable.id, idNum))
      .returning();

    res.json({ ...formatQuiz(updated), addedCount: newQuestions.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Add questions failed");
    res.status(500).json({ error: "Failed to generate questions: " + message });
  }
});

router.get("/quizzes/:id", async (req, res) => {
  const parsed = GetQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, parsed.data.id));
  if (!quiz) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatQuiz(quiz));
});

router.put("/quizzes/:id", async (req, res) => {
  const paramsParsed = UpdateQuizParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = UpdateQuizBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (bodyParsed.data.title) updates.title = bodyParsed.data.title;

  if (bodyParsed.data.questions) {
    const normalizedQuestions = cleanQuestionsForStorage(bodyParsed.data.questions as QuizQuestion[]);
    updates.questions = normalizedQuestions;
    updates.questionCount = normalizedQuestions.length;
  }

  const [quiz] = await db.update(quizzesTable).set(updates).where(eq(quizzesTable.id, paramsParsed.data.id)).returning();
  if (!quiz) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatQuiz(quiz));
});

router.delete("/quizzes/:id", async (req, res) => {
  const parsed = DeleteQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(quizzesTable).where(eq(quizzesTable.id, parsed.data.id));
  res.status(204).send();
});

router.post("/quizzes/:id/mark-posted", async (req, res) => {
  const parsed = GetQuizParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { channelId } = req.body as { channelId?: string };
  await db.update(quizzesTable)
    .set({ postedToTelegram: true, telegramChannel: channelId ?? null, updatedAt: new Date() })
    .where(eq(quizzesTable.id, parsed.data.id));
  res.json({ success: true });
});

router.post("/quizzes/:id/post-to-telegram", async (req, res) => {
  const paramsParsed = PostQuizToTelegramParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = PostQuizToTelegramBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, paramsParsed.data.id));
  if (!quiz) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { botToken, channelId, questionIndex } = bodyParsed.data;
  const questions = quiz.questions as QuizQuestion[];
  const toPost = questionIndex != null ? [questions[questionIndex]].filter(Boolean) : questions;

  const messageIds: number[] = [];
  for (const q of toPost) {
    const payload = {
      chat_id: channelId,
      question: plainTextify(q.question),
      options: q.options.map((o) => plainTextify(o)),
      type: "quiz",
      correct_option_id: q.correctOptionIndex,
      explanation: q.explanation ? plainTextify(q.explanation) : undefined,
      is_anonymous: true,
    };

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPoll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await resp.json()) as { ok: boolean; result?: { message_id: number } };
    if (!data.ok) {
      res.status(400).json({ error: `Telegram error: ${JSON.stringify(data)}` });
      return;
    }
    if (data.result) messageIds.push(data.result.message_id);
  }

  await db.update(quizzesTable)
    .set({ postedToTelegram: true, telegramChannel: channelId, updatedAt: new Date() })
    .where(eq(quizzesTable.id, paramsParsed.data.id));

  res.json({ success: true, postedCount: messageIds.length, messageIds });
});

router.get("/quizzes/:id/export", async (req, res) => {
  const paramsParsed = ExportQuizParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const queryParsed = ExportQuizQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, paramsParsed.data.id));
  if (!quiz) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const questions = toRenderableQuestions((quiz.questions ?? []) as QuizQuestion[]);
  const format = queryParsed.data.format;

  if (format === "json") {
    const data = JSON.stringify({ title: quiz.title, questions }, null, 2);
    res.json({ data, filename: `${quiz.title}.json`, format });
  } else {
    const rows = ["Question,Option A,Option B,Option C,Option D,Correct Answer,Explanation"];
    for (const q of questions) {
      const opts = q.options.map((o) => `"${o.replace(/"/g, '""')}"`);
      while (opts.length < 4) opts.push('""');
      const correct = q.options[q.correctOptionIndex] ?? "";
      const exp = q.explanation ? `"${q.explanation.replace(/"/g, '""')}"` : '""';
      rows.push([`"${q.question.replace(/"/g, '""')}"`, ...opts.slice(0, 4), `"${correct}"`, exp].join(","));
    }
    res.json({ data: rows.join("\n"), filename: `${quiz.title}.csv`, format });
  }
});

function formatQuiz(quiz: typeof quizzesTable.$inferSelect) {
  const questions = toRenderableQuestions((quiz.questions ?? []) as QuizQuestion[]);
  return {
    id: quiz.id,
    title: quiz.title,
    sourceContent: quiz.sourceContent,
    questions,
    questionCount: quiz.questionCount,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
    postedToTelegram: quiz.postedToTelegram,
    telegramChannel: quiz.telegramChannel ?? null,
  };
}

export default router;
