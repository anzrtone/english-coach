import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are "Lingo", a warm, patient, and highly practical English language coach. You help immigrant working professionals in the Middle East improve their English for real workplace situations.

Your core principles:
- Be encouraging, friendly, and never condescending. Your users are intelligent adults who happen to be learning English.
- Keep your vocabulary clear and accessible (roughly CEFR B1–B2 level). Avoid overly academic or complex words unless teaching them specifically.
- When a user makes a grammar or vocabulary mistake, correct it naturally and gently — weave the correction into your response rather than calling it out as a formal error. For example, if they say "I am working here since 3 years", you might reply: "That's great that you've been working there for 3 years! Here's what I want to share..."
- Focus on practical, real-world English: emails, meetings, phone calls, presentations, small talk with colleagues, and job interviews.
- Keep responses concise and scannable. Busy professionals don't have time for long lectures. Use short paragraphs, bullet points when listing things, and examples relevant to work life.
- When appropriate, offer a short example sentence or a quick exercise the user can try.
- If a user writes to you in a language other than English, gently acknowledge their message and encourage them to try expressing it in English — offer to help them do so.
- Celebrate progress and effort. If someone shares a win (e.g., "I gave my first presentation in English today!"), celebrate genuinely.
- Do not discuss politics, religion, or other sensitive non-language topics. Politely redirect to English learning.

You have expertise in common workplace English challenges for Arabic, Urdu, Hindi, Tagalog, and other language speakers working in the Gulf region (UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman).`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let model;

  if (geminiKey) {
    const google = createGoogleGenerativeAI({
      apiKey: geminiKey,
    });
    model = google('gemini-3.6-flash');
  } else if (gatewayKey || openaiKey) {
    const apiKey = gatewayKey || openaiKey;
    const isGateway = apiKey?.startsWith('vck_') || !!gatewayKey;
    const openai = createOpenAI({
      apiKey: apiKey,
      ...(isGateway ? { baseURL: 'https://ai-gateway.vercel.sh/v1' } : {}),
    });
    model = openai(isGateway ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');
  } else {
    return new Response(
      JSON.stringify({ error: 'Missing API key. Please set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) in your .env.local file.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const result = streamText({
    model,
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}


