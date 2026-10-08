# Lingo — Feature Plans

Constraint: this is a demo, so **every tool must be 100% free** (Gemini free tier, browser APIs, open-source packages).

## Current state (baseline)

- **Stack:** Next.js 16.3, React 19, Vercel AI SDK v7 (`useChat` / `streamText`), Tailwind v4 + custom CSS in `app/globals.css`.
- `app/api/chat/route.ts` — streams chat from Gemini, with an OpenAI / Vercel Gateway fallback (not free) and the "Lingo" coach system prompt.
- `app/page.tsx` — the whole UI: native-language modal (8 languages, saved in `localStorage`), chat bubbles, suggestion chips, single-line input, per-message "Translate" button.

Known issues these plans address:

1. `formatMarkdown()` only handled `**bold**` and newlines, so `####`, `---`, lists, code and tables rendered as raw text.
2. Translation is one-way (English → native) via MyMemory from the browser:
   - text is truncated at 500 characters;
   - only `**` is stripped before translating;
   - the cache is keyed by message ID only, so a stale translation shows after the user switches language;
   - partially streamed messages can be translated;
   - Urdu and Arabic are not shown right-to-left.
3. There is no voice input or output.
4. The system prompt targets caregivers and hospitality workers. The intended audience also includes technical and labour workers (e.g. a Bangladeshi technician in the UAE), so the prompt should be broadened.

---

## Plan 0: Gemini API key rotation ✅ implemented

**Goal:** when one Gemini key hits its rate limit, switch to the next key automatically.

- `lib/gemini.ts` builds the Google provider with a custom `fetch`.
- Each request gets the current key in the `x-goog-api-key` header.
- **On 429** (rate limit), the key is put on cooldown and the same request is retried with the next key:
  - the cooldown length comes from the `Retry-After` header or Google's `RetryInfo.retryDelay`, with 60 seconds as the default.
- **On 401/403** (invalid or revoked key), the key is put on a 10-minute cooldown.
- Because rotation happens at the fetch level, it works for streaming chat and will also cover `generateText` (translation), `generateSpeech` (TTS) and `transcribe` later.
- **Configuration:** `GEMINI_API_KEYS=key1,key2,key3` (comma-separated). The existing single-key variables `GOOGLE_GENERATIVE_AI_API_KEY` and `GEMINI_API_KEY` still work and are added to the pool.
- ⚠️ **Free-tier quota is per Google Cloud project, not per key.** Several keys from the same project share one quota. Each key must come from a different project or account for rotation to help.
- The cooldown state lives in server memory. That is fine for `next dev` and a single warm serverless instance; it resets on a cold start.

---

## Plan 1: Format AI replies properly ✅ implemented

**Tools:** `react-markdown` and `remark-gfm` (MIT).

