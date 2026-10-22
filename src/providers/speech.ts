import { generateText } from 'ai';
import type { Settings } from '../shared/types';
import { getApiKey } from '../storage/settings';
import { ConfigError, HttpError } from './errors';
import { createLanguageModel } from './language-model';
import { pickSlot } from './resolve';
import { normalizeBaseURL } from './vendors';

const GEMINI_PROMPT =
  'Transcribe this recording verbatim, in the language spoken (keep mixed languages as spoken). Reply with the transcript only.';

/**
 * Speech to text with the `stt` slot (M1.5 C7): OpenAI's /audio/transcriptions
 * (also served by Groq, SiliconFlow and other compatible services), or Gemini
 * with the audio as a file part.
 */
export async function transcribeAudio(
  settings: Settings,
  audio: Uint8Array,
  mediaType: string,
  language: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ref = pickSlot(settings, ['stt']);
  const connection = settings.connections.find((c) => c.id === ref?.connectionId);
  if (!ref || !connection) throw new ConfigError('noModel', 'No speech-to-text model is set under Model roles.');
  const apiKey = await getApiKey(connection.id);
  const base = normalizeBaseURL(connection.baseURL);

  switch (connection.vendor) {
    case 'openai':
    case 'openai-compatible': {
      const extension = mediaType.includes('ogg') ? 'ogg' : mediaType.includes('mp4') ? 'm4a' : 'webm';
      const form = new FormData();
      form.append('model', ref.modelId);
      form.append('file', new Blob([audio as BlobPart], { type: mediaType }), `speech.${extension}`);
      // The API takes ISO 639-1 codes ("zh", not "zh-CN").
      if (language) form.append('language', language.split('-')[0]!.toLowerCase());
      const url = `${base}/audio/transcriptions`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body: form,
      });
      if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ''), url);
      const body = (await response.json()) as { text?: string };
      return (body.text ?? '').trim();
    }
    case 'google': {
      const result = await generateText({
        model: createLanguageModel(connection, apiKey, ref.modelId),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: GEMINI_PROMPT },
              { type: 'file', data: audio, mediaType },
            ],
          },
        ],
        maxRetries: 1,
      });
      return result.text.trim();
    }
    default:
      throw new ConfigError('noModel', `${connection.name} cannot transcribe speech. Choose an OpenAI, Gemini or compatible model.`);
  }
}
