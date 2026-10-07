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
const VOICE_STORAGE_KEY = 'planned-out-voice-replies-v2';
const LOCAL_TTS_URL = (process.env.NEXT_PUBLIC_TTS_SERVER_URL || '').trim().replace(/\/+$/, '');
const LOCAL_TTS_LANGUAGE = (process.env.NEXT_PUBLIC_TTS_LANGUAGE || 'en').trim();
const LOCAL_TTS_SPEAKER = (process.env.NEXT_PUBLIC_TTS_SPEAKER || 'xavier_warm').trim();

type SpeechResult = {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }>>;
};

type SpeechErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous?: boolean;
  maxAlternatives?: number;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
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

function normalizeSpeechText(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[\*_#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSpeech(value: string) {
  const cleaned = normalizeSpeechText(value);
  if (!cleaned) return [];

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const text = sentence.trim();
    if (!text) continue;

    if (text.length <= 220) {
      chunks.push(text);
      continue;
    }

    let chunk = '';
    for (const word of text.split(/\s+/)) {
      const next = chunk ? chunk + ' ' + word : word;
      if (next.length > 190 && chunk) {
        chunks.push(chunk);
        chunk = word;
      } else {
        chunk = next;
      }
    }
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

function recognitionErrorMessage(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone permission is blocked. Allow microphone access for Planned Out, then tap Talk again.';
  }
  if (error === 'audio-capture') {
    return 'No working microphone input was available to the browser.';
  }
  if (error === 'no-speech') {
    return 'I did not hear any speech. Tap Talk and try again.';
  }
  if (error === 'network') {
    return 'Speech recognition could not reach the speech service. Check your connection and try again.';
  }
  if (error === 'aborted') return '';
  return 'Voice recognition stopped unexpectedly. Tap Talk to try again.';
}

export function AssistantPanel({
  actions,
  premium = false,
  onPhaseChange,
}: {
  actions: AssistantActions;
  premium?: boolean;
  onPhaseChange?: (phase: XavierPhase) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] =
    useState<AssistantModelChoice>('auto');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [voiceError, setVoiceError] = useState('');
  const [phase, setPhaseState] = useState<XavierPhase>('dormant');

  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const voiceRepliesRef = useRef(true);
  const speechGeneration = useRef(0);
  const speechResumeTimer = useRef<number | null>(null);
  const speechStartWatchdog = useRef<number | null>(null);
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrl = useRef<string | null>(null);

  function setPhase(next: XavierPhase) {
    setPhaseState(next);
    onPhaseChange?.(next);
  }

  function setVoiceEnabled(next: boolean) {
    voiceRepliesRef.current = next;
    setVoiceReplies(next);
    window.localStorage.setItem(VOICE_STORAGE_KEY, String(next));
    if (!next) stopSpeaking();
  }

  function refreshVoices() {
    if (!('speechSynthesis' in window)) return;
    voices.current = window.speechSynthesis.getVoices();
  }

  function chooseVoice() {
    const available = voices.current.length
      ? voices.current
      : ('speechSynthesis' in window ? window.speechSynthesis.getVoices() : []);

    const english = available.filter((voice) => /^en(?:-|_)/i.test(voice.lang));

    return (
      english.find((voice) => /^en-AU$/i.test(voice.lang) && voice.localService) ||
      english.find((voice) => /^en-AU$/i.test(voice.lang)) ||
      english.find((voice) => /google|microsoft|samsung/i.test(voice.name) && voice.localService) ||
      english.find((voice) => /^en-GB$/i.test(voice.lang)) ||
      english.find((voice) => /^en-US$/i.test(voice.lang)) ||
      english[0] ||
      available[0]
    );
  }

  function stopSpeaking(resetPhase = true) {
    speechGeneration.current += 1;

    if (speechResumeTimer.current !== null) {
      window.clearInterval(speechResumeTimer.current);
      speechResumeTimer.current = null;
    }

    if (speechStartWatchdog.current !== null) {
      window.clearTimeout(speechStartWatchdog.current);
      speechStartWatchdog.current = null;
    }

    activeUtterance.current = null;

    if (activeAudio.current) {
      activeAudio.current.pause();
      activeAudio.current.src = '';
      activeAudio.current = null;
    }

    if (activeAudioUrl.current) {
      URL.revokeObjectURL(activeAudioUrl.current);
      activeAudioUrl.current = null;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (resetPhase) setPhase('dormant');
  }

  function primeSpeechOutput() {
    if (!('speechSynthesis' in window)) return;
    refreshVoices();
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
  }

  function speak(reply: string, force = false, directTest = false, skipLocalTts = false) {
    if (!voiceRepliesRef.current && !force) return;

    if (LOCAL_TTS_URL && !skipLocalTts) {
      stopSpeaking(false);
      setVoiceError('');
      setPhase('speaking');
      const generation = speechGeneration.current;

      void (async () => {
        try {
          const response = await fetch(`${LOCAL_TTS_URL}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: reply,
              language: LOCAL_TTS_LANGUAGE,
              speaker: LOCAL_TTS_SPEAKER,
            }),
          });

          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`Local TTS returned ${response.status}${detail ? `: ${detail}` : ''}`);
          }

          if (generation !== speechGeneration.current) return;

          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          activeAudio.current = audio;
          activeAudioUrl.current = objectUrl;

          audio.onended = () => {
            if (generation !== speechGeneration.current) return;
            activeAudio.current = null;
            if (activeAudioUrl.current) {
              URL.revokeObjectURL(activeAudioUrl.current);
              activeAudioUrl.current = null;
            }
            setPhase('completed');
            window.setTimeout(() => {
              if (generation === speechGeneration.current) setPhase('dormant');
            }, 700);
          };

          audio.onerror = () => {
            if (generation !== speechGeneration.current) return;
            speak(reply, force, directTest, true);
          };

          await audio.play();
        } catch {
          if (generation !== speechGeneration.current) return;
          speak(reply, force, directTest, true);
        }
      })();
      return;
    }

    if (!('speechSynthesis' in window)) {
      if (force) setVoiceError('Spoken replies are not supported by this browser.');
      return;
    }

    const chunks = splitSpeech(reply);
    if (!chunks.length) return;

    stopSpeaking(false);
    setVoiceError('');
    setPhase('speaking');

    const generation = speechGeneration.current;
    let index = 0;
    let retriedCurrentChunk = false;

    const clearStartWatchdog = () => {
      if (speechStartWatchdog.current !== null) {
        window.clearTimeout(speechStartWatchdog.current);
        speechStartWatchdog.current = null;
      }
    };

    const speakNext = () => {
      if (generation !== speechGeneration.current) return;

      const text = chunks[index++];
      if (!text) {
        clearStartWatchdog();
        activeUtterance.current = null;

        if (speechResumeTimer.current !== null) {
          window.clearInterval(speechResumeTimer.current);
          speechResumeTimer.current = null;
        }

        setPhase('completed');
        window.setTimeout(() => {
          if (generation === speechGeneration.current) setPhase('dormant');
        }, 700);
        return;
      }

      const buildAndSpeak = (useSelectedVoice: boolean) => {
        if (generation !== speechGeneration.current) return;

        clearStartWatchdog();
        const utterance = new SpeechSynthesisUtterance(text);
        activeUtterance.current = utterance;
        utterance.lang = 'en-AU';
        utterance.rate = directTest ? 1 : 0.94;
        utterance.pitch = 0.92;
        utterance.volume = 1;

        if (useSelectedVoice) {
          const voice = chooseVoice();
          if (voice) utterance.voice = voice;
        }

        let started = false;

        utterance.onstart = () => {
          started = true;
          clearStartWatchdog();
          setVoiceError('');
          setPhase('speaking');
        };

        utterance.onend = () => {
          clearStartWatchdog();
          activeUtterance.current = null;
          retriedCurrentChunk = false;
          speakNext();
        };

        utterance.onerror = (event) => {
          clearStartWatchdog();
          activeUtterance.current = null;

          if (generation !== speechGeneration.current) return;
          if (event.error === 'interrupted' || event.error === 'canceled') return;

          if (!retriedCurrentChunk) {
            retriedCurrentChunk = true;
            window.speechSynthesis.cancel();
            window.setTimeout(() => buildAndSpeak(false), 120);
            return;
          }

          setVoiceError('Android did not start Xavier voice output. Check Media volume and the phone Text-to-speech engine, then tap Test voice.');
          stopSpeaking();
        };

        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);

        speechStartWatchdog.current = window.setTimeout(() => {
          if (generation !== speechGeneration.current || started) return;

          if (!retriedCurrentChunk) {
            retriedCurrentChunk = true;
            window.speechSynthesis.cancel();
            window.setTimeout(() => buildAndSpeak(false), 120);
            return;
          }

          setVoiceError('Xavier created the reply, but Android blocked the voice engine from starting. Tap Test voice once to unlock it.');
          stopSpeaking();
        }, 1800);
      };

      buildAndSpeak(true);
    };

    speechResumeTimer.current = window.setInterval(() => {
      if (generation !== speechGeneration.current) return;
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 4000);

    window.speechSynthesis.resume();
    speakNext();
  }

  useEffect(() => {
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel && isModelChoice(savedModel)) {
      setSelectedModel(savedModel);
    }

    const savedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
    const enabled = savedVoice === null ? true : savedVoice === 'true';
    voiceRepliesRef.current = enabled;
    setVoiceReplies(enabled);

    if ('speechSynthesis' in window) {
      refreshVoices();
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }

    return () => {
      recognition.current?.abort?.();
      recognition.current?.stop();
      stopSpeaking(false);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  function runCommand(value: string): string | null {
    const task = value.match(/^(?:please )?(?:create|add|make) (?:a )?task(?: called| to)? (.+)$/i);
    if (task) {
      actionsRef.current.createTask({ title: task[1].trim() });
      return 'Created the task ' + task[1].trim() + '.';
    }

    const note = value.match(/^(?:please )?(?:add|create|write) (?:a )?note(?: called| saying)? (.+)$/i);
    if (note) {
      actionsRef.current.createRecord('knowledge', note[1].trim());
      return 'Saved the note ' + note[1].trim() + '.';
    }

    const memory = value.match(/^(?:please )?remember (?:that )?(.+)$/i);
    if (memory) {
      actionsRef.current.remember(memory[1].trim());
      return "I'll remember that: " + memory[1].trim() + '.';
    }

    const view = value.match(/^(?:please )?(?:open|show|go to) (calendar|planner|dashboard|board|focus|habits|journal|finance|settings)$/i);
    if (view) {
      actionsRef.current.navigate(view[1].toLowerCase() as AppView);
      return 'Opened ' + view[1] + '.';
    }

    const openTask = value.match(/^(?:please )?open task (.+)$/i);
    if (openTask) {
      const found = actionsRef.current.openTask(openTask[1]);
      return found.found
        ? 'Opened ' + found.title + '.'
        : "I couldn't find a task named " + openTask[1] + '.';
    }

    return null;
  }

  async function startListening() {
    if (listening) {
      recognition.current?.stop();
      return;
    }

    stopSpeaking(false);
    setVoiceEnabled(true);
    primeSpeechOutput();
    setVoiceError('');

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        setVoiceError('Microphone permission is blocked or no microphone is available to the browser.');
        setPhase('dormant');
        return;
      }
    }

    const browser = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognition =
      browser.SpeechRecognition || browser.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceError('This browser does not provide speech recognition. Xavier can still talk back when you type.');
      return;
    }

    try {
      const instance = new SpeechRecognition();
      recognition.current = instance;
      instance.lang = /^en/i.test(navigator.language || '') ? navigator.language : 'en-AU';
      instance.interimResults = false;
      instance.continuous = false;
      instance.maxAlternatives = 3;

      let heardSpeech = false;

      instance.onresult = (event) => {
        const alternatives = event.results[0];
        let transcript = '';

        for (let index = 0; index < alternatives.length; index += 1) {
          const candidate = alternatives[index]?.transcript?.trim();
          if (candidate) {
            transcript = candidate;
            break;
          }
        }

        if (!transcript) return;

        heardSpeech = true;
        setListening(false);
        setPhase('understanding');
        setInput(transcript);
        submit(transcript, true);
      };

      instance.onerror = (event) => {
        const message = recognitionErrorMessage(event.error);
        if (message) setVoiceError(message);
        setListening(false);
        setPhase('dormant');
      };

      instance.onend = () => {
        setListening(false);
        if (!heardSpeech) setPhase('dormant');
      };

      instance.start();
      setListening(true);
      setPhase('listening');
    } catch {
      setVoiceError('Could not start voice recognition. Close other apps using the microphone and try again.');
      setListening(false);
      setPhase('dormant');
    }
  }

  function chooseModel(value: string) {
    if (!isModelChoice(value)) return;
    setSelectedModel(value);
    window.localStorage.setItem(MODEL_STORAGE_KEY, value);
  }

  async function sendMessage(text: string, forceVoice = false) {
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

      const result = commandReply
        ? { text: commandReply, model: 'Xavier action' }
        : await serverAIChat(
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

      if (forceVoice || voiceRepliesRef.current) {
        speak(result.text, forceVoice);
      } else {
        setPhase('completed');
        window.setTimeout(() => setPhase('dormant'), 700);
      }
    } catch (error) {
      const errorText =
        error instanceof Error
          ? 'Xavier AI error: ' + error.message
          : 'Xavier AI is temporarily unavailable.';

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [{ type: 'text', text: errorText }],
        },
      ]);

      if (forceVoice || voiceRepliesRef.current) {
        speak(errorText, true);
      } else {
        setPhase('dormant');
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  function submit(text: string, forceVoice = false) {
    const value = text.trim();
    if (!value || busy) return;

    void sendMessage(value, forceVoice);
    setInput('');
  }

  const selected =
    MODEL_OPTIONS.find((option) => option.id === selectedModel) ||
    MODEL_OPTIONS[0];

  return (
    <>
      <div className={'assistant-orb-dock ' + (open ? 'orb-dock-open' : '')}>
        <XavierOrb
          phase={phase}
          premium={premium}
          onActivate={() => setOpen((value) => !value)}
        />
      </div>

      {open && (
        <section
          className="assistant-panel"
          role="dialog"
          aria-label="Xavier AI assistant"
        >
          <header className="assistant-head">
            <div className="assistant-head-copy">
              <strong>Xavier AI</strong>
              <small>Secure planner intelligence · voice ready</small>

              <select
                value={selectedModel}
                onChange={(event) => chooseModel(event.target.value)}
                aria-label="Choose AI model"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>

              <small title={selected.detail}>{selected.detail}</small>
            </div>

            <div className="assistant-head-actions">
              <button
                type="button"
                className={'assistant-voice-toggle ' + (voiceReplies ? 'active' : '')}
                onClick={() => {
                  const next = !voiceRepliesRef.current;
                  setVoiceEnabled(next);
                  if (next) {
                    primeSpeechOutput();
                    speak('Xavier voice is on.', true, true);
                  }
                }}
                aria-pressed={voiceReplies}
                title="Spoken replies"
              >
                {voiceReplies ? '🔊 Talk back on' : '🔇 Talk back off'}
              </button>

              <button
                type="button"
                className="assistant-voice-test"
                onClick={() => {
                  setVoiceEnabled(true);
                  primeSpeechOutput();
                  speak('Xavier voice is ready.', true, true);
                }}
              >
                Test voice
              </button>

              <button
                className="assistant-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </header>

          <div className="assistant-log">
            <div className="xavier-orb-stage">
              <XavierOrb phase={phase} premium={premium} large />
              <small className="assistant-phase-label">
                {listening ? 'LISTENING' : phase.toUpperCase()}
              </small>
            </div>

            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>
                  Talk naturally to Xavier or type a request. Voice commands automatically turn spoken replies on.
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

            {messages.map((message) => {
              const messageText = message.parts
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join(' ');

              return (
                <div
                  key={message.id}
                  className={'assistant-msg ' + message.role}
                >
                  {message.model && message.role === 'assistant' && (
                    <small className="assistant-model-label">
                      {message.model}
                    </small>
                  )}

                  {message.parts.map((part, index) => (
                    part.type === 'text'
                      ? <span key={index}>{part.text}</span>
                      : null
                  ))}

                  {message.role === 'assistant' && (
                    <button
                      type="button"
                      className="assistant-replay"
                      onClick={() => {
                        primeSpeechOutput();
                        speak(messageText, true);
                      }}
                    >
                      🔊 Replay voice
                    </button>
                  )}
                </div>
              );
            })}

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
              placeholder="Ask Xavier AI to plan, reason or act…"
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

            <button
              type="button"
              className={'assistant-talk ' + (listening ? 'active' : '')}
              onClick={() => void startListening()}
              disabled={busy}
              aria-label={listening ? 'Stop listening' : 'Talk to Xavier AI'}
              aria-pressed={listening}
            >
              {listening ? '● Listening…' : '🎙 Talk'}
            </button>
          </form>

          {voiceError && (
            <p role="alert" className="assistant-voice-error">
              {voiceError}
            </p>
          )}
        </section>
      )}
    </>
  );
}
