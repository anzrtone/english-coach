import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { textKey, toSpeechText } from '@/lib/plainText';
// Pre-generated MP3s for the starter content (scripts/generate-preset-audio.mjs).
import PRESET_AUDIO from '@/lib/presetAudio.json';

/**
 * Text-to-speech with two engines:
 *
 * 1. Natural voice — Gemini TTS via /api/speak (free tier). Text is sent in
 *    pieces: a short first piece so audio starts quickly, then larger pieces
 *    fetched while the previous one plays. Audio is cached per piece, so
 *    replays are instant and cost no quota.
 * 2. Browser voice — the device's built-in voices. Used when the natural
 *    voice fails or is rate-limited (it then rests for a minute).
 */

const NATURAL_VOICE_RE = /natural|neural|online|google|premium|enhanced/i;
const BROWSER_MAX_CHUNK = 220;
const NATURAL_FIRST_CHUNK = 200;
const NATURAL_CHUNK = 700;
const NATURAL_COOLDOWN_MS = 60_000;
// How many natural-voice pieces to have requested ahead of playback.
const NATURAL_LOOKAHEAD = 2;

// Natural audio plays at its own pace, so it needs less slowing down than
// the browser voices to sound like the same "Slow / Normal / Fast".
export const SPEECH_RATES = [
  { label: 'Slow', browser: 0.75, audio: 0.85 },
  { label: 'Normal', browser: 0.9, audio: 1 },
  { label: 'Fast', browser: 1.1, audio: 1.15 },
] as const;

// Playing this silent clip during the tap unlocks audio on iOS Safari, which
// otherwise blocks sound that starts after a network request.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const hasSynth = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const hasAudio = () => typeof window !== 'undefined' && typeof Audio !== 'undefined';
const canPlayAnything = () => hasSynth() || hasAudio();

// getVoices() returns a new array on every call; cache it so React's
// useSyncExternalStore sees a stable snapshot.
let cachedVoices: SpeechSynthesisVoice[] = [];
function getVoicesSnapshot(): SpeechSynthesisVoice[] {
  if (!hasSynth()) return cachedVoices;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length !== cachedVoices.length) cachedVoices = voices;
  return cachedVoices;
}
const NO_VOICES: SpeechSynthesisVoice[] = [];
const getServerVoices = () => NO_VOICES;

function subscribeVoices(onChange: () => void) {
  if (!hasSynth()) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
}

const noopSubscribe = () => () => {};

/** Language part of a locale; Tagalog voices may be labelled "tl" or "fil". */
function baseLang(locale: string): string {
  const base = locale.split('-')[0];
  return base === 'tl' ? 'fil' : base;
}

