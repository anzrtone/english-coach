/**
 * Strips Markdown syntax and emoji from model output, keeping line breaks.
 * Used before sending text to translation or text-to-speech.
 */
export function toPlainText(markdown: string): string {
  return (
    markdown
      // Code fences and inline code: keep the content, drop the backticks.
      .replace(/```[^\n]*\n?/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Images and links: keep the visible text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Headings, blockquotes, list markers, horizontal rules.
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
      .replace(/^\s*([-*_]\s*){3,}$/gm, '')
      // Table pipes and separator rows.
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
      .replace(/[ \t]*\|[ \t]*/g, ' ')
      // Bold / italic / strikethrough markers.
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/(^|\W)_([^_\n]+)_(?!\w)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      // Emoji and pictographs (plus variation selectors / joiners).
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
      // Tidy whitespace.
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** The exact text the Listen button reads aloud: plain text, with "a/b" read as "a, b". */
export function toSpeechText(markdown: string): string {
  return toPlainText(markdown).replace(/\s*\/\s*/g, ', ');
}

/**
 * Short stable fingerprint of a text (cyrb53 hash), used to name and look up
 * pre-generated audio clips. Shared by the app and the generator script.
 */
export function textKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
