# সম্পূর্ণ বিনামূল্যে Deploy করুন

## Stack (সব Free)

| Service | কাজ | Free Limit |
|---|---|---|
| **Groq** | AI (llama-3.3-70b) | Free unlimited |
| **Neon.tech** | PostgreSQL Database | 512MB forever |
| **Render.com** | Express Backend | 750h/month (web service) |
| **Vercel** | React Frontend | Unlimited |
| **GitHub** | Code | Free |

---

## ধাপ ১ — Groq API Key (AI, বিনামূল্যে)

1. যান: https://console.groq.com → Sign up
2. **API Keys** → **Create API Key**
3. Key কপি করুন (যেমন: `gsk_xxxxxxxxxxxxxxxxx`)

---

## ধাপ ২ — Neon Database (PostgreSQL, বিনামূল্যে)

1. যান: https://neon.tech → Sign up (GitHub দিয়ে)
2. **New Project** → নাম দিন → **Create Project**
3. **Connection String** কপি করুন:
   ```
   postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
4. এটাই আপনার `DATABASE_URL`

---

## ধাপ ৩ — Render.com Backend (বিনামূল্যে)

1. যান: https://render.com → Sign up with GitHub
2. **New** → **Web Service**
3. GitHub repo connect করুন: `mhx2n/Telegram-Quiz-Creator`
4. Settings:
   - **Name**: `telegram-quiz-api`
   - **Root Directory**: *(খালি রাখুন)*
   - **Build Command**: `pnpm install && pnpm --filter @workspace/api-server run build`
   - **Start Command**: `node --enable-source-maps ./artifacts/api-server/dist/index.mjs`
   - **Instance Type**: Free
5. **Environment Variables** যোগ করুন:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `10000` |
   | `DATABASE_URL` | *(Neon connection string)* |
   | `GROQ_API_KEY` | *(Groq API key)* |
6. **Create Web Service** → Deploy হবে

Deploy শেষে URL পাবেন: `https://telegram-quiz-api.onrender.com`

---

## ধাপ ৪ — vercel.json Update করুন

`vercel.json` ফাইলে Render URL বসান:

```json
{ "source": "/api/(.*)", "destination": "https://telegram-quiz-api.onrender.com/api/$1" }
```

তারপর Replit Shell-এ:
```
git push origin main
```

---

## ধাপ ৫ — Vercel Frontend (বিনামূল্যে)

1. যান: https://vercel.com → Sign up with GitHub
2. **New Project** → `Telegram-Quiz-Creator` repo
3. Root Directory: *(খালি, repo root)*
4. **Deploy** → Done!

---

## সমস্যা সমাধান

**Render app ধীর?** — Free tier 15 মিনিট inactive থাকলে ঘুমিয়ে যায়। প্রথম request-এ 30-60 সেকেন্ড লাগবে।

**DB connection error?** — Neon URL-এ `?sslmode=require` আছে কিনা দেখুন।

**AI error?** — Groq key ঠিকঠাক আছে কিনা দেখুন।
