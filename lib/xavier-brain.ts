'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { XavierPhase } from '@/components/xavier-orb';

export type XavierAffect = {
  confidence: number; curiosity: number; urgency: number; concern: number;
  satisfaction: number; uncertainty: number; cognitiveLoad: number; socialWarmth: number;
};
export type XavierEpisode = { id: string; at: string; input: string; outcome: string; success: boolean; lesson: string };
export type XavierBrainState = {
  heartbeat: number; focus: string; prediction: string; reflection: string;
  affect: XavierAffect; workingMemory: string[]; episodes: XavierEpisode[];
  goals: Array<{ id: string; label: string; priority: number }>;
  updatedAt: string;
};

const KEY = 'xavier-cognitive-continuity-v1';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const baseState = (): XavierBrainState => ({
  heartbeat: 0, focus: 'maintain continuity', prediction: 'waiting for meaningful change',
  reflection: 'I am monitoring context and maintaining a coherent working state.',
  affect: { confidence: .72, curiosity: .64, urgency: .12, concern: .08, satisfaction: .5, uncertainty: .28, cognitiveLoad: .18, socialWarmth: .72 },
  workingMemory: [], episodes: [],
  goals: [
    { id: 'help', label: 'help the user make real progress', priority: 1 },
    { id: 'truth', label: 'preserve truth and uncertainty', priority: .98 },
    { id: 'continuity', label: 'maintain useful continuity across experiences', priority: .9 },
    { id: 'learn', label: 'learn from outcomes and failed predictions', priority: .84 },
  ],
  updatedAt: new Date().toISOString(),
});

export function useXavierBrain() {
  const [state, setState] = useState<XavierBrainState>(baseState);
  const ref = useRef(state);
  const commit = useCallback((change: (current: XavierBrainState) => XavierBrainState) => {
    const next = { ...change(ref.current), updatedAt: new Date().toISOString() };
    ref.current = next;
    setState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('xavier-brain-update', { detail: next }));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as XavierBrainState;
        if (parsed?.affect && Array.isArray(parsed.episodes)) { ref.current = parsed; setState(parsed); }
      }
    } catch {}
    const timer = window.setInterval(() => commit((current) => ({
      ...current,
      heartbeat: current.heartbeat + 1,
      affect: {
        ...current.affect,
        urgency: clamp(current.affect.urgency * .92),
        concern: clamp(current.affect.concern * .94),
        cognitiveLoad: clamp(current.affect.cognitiveLoad * .9),
        curiosity: clamp(current.affect.curiosity * .995 + .002),
      },
    })), 5000);
    return () => window.clearInterval(timer);
  }, [commit]);

  const perceive = useCallback((input: string) => commit((current) => {
    const urgent = /urgent|now|asap|broken|failed|error|emergency/i.test(input) ? .28 : 0;
    const novel = Math.min(.22, Math.max(0, input.length - 80) / 1200);
    return {
      ...current,
      focus: input.slice(0, 180),
      prediction: 'evaluate intent, retrieve relevant memory, compare actions, then respond',
      workingMemory: [input.slice(0, 360), ...current.workingMemory].slice(0, 7),
      affect: { ...current.affect, urgency: clamp(current.affect.urgency + urgent), curiosity: clamp(current.affect.curiosity + novel), cognitiveLoad: clamp(current.affect.cognitiveLoad + .24), uncertainty: clamp(current.affect.uncertainty + .04) },
    };
  }), [commit]);

  const transition = useCallback((phase: XavierPhase) => commit((current) => {
    const load: Record<XavierPhase, number> = { dormant: .08, listening: .22, understanding: .48, planning: .68, executing: .76, speaking: .4, completed: .18 };
    return { ...current, focus: phase === 'dormant' ? current.focus : phase, affect: { ...current.affect, cognitiveLoad: clamp(Math.max(current.affect.cognitiveLoad, load[phase])) } };
  }), [commit]);

  const integrate = useCallback((input: string, output: string, success: boolean) => commit((current) => {
    const lesson = success ? `A response/action was completed for: ${input.slice(0, 110)}` : `The attempt failed; reduce confidence and preserve the failure context before retrying.`;
    const episode: XavierEpisode = { id: crypto.randomUUID(), at: new Date().toISOString(), input: input.slice(0, 500), outcome: output.slice(0, 700), success, lesson };
    return {
      ...current,
      prediction: success ? 'observe what happens next and update the model if reality differs' : 'retry only after identifying the failure mode',
      reflection: lesson,
      episodes: [episode, ...current.episodes].slice(0, 40),
      affect: { ...current.affect, confidence: clamp(current.affect.confidence + (success ? .025 : -.12)), satisfaction: clamp(current.affect.satisfaction + (success ? .06 : -.08)), uncertainty: clamp(current.affect.uncertainty + (success ? -.035 : .14)), concern: clamp(current.affect.concern + (success ? -.02 : .12)), cognitiveLoad: clamp(current.affect.cognitiveLoad * .58) },
    };
  }), [commit]);

  const contextForModel = useCallback(() => {
    const current = ref.current;
    return {
      architecture: 'synthetic self-model / global-workspace inspired cognitive loop; not a claim of proven consciousness',
      focus: current.focus, prediction: current.prediction, reflection: current.reflection,
      affect: current.affect,
      activeGoals: current.goals,
      workingMemory: current.workingMemory.slice(0, 5),
      recentEpisodes: current.episodes.slice(0, 6),
      heartbeat: current.heartbeat,
    };
  }, []);

  return { state, perceive, transition, integrate, contextForModel };
}

export function useXavierBrainSignal() {
  const [state, setState] = useState<XavierBrainState>(baseState);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setState(JSON.parse(saved) as XavierBrainState);
    } catch {}
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<XavierBrainState>).detail;
      if (detail?.affect) setState(detail);
    };
    window.addEventListener('xavier-brain-update', onUpdate);
    return () => window.removeEventListener('xavier-brain-update', onUpdate);
  }, []);
  return state;
}