/** Finds the best-sounding installed voice for a BCP-47 locale like "bn-BD". */
function pickVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | undefined {
  const wanted = locale.toLowerCase();
  const base = baseLang(wanted);
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = -1;
  for (const voice of voices) {
    const lang = voice.lang.replace('_', '-').toLowerCase();
    if (baseLang(lang) !== base) continue;
    const score =
      (NATURAL_VOICE_RE.test(voice.name) ? 4 : 0) + (lang === wanted ? 2 : 0) + (voice.default ? 1 : 0);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** Splits plain text into sentences, breaking any sentence longer than `max` at commas/words. */
function splitSentences(plain: string, max: number): string[] {
  return plain
    .split(/\n+|(?<=[.!?।؟])\s+/)
    .flatMap((sentence) => {
      if (sentence.length <= max) return [sentence];
      const pieces: string[] = [];
      let current = '';
      for (const word of sentence.split(/(?<=,)\s+|\s+/)) {
        if (current && current.length + word.length + 1 > max) {
          pieces.push(current);
          current = '';
        }
        current = current ? `${current} ${word}` : word;
      }
      if (current) pieces.push(current);
      return pieces;
    })
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Groups sentences into natural-voice requests: a short first piece, then larger ones. */
function chunkForNatural(plain: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of splitSentences(plain, NATURAL_CHUNK)) {
    const limit = chunks.length === 0 ? NATURAL_FIRST_CHUNK : NATURAL_CHUNK;
    if (current && current.length + sentence.length + 1 > limit) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

class NaturalVoiceError extends Error {
  constructor(public status: number) {
    super(`Natural voice request failed (${status})`);
  }
}

export function useSpeechOutput() {
  const supported = useSyncExternalStore(noopSubscribe, canPlayAnything, () => false);
  const voices = useSyncExternalStore(subscribeVoices, getVoicesSnapshot, getServerVoices);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Set while waiting for the first natural-voice audio to arrive.
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rateIndex, setRateIndex] = useState(1);
  // Short message shown on a Listen button when nothing could be played.
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rate = SPEECH_RATES[rateIndex];

  // Bumped on every speak/stop so callbacks from a cancelled run are ignored.
  const runRef = useRef(0);
  // Chrome can garbage-collect utterances mid-speech (and skip onend) unless referenced.
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Audio for each text piece (object URLs), shared across replays.
  const clipCacheRef = useRef(new Map<string, Promise<string>>());
  const naturalPausedUntilRef = useRef(0);

  const getAudio = () => (audioRef.current ??= new Audio());

  const stop = useCallback(() => {
    runRef.current++;
    utterancesRef.current = [];
    if (hasSynth()) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    setSpeakingId(null);
    setLoadingId(null);
  }, []);

  /** Speaks sentences with the device's voice; resolves when done or stopped. */
  const speakWithBrowser = useCallback(
    (run: number, plain: string, locale: string, rateValue: number) =>
      new Promise<boolean>((resolve) => {
        const sentences = splitSentences(plain, BROWSER_MAX_CHUNK);
        const voice = pickVoice(voices, locale);
        // Without a voice for this language the device would read e.g.
        // Bengali with an English voice — only the digits and symbols come out.
        if (!hasSynth() || sentences.length === 0 || !voice) return resolve(false);
        utterancesRef.current = sentences.map((sentence, i) => {
          const utterance = new SpeechSynthesisUtterance(sentence);
          utterance.lang = voice.lang;
          utterance.voice = voice;
          utterance.rate = rateValue;
          if (i === sentences.length - 1) utterance.onend = () => resolve(true);
          utterance.onerror = (e) => {
            if (runRef.current !== run) return resolve(true);
            // "interrupted"/"canceled" just mean we stopped it ourselves.
            if (e.error !== 'interrupted' && e.error !== 'canceled') window.speechSynthesis.cancel();
            resolve(true);
          };
          return utterance;
        });
        utterancesRef.current.forEach((u) => window.speechSynthesis.speak(u));
      }),
    [voices],
  );

  /** Fetches (or reuses) the natural-voice clip for one piece of text. */
  const getClip = useCallback((text: string) => {
    const cache = clipCacheRef.current;
    let clip = cache.get(text);
    if (!clip) {
      clip = fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).then(async (res) => {
        if (!res.ok) throw new NaturalVoiceError(res.status);
        return URL.createObjectURL(await res.blob());
      });
      clip.catch(() => cache.delete(text));
      cache.set(text, clip);
    }
    return clip;
  }, []);

  /** Plays one clip; resolves when it ends or is stopped. */
  const playClip = useCallback((url: string, playbackRate: number) => {
    const audio = getAudio();
    // Set the source first: swapping sources can fire "pause" for the old clip.
    audio.src = url;
    audio.playbackRate = playbackRate;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.onended = audio.onpause = audio.onerror = null;
      };
      audio.onended = audio.onpause = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('Audio playback failed'));
      };
      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }, []);

  const speak = useCallback(
    async (id: string, text: string, locale: string) => {
      stop();
      setNotice(null);
      const run = runRef.current;
      const plain = toSpeechText(text);
      if (!plain) return;
      setSpeakingId(id);

      const done = () => {
        if (runRef.current !== run) return;
        utterancesRef.current = [];
        setSpeakingId(null);
        setLoadingId(null);
      };

      /** Finishes with the device voice, or explains why nothing can be played. */
      const fallBackToBrowser = async (rest: string, naturalBusy: boolean) => {
        setLoadingId(null);
        const spoke = await speakWithBrowser(run, rest, locale, rate.browser);
        if (!spoke && runRef.current === run) {
          clearTimeout(noticeTimerRef.current);
          setNotice({ id, text: naturalBusy ? 'Voice busy — try again in a minute' : 'Voice unavailable right now' });
          noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
        }
        done();
      };

      // Pre-generated clip for this exact text: play it straight away.
      const presetClip = (PRESET_AUDIO as Record<string, string>)[textKey(plain)];
      if (presetClip && hasAudio()) {
        try {
          await playClip(presetClip, rate.audio);
          return done();
        } catch {
          if (runRef.current !== run) return;
          // Missing/unplayable file: fall through to the live voices.
        }
      }

      const useNatural = hasAudio() && Date.now() >= naturalPausedUntilRef.current;
      if (!useNatural) return fallBackToBrowser(plain, true);

      // Unlock audio for iOS while we're still inside the tap.
      const audio = getAudio();
      audio.src = SILENT_WAV;
      audio.play().catch(() => {});

      const chunks = chunkForNatural(plain);
      setLoadingId(id);
      // Each Gemini request has several seconds of fixed overhead, so keep the
      // next pieces in flight while one plays (two ahead) to avoid silent gaps.
      const clips = chunks.slice(0, NATURAL_LOOKAHEAD).map(getClip);
      for (let i = 0; i < chunks.length; i++) {
        let url: string;
        try {
          url = await clips[i];
        } catch (error) {
          if (runRef.current !== run) return;
          // Rate-limited or unavailable: rest the natural voice and finish with the browser voice.
          const rateLimited = error instanceof NaturalVoiceError && error.status === 429;
          if (rateLimited) naturalPausedUntilRef.current = Date.now() + NATURAL_COOLDOWN_MS;
          return fallBackToBrowser(chunks.slice(i).join(' '), rateLimited);
        }
        if (runRef.current !== run) return;
        if (i + NATURAL_LOOKAHEAD < chunks.length) clips.push(getClip(chunks[i + NATURAL_LOOKAHEAD]));
        setLoadingId(null);
        try {
          await playClip(url, rate.audio);
        } catch {
          if (runRef.current !== run) return;
          return fallBackToBrowser(chunks.slice(i).join(' '), false);
        }
        if (runRef.current !== run) return;
      }
      done();
    },
    [stop, speakWithBrowser, getClip, playClip, rate],
  );

  /**
   * Whether this text can be read aloud in the locale. The natural voice
   * speaks most languages; otherwise the device needs a matching voice.
   * (A natural voice that is only resting after a rate limit still counts —
   * tapping Listen then explains it's busy instead of the button vanishing.)
   */
  const canSpeak = useCallback((locale: string) => hasAudio() || !!pickVoice(voices, locale), [voices]);

  const cycleRate = useCallback(() => setRateIndex((i) => (i + 1) % SPEECH_RATES.length), []);

  // Apply speed changes to audio that is already playing.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate.audio;
  }, [rate]);

  // Don't keep talking after the page is closed or hidden.
  useEffect(() => {
    const clips = clipCacheRef.current;
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stop();
      clips.forEach((clip) => clip.then(URL.revokeObjectURL, () => {}));
      clips.clear();
    };
  }, [stop]);

  return {
    supported,
    speakingId,
    loadingId,
    notice,
    speak,
    stop,
    canSpeak,
    rateLabel: rate.label,
    cycleRate,
  };
}
