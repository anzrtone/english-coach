import { generateSpeech } from 'ai';
import { createHash } from 'node:crypto';
import { google, parseDurationMs } from '@/lib/gemini';
import { toPlainText } from '@/lib/plainText';
import { TTS_MODEL as MODEL, TTS_STYLE as STYLE, TTS_VOICE as VOICE } from '@/lib/voice';

/**
 * Natural-sounding text-to-speech with Gemini TTS (free tier, shares the
 * rotating key pool). Returns a WAV file. The client falls back to the
 * browser's built-in voices when this fails or the quota is used up.
 */

export const maxDuration = 60;

const MAX_CHARS = 2500;
// Free-tier TTS has a small per-minute limit. If Google asks us to wait only
// briefly, wait once and retry rather than failing the request.
const MAX_RETRY_WAIT_MS = 20_000;

// Free-tier TTS quota is small, so identical requests (e.g. the welcome
// message) are served from memory instead of calling Gemini again.
const MAX_CACHE_ENTRIES = 40;
const cache = new Map<string, Uint8Array>();

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (hit) {
    // Re-insert to mark as recently used.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, audio: Uint8Array) {
  cache.set(key, audio);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

function wavResponse(audio: Uint8Array, cacheStatus: 'HIT' | 'MISS') {
  return new Response(audio as BodyInit, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'private, max-age=86400',
      'X-Cache': cacheStatus,
    },
  });
}

function isRateLimit(error: unknown): boolean {
  return /429|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(String((error as Error)?.message ?? error));
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  if (!google) return jsonError(503, 'Natural voice is not configured.');

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const plain = toPlainText(text ?? '').slice(0, MAX_CHARS);
  if (!plain) return jsonError(400, 'Nothing to read.');

  const key = createHash('sha256').update(`${MODEL}|${VOICE}|${plain}`).digest('hex');
  const cached = cacheGet(key);
  if (cached) return wavResponse(cached, 'HIT');

  const synthesize = () =>
    generateSpeech({
      model: google!.speech(MODEL),
      text: plain,
      voice: VOICE,
      instructions: STYLE,
      maxRetries: 0,
    });

  try {
    let result;
    try {
      result = await synthesize();
    } catch (error) {
      const wait = parseDurationMs(String((error as Error)?.message).match(/retry in ([\d.hms]+)/i)?.[1]);
      if (!isRateLimit(error) || wait <= 0 || wait > MAX_RETRY_WAIT_MS) throw error;
      console.warn(`[speak] rate-limited; retrying in ${Math.ceil(wait / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, wait + 500));
      result = await synthesize();
    }
    cacheSet(key, result.audio.uint8Array);
    return wavResponse(result.audio.uint8Array, 'MISS');
  } catch (error) {
    console.error('[speak]', error);
    const rateLimited = isRateLimit(error);
    return rateLimited
      ? jsonError(429, 'Natural voice is busy right now.')
      : jsonError(502, 'Natural voice is unavailable right now.');
  }
}
