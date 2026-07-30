# Cloudflare + Render ডিপ্লয়মেন্ট গাইড (সম্পূর্ণ ফ্রি)

> এই গাইডটি ধাপে ধাপে অনুসরণ করুন। প্রতিটা ধাপ শেষ করে পরের ধাপে যান।

## স্থাপত্য (Architecture)

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  Cloudflare     │     │  Render (Free)        │     │  Neon (Free)  │
│  Pages          │────▶│  Express API Server   │────▶│  PostgreSQL   │
│  (Frontend/React)│    │  + Telegram Bot       │     │  512MB        │
│  স্ট্যাটিক ফাইল   │     │  Node.js দরকার         │     └──────────────┘
└─────────────────┘     │                       │
                        │  ┌──────────────────┐  │     ┌──────────────┐
                        │  │ MongoDB Atlas     │  │     │ MongoDB Atlas │
                        │  │ (ব্যাকআপ, ফ্রি)     │──┼────▶│ (Free 512MB)  │
                        │  └──────────────────┘  │     └──────────────┘
                        └───────────────────────┘
```

**কেন পুরোটা Cloudflare-এ নয়?**
- Frontend (React) স্ট্যাটিক ফাইল → Cloudflare Pages-এ চলবে ✅
- Backend (Express API + Telegram Bot) Node.js সার্ভার দরকার → Cloudflare Workers এ Express চলে না ❌ (Workers runtime আলাদা, কোনো `http.Server` নেই)
- Telegram Bot long-polling চালাতে একটা সার্ভার ২৪/৭ চলতে হবে → Render-এ চলবে ✅

---

## ধাপ ১ — GitHub-এ কোড পুশ করুন

আপনার কোড যদি ইতিমধ্যে GitHub-এ থাকে (mhx2n/Telegram-Quiz-Creator), তবে সব পরিবর্তন push করুন:

```bash
git add -A
git commit -m "Add Cloudflare Pages SPA config + deployment setup"
git push origin main
```

> যদি লোকালে কাজ করেন, নিশ্চিত করুন যে `artifacts/quiz-generator/public/_redirects` ফাইলটা push হয়েছে।

---

## ধাপ ২ — Neon Database (PostgreSQL, ফ্রি)

1. ব্রাউজারে যান: **https://neon.tech**
2. **Sign up** → GitHub দিয়ে লগইন করুন
3. **New Project** → নাম দিন (যেমন `quiz-db`) → Region বাছুন → **Create**
4. Dashboard-এ গিয়ে **Connection String** কপি করুন:
   ```
   postgresql://user:password@ep-xxxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
5. এটি সেভ করে রাখুন — পরে দরকার হবে।

---

## ধাপ ৩ — MongoDB Atlas (ব্যাকআপ, ফ্রি)

1. ব্রাউজারে যান: **https://www.mongodb.com/cloud/atlas/register**
2. সাইন আপ করুন (ফ্রি)
3. **Create** → **M0 Free** cluster তৈরি করুন
4. Database Access-এ একটা user বানান (username + password)
5. Network Access-এ **Allow access from anywhere** (`0.0.0.0/0`) দিন
6. **Connect** → **Drivers** → Connection string কপি করুন:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. এটি সেভ করে রাখুন।

---

## ধাপ ৪ — Groq / Mistral / Gemini API Key (AI এর জন্য, ফ্রি)

> এগুলো এখন অ্যাড করতে হবে না — অ্যাডমিন প্যানেল থেকে পরেও যোগ করতে পারবেন। তবে কমপক্ষে একটা দিয়ে শুরু করা ভালো।

**Groq (ফ্রি, সবচেয়ে দ্রুত):**
1. যান: **https://console.groq.com** → Sign up
2. **API Keys** → **Create API Key** → কপি করুন

---

## ধাপ ৫ — Telegram Bot তৈরি করুন (এরর নোটিফিকেশন ও এক্সেস কোডের জন্য)

