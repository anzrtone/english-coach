import { toPlainText } from './plainText';

// MyMemory rejects queries over 500 characters; stay safely below that.
const MAX_CHUNK = 450;

// Structural prefixes kept untranslated so the result renders like the original:
// headings, bullets, numbered items and blockquotes.
const PREFIX_RE = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)*)(.*)$/;
const RULE_RE = /^\s*([-*_]\s*){3,}$/;

async function translateChunk(text: string, from: string, to: string): Promise<string> {
  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`,
  );
  const data = await res.json();
  // MyMemory reports quota/limit errors with HTTP 200 and a non-200 responseStatus.
  if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) {
    throw new Error(data.responseDetails || 'Translation unavailable.');
  }
  return data.responseData.translatedText;
}

/** Splits long text on sentence boundaries into chunks under MAX_CHUNK characters. */
function splitSentences(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
    if (current && current.length + sentence.length + 1 > MAX_CHUNK) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  // A single sentence can still be too long; hard-cut as a last resort.
  return chunks.flatMap((c) => c.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK}}`, 'g')) ?? []);
}

async function translateLine(text: string, from: string, to: string): Promise<string> {
  const parts = await Promise.all(splitSentences(text).map((c) => translateChunk(c, from, to)));
  return parts.join(' ');
}

// A quoted English example, optionally bold inside or outside the quotes:
// "Hello", **"Hello"**, "**Hello**".
const QUOTE_RE = /\*{0,2}["“]\*{0,2}[^"”\n]+?\*{0,2}["”]\*{0,2}/g;

/**
 * Fallback for lines that contain quoted English examples: the examples stay
 * in English with their meaning in brackets, and only the text around them is
 * translated, so the lesson isn't lost.
 */
async function translateKeepingQuotes(rest: string, translate: (text: string) => Promise<string>): Promise<string> {
  const pieces: Promise<string>[] = [];
  let last = 0;
  const prose = async (text: string) => {
    const plain = toPlainText(text);
    return /\p{L}/u.test(plain) ? ` ${await translate(plain)} ` : text;
  };
  for (const match of rest.matchAll(QUOTE_RE)) {
    pieces.push(prose(rest.slice(last, match.index)));
    const quote = match[0];
    pieces.push(translate(toPlainText(quote).replace(/["“”]/g, '')).then((meaning) => `${quote} (${meaning})`));
    last = match.index + quote.length;
  }
  pieces.push(prose(rest.slice(last)));
  return (await Promise.all(pieces)).join('').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Translates one of Lingo's messages for the learner. Gemini (/api/translate)
 * explains the lesson in their language while keeping the English being taught;
 * MyMemory is the fallback when Gemini is unavailable.
 */
export async function translateMarkdown(markdown: string, from: string, to: string): Promise<string> {
  if (from === 'en') {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: markdown, to }),
      });
      if (res.ok) return (await res.json()).text;
    } catch {
      // Network error: fall through to MyMemory.
    }
  }
  return translateWithMyMemory(markdown, from, to);
}

/**
 * Translates Markdown line by line with MyMemory so paragraphs, headings and
 * lists survive. Inline formatting is dropped from translated text, except for
 * quoted English examples, which are kept as written.
 */
async function translateWithMyMemory(markdown: string, from: string, to: string): Promise<string> {
  const lines = markdown.split('\n');
  const cache = new Map<string, Promise<string>>();

  const translated = await Promise.all(
    lines.map(async (line) => {
      if (!line.trim()) return '';
      if (RULE_RE.test(line)) return line;
      const [, prefix, rest] = line.match(PREFIX_RE)!;
      if (from === 'en' && rest.match(QUOTE_RE)) {
        return prefix + (await translateKeepingQuotes(rest, (text) => translateLine(text, from, to)));
      }
      const content = toPlainText(rest);
      if (!content) return prefix.trimEnd();
      if (!cache.has(content)) cache.set(content, translateLine(content, from, to));
      let result = (await cache.get(content))!;
      // Keep a bold lead-in label ("**Temperature:** …") bold in the translation.
      const colon = result.search(/[:：]/);
      if (/^\*\*[^*]+(:\*\*|\*\*:)/.test(rest) && colon > 0) {
        result = `**${result.slice(0, colon + 1)}**${result.slice(colon + 1)}`;
      } else if (/^\*\*[^*]+\*\*$/.test(rest.trim())) {
        // Whole line bold, e.g. "**1. Telling your employer**" used as a sub-heading.
        result = `**${result}**`;
      }
      // "1. Foo" that wasn't a list item in the original must not become one.
      if (!/\d+[.)]\s/.test(prefix)) result = result.replace(/^(\d+)([.)])/, '$1\\$2');
      return prefix + result;
    }),
  );

  return translated.join('\n');
}
