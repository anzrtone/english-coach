import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Speech-to-text with the browser's Web Speech API (free, no API key).
 * Supported in Chrome, Edge, Safari and Android Chrome; not in Firefox.
 * Needs a secure context (https or localhost).
 */

// lib.dom doesn't ship SpeechRecognition types yet — declare what we use.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Please allow the microphone in your browser settings.',
  'service-not-allowed': 'Microphone access is blocked. Please allow the microphone in your browser settings.',
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  'audio-capture': 'No microphone was found on this device.',
  network: 'Voice input needs an internet connection.',
  'language-not-supported': "Voice input isn't available for this language in your browser.",
};

const noopSubscribe = () => () => {};
const isSupported = () => !!getRecognitionCtor();

export function useSpeechInput() {
  const supported = useSyncExternalStore(noopSubscribe, isSupported, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  /** Starts listening; `onTranscript` receives the full text heard so far on every update. */
  const start = useCallback((locale: string, onTranscript: (text: string) => void) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.lang = locale;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // Android Chrome repeats results in continuous mode, so there it stops
    // after one sentence; elsewhere it keeps listening until tapped off.
    recognition.continuous = !/Android/i.test(navigator.userAgent);

    recognition.onresult = (e) => {
      const text = Array.from(e.results, (result) => result[0].transcript.trim()).join(' ');
      onTranscript(text.replace(/\s+/g, ' ').trim());
    };
    recognition.onerror = (e) => {
      if (e.error === 'aborted') return;
      setError(ERROR_MESSAGES[e.error] ?? 'Voice input stopped. Please try again.');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
      }
    };

    setError(null);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError('Voice input could not start. Please try again.');
    }
  }, []);

  /** Stops listening and keeps what was heard. */
  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  /** Stops listening immediately and discards any pending result. */
  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();
    setListening(false);
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, error, start, stop, cancel, clearError: () => setError(null) };
}
