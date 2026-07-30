// artifacts/api-server/src/routes/health.ts
import { Router } from "express";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
