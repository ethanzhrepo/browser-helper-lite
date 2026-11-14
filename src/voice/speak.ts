import { useCallback, useEffect, useRef, useState } from 'react';

/** Longer utterances are cut off by some of Chrome's voices, so replies are read a few sentences at a time. */
const CHUNK_CHARS = 180;

/** What to say of a reply written in Markdown: its words, without code, tables' rulers, addresses or markup. */
export function speakable(markdown: string): string {
  return (
    markdown
      // Code and diagrams are for reading, not for listening.
      .replace(/```[\s\S]*?(?:```|$)/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, ' ')
      .replace(/^\s*\||\|\s*$/gm, '')
      .replace(/\s*\|\s*/g, ', ')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/[*_~`#]+/g, '')
      .replace(/\s*\n\s*/g, '. ')
      .replace(/(?:[.,;:!?。，；：！？]\s*){2,}/g, (run) => `${run.trim()[0]} `)
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Sentences grouped into pieces of at most CHUNK_CHARS. */
export function speechChunks(text: string, limit = CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?。！？；;\n]+[.!?。！？；;]*\s*/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences.flatMap((s) => (s.length > limit ? (s.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g')) ?? []) : [s]))) {
    if (current && current.length + sentence.length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** The language to read a text in: Chinese when it is mostly Chinese, else the given one. */
export function spokenLanguage(text: string, fallback: string): string {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  const cjk = letters.match(/[㐀-鿿]/g)?.length ?? 0;
  if (letters.length > 0 && cjk / letters.length > 0.3) return fallback.startsWith('zh') ? fallback : 'zh-CN';
  return fallback.startsWith('zh') && cjk === 0 && letters.length > 0 ? 'en-US' : fallback;
}

/**
 * Reads text aloud with the voices of the system (the Web Speech API): free,
 * and nothing is sent anywhere. One text at a time; `speaking` is the id of
 * the one being read.
 */
export function useSpeech() {
  const [speaking, setSpeaking] = useState<string>();
  /** Bumped on every start and stop, so the end of an old reading is ignored. */
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current += 1;
    globalThis.speechSynthesis?.cancel();
    setSpeaking(undefined);
  }, []);

  const speak = useCallback((id: string, markdown: string, language: string, onEnd?: () => void) => {
    const synth = globalThis.speechSynthesis;
    const chunks = speechChunks(speakable(markdown));
    if (!synth || chunks.length === 0) return false;
    synth.cancel();
    const mine = ++run.current;
    const lang = spokenLanguage(chunks.join(' '), language);
    setSpeaking(id);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = lang;
      const done = () => {
        if (run.current !== mine || index < chunks.length - 1) return;
        setSpeaking(undefined);
        onEnd?.();
      };
      utterance.onend = done;
      utterance.onerror = () => {
        if (run.current !== mine) return;
        run.current += 1;
        synth.cancel();
        setSpeaking(undefined);
      };
      synth.speak(utterance);
    });
    return true;
  }, []);

  // A closed panel stops talking.
  useEffect(() => stop, [stop]);

  return { speaking, speak, stop };
}
