# Telegram Quiz Generator

A full-featured web app to generate Telegram anonymous quiz polls from text or images using AI.

## Features

- **AI Quiz Generation** — Paste text or upload a page photo, AI generates MCQ questions
- **OCR Support** — Bengali & English text extraction from images (Tesseract.js)
- **Telegram Integration** — Post quizzes as anonymous polls to any channel
- **Advanced Export** — PDF (formatted), CSV (5-option format), JSON (structured)
- **Question Editing** — Edit individual questions after generation
- **Settings Persistence** — Bot token & channel saved locally
- **Mobile Friendly** — Bottom navigation bar, responsive design

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS |
| Backend | Express 5 + Node.js |
| Database | PostgreSQL (Drizzle ORM) |
| AI | OpenAI GPT-4o (vision + text) |
| OCR | Tesseract.js (browser-based) |
| PDF | jsPDF |

---

## Local Development

### Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL database (local or [Neon](https://neon.tech) free tier)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and OPENAI_API_KEY

# 4. Push database schema
pnpm --filter @workspace/db run push

# 5. Start development servers
# Terminal 1 — API server
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/quiz-generator run dev
```

Open http://localhost:3000

---

## Vercel Deployment (Free)

### Step 1 — Set up free database (Neon)

1. Go to [neon.tech](https://neon.tech) → Sign up free
2. Create a new project
3. Copy the **Connection string** (looks like `postgresql://...`)
4. Run schema migration locally: `pnpm --filter @workspace/db run push`

### Step 2 — Deploy Frontend to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import your GitHub repo
3. Set these environment variables in Vercel dashboard:
   - `VITE_API_URL` = your API server URL (see Step 3)
4. Deploy — Vercel uses `vercel.json` automatically

### Step 3 — Deploy API to Render (Free)

The backend needs a server runtime. Use [Render](https://render.com) free tier:

1. Go to [render.com](https://render.com) → New Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build Command**: `pnpm install && pnpm --filter @workspace/api-server run build`
   - **Start Command**: `node artifacts/api-server/dist/index.mjs`
   - **Environment**: Node
4. Add environment variables:
   - `DATABASE_URL` = your Neon connection string
   - `OPENAI_API_KEY` = your OpenAI key
   - `PORT` = `10000`
   - `NODE_ENV` = `production`

### Step 4 — Connect Frontend to Backend

In your Vercel project settings, add:
- `VITE_API_URL` = your Render API URL (e.g. `https://your-app.onrender.com`)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key for quiz generation |
| `PORT` | Yes | Server port (auto-set by hosting) |
| `NODE_ENV` | No | `development` or `production` |

---

## How to Use

1. **Create Quiz** → Paste text or upload a photo of a page
2. **OCR** → Click "Extract Text" to read text from the image
3. **Generate** → Set question count (1-50) and language
4. **Export** → Download as PDF, CSV, or JSON
5. **Post** → Enter your Telegram bot token and channel, click Post

### Telegram Bot Setup
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the token
4. Add the bot as **Admin** to your channel
5. Use the token in the app

---

## License

MIT
