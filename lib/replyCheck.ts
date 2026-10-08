import type { FinishReason } from 'ai';

/**
 * Returns why a reply looks cut off, or null if it looks complete. Besides the
 * model's own finish reason, Gemini sometimes reports "stop" on a truncated
 * reply, so the Markdown itself is checked for a dangling ending.
 */
export function findCutOff(text: string, finishReason: FinishReason): string | null {
  if (finishReason !== 'stop') return `finish reason "${finishReason}"`;
  const trimmed = text.trim();
  if (!trimmed) return 'empty reply';
  if ((trimmed.replace(/\*\*\*/g, '').match(/\*\*/g) ?? []).length % 2 !== 0) return 'unclosed bold';
  if ((trimmed.match(/```/g) ?? []).length % 2 !== 0) return 'unclosed code block';
  const lastLine = trimmed.split('\n').at(-1)!.trim();
  if (/^#{1,6}\s/.test(lastLine)) return 'ends on a heading';
  if (/[:,(\[]$/.test(lastLine)) return 'ends mid-sentence';
  return null;
}
