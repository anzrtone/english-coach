'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { BookOpenIcon, GlobeIcon, PaperAirplaneIcon, SparklesIcon } from './icons';

interface LanguageOption {
  code: string;
  name: string;
  native: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇧🇩' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog', flag: '🇵🇭' },
  { code: 'ur', name: 'Urdu', native: 'اردو', flag: '🇵🇰' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa', flag: '🇮🇩' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
];

const WELCOME_MESSAGE = `👋 Hello! I'm **Lingo**, your English coach for **caregivers, babysitters, elder home aides, & hospitality workers**.

I'm here to help you practice English for real daily situations — giving daily care updates to parents/employers, medicine routines, emergency safety, and comforting words.

Feel free to write in English (even if it's not perfect!). You can also click **Translate** below any message to see it in your native language.`;

const CAREGIVER_SUGGESTIONS = [
  { icon: '👶', text: 'Daily report to parents (nap times, meals, mood)' },
  { icon: '👵', text: 'Comforting an upset elderly person safely' },
  { icon: '💊', text: 'Explaining medicine time & doses to an employer' },
  { icon: '🚨', text: 'Emergency English: Reporting a fever or fall' },
];

interface TranslationState {
  [messageId: string]: {
    text?: string;
    loading?: boolean;
    error?: string;
    visible?: boolean;
  };
}

function formatMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const lines = part.split('\n');
    return lines.map((line, j) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < lines.length - 1 && <br />}
      </span>
    ));
  });
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

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
    sendMessage({ text: trimmed });
    setInputValue('');
  };

  const handleSuggestionClick = (promptText: string) => {
    if (isStreaming) return;
    sendMessage({ text: promptText });
  };

  const handleTranslate = async (messageId: string, rawText: string) => {
    const current = translations[messageId];

    // If already translated and visible, toggle off
    if (current?.text && current?.visible) {
      setTranslations((prev) => ({
        ...prev,
        [messageId]: { ...prev[messageId], visible: false },
      }));
      return;
    }

    // If already translated but hidden, toggle on
    if (current?.text && !current?.visible) {
      setTranslations((prev) => ({
        ...prev,
        [messageId]: { ...prev[messageId], visible: true },
      }));
      return;
    }

    // Otherwise fetch translation via MyMemory API
    setTranslations((prev) => ({
      ...prev,
      [messageId]: { loading: true, visible: true },
    }));

    try {
      const cleanText = rawText.replace(/\*\*/g, '');
      const encodedText = encodeURIComponent(cleanText.slice(0, 500));
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|${userLang.code}`
      );
      const data = await res.json();
      const translatedText = data.responseData?.translatedText || 'Translation unavailable.';

      setTranslations((prev) => ({
        ...prev,
        [messageId]: {
          text: translatedText,
          loading: false,
          visible: true,
        },
      }));
    } catch {
      setTranslations((prev) => ({
        ...prev,
        [messageId]: {
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
              <p className="message-text">{formatMarkdown(WELCOME_MESSAGE)}</p>
              
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
                <button
                  onClick={() => handleTranslate('welcome', WELCOME_MESSAGE)}
                  className="translate-btn"
                >
                  <GlobeIcon className="w-3.5 h-3.5" />
                  <span>
                    {translations['welcome']?.visible
                      ? 'Hide Translation'
                      : `Translate to ${userLang.native}`}
                  </span>
                </button>
              </div>

              {/* Translation box */}
              {translations['welcome']?.visible && (
                <div className="translated-box">
                  <div className="translated-header">
                    <span>{userLang.flag} {userLang.name} Translation</span>
                  </div>
                  {translations['welcome'].loading ? (
                    <span className="text-violet-300">Translating…</span>
                  ) : (
                    <p>{translations['welcome'].text || translations['welcome'].error}</p>
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

            const tState = translations[message.id];

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
                  <p className="message-text">
                    {textParts.map((part, i) =>
                      part.type === 'text' ? (
                        <span key={i}>{formatMarkdown(part.text)}</span>
                      ) : null,
                    )}
                  </p>

                  {/* Translation Button on chat bubble */}
                  <div className="translate-bar">
                    <button
                      onClick={() => handleTranslate(message.id, fullText)}
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
                      </div>
                      {tState.loading ? (
                        <span className="text-violet-300">Translating…</span>
                      ) : (
                        <p>{tState.text || tState.error}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

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
              placeholder={isStreaming ? 'Lingo is typing…' : 'Ask about caregiver English or practice daily situations…'}
              className="chat-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="true"
            />
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
          <p className="input-hint">Press Enter to send · Click "Translate" under any message for {userLang.native} translation</p>
        </div>
      </footer>
    </div>
  );
}
