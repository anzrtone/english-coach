// Pre-generates the replies to the starter suggestions and the translations
// of the welcome message, suggestions and replies, so they load instantly
// (and cost no API quota) in the app.
//
// Usage:  npm run presets                  -> Bengali
//         npm run presets -- bn hi         -> Bengali and Hindi
//         npm run presets -- bn --fresh    -> also regenerate the English replies
//
// Existing English replies in lib/presets.json are kept (so their audio stays
// valid) unless --fresh is passed; translations are always redone.
//
// Reads Gemini keys from GEMINI_API_KEYS / GOOGLE_GENERATIVE_AI_API_KEY,
// loading .env.local if they aren't already set.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (!process.env.GEMINI_API_KEYS && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local — gemini.ts will report missing keys below.
  }
}

// Imported after the env is loaded: gemini.ts reads the keys at import time.
const { generateText } = await import('ai');
const { google } = await import('../lib/gemini.ts');
const { GEMINI_MODELS, LANGUAGE_NAMES, SYSTEM_PROMPT, translationInstructions } = await import('../lib/prompt.ts');
const { findCutOff } = await import('../lib/replyCheck.ts');
const { WELCOME_MESSAGE, CAREGIVER_SUGGESTIONS } = await import('../lib/content.ts');

const OUTPUT = new URL('../lib/presets.json', import.meta.url);
const MAX_ATTEMPTS = 3;

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const langArgs = args.filter((a) => !a.startsWith('--'));
const langs = langArgs.length ? langArgs : ['bn'];
const previous = !fresh && existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, 'utf8')) : null;
const previousReplies = new Map((previous?.suggestions ?? []).map((s) => [s.prompt, s.reply]));
for (const lang of langs) {
  if (!LANGUAGE_NAMES[lang]) throw new Error(`Unknown language code "${lang}"`);
}
if (!google) throw new Error('No Gemini API key found (set GEMINI_API_KEYS in .env.local).');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** generateText with the same model fallback as the chat route, waiting out overloads. */
async function generate(options) {
  for (let round = 1; ; round++) {
    for (const model of GEMINI_MODELS) {
      try {
        return await generateText({ model: google(model), maxRetries: 1, ...options });
      } catch (error) {
        console.warn(`  ${model} failed (${error.statusCode ?? error.lastError?.statusCode ?? String(error.message).slice(0, 80)})`);
      }
    }
    if (round >= 6) throw new Error('Every Gemini model kept failing; try again later.');
    console.warn(`  all models busy; waiting 30s (round ${round})`);
    await sleep(30_000);
  }
}

async function generateReply(prompt) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text, finishReason } = await generate({
      instructions: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    const problem = findCutOff(text, finishReason);
    if (!problem) return text.trim();
    console.warn(`  reply cut off (${problem}); regenerating`);
  }
  throw new Error(`Could not get a complete reply for "${prompt}"`);
}

async function translate(markdown, lang) {
  const { text } = await generate({
    instructions: translationInstructions(lang),
    messages: [{ role: 'user', content: markdown }],
  });
  return text.trim();
}

const presets = {
  generatedAt: new Date().toISOString(),
  languages: langs,
  welcome: { translations: {} },
  suggestions: [],
};

for (const lang of langs) {
  console.log(`Translating welcome message -> ${lang}`);
  presets.welcome.translations[lang] = await translate(WELCOME_MESSAGE, lang);
}

for (const { text: prompt } of CAREGIVER_SUGGESTIONS) {
  let reply = previousReplies.get(prompt);
  if (reply) {
    console.log(`Keeping saved reply: "${prompt}"`);
  } else {
    console.log(`Generating reply: "${prompt}"`);
    reply = await generateReply(prompt);
  }
  const translations = {};
  for (const lang of langs) {
    console.log(`  translating -> ${lang}`);
    translations[lang] = { prompt: await translate(prompt, lang), reply: await translate(reply, lang) };
  }
  presets.suggestions.push({ prompt, reply, translations });
}

writeFileSync(OUTPUT, JSON.stringify(presets, null, 2) + '\n');
console.log(`\nSaved ${presets.suggestions.length} replies and ${langs.join(', ')} translations to lib/presets.json`);
