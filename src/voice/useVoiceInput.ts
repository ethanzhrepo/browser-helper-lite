import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { TranscribeRequest, TranscribeResult } from '../shared/protocol';
import type { ErrorInfo, Locale, VoiceSettings } from '../shared/types';

export type VoiceState = 'idle' | 'listening' | 'transcribing';

export type VoiceProblem = 'permission' | 'unsupported' | 'network' | 'transcribe';

/** Stop after this much silence once something was said. */
const SILENCE_MS = 2000;
/** RMS level treated as speech when recording for the speech-to-text model. */
const SPEECH_LEVEL = 0.04;

const RECOGNITION_LANGUAGES: Record<Locale, string> = { 'zh-CN': 'zh-CN', en: 'en-US', fr: 'fr-FR', es: 'es-ES' };

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechLanguage(voice: VoiceSettings, locale: Locale): string {
  return voice.language === 'auto' ? RECOGNITION_LANGUAGES[locale] : voice.language;
}

/** Opens the extension page that asks Chrome for the microphone (side panels cannot show the prompt). */
export function openMicPermissionPage(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/mic-permission.html') });
}

async function microphoneGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Voice input for the composer (M1.5 C7): Chrome's speech recognition, or a
 * recording sent to the speech-to-text model. `onText` receives the whole
 * transcript so far; `onDone` the final one when listening ends.
 */
export function useVoiceInput({ voice, locale, onText, onDone, onProblem }: {
  voice: VoiceSettings;
  locale: Locale;
  onText: (text: string) => void;
  onDone: (text: string) => void;
  onProblem: (problem: VoiceProblem, error?: ErrorInfo) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => void) | undefined>(undefined);
  const callbacks = useRef({ onText, onDone, onProblem });
  callbacks.current = { onText, onDone, onProblem };

  const stop = useCallback(() => stopRef.current?.(), []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (stopRef.current) return;
    const Recognition = recognitionConstructor();
    if (voice.engine === 'browser' && !Recognition) return callbacks.current.onProblem('unsupported');
    if (!(await microphoneGranted())) {
      openMicPermissionPage();
      return callbacks.current.onProblem('permission');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      openMicPermissionPage();
      return callbacks.current.onProblem('permission');
    }

    // Level meter for the button animation, also used to detect silence when recording.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let spoke = false;
    let lastSound = Date.now();
    let finished = false;
    let silenceCheck: (() => void) | undefined;
    const meter = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      // Rounded so React skips most frames.
      setLevel(Math.round(Math.min(1, rms * 6) * 10) / 10);
      if (rms > SPEECH_LEVEL) {
        spoke = true;
        lastSound = Date.now();
      }
      silenceCheck?.();
      frame = requestAnimationFrame(meter);
    };
    frame = requestAnimationFrame(meter);

    const release = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
      void audio.close();
      setLevel(0);
      stopRef.current = undefined;
    };

    setState('listening');
    const language = speechLanguage(voice, locale);

    if (voice.engine === 'browser' && Recognition) {
      const recognition = new Recognition();
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      let transcript = '';
      let silenceTimer: ReturnType<typeof setTimeout> | undefined;
      recognition.onresult = (event) => {
        transcript = Array.from(event.results, (r) => r[0].transcript).join('');
        callbacks.current.onText(transcript.trim());
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => recognition.stop(), SILENCE_MS);
      };
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          openMicPermissionPage();
          callbacks.current.onProblem('permission');
        } else if (event.error === 'network') {
          callbacks.current.onProblem('network');
        }
      };
      recognition.onend = () => {
        if (finished) return;
        finished = true;
        clearTimeout(silenceTimer);
        release();
        setState('idle');
        callbacks.current.onDone(transcript.trim());
      };
      stopRef.current = () => recognition.stop();
      recognition.start();
      return;
    }

    // Speech-to-text model: record, then upload when the user stops or falls silent.
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
    recorder.onstop = async () => {
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) return setState('idle');
      setState('transcribing');
      const request: TranscribeRequest = {
        type: 'stt.transcribe',
        audio: toBase64(await blob.arrayBuffer()),
        mediaType: blob.type.split(';')[0]!,
        language,
      };
      const result = (await browser.runtime.sendMessage(request)) as TranscribeResult;
      setState('idle');
      if (!result.ok) return callbacks.current.onProblem('transcribe', result.error);
      callbacks.current.onText(result.text);
      callbacks.current.onDone(result.text);
    };
    silenceCheck = () => {
      if (spoke && recorder.state === 'recording' && Date.now() - lastSound > SILENCE_MS) recorder.stop();
    };
    stopRef.current = () => recorder.state === 'recording' && recorder.stop();
    recorder.start(250);
  }, [voice, locale]);

  const toggle = useCallback(() => {
    if (state === 'listening') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  return { state, level, toggle, stop };
}
