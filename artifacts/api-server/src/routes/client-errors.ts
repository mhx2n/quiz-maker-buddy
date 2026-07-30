import { Router } from "express";
import { z } from "zod";
import { reportError } from "../lib/notify";

const router = Router();

const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional().nullable(),
  url: z.string().max(500).optional(),
  kind: z.string().max(60).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** The frontend pipes every uncaught error / failed request here. */
router.post("/client-errors", async (req, res) => {
  const parsed = clientErrorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  await reportError({
    source: "client",
    level: "error",
    message: parsed.data.message,
    stack: parsed.data.stack ?? null,
    userId: req.user?.id ?? null,
    context: {
      kind: parsed.data.kind ?? "window.error",
      url: parsed.data.url,
      email: req.user?.email,
      userAgent: req.headers["user-agent"],
      ...(parsed.data.extra ?? {}),
    },
  });

  res.json({ ok: true });
});

export default router;
