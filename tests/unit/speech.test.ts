import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { transcribeAudio } from '../../src/providers/speech';
import type { Connection } from '../../src/shared/types';
import { loadSettings, saveConnection, updateSettings } from '../../src/storage/settings';

const groq: Connection = {
  id: 'groq',
  vendor: 'openai-compatible',
  presetId: 'groq',
  name: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1/',
  models: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('transcribeAudio', () => {
  beforeEach(() => fakeBrowser.reset());

  it('uploads the recording to /audio/transcriptions with an ISO 639-1 language', async () => {
    await saveConnection(groq, 'gsk-key');
    await updateSettings((s) => ({ ...s, slots: { ...s.slots, stt: { connectionId: 'groq', modelId: 'whisper-large-v3' } } }));
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: ' 你好 world ' }), { status: 200 });
    }) as unknown as typeof fetch;

    const text = await transcribeAudio(await loadSettings(), new Uint8Array([1, 2, 3]), 'audio/webm', 'zh-CN', fetchImpl);
    expect(text).toBe('你好 world');
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-key');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('language')).toBe('zh');
    expect((form.get('file') as File).name).toBe('speech.webm');
  });

  it('asks for a speech-to-text model when none is set', async () => {
    await expect(transcribeAudio(await loadSettings(), new Uint8Array(), 'audio/webm', undefined)).rejects.toThrow(/speech-to-text/);
  });
});
