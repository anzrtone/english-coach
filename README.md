# Lingo — Free English Coach for Professionals

A production-ready AI-powered English learning chatbot built for **immigrant working professionals in the Middle East**. Powered by the [Vercel AI SDK](https://sdk.vercel.ai/) with streaming, built on Next.js 15 App Router.

---

## ✨ Features

- 🎓 **Personalised English coaching** — workplace emails, meetings, presentations, small talk
- ⚡ **Real-time streaming** — responses appear word by word via edge functions
- 📱 **Responsive design** — works great on desktop and mobile
- 🔒 **No data storage** — conversations are never persisted
- 🆓 **Free to use** — runs on Vercel's free tier + Vercel AI Gateway

---

## 🚀 Local Development

### Prerequisites
- **Node.js 22+** — [Download](https://nodejs.org)
- **Vercel account** (free) — [Sign up](https://vercel.com)
- **Vercel AI Gateway API key** — [Get one here](https://vercel.com/ai-gateway) (free tier available)

### Setup

```bash
# 1. Clone or download this repository
git clone <your-repo-url>
cd english-coach

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env.local
# Then open .env.local and add your API key

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the Lingo chat interface.

---

## 🌐 Deploy to Vercel (Free)

### Option A — One-click via Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow the prompts. When asked for environment variables, add your `AI_GATEWAY_API_KEY`.

### Option B — GitHub → Vercel (recommended)

1. Push this project to a GitHub repository
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. In the **Environment Variables** section, add:
   - `AI_GATEWAY_API_KEY` = your key from [vercel.com/ai-gateway](https://vercel.com/ai-gateway)
4. Click **Deploy** — that's it! 🎉

Your app will be live at `https://your-project.vercel.app` within ~60 seconds.

---

## 🔧 Configuration

### Changing the LLM model

Open `app/api/chat/route.ts` and change the `model` string:

```typescript
// Default (cost-efficient, great quality)
model: 'openai/gpt-4o-mini',

// Higher quality
model: 'openai/gpt-4o',
model: 'anthropic/claude-sonnet-4.5',

// See all available models:
// https://vercel.com/ai-gateway#models
```

### Customising the system prompt

Edit the `SYSTEM_PROMPT` constant in `app/api/chat/route.ts` to adjust Lingo's persona, tone, or focus areas.

---

## 🗂️ Project Structure

```
english-coach/
├── app/
│   ├── api/chat/
│   │   └── route.ts        # Edge API route + system prompt
│   ├── globals.css          # Dark theme, glassmorphism, animations
│   ├── icons.tsx            # Inline SVG icons
│   ├── layout.tsx           # Root layout, fonts, SEO metadata
│   └── page.tsx             # Chat UI (useChat hook)
├── .env.example             # Environment variable template
├── next.config.ts
├── package.json
├── tailwind.config.ts
└── README.md
```

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| AI SDK | Vercel AI SDK v7 |
| LLM Provider | Vercel AI Gateway → OpenAI |
| Styling | Tailwind CSS + Custom CSS |
| Hosting | Vercel (Edge Functions) |

---

## 📄 License

MIT — use freely, modify, and deploy for your community.
