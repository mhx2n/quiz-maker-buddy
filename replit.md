# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### quiz-generator (React + Vite, preview: `/`)
Telegram Quiz Generator web app. Features:
- AI quiz generation from text or images (Bengali + English OCR via Tesseract.js)
- 6 category selector: Engineering (BUET), Medical (MBBS), Varsity, HSC, SSC, General
- PDF export: smart page slicing (no question cuts), 2-column/1-column layout, 5 themes, Bengali font
- CSV export with 5-option format matching probaho export standard (BOM-encoded UTF-8)
- JSON export with full metadata
- Per-channel Telegram settings in localStorage (key: tg_channels_v3)
  - Each channel stores: botToken, postDelay, questionPrefix, explanationSuffix, intro, pinIntro, deleteService, sendScore
  - Saved channels shown as clickable badges; hover to delete
  - Settings auto-load from last-used channel on mount
- Telegram posting: intro message with HTML, photo upload, pin + delete service message, score message
- Bot token validation via Telegram API
- Individual question editing with correct answer selector
- Generate more questions (add to existing quiz)
- Mobile-friendly with bottom navigation bar

### api-server (Express 5, preview: `/api`)
REST API backend. Routes:
- `GET /api/quizzes` — list all quizzes
- `GET /api/quizzes/stats` — dashboard statistics
- `POST /api/quizzes` — generate quiz (AI via gpt-4o-mini)
- `GET /api/quizzes/:id` — get quiz
- `PUT /api/quizzes/:id` — update quiz title/questions
- `DELETE /api/quizzes/:id` — delete quiz
- `POST /api/quizzes/:id/mark-posted` — mark quiz as posted to Telegram
- `POST /api/quizzes/:id/add-questions` — generate additional questions
- `POST /api/quizzes/:id/post-to-telegram` — server-side Telegram posting
- `POST /api/telegram/validate-bot` — validate bot token

## AI Model
- Uses `gpt-4o-mini` (free-tier-friendly, cost-efficient)
- Category-specific prompts: engineering, medical, varsity, hsc, ssc, general
- Robust JSON parsing: control-char cleanup, backslash fix, trailing-comma removal, per-object fallback

## Deployment
- **Replit**: Use the Deploy button (hosted with full backend + DB)
- **Vercel (frontend only)**: `vercel.json` at root — update `YOUR_BACKEND.replit.app` to deployed Replit URL
- **GitHub**: `git remote add origin <url> && git push -u origin main` from Shell

## Key Libraries
- `jspdf` — PDF generation
- `html2canvas` — DOM-to-image for PDF rendering (Bengali Unicode)
- `tesseract.js` — browser-based OCR (Bengali + English)
- `drizzle-orm` + PostgreSQL — database
- `@workspace/integrations-openai-ai-server` — AI quiz generation via gpt-4o-mini
