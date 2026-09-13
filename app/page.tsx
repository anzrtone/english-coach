'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { BookOpenIcon, PaperAirplaneIcon, SparklesIcon } from './icons';

const WELCOME_MESSAGE = `👋 Hello! I'm **Lingo**, your personal English coach.

I'm here to help you improve your **workplace English** — emails, meetings, presentations, small talk, and more.

Feel free to write to me in English (even if it's not perfect!), ask me to explain something, or just start a conversation. I'll help you grow naturally and at your own pace.

**What would you like to practice today?**`;

function formatMarkdown(text: string): React.ReactNode {
  // Split on bold markers and render
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Handle line breaks
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus after streaming completes
  useEffect(() => {
    if (status === 'ready') {
      inputRef.current?.focus();
    }
  }, [status]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    sendMessage({ text: trimmed });
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed || isStreaming) return;
      sendMessage({ text: trimmed });
      setInputValue('');
    }
  };

  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-icon">
              <BookOpenIcon className="w-5 h-5 text-violet-300" />
            </div>
            <div>
              <h1 className="brand-title">Lingo</h1>
              <p className="brand-subtitle">English Coach for Professionals</p>
            </div>
          </div>
          <div className="header-badge">
            <span className="badge-dot" />
            <span className="badge-text">Free</span>
          </div>
        </div>
      </header>

      {/* ── Message Area ── */}
      <main className="messages-area">
        <div className="messages-container">
          {/* Welcome message (always shown) */}
          <div className="message-row message-row--ai animate-slide-up">
            <div className="avatar-icon flex-shrink-0">
              <SparklesIcon className="w-4 h-4 text-violet-300" />
            </div>
            <div className="glass-bubble">
              <p className="message-text">{formatMarkdown(WELCOME_MESSAGE)}</p>
            </div>
          </div>

          {/* Chat messages */}
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const textParts = message.parts.filter((p) => p.type === 'text');
            if (textParts.length === 0) return null;

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
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={isStreaming ? 'Lingo is typing…' : 'Write in English — I\'ll help you improve…'}
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
          <p className="input-hint">Press Enter to send · Your conversations are not stored</p>
        </div>
      </footer>
    </div>
  );
}
