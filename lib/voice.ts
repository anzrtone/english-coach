// Natural-voice settings, shared by /api/speak and scripts/generate-preset-audio.mjs
// so pre-generated clips sound the same as live ones.

export const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
// "Sulafat" is Gemini's warm voice — friendly without sounding like an ad.
export const TTS_VOICE = 'Sulafat';
export const TTS_STYLE =
  'Read this aloud in a warm, friendly, encouraging voice, speaking clearly and at a calm pace for someone learning the language';
