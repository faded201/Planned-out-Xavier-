'use client';

import { useEffect, useRef, useState } from 'react';
import { XavierOrb, type XavierPhase } from '@/components/xavier-orb';
import {
  MODEL_OPTIONS,
  serverAIChat,
  type AssistantModelChoice,
} from '@/lib/ai';
import type {
  AppView,
  ModuleName,
  PlannerLevel,
  Priority,
} from '@/lib/types';

export type AssistantContext = {
  currentView: string;
  theme: string;
  stats: {
    tasks: number;
    done: number;
    overdue: number;
    records: number;
    files: number;
  };
  topTasks: Array<{
    title: string;
    level: string;
    status: string;
    priority: string;
    due: string;
    area: string;
  }>;
  recentRecords: Array<{ module: string; title: string }>;
  memory: string[];
};

export type AssistantActions = {
  getContext: () => AssistantContext;
  navigate: (view: AppView) => void;
  createTask: (input: {
    title: string;
    notes?: string;
    level?: PlannerLevel;
    priority?: Priority;
    area?: string;
    dueDate?: string;
  }) => void;
  createRecord: (module: ModuleName, title: string, body?: string) => void;
  openTask: (query: string) => { found: boolean; title?: string };
  setTheme: (theme: string) => void;
  remember: (note: string) => void;
};

type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
  model?: string;
};

const MODEL_STORAGE_KEY = 'xavier-planner-ai-model-v1';
const VOICE_STORAGE_KEY = 'planned-out-voice-replies';

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const SUGGESTIONS = [
  'Plan my week',
  'What should I focus on now?',
  'Break my biggest goal into next actions',
  'Help me prioritize everything overdue',
];

function isModelChoice(value: string): value is AssistantModelChoice {
  return MODEL_OPTIONS.some((option) => option.id === value);
}

