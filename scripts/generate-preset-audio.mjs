// Pre-generates natural-voice MP3s for the starter content (welcome message,
// suggestion prompts and their replies, in English and every language in
// lib/presets.json), so Listen plays them instantly with no API quota.
//
// Usage:  npm run presets:audio      (run `npm run presets` first)
//
// Clips are named by a fingerprint of the exact text the Listen button reads,
// so existing clips are skipped and edited text gets a fresh clip.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

if (!process.env.GEMINI_API_KEYS && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local — gemini.ts will report missing keys below.
  }
}

// Imported after the env is loaded: gemini.ts reads the keys at import time.
const { generateSpeech } = await import('ai');
const { Mp3Encoder } = await import('@breezystack/lamejs');
const { google, parseDurationMs } = await import('../lib/gemini.ts');
const { toSpeechText, textKey } = await import('../lib/plainText.ts');
const { TTS_MODEL, TTS_STYLE, TTS_VOICE } = await import('../lib/voice.ts');
const { WELCOME_MESSAGE } = await import('../lib/content.ts');

const PRESETS = JSON.parse(readFileSync(new URL('../lib/presets.json', import.meta.url), 'utf8'));
const AUDIO_DIR = new URL('../public/audio/presets/', import.meta.url);
const MANIFEST = new URL('../lib/presetAudio.json', import.meta.url);
const KBPS = 48; // plenty for a single speaking voice
const MAX_CHUNK = 900; // characters per Gemini request
const PAUSE_SECONDS = 0.35; // silence inserted between chunks
const MAX_ATTEMPTS = 5;

if (!google) throw new Error('No Gemini API key found (set GEMINI_API_KEYS in .env.local).');

// ── Which texts get a clip ──
const texts = [WELCOME_MESSAGE, ...Object.values(PRESETS.welcome.translations)];
for (const s of PRESETS.suggestions) {
  texts.push(s.prompt, s.reply);
  for (const t of Object.values(s.translations)) texts.push(t.prompt, t.reply);
}
const clips = [...new Map(texts.map((t) => toSpeechText(t)).map((speech) => [textKey(speech), speech])).entries()];

// ── Helpers ──
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits text into sentence-aligned chunks of at most MAX_CHUNK characters. */
function chunk(text) {
  const chunks = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?।؟])\s+|\n+/).filter((s) => s.trim())) {
    if (current && current.length + sentence.length + 1 > MAX_CHUNK) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Extracts 16-bit mono PCM samples and the sample rate from a WAV file. */
function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const data = bytes.slice(offset + 8, offset + 8 + size);
      return { sampleRate, samples: new Int16Array(data.buffer, 0, Math.floor(data.length / 2)) };
    }
    offset += 8 + size;
  }
  throw new Error('WAV has no data chunk');
}

/** One Gemini TTS call, waiting out short rate limits (keys rotate automatically). */
async function synthesize(text) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { audio } = await generateSpeech({
        model: google.speech(TTS_MODEL),
        text,
        voice: TTS_VOICE,
        instructions: TTS_STYLE,
        maxRetries: 0,
      });
      return parseWav(audio.uint8Array);
    } catch (error) {
      const message = String(error?.message ?? error);
      if (attempt >= MAX_ATTEMPTS || !/429|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(message)) throw error;
      const wait = Math.min(parseDurationMs(message.match(/retry in ([\d.hms]+)/i)?.[1]) || 15_000, 60_000);
      console.warn(`    rate-limited; waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait + 500);
    }
  }
}

function encodeMp3(pcm, sampleRate) {
  const encoder = new Mp3Encoder(1, sampleRate, KBPS);
  const parts = [];
  // lamejs works best when fed in frame-sized blocks.
  for (let i = 0; i < pcm.length; i += 1152 * 64) parts.push(encoder.encodeBuffer(pcm.subarray(i, i + 1152 * 64)));
  parts.push(encoder.flush());
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

// ── Generate ──
mkdirSync(AUDIO_DIR, { recursive: true });
const manifest = {};
let generated = 0;
let totalBytes = 0;

for (const [index, [key, speech]] of clips.entries()) {
  const file = `${key}.mp3`;
  const path = new URL(file, AUDIO_DIR);
  manifest[key] = `/audio/presets/${file}`;
  const label = `[${index + 1}/${clips.length}] ${speech.slice(0, 50).replace(/\n/g, ' ')}…`;

  if (existsSync(path)) {
    totalBytes += readFileSync(path).length;
    console.log(`${label} (exists, skipped)`);
    continue;
  }

  console.log(label);
  const pieces = [];
  let sampleRate = 24_000;
  for (const piece of chunk(speech)) {
    const result = await synthesize(piece);
    sampleRate = result.sampleRate;
    if (pieces.length) pieces.push(new Int16Array(Math.round(sampleRate * PAUSE_SECONDS)));
    pieces.push(result.samples);
  }
  const pcm = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of pieces) {
    pcm.set(p, offset);
    offset += p.length;
  }

  const mp3 = encodeMp3(pcm, sampleRate);
  writeFileSync(path, mp3);
  generated++;
  totalBytes += mp3.length;
  const wavKb = Math.round((pcm.length * 2 + 44) / 1024);
  console.log(`    ${(pcm.length / sampleRate).toFixed(1)}s audio: ${wavKb} KB WAV -> ${Math.round(mp3.length / 1024)} KB MP3`);
}

// Remove clips for text that no longer exists.
for (const file of readdirSync(AUDIO_DIR)) {
  if (file.endsWith('.mp3') && !manifest[file.slice(0, -4)]) {
    rmSync(new URL(file, AUDIO_DIR));
    console.log(`Removed unused clip ${file}`);
  }
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nDone: ${generated} new clip(s), ${clips.length} total, ${(totalBytes / 1024 / 1024).toFixed(2)} MB in public/audio/presets`);