### ৫.ক — বট তৈরি
1. Telegram-এ **@BotFather** খুলুন
2. `/newbot` পাঠান
3. নাম দিন (যেমন `Quiz Error Monitor Bot`)
4. Username দিন (যেমন `quiz_error_bot`)
5. আপনি একটা **Bot Token** পাবেন — সেভ করুন:
   ```
   1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### ৫.খ — প্রাইভেট গ্রুপ তৈরি ও বট এড করুন
1. Telegram-এ একটা **নতুন গ্রুপ** বানান (প্রাইভেট)
2. গ্রুপে আপনার বটকে **Add Member** করে এড করুন
3. গ্রুপে বটকে **Admin** করে দিন (এতে বট মেসেজ পাঠাতে পারবে)
4. গ্রুপে যেকোনো একটা মেসেজ পাঠান
5. ব্রাউজারে এই URL খুলুন (আপনার বট টোকেন বসিয়ে):
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
6. JSON রেসপন্স থেকে `"chat":{"id":-1001234567890}` খুঁজে বের করুন
7. এই **Group Chat ID** সেভ করুন (নেগেটিভ সাইন সহ)

---

## ধাপ ৬ — Render-এ Backend + Bot ডিপ্লয় করুন (ফ্রি)

1. যান: **https://render.com** → GitHub দিয়ে Sign up
2. **New** → **Web Service**
3. আপনার GitHub repo কানেক্ট করুন: `mhx2n/Telegram-Quiz-Creator`
4. সেটিংস পূরণ করুন:

   | ফিল্ড | মান |
   |---|---|
   | **Name** | `telegram-quiz-api` |
   | **Root Directory** | *(খালি রাখুন — repo root)* |
   | **Runtime** | Node |
   | **Build Command** | `pnpm install && pnpm --filter @workspace/api-server run build` |
   | **Start Command** | `node --enable-source-maps ./artifacts/api-server/dist/index.mjs` |
   | **Instance Type** | Free |

5. **Environment Variables** যোগ করুন (Advanced → Environment):

   | Key | Value | কোথা থেকে পাবেন |
   |---|---|---|
   | `NODE_ENV` | `production` | — |
   | `PORT` | `10000` | — |
   | `DATABASE_URL` | `postgresql://...` | ধাপ ২ (Neon) |
   | `JWT_SECRET` | যেকোনো লম্বা র্যান্ডম স্ট্রিং | `openssl rand -hex 32` চালান |
   | `ADMIN_EMAIL` | আপনার ইমেইল | প্রথম রেজিস্টার হওয়া ইউজার admin হবে |
   | `TELEGRAM_ERROR_BOT_TOKEN` | বট টোকেন | ধাপ ৫.ক |
   | `TELEGRAM_ERROR_GROUP_ID` | `-1001234567890` | ধাপ ৫.খ |
   | `MONGODB_URI` | `mongodb+srv://...` | ধাপ ৩ (MongoDB Atlas) |
   | `GROQ_API_KEY` | `gsk_xxx...` | ধাপ ৪ (অপশনাল, পরেও দিতে পারেন) |

6. **Create Web Service** → Deploy শুরু হবে
7. ডিপ্লয় শেষ হলে URL পাবেন:
   ```
   https://telegram-quiz-api.onrender.com
   ```
8. ব্রাউজারে যান: `https://telegram-quiz-api.onrender.com/api/health` —
   `{"status":"ok"}` দেখলে ঠিক আছে।

> ⚠️ Render ফ্রি টায়ারে ১৫ মিনিট কোনো রিকোয়েস্ট না এলে সার্ভার ঘুমিয়ে যায়। প্রথম রিকোয়েস্টে ৩০-৬০ সেকেন্ড লাগবে। এটা স্বাভাবিক।

---

## ধাপ ৭ — Cloudflare Pages-এ Frontend ডিপ্লয় করুন (ফ্রি)

1. যান: **https://dash.cloudflare.com** → Sign up / Login
2. বাঁ পাশের মেনু থেকে **Workers & Pages** → **Create** → **Pages** ট্যাব
3. **Connect to Git** → GitHub অ্যাকাউন্ট কানেক্ট করুন
4. রিপোজিটরি বাছুন: `mhx2n/Telegram-Quiz-Creator`
5. **Begin setup** → সেটিংস পূরণ করুন:

   | ফিল্ড | মান |
   |---|---|
   | **Project name** | `telegram-quiz-creator` |
   | **Production branch** | `main` |
   | **Framework preset** | `None` (ম্যানুয়াল) |
   | **Build command** | `pnpm install && pnpm --filter @workspace/quiz-generator run build` |
   | **Build output directory** | `artifacts/quiz-generator/dist/public` |
   | **Root directory** | *(খালি — repo root)* |

6. **Environment variables** (Settings → Environment variables সেকশনে) যোগ করুন:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | `https://telegram-quiz-api.onrender.com` |
   | `NODE_VERSION` | `20` |

   > `VITE_API_URL` = ধাপ ৬-এ পাওয়া Render URL (শেষে `/` দেবেন না)

7. **Save and Deploy** → বিল্ড শুরু হবে
8. বিল্ড শেষে URL পাবেন:
   ```
   https://telegram-quiz-creator.pages.dev
   ```

### SPA রাউটিং (অটোমেটিক)
`artifacts/quiz-generator/public/_redirects` ফাইলে ইতিমধ্যে সেট করা আছে:
```
/*    /index.html    200
```
এটি নিশ্চিত করে যে যেকোনো রাউট (যেমন `/secure-admin-login`) সরাসরি খুললেও `index.html` লোড হবে।

---

## ধাপ ৮ — টেস্ট করুন

