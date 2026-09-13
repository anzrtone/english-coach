# Lingo — Free English Coach for Caregivers & Domestic Workers

A production-ready AI-powered English learning chatbot built for **immigrant international caregivers (babysitters, elder care aides, domestic helpers, hospitality workers)**. Powered by the [Vercel AI SDK](https://sdk.vercel.ai/) with Google Gemini or OpenAI, built on Next.js 16 App Router.

---

## ✨ Features

- 👵 **Caregiver English coaching** — daily care updates to parents/employers, medicine routines, comforting phrases, and emergency safety
- 🌐 **Instant Native Language Translation (Non-AI)** — translate any chat message into **Bengali (বাংলা)**, **Hindi (हिन्दी)**, **Tagalog**, **Urdu**, **Arabic**, **Spanish**, **Indonesian**, or **Vietnamese**
- ⚡ **Real-time streaming** — responses appear word by word
- 📱 **Responsive design** — optimized for desktop & mobile
- 🔒 **No data storage** — conversations are private and never persisted
- 🆓 **Free to use** — runs with Google AI Studio Gemini API free tier

---

## 🚀 Local Development

### Prerequisites
- **Node.js 22+** — [Download](https://nodejs.org)
- **Google Gemini API Key (Free)** — [Get key at Google AI Studio](https://aistudio.google.com/app/apikey)

### Setup

```bash
# 1. Clone this repository
git clone <your-repo-url>
cd english-coach

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env.local
# Open .env.local and add your key:
# GOOGLE_GENERATIVE_AI_API_KEY=AIzaSy...

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — select your native language and start practicing!

---

## 🌐 Deploy to Vercel (Free)

1. Push this project to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. In **Settings** → **Environment Variables**, add:
   - `GOOGLE_GENERATIVE_AI_API_KEY` = your Gemini key from Google AI Studio
4. Click **Deploy** 🎉

