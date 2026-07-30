import { Router } from "express";
import healthRouter from "./health";
import quizzesRouter from "./quizzes";
import telegramRouter from "./telegram";

const router = Router();

router.use(healthRouter);      // → /health
router.use(quizzesRouter);     // → /quizzes/...
router.use(telegramRouter);    // → /telegram/...

export default router;
