import {
  generateText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@/lib/gemini';
import { findCutOff } from '@/lib/replyCheck';
import { GEMINI_MODELS, SYSTEM_PROMPT } from '@/lib/prompt';

// Room for a regeneration or two when a reply comes back cut off.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;


const isOverloaded = (error: unknown) =>
  /503|UNAVAILABLE|high demand|overloaded/i.test(String((error as Error)?.message ?? error));

class IncompleteReplyError extends Error {
  constructor() {
    super('Model kept returning incomplete replies');
  }
}

/** Turns stream errors into a safe, user-facing message (details stay in the server log). */
function describeError(error: unknown): string {
  console.error('[chat]', error);
  const text = String((error as Error)?.message ?? error);
  if (error instanceof IncompleteReplyError) {
    return "Sorry, I couldn't finish that answer. Please try asking again.";
  }
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(text)) {
    return 'Lingo is overloaded right now. Please try again in a moment.';
  }
  if (/429|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(text)) {
    return 'Lingo is very busy right now. Please wait a minute and try again.';
  }
  return 'Sorry, something went wrong. Please try again.';
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let models;

  if (google) {
    const gemini = google;
    models = GEMINI_MODELS.map((id) => gemini(id));
  } else if (gatewayKey || openaiKey) {
    const apiKey = gatewayKey || openaiKey;
    const isGateway = apiKey?.startsWith('vck_') || !!gatewayKey;
    const openai = createOpenAI({
      apiKey: apiKey,
      ...(isGateway ? { baseURL: 'https://ai-gateway.vercel.sh/v1' } : {}),
    });
    models = [openai(isGateway ? 'openai/gpt-4o-mini' : 'gpt-4o-mini')];
  } else {
    return new Response(
      JSON.stringify({ error: 'Missing API key. Please set GEMINI_API_KEYS (comma-separated) or GOOGLE_GENERATIVE_AI_API_KEY in your .env.local file.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const modelMessages = await convertToModelMessages(messages);

  // The reply is generated in full on the server and checked before anything
  // reaches the user. A reply that ended early is regenerated; the user only
  // ever receives a complete one (or a friendly error).
  const stream = createUIMessageStream({
    onError: describeError,
    execute: async ({ writer }) => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let result;
        for (let m = 0; ; m++) {
          try {
            result = await generateText({
              model: models[m],
              instructions: SYSTEM_PROMPT,
              messages: modelMessages,
              maxRetries: 3,
            });
            break;
          } catch (error) {
            if (m + 1 >= models.length || !(isOverloaded(error) || /429|RESOURCE_EXHAUSTED/i.test(String((error as Error)?.message)))) throw error;
            console.warn(`[chat] ${GEMINI_MODELS[m]} unavailable; falling back to ${GEMINI_MODELS[m + 1]}.`);
          }
        }
        const { text, finishReason, rawFinishReason } = result;

        const problem = findCutOff(text, finishReason);
        if (!problem) {
          writer.write({ type: 'start' });
          writer.write({ type: 'text-start', id: 'reply' });
          writer.write({ type: 'text-delta', id: 'reply', delta: text });
          writer.write({ type: 'text-end', id: 'reply' });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return;
        }

        console.warn(
          `[chat] attempt ${attempt}/${MAX_ATTEMPTS} cut off (${problem}; finish: ${finishReason}, raw: ${rawFinishReason}); ` +
            (attempt < MAX_ATTEMPTS ? 'regenerating.' : 'giving up.'),
        );
      }
      throw new IncompleteReplyError();
    },
  });

  return createUIMessageStreamResponse({ stream });
}
