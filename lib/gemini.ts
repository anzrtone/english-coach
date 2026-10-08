import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Gemini provider with API key rotation.
 *
 * Keys come from GEMINI_API_KEYS (comma-separated) plus the single-key vars
 * GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY. Every request goes through a
 * custom fetch that injects the active key; when Google answers 429 (rate
 * limit) or 401/403 (bad/revoked key), that key is put on cooldown and the same
 * request is retried with the next key. This works for streaming, generateText,
 * speech and transcription alike, since they all share this fetch.
 *
 * NOTE: free-tier quota is per Google Cloud project, not per key — keys must
 * come from different projects/accounts for rotation to add capacity.
 * Cooldown state is in-memory (per server instance).
 */

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const INVALID_KEY_COOLDOWN_MS = 10 * 60_000;

function loadKeys(): string[] {
  const raw = [
    ...(process.env.GEMINI_API_KEYS ?? '').split(','),
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    process.env.GEMINI_API_KEY ?? '',
  ];
  // Tolerate `"key1", "key2"` style lists: strip whitespace, quotes and stray commas.
  const cleaned = raw.flatMap((k) => k.split(',')).map((k) => k.trim().replace(/^["']+|["']+$/g, '').trim());
  return [...new Set(cleaned.filter(Boolean))];
}

const keys = loadKeys();
// Google's limits are per key *and* per model (chat, TTS and transcription
// each have their own quota), so cooldowns are tracked per "key|model".
// "key|*" marks a key that is invalid for every model.
const cooldownUntil = new Map<string, number>();
let activeIndex = 0;

export const hasGeminiKeys = keys.length > 0;

// When every key is cooling down, still try the soonest one if it frees up
// within this window (cooldown estimates can be conservative).
const RETRY_ANYWAY_WINDOW_MS = 10_000;

function modelFromUrl(input: RequestInfo | URL): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.match(/\/models\/([^:/?]+)/)?.[1] ?? '*';
}

function cooldownEnd(keyIndex: number, model: string): number {
  return Math.max(cooldownUntil.get(`${keyIndex}|${model}`) ?? 0, cooldownUntil.get(`${keyIndex}|*`) ?? 0);
}

/** Picks the next usable key for a model, starting from the active one and skipping keys already tried. */
function pickKey(model: string, tried: Set<number>): number {
  const now = Date.now();
  let soonest = -1;
  for (let offset = 0; offset < keys.length; offset++) {
    const i = (activeIndex + offset) % keys.length;
    if (tried.has(i)) continue;
    if (cooldownEnd(i, model) <= now) return i;
    if (soonest === -1 || cooldownEnd(i, model) < cooldownEnd(soonest, model)) soonest = i;
  }
  if (tried.size === 0 && soonest !== -1 && cooldownEnd(soonest, model) - now <= RETRY_ANYWAY_WINDOW_MS) {
    return soonest;
  }
  return -1;
}

/** Parses durations like "37s", "1.5s" or "19h45m31.27s" into milliseconds. */
export function parseDurationMs(text: string | undefined): number {
  let ms = 0;
  for (const [, value, unit] of (text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)(?![a-z])/gi)) {
    ms += parseFloat(value) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
  }
  return ms;
}

/** Reads the retry delay from a Retry-After header, Google's RetryInfo detail, or the error message. */
async function getRetryDelayMs(res: Response): Promise<number> {
  const header = Number(res.headers.get('retry-after'));
  if (header > 0) return header * 1000;
  try {
    const body = await res.clone().json();
    const retryInfo = body?.error?.details?.find(
      (d: { '@type'?: string }) => d['@type']?.endsWith('google.rpc.RetryInfo'),
    );
    const ms =
      parseDurationMs(retryInfo?.retryDelay) ||
      parseDurationMs(String(body?.error?.message ?? '').match(/retry in ([\d.hms]+)/i)?.[1]);
    if (ms > 0) return ms;
  } catch {
    // Body wasn't JSON — fall through to the default.
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

/** Google reports a malformed or deleted key as 400 with reason API_KEY_INVALID. */
async function isInvalidKey(res: Response): Promise<boolean> {
  try {
    return (await res.clone().text()).includes('API_KEY_INVALID');
  } catch {
    return false;
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}m` : minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

const rotatingFetch: typeof fetch = async (input, init) => {
  const model = modelFromUrl(input);
  const tried = new Set<number>();
  let lastFailure: Response | undefined;

  for (let i = pickKey(model, tried); i !== -1; i = pickKey(model, tried)) {
    tried.add(i);
    const headers = new Headers(init?.headers);
    headers.set('x-goog-api-key', keys[i]);

    const res = await fetch(input, { ...init, headers });

    let pausedFor: number;
    if (res.status === 429) {
      pausedFor = await getRetryDelayMs(res);
      cooldownUntil.set(`${i}|${model}`, Date.now() + pausedFor);
    } else if (res.status === 401 || res.status === 403 || (res.status === 400 && (await isInvalidKey(res)))) {
      pausedFor = INVALID_KEY_COOLDOWN_MS;
      cooldownUntil.set(`${i}|*`, Date.now() + pausedFor);
    } else {
      activeIndex = i;
      return res;
    }

    console.warn(
      `[gemini] key #${i + 1}/${keys.length} failed with ${res.status} on ${model}; paused for ${formatDuration(pausedFor)}. ` +
        (tried.size < keys.length ? 'Switching to next key.' : 'No keys left.'),
    );
    activeIndex = (i + 1) % keys.length;
    lastFailure = res;
  }

  return (
    lastFailure ??
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: `All Gemini API keys are currently rate-limited for ${model}. Please try again later.`,
        },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  );
};

export const google = hasGeminiKeys
  ? createGoogleGenerativeAI({ apiKey: keys[0], fetch: rotatingFetch })
  : null;
