import { Router } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import quizzesRouter from "./quizzes";
import telegramRouter from "./telegram";
import clientErrorsRouter from "./client-errors";
import { attachUser } from "../lib/auth";

const router = Router();

router.use(attachUser);        // populates req.user when a valid token is present

router.use(healthRouter);      // → /health
router.use(authRouter);        // → /auth/...
router.use(adminRouter);       // → /admin/... (admin only, 404 otherwise)
router.use(quizzesRouter);     // → /quizzes/...
router.use(telegramRouter);    // → /telegram/...
router.use(clientErrorsRouter); // → /client-errors

export default router;
