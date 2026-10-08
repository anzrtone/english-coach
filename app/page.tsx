'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, generateId } from 'ai';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpenIcon,
  GlobeIcon,
  MicrophoneIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  StopIcon,
} from './icons';
import { Markdown } from './components/Markdown';
import { translateMarkdown } from '@/lib/translate';
import { CAREGIVER_SUGGESTIONS, WELCOME_MESSAGE } from '@/lib/content';
import PRESETS from '@/lib/presets.json';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useSpeechOutput } from '@/hooks/useSpeechOutput';

interface LanguageOption {
  code: string;
  name: string;
  native: string;
  flag: string;
  /** BCP-47 locale for speech recognition and voices. */
  speech: string;
}

const ENGLISH_SPEECH = 'en-US';

const LANGUAGES: LanguageOption[] = [
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇧🇩', speech: 'bn-BD' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', speech: 'hi-IN' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog', flag: '🇵🇭', speech: 'fil-PH' },
  { code: 'ur', name: 'Urdu', native: 'اردو', flag: '🇵🇰', speech: 'ur-PK' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦', speech: 'ar-AE' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸', speech: 'es-ES' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa', flag: '🇮🇩', speech: 'id-ID' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳', speech: 'vi-VN' },
];

// Pre-generated (scripts/generate-presets.mjs): replies to the starter
// suggestions and translations, so they load instantly without API calls.
type PresetTranslations = Partial<Record<string, string>>;
const WELCOME_TRANSLATIONS: PresetTranslations = PRESETS.welcome.translations;
const PRESET_REPLIES = new Map<string, { reply: string; translations: Partial<Record<string, { prompt: string; reply: string }>> }>(
  PRESETS.suggestions.map((s) => [s.prompt, s]),
);
// Brief "typing…" pause before a pre-generated reply appears, so it feels natural.
const PRESET_TYPING_MS = 900;

/** Translations stored on a message (pre-generated replies carry them). */
function presetTranslationsOf(message: { metadata?: unknown }): PresetTranslations | undefined {
  return (message.metadata as { translations?: PresetTranslations } | undefined)?.translations;
}

interface TranslationState {
  [messageId: string]: {
    text?: string;
    loading?: boolean;
    error?: string;
    visible?: boolean;
  };
}

const RTL_LANGS = new Set(['ar', 'ur']);

function TranslatedText({ lang, text, error }: { lang: string; text?: string; error?: string }) {
  return (
    <div className="translated-text" lang={lang} dir={RTL_LANGS.has(lang) ? 'rtl' : 'ltr'}>
      {text ? <Markdown>{text}</Markdown> : <p>{error}</p>}
    </div>
  );
}

