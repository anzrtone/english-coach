import { generateText } from 'ai';
import { google } from '@/lib/gemini';
import { GEMINI_MODELS, LANGUAGE_NAMES, translationInstructions } from '@/lib/prompt';

export const maxDuration = 60;

const MAX_LENGTH = 6000;

/**
 * Translates one of Lingo's messages into the learner's language with Gemini,
 * keeping the English being taught in English. The client falls back to
 * MyMemory when this fails (no key, every key rate-limited, …).
 */
export async function POST(req: Request) {
  const { text, to }: { text?: string; to?: string } = await req.json();

  if (!google) return Response.json({ error: 'No Gemini key configured.' }, { status: 503 });
  if (!text?.trim() || !to || !LANGUAGE_NAMES[to] || text.length > MAX_LENGTH) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    try {
      const { text: translated, finishReason } = await generateText({
        model: google(GEMINI_MODELS[m]),
        instructions: translationInstructions(to),
        messages: [{ role: 'user', content: text }],
        maxRetries: 1,
      });
      if (finishReason !== 'stop' || !translated.trim()) throw new Error(`Incomplete translation (${finishReason})`);
      return Response.json({ text: translated.trim() });
    } catch (error) {
      console.warn(`[translate] ${GEMINI_MODELS[m]} failed:`, (error as Error)?.message ?? error);
    }
  }
  return Response.json({ error: 'Translation unavailable.' }, { status: 502 });
}