export function AssistantPanel({ actions, premium = false, onPhaseChange }: { actions: AssistantActions; premium?: boolean; onPhaseChange?: (phase: XavierPhase) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] =
    useState<AssistantModelChoice>('auto');

  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [phase, setPhaseState] = useState<XavierPhase>('dormant');
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  function setPhase(next: XavierPhase) { setPhaseState(next); onPhaseChange?.(next); }

  useEffect(() => {
    const saved = window.localStorage.getItem(MODEL_STORAGE_KEY);

    if (saved && isModelChoice(saved)) {
      setSelectedModel(saved);
    }
    setVoiceReplies(window.localStorage.getItem(VOICE_STORAGE_KEY) === 'true');
    return () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); };
  }, []);

  function speak(reply: string) {
    if (!voiceReplies || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = 'en-AU';
    utterance.rate = 0.96;
    utterance.onstart = () => setPhase('speaking');
    utterance.onend = () => { setPhase('completed'); window.setTimeout(() => setPhase('dormant'), 900); };
    window.speechSynthesis.speak(utterance);
  }

  function runCommand(value: string): string | null {
    const task = value.match(/^(?:please )?(?:create|add|make) (?:a )?task(?: called| to)? (.+)$/i);
    if (task) {
      actionsRef.current.createTask({ title: task[1].trim() });
      return `Created the task ${task[1].trim()}.`;
    }
    const note = value.match(/^(?:please )?(?:add|create|write) (?:a )?note(?: called| saying)? (.+)$/i);
    if (note) {
      actionsRef.current.createRecord('knowledge', note[1].trim());
      return `Saved the note ${note[1].trim()}.`;
    }
    const memory = value.match(/^(?:please )?remember (?:that )?(.+)$/i);
    if (memory) {
      actionsRef.current.remember(memory[1].trim());
      return `I'll remember that: ${memory[1].trim()}.`;
    }
    const view = value.match(/^(?:please )?(?:open|show|go to) (calendar|planner|dashboard|board|focus|habits|journal|finance|settings)$/i);
    if (view) {
      actionsRef.current.navigate(view[1].toLowerCase() as AppView);
      return `Opened ${view[1]}.`;
    }
    const openTask = value.match(/^(?:please )?open task (.+)$/i);
    if (openTask) {
      const found = actionsRef.current.openTask(openTask[1]);
      return found.found ? `Opened ${found.title}.` : `I couldn't find a task named ${openTask[1]}.`;
    }
    return null;
  }

  function startListening() {
    if (listening) { recognition.current?.stop(); return; }
    const browser = window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const SpeechRecognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceError('Voice input is unavailable in this browser. You can still type commands.'); return; }
    setVoiceError('');
    try {
      const instance = new SpeechRecognition();
      recognition.current = instance;
      instance.lang = navigator.language || 'en-AU';
      instance.interimResults = false;
      instance.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim();
        if (transcript) { setPhase('understanding'); setInput(transcript); submit(transcript); }
      };
      instance.onerror = () => { setVoiceError('Microphone permission or speech recognition failed. Try again or type your command.'); setListening(false); setPhase('dormant'); };
      instance.onend = () => setListening(false);
      instance.start();
      setListening(true);
      setPhase('listening');
    } catch { setVoiceError('Could not start the microphone.'); setListening(false); }
  }

  function chooseModel(value: string) {
    if (!isModelChoice(value)) return;

    setSelectedModel(value);
    window.localStorage.setItem(MODEL_STORAGE_KEY, value);
  }

  async function sendMessage(text: string) {
    const history = messages.map((message) => ({
      role: message.role,
      content: message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' '),
    }));

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }],
      },
    ]);

    setBusy(true);
    setPhase('planning');

    try {
      const commandReply = runCommand(text);
      setPhase(commandReply ? 'executing' : 'understanding');
      const result = commandReply ? { text: commandReply, model: 'Voice command' } : await serverAIChat(
        text,
        actionsRef.current.getContext(),
        history,
        selectedModel,
        setProgress,
      );

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [{ type: 'text', text: result.text }],
          model: result.model,
        },
      ]);
      if (voiceReplies) speak(result.text);
      else { setPhase('completed'); window.setTimeout(() => setPhase('dormant'), 900); }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Xavier AI error: ${error.message}`
                  : 'Xavier AI is temporarily unavailable.',
            },
          ],
        },
      ]);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  function submit(text: string) {
    const value = text.trim();

    if (!value || busy) return;

    void sendMessage(value);
    setInput('');
  }

  const selected =
    MODEL_OPTIONS.find((option) => option.id === selectedModel) ||
    MODEL_OPTIONS[0];

  return (
    <>
      <div className="assistant-orb-dock">
        <XavierOrb phase={phase} premium={premium} onActivate={() => setOpen((value) => !value)} />
      </div>

      {open && (
        <section
          className="assistant-panel"
          role="dialog"
          aria-label="Xavier AI assistant"
        >
          <header className="assistant-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Xavier AI</strong>
              <small>Your secure planning assistant</small>

              <select
                value={selectedModel}
                onChange={(event) => chooseModel(event.target.value)}
                aria-label="Choose AI model"
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '7px 9px',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'var(--card2)',
                  color: 'var(--text)',
                  fontSize: 12,
                }}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>

              <small title={selected.detail}>{selected.detail}</small>

              <a
                className="assistant-chatgpt-link"
                href="https://chatgpt.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ChatGPT (free account) ↗
              </a>
              <small>Use your own ChatGPT account. Replies stay in ChatGPT.</small>
            </div>

            <button
              className="assistant-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <button type="button" onClick={() => { const next = !voiceReplies; setVoiceReplies(next); localStorage.setItem(VOICE_STORAGE_KEY, String(next)); if (!next) window.speechSynthesis?.cancel(); }} aria-label={voiceReplies ? 'Turn off spoken replies' : 'Turn on spoken replies'} title="Speak AI replies">{voiceReplies ? '🔊' : '🔇'}</button>
          </header>

          <div className="assistant-log">
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>
                  Ask Xavier to help plan, prioritize, or break down your goals. Sign in to use your monthly allowance.
                </p>

                <div className="assistant-chips">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => submit(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`assistant-msg ${message.role}`}
              >
                {message.model && message.role === 'assistant' && (
                  <small
                    style={{
                      opacity: 0.72,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '.04em',
                    }}
                  >
                    {message.model}
                  </small>
                )}

                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    return <span key={index}>{part.text}</span>;
                  }

                  return null;
                })}
              </div>
            ))}

            {busy && messages[messages.length - 1]?.role === 'user' && (
              <div className="assistant-msg assistant">
                <span className="assistant-typing">
                  {progress || 'Connecting to Xavier…'}
                </span>
              </div>
            )}
          </div>

          <form
            className="assistant-input"
            onSubmit={(event) => {
              event.preventDefault();
              submit(input);
            }}
          >
            <input
              value={input}
              placeholder="Ask Xavier AI to plan or reason…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  submit(input);
                }
              }}
            />

            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
            <button type="button" onClick={startListening} disabled={busy} aria-label={listening ? 'Stop listening' : 'Talk to Xavier AI'} aria-pressed={listening}>{listening ? 'Listening…' : '🎙 Talk'}</button>
          </form>
          {voiceError && <p role="alert" className="reminder-help">{voiceError}</p>}
        </section>
      )}
    </>
  );
}