1. `app/components/Markdown.tsx`:
   - Wraps `react-markdown` with GFM (GitHub-flavored markdown).
   - Headings are scaled down to fit a chat bubble.
   - Links open in a new tab with `rel="noopener noreferrer"`.
   - Tables scroll horizontally inside the bubble.
   - Raw HTML is not rendered (the library's default), so model output cannot inject HTML.
2. `formatMarkdown()` is replaced everywhere: AI bubbles, user bubbles and the welcome message. `<p className="message-text">` becomes a `<div>`, because putting lists inside a `<p>` is invalid HTML.
3. Markdown styles live under `.message-text` / `.md` in `globals.css`: lists, `hr`, inline and block code, blockquote, table. `overflow-wrap: anywhere` prevents long words from breaking the layout on phones.
4. `lib/plainText.ts` adds `toPlainText(markdown)`. It removes markdown symbols and emoji while keeping line and sentence breaks. The translate button already uses it, and Plans 2 and 3 will reuse it.
5. System prompt formatting rules: short replies, `###` as the largest heading, bullet lists, `**bold**` for key phrases, no tables or code blocks.

---

## Server-side check for cut-off replies ✅ implemented

- `app/api/chat/route.ts` generates the whole reply on the server with `generateText` and checks it before sending.
- `lib/replyCheck.ts` flags a reply as cut off when any of these is true:
  - the finish reason isn't `stop`;
  - the reply is empty;
  - it has an unclosed `**` or code fence;
  - it ends on a heading or mid-sentence (`:` `,` `(`).
- A cut-off reply is regenerated, up to 3 attempts. If all 3 fail, the user gets "Sorry, I couldn't finish that answer" instead of a partial reply.
- **Trade-off:** the reply no longer streams in word by word. The user sees the typing dots for the whole generation time (about 7–15 seconds).
- **Possible upgrade:** stream the reply but hold back its last few lines until the finish check passes, or show a progress hint while waiting.

---

## Pre-generated starter content ✅ implemented

- `lib/presets.json` holds the replies to the 4 suggestion chips, plus Bengali translations of the welcome message, the chips and the replies. It is created by `npm run presets` (`scripts/generate-presets.mjs`).
- The script uses the same system prompt, model fallback, key rotation and cut-off check as the chat route (`lib/prompt.ts`), and translates with Gemini.
- In the app:
  - tapping a chip shows its saved reply after a short "typing" pause, with no API call;
  - Translate on these messages is instant;
  - anything the user asks afterwards goes to Gemini as normal, with the saved reply in the conversation history.
- To add more languages: `npm run presets -- bn hi ur`.
- **Re-run the script after editing `lib/content.ts` or the system prompt.** A chip whose text no longer matches a saved reply automatically falls back to a live Gemini call.
- **Pre-generated voice:** `npm run presets:audio` (`scripts/generate-preset-audio.mjs`) creates natural-voice MP3s for all of this content, in English and each pre-generated language.
  - Format: 48 kbps mono, encoded with `@breezystack/lamejs`. Files go in `public/audio/presets/`, listed in `lib/presetAudio.json`.
  - Each clip is named after a fingerprint of the exact text Listen reads. The app plays the matching MP3 instantly and falls back to the live voice for anything else.
  - Existing clips are skipped, and clips for text that no longer exists are deleted. Run it after `npm run presets`.

## Plan 2: Translate messages both ways

**Status:** ✅ `/api/translate` (Gemini, with MyMemory as fallback) is done. ⏳ The 🌐 button in the typing box and the fonts are still to do.

**Teaching-style translation.** Translating Lingo's messages works like a teacher explaining an English lesson in the learner's language:
- The explanations are translated.
- The English being taught (example sentences, phrases and templates) stays in English, with the meaning in brackets after it.
- The prompt is `translationInstructions()` in `lib/prompt.ts`, shared by `/api/translate` and `npm run presets`.
- The MyMemory fallback does the same for quoted examples.

**Tools**

- **Main option: Gemini through a new `/api/translate` route.**
  - It uses the same free key pool (with rotation from Plan 0).
  - Quality is much better than MyMemory for Bengali, Urdu and Tagalog.
  - It keeps the markdown structure and has no 500-character limit.
- **Fallback: MyMemory.** Used when every Gemini key is rate-limited.
  - Text is split by sentence to stay under 500 characters per request.
  - Passing a `de=<email>` parameter raises the free daily quota from about 5k to about 50k characters.
- Not used:
  - LibreTranslate's public server now needs a paid key.
  - Unofficial Google Translate endpoints break often and violate its terms.
  - Chrome's built-in Translator API is desktop-only, and most users will be on Android phones.

**How it works for the user**

- **Replies (English → native):** keep the existing button. The translation appears under the English text, which is better for learning.
- **The user's own messages:** the same toggle, in whichever direction is needed.
- **Typing box (native → English):** a 🌐 button next to Send replaces the typed text with its English version *before* sending, so the user sees the English sentence first. The replacement can be undone.
- **Choosing the direction:** default to native → English in the typing box and English → native on messages, with a ⇄ toggle for other cases. Auto-detection is unreliable for languages written in Latin script (Tagalog, Indonesian, Spanish, Vietnamese).

**Steps**

1. **`app/api/translate/route.ts`:**
   - Receives `{ text, from, to }` and calls `generateText` with a strict prompt: "Translate only. Keep the markdown. Keep names, numbers and times unchanged. Output only the translation."
   - Check the v7 `generateText` signature in `node_modules/ai` first: v7 uses `instructions:`, not `system:`.
2. **`lib/translate.ts` (client):** calls the route and falls back to MyMemory on 429 or other errors.
3. **Cache:**
   - Key saved translations by `messageId + targetLang + direction`.
   - Disable the button while that message is still streaming.
4. **Display:**
   - Set `dir="rtl"` and `lang` on translation boxes for Urdu and Arabic.
   - Render translations with the `Markdown` component.
   - Optionally load Noto Sans Bengali, Devanagari and Arabic through `next/font`.
5. **Typing box button:** shows a loading state, replaces the input text with an undo option, and blocks sending while it's still translating.
6. **Optional:** a setting that shows each reply with its translation automatically.

**Effort:** about half a day.

---

## Plan 3: Voice input and spoken replies

**Status:** ✅ Listen buttons, the natural Gemini voice (`/api/speak`, falling back to the browser voice) and mic input are implemented. ⏳ Hands-free mode and the Firefox fallback are still to do.

The installed AI SDK already includes `generateSpeech` and `transcribe`. The Google provider exposes `google.speech('gemini-3.1-flash-tts-preview')` and `google.transcription(...)`.

### Voice input (speech-to-text)

| Tier | Tool | Notes |
|---|---|---|
| Main | Web Speech API (`SpeechRecognition`) | Free and needs no key. Shows words as the user speaks. Works in Chrome, Edge, Android Chrome and Safari, and supports `bn-BD`, `hi-IN`, `ur-PK`, `ar-AE`, `fil-PH`, `en-US` and others. |
| Fallback (Firefox) | Record with `MediaRecorder` → send the audio to Gemini (free tier) | Works in every browser. As a bonus, the coach can comment on pronunciation. |

### Spoken replies (text-to-speech)

| Tier | Tool | Notes |
|---|---|---|
| Baseline | Browser `speechSynthesis` | Free and offline. Rank the available voices to prefer names containing "Natural", "Neural", "Online" or "Google". Edge's neural voices sound very natural. |
| "Natural voice" option | Gemini TTS (`gemini-3.1-flash-tts-preview`) through a `/api/speak` route | The most natural option, and it can speak native languages. **Check the free-tier limits in AI Studio first**, and fall back to the browser voice on 429. |
| Offline option | Kokoro TTS (`kokoro-js`, Apache-2.0) running in the browser | Natural English with no API calls. Needs a one-time 80–300 MB model download, so offer it only as an opt-in "HD voice". |

Avoid the unofficial `edge-tts` endpoint; it isn't a sanctioned API.

**Steps**

1. **`hooks/useSpeechInput.ts`:**
   - Detects browser support and switches `lang` between English and the native language.
   - Shows words as they are recognized.
   - Uses the recording fallback when needed and handles microphone permission being refused.
2. **Mic button in the typing box:**
   - Tap to start and stop, with a pulsing animation while listening.
   - The recognized words fill the input so the user can check them before sending.
   - An "EN / native" toggle lets the user speak in their own language, then use the 🌐 button from Plan 2.
3. **`hooks/useSpeech.ts`:**
   - Speaks `toPlainText(message)` sentence by sentence, because Chrome silently stops long utterances.
   - Speed control: 0.8×, 1× or 1.1×.
   - Only one message plays at a time.
4. **🔊 button on every message and translation:** hide it if the phone has no voice for that language, unless Gemini TTS is turned on.
5. **Conversation mode (hands-free):**
   - The cycle is listen → send when the user stops talking → wait for the full reply → speak it → listen again.
   - The microphone is off while the AI is speaking.
6. **Prompt tweak:** send `mode: 'voice'` in the chat request so replies stay under 3 sentences.
7. **Limits to test:**
   - The microphone needs HTTPS (fine on localhost and on Vercel).
   - iOS Safari only plays audio after a tap.
   - Check that Android Chrome speech recognition works for Bengali.

**Effort:** about 1 day for the browser-only version, plus half a day for Gemini TTS, plus half a day for Kokoro if wanted.

---

## Order

1. ✅ Plan 0 (key rotation) and Plan 1 (formatting)
2. Plan 2 (translation: fixes the existing bugs and adds translating into English)
3. Plan 3: browser-only voice first, then Gemini TTS after checking free-tier limits, then Kokoro optionally