1. Cloudflare URL খুলুন: `https://telegram-quiz-creator.pages.dev`
2. লগইন পেজ দেখাবে
3. **Register** করুন — ইমেইল দিন (ADMIN_EMAIL হিসেবে যেটা Render-এ সেট করেছেন)
4. প্রথম রেজিস্টার হওয়া ইউজার স্বয়ংক্রিয়ভাবে **admin** হবে
5. **Hidden Admin Login** খুলুন: `https://telegram-quiz-creator.pages.dev/secure-admin-login`
6. অ্যাডমিন প্যানেল খুলুন: `https://telegram-quiz-creator.pages.dev/control-room`
7. অ্যাডমিন প্যানেলে যান → **Platform Settings** ট্যাব → টেলিগ্রাম বট টোকেন ও গ্রুপ ID সেট করুন
8. **AI Keys** ট্যাবে গিয়ে API key যোগ করুন (Groq/Mistral/Gemini)
9. **Access Codes** ট্যাবে গিয়ে ইউজারদের জন্য ইউনিক কোড জেনারেট করুন

---

## ধাপ ৯ — এক্সেস কোড সিস্টেম

ইউজাররা এই ওয়েবসাইটে এক্সেস পেতে একটা ইউনিক কোড লাগবে।

1. অ্যাডমিন প্যানেল → **Access Codes** ট্যাব
2. **Generate Code** → একটা কোড তৈরি হবে (যেমন `ABC123XYZ`)
3. টেলিগ্রাম বটে `/newcode` পাঠিয়েও কোড তৈরি করতে পারেন
4. এই কোড ইউজারকে দিন
5. ইউজার লগইন পেজে গিয়ে রেজিস্টার করার সময় কোডটা দিবে

> অথবা টেলিগ্রাম বট থেকে সরাসরি ইউজারকে কোড পাঠানোর সিস্টেমও আছে (bot `/newcode` কমান্ড)।

---

## ধাপ ১০ — টেলিগ্রাম চ্যানেলে কুইজ পোস্ট করা

ইউজাররা তাদের নিজস্ব বট টোকেন দিয়ে চ্যানেলে পোস্ট করতে পারে:

1. ইউজার নিজের একটা বট বানাবে (@BotFather থেকে)
2. সেই বটকে তার চ্যানেলে Admin করে এড করবে
3. কুইজ তৈরি করার সময় চ্যানেল username (যেমন `@my_quiz_channel`) ও বট টোকেন দিবে
4. কুইজ তৈরি হওয়ার পর "Post to Telegram" বাটনে ক্লিক করলে চ্যানেলে পোস্ট হবে

> **আনলিমিটেড কুইজ** — সিস্টেমে ১টা কুইজে ১০০০ পর্যন্ত প্রশ্ন তৈরি করা যায়, ব্যাচে ব্যাচে। কোনো সীমা নেই।

---

## সমস্যা সমাধান (Troubleshooting)

### ❌ "Request failed (404)" বা লগইন কাজ করছে না
→ `VITE_API_URL` ঠিক সেট হয়েছে কিনা দেখুন। Render URL খুলুন ব্রাউজারে (`/api/health`), `ok` আসছে কিনা।

### ❌ Render সার্ভার ঘুমিয়ে আছে (cold start)
→ প্রথম রিকোয়েস্টে ৩০-৬০ সেকেন্ড লাগবে। অপেক্ষা করুন।

### ❌ AI কাজ করছে না
→ অ্যাডমিন প্যানেল → **AI Keys** ট্যাবে গিয়ে কমপক্ষে একটা অ্যাক্টিভ কী আছে কিনা দেখুন। Test বাটনে চেক করুন।

### ❌ টেলিগ্রাম নোটিফিকেশন আসছে না
→ বট টোকেন ও গ্রুপ ID ঠিক আছে কিনা। বট গ্রুপে Admin কিনা।

### ❌ MongoDB ব্যাকআপ কাজ করছে না
→ `MONGODB_URI` ঠিক কিনা। Network Access-এ `0.0.0.0/0` দেওয়া আছে কিনা।

### ❌ চ্যানেলে পোস্ট হচ্ছে না
→ বট টোকেন দিয়ে বট চ্যানেলে Admin কিনা। চ্যানেল username `@` সহ দিয়েছেন কিনা।

---

## পরিবর্তনের সারাংশ (কোডে কী কী হলো)

1. **`artifacts/quiz-generator/public/_redirects`** (নতুন) — Cloudflare Pages-এ SPA রাউটিং নিশ্চিত করে।
2. **`CLOUDFLARE_DEPLOY.md`** (এই ফাইল) — সম্পূর্ণ ডিপ্লয়মেন্ট গাইড।
3. ফ্রন্টএন্ড এখন `VITE_API_URL` দেখে ঠিকানা ঠিক করে — Cloudflare-এ এটি Render URL হবে।

> সব স্টেপ ফলো করলে ওয়েবসাইট কাজ করবে। কোনো সমস্যা হলে বলবেন।