function SpeakButton({
  speaking,
  loading = false,
  notice,
  onClick,
  label = 'Listen',
}: {
  speaking: boolean;
  loading?: boolean;
  notice?: string;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`translate-btn ${speaking ? 'translate-btn--active' : ''}`}
      aria-pressed={speaking}
    >
      {speaking ? <StopIcon className="w-3.5 h-3.5" /> : <SpeakerWaveIcon className="w-3.5 h-3.5" />}
      <span>{loading ? 'Loading voice…' : speaking ? 'Stop' : notice ?? label}</span>
    </button>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 mb-4">
      <div className="avatar-icon flex-shrink-0">
        <SparklesIcon className="w-4 h-4 text-violet-300" />
      </div>
      <div className="glass-bubble typing-bubble">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [inputValue, setInputValue] = useState('');
  const [userLang, setUserLang] = useState<LanguageOption>(LANGUAGES[0]); // Default Bengali
  const [showLangModal, setShowLangModal] = useState(false);
  const [translations, setTranslations] = useState<TranslationState>({});
  // IDs of AI replies that ended before the model finished (limit, filter, dropped connection).
  const [cutOffIds, setCutOffIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onFinish: ({ message, finishReason, isDisconnect, isError }) => {
      const hasText = message.parts.some((p) => p.type === 'text' && p.text.trim());
      if (message.role === 'assistant' && hasText && (isDisconnect || isError || (finishReason && finishReason !== 'stop'))) {
        setCutOffIds((prev) => new Set(prev).add(message.id));
      }
    },
  });

  const [presetTyping, setPresetTyping] = useState(false);
  const isStreaming = status === 'streaming' || status === 'submitted' || presetTyping;
  // Translations are remembered per message *and* language.
  const tKey = (id: string) => `${id}|${userLang.code}`;
  const streamingMessageId = isStreaming ? messages.at(-1)?.id : undefined;

  const speech = useSpeechOutput();
  const voiceInput = useSpeechInput();
  // Which language the mic listens for: English practice, or the native language.
  const [micLang, setMicLang] = useState<'en' | 'native'>('en');

  const handleSpeak = (id: string, text: string, locale: string) => {
    if (speech.speakingId === id) speech.stop();
    else speech.speak(id, text, locale);
  };

  const handleMicClick = () => {
    if (voiceInput.listening) {
      voiceInput.stop();
      return;
    }
    speech.stop(); // don't let the mic hear Lingo talking
    const before = inputValue.trim();
    voiceInput.start(micLang === 'en' ? ENGLISH_SPEECH : userLang.speech, (heard) => {
      setInputValue(before ? `${before} ${heard}` : heard);
    });
    inputRef.current?.focus();
  };

  // Load language preference from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('lingo_user_lang');
    if (saved) {
      const found = LANGUAGES.find((l) => l.code === saved);
      if (found) {
        setUserLang(found);
        return;
      }
    }
    // If no saved language, open language selection modal automatically
    setShowLangModal(true);
  }, []);

  const handleSelectLanguage = (lang: LanguageOption) => {
    setUserLang(lang);
    localStorage.setItem('lingo_user_lang', lang.code);
    setShowLangModal(false);
  };

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, translations]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    voiceInput.cancel();
    sendMessage({ text: trimmed });
    setInputValue('');
  };

  const handleContinue = (messageId: string) => {
    if (isStreaming) return;
    setCutOffIds((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    sendMessage({ text: 'Please continue exactly where you stopped.' });
  };

  const handleSuggestionClick = (promptText: string) => {
    if (isStreaming) return;
    const preset = PRESET_REPLIES.get(promptText);
    if (!preset) {
      sendMessage({ text: promptText });
      return;
    }
    // Pre-generated reply: no API call. Both messages carry their translations.
    const byLang = (pick: 'prompt' | 'reply') =>
      Object.fromEntries(Object.entries(preset.translations).map(([lang, t]) => [lang, t![pick]]));
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: 'user',
        parts: [{ type: 'text', text: promptText }],
        metadata: { translations: byLang('prompt') },
      },
    ]);
    setPresetTyping(true);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          parts: [{ type: 'text', text: preset.reply }],
          metadata: { translations: byLang('reply') },
        },
      ]);
      setPresetTyping(false);
    }, PRESET_TYPING_MS);
  };

  const handleTranslate = async (messageId: string, rawText: string, preset?: PresetTranslations) => {
    const key = tKey(messageId);
    const current = translations[key];

    // If already translated and visible, toggle off
    if (current?.text && current?.visible) {
      setTranslations((prev) => ({
        ...prev,
        [key]: { ...prev[key], visible: false },
      }));
      return;
    }

    // If already translated but hidden, toggle on
    if (current?.text && !current?.visible) {
      setTranslations((prev) => ({
        ...prev,
        [key]: { ...prev[key], visible: true },
      }));
      return;
    }

    // Pre-generated translation: show it instantly.
    const presetText = preset?.[userLang.code];
    if (presetText) {
      setTranslations((prev) => ({ ...prev, [key]: { text: presetText, visible: true } }));
      return;
    }

    // Otherwise fetch translation via MyMemory API
    setTranslations((prev) => ({
      ...prev,
      [key]: { loading: true, visible: true },
    }));

    try {
      const translatedText = await translateMarkdown(rawText, 'en', userLang.code);

      setTranslations((prev) => ({
        ...prev,
        [key]: {
          text: translatedText,
          loading: false,
          visible: true,
        },
      }));
    } catch {
      setTranslations((prev) => ({
        ...prev,
        [key]: {
          error: 'Could not load translation.',
          loading: false,
          visible: true,
        },
      }));
    }
  };

  return (
    <div className="app-shell">
      {/* ── Native Language Modal ── */}
      {showLangModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="modal-title">Welcome to Lingo 👋</h2>
              <p className="modal-subtitle">What is your primary native language?</p>
            </div>
            <div className="language-grid">
              {LANGUAGES.map((lang) => {
                const isSelected = userLang.code === lang.code;
                return (
                  <button
                    key={lang.code}
                    onClick={() => handleSelectLanguage(lang)}
                    className={`language-card ${isSelected ? 'language-card--selected' : ''}`}
                  >
                    <div>
                      <div className="lang-name-native">{lang.flag} {lang.native}</div>
                      <div className="lang-name-en">{lang.name}</div>
                    </div>
                    {isSelected && <span className="text-violet-400 font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowLangModal(false)}
              className="modal-confirm-btn"
            >
              Start Learning in English →
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-icon">
              <BookOpenIcon className="w-5 h-5 text-violet-300" />
            </div>
            <div>
              <h1 className="brand-title">Lingo</h1>
              <p className="brand-subtitle">English Coach for Caregivers</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowLangModal(true)}
              className="lang-selector-btn"
              title="Change your native language"
            >
              <GlobeIcon className="w-4 h-4 text-violet-400" />
              <span>{userLang.flag} {userLang.native}</span>
            </button>
            {speech.supported && (
              <button onClick={speech.cycleRate} className="lang-selector-btn" title="Change how fast Lingo speaks">
                <SpeakerWaveIcon className="w-4 h-4 text-violet-400" />
                <span>{speech.rateLabel}</span>
              </button>
            )}
            <div className="header-badge">
              <span className="badge-dot" />
              <span className="badge-text">Free</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Message Area ── */}
      <main className="messages-area">
        <div className="messages-container">
          {/* Welcome message */}
          <div className="message-row message-row--ai animate-slide-up">
            <div className="avatar-icon flex-shrink-0">
              <SparklesIcon className="w-4 h-4 text-violet-300" />
            </div>
            <div className="glass-bubble">
              <div className="message-text">
                <Markdown>{WELCOME_MESSAGE}</Markdown>
              </div>
              
              {/* Caregiver suggestion chips */}
              <div className="suggestion-section">
                <div className="suggestion-title">
                  <span>💡 Try asking Lingo:</span>
                </div>
                <div className="suggestion-grid">
                  {CAREGIVER_SUGGESTIONS.map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSuggestionClick(chip.text)}
                      disabled={isStreaming}
                      className="suggestion-chip"
                    >
                      <span>{chip.icon}</span>
                      <span>{chip.text}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Welcome message translation button */}
              <div className="translate-bar">
                {speech.supported && (
                  <SpeakButton
                    speaking={speech.speakingId === 'welcome'}
                    loading={speech.loadingId === 'welcome'}
                    notice={speech.notice?.id === 'welcome' ? speech.notice.text : undefined}
                    onClick={() => handleSpeak('welcome', WELCOME_MESSAGE, ENGLISH_SPEECH)}
                  />
                )}
                <button
                  onClick={() => handleTranslate('welcome', WELCOME_MESSAGE, WELCOME_TRANSLATIONS)}
                  className="translate-btn"
                >
                  <GlobeIcon className="w-3.5 h-3.5" />
                  <span>
                    {translations[tKey('welcome')]?.visible
                      ? 'Hide Translation'
                      : `Translate to ${userLang.native}`}
                  </span>
                </button>
              </div>

              {/* Translation box */}
              {translations[tKey('welcome')]?.visible && (
                <div className="translated-box">
                  <div className="translated-header">
                    <span>{userLang.flag} {userLang.name} Translation</span>
                    {translations[tKey('welcome')].text && speech.canSpeak(userLang.speech) && (
                      <SpeakButton
                        speaking={speech.speakingId === 'welcome:tr'}
                        loading={speech.loadingId === 'welcome:tr'}
                        notice={speech.notice?.id === 'welcome:tr' ? speech.notice.text : undefined}
                        onClick={() => handleSpeak('welcome:tr', translations[tKey('welcome')].text!, userLang.speech)}
                      />
                    )}
                  </div>
                  {translations[tKey('welcome')].loading ? (
                    <span className="text-violet-300">Translating…</span>
                  ) : (
                    <TranslatedText lang={userLang.code} text={translations[tKey('welcome')].text} error={translations[tKey('welcome')].error} />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Chat messages */}
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const textParts = message.parts.filter((p) => p.type === 'text');
            if (textParts.length === 0) return null;
            const fullText = textParts.map((p) => (p.type === 'text' ? p.text : '')).join('');

            const tState = translations[tKey(message.id)];
            const isMessageStreaming = message.id === streamingMessageId;

            return (
              <div
                key={message.id}
                className={`message-row animate-slide-up ${isUser ? 'message-row--user' : 'message-row--ai'}`}
              >
                {!isUser && (
                  <div className="avatar-icon flex-shrink-0">
                    <SparklesIcon className="w-4 h-4 text-violet-300" />
                  </div>
                )}
                <div className={isUser ? 'user-bubble' : 'glass-bubble'}>
                  <div className="message-text">
                    <Markdown>{fullText}</Markdown>
                  </div>

                  {/* Notice when the reply ended early */}
                  {cutOffIds.has(message.id) && (
                    <div className="cutoff-notice">
                      <span>⚠️ This reply was cut off.</span>
                      <button onClick={() => handleContinue(message.id)} disabled={isStreaming} className="cutoff-continue-btn">
                        Continue
                      </button>
                    </div>
                  )}

                  {/* Translation Button on chat bubble */}
                  <div className="translate-bar">
                    {speech.supported && !isMessageStreaming && (
                      <SpeakButton
                        speaking={speech.speakingId === message.id}
                        loading={speech.loadingId === message.id}
                        notice={speech.notice?.id === message.id ? speech.notice.text : undefined}
                        onClick={() => handleSpeak(message.id, fullText, ENGLISH_SPEECH)}
                      />
                    )}
                    <button
                      onClick={() => handleTranslate(message.id, fullText, presetTranslationsOf(message))}
                      disabled={isMessageStreaming}
                      title={isMessageStreaming ? 'Wait for the reply to finish' : undefined}
                      className="translate-btn"
                    >
                      <GlobeIcon className="w-3.5 h-3.5" />
                      <span>
                        {tState?.visible
                          ? 'Hide Translation'
                          : `Translate to ${userLang.native}`}
                      </span>
                    </button>
                  </div>

                  {/* Translation result box */}
                  {tState?.visible && (
                    <div className="translated-box">
                      <div className="translated-header">
                        <span>{userLang.flag} {userLang.name} Translation</span>
                        {tState.text && speech.canSpeak(userLang.speech) && (
                          <SpeakButton
                            speaking={speech.speakingId === `${message.id}:tr`}
                            loading={speech.loadingId === `${message.id}:tr`}
                            notice={speech.notice?.id === `${message.id}:tr` ? speech.notice.text : undefined}
                            onClick={() => handleSpeak(`${message.id}:tr`, tState.text!, userLang.speech)}
                          />
                        )}
                      </div>
                      {tState.loading ? (
                        <span className="text-violet-300">Translating…</span>
                      ) : (
                        <TranslatedText lang={userLang.code} text={tState.text} error={tState.error} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Error from the chat API (e.g. all API keys rate-limited) */}
          {error && !isStreaming && (
            <div className="message-row message-row--ai animate-slide-up">
              <div className="avatar-icon flex-shrink-0">
                <SparklesIcon className="w-4 h-4 text-violet-300" />
              </div>
              <div className="glass-bubble error-bubble">
                <p className="message-text">{error.message || 'Sorry, something went wrong. Please try again.'}</p>
              </div>
            </div>
          )}

          {/* Streaming / typing indicator */}
          {isStreaming && <TypingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Input Bar ── */}
      <footer className="input-footer">
        <div className="input-container">
          <form onSubmit={handleSubmit} className="input-form">
            <input
              ref={inputRef}
              id="chat-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isStreaming}
              readOnly={voiceInput.listening}
              placeholder={
                isStreaming
                  ? 'Lingo is typing…'
                  : voiceInput.listening
                    ? 'Listening… speak now'
                    : 'Ask about caregiver English or practice daily situations…'
              }
              className="chat-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="true"
            />
            {voiceInput.supported && (
              <>
                <button
                  type="button"
                  onClick={() => setMicLang((l) => (l === 'en' ? 'native' : 'en'))}
                  disabled={voiceInput.listening}
                  className="mic-lang-btn"
                  title={`Voice input language: ${micLang === 'en' ? 'English' : userLang.name} (tap to switch)`}
                >
                  {micLang === 'en' ? 'EN' : userLang.code.toUpperCase()}
                </button>
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={isStreaming}
                  className={`mic-button ${voiceInput.listening ? 'mic-button--listening' : ''}`}
                  aria-label={voiceInput.listening ? 'Stop voice input' : 'Speak your message'}
                  aria-pressed={voiceInput.listening}
                >
                  {voiceInput.listening ? <StopIcon className="w-5 h-5" /> : <MicrophoneIcon className="w-5 h-5" />}
                </button>
              </>
            )}
            <button
              type="submit"
              id="send-button"
              disabled={isStreaming || !inputValue.trim()}
              className="send-button"
              aria-label="Send message"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </form>
          {voiceInput.error ? (
            <p className="input-hint input-hint--error" role="alert">{voiceInput.error}</p>
          ) : voiceInput.listening ? (
            <p className="input-hint">
              🎤 Listening in {micLang === 'en' ? 'English' : userLang.name}… tap the stop button when you finish
            </p>
          ) : (
            <p className="input-hint">
              Press Enter to send · Tap 🎤 to speak · Tap &ldquo;Listen&rdquo; to hear a message
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
