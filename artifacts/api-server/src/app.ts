import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { reportError } from "./lib/notify";

const app: Express = express();

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Telegram Quiz Creator API",
  });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Allow all origins — needed for Vercel (frontend) → Render (backend) cross-domain calls
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/api", router);

// ── Global error handler: nothing escapes without reaching the owner group ──
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: error }, "Unhandled request error");

  void reportError({
    source: "server",
    message: error.message,
    stack: error.stack ?? null,
    userId: req.user?.id ?? null,
    context: {
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      email: req.user?.email,
    },
  });

  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong. The team has been notified." });
});

export default app;
