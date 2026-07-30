import { Router } from "express";
import { ValidateTelegramBotBody } from "@workspace/api-zod";

const router = Router();

router.post("/telegram/validate-bot", async (req, res) => {
  const parsed = ValidateTelegramBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { botToken } = parsed.data;
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const data = await resp.json() as { ok: boolean; result?: { username: string; first_name: string } };
  if (!data.ok) {
    res.json({ valid: false, username: null, firstName: null });
    return;
  }
  res.json({
    valid: true,
    username: data.result?.username ?? null,
    firstName: data.result?.first_name ?? null,
  });
});

export default router;
