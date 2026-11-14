import { APICallError, RetryError } from 'ai';
import type { Vendor } from '../shared/types';

/** OpenAI models that take text only. Everything else current from OpenAI reads images. */
const OPENAI_TEXT_ONLY = /^(gpt-3\.5|gpt-4-(?!turbo|vision)|gpt-4$|o1-mini|o1-preview|o3-mini|text-|davinci|babbage)|instruct|embedding|whisper|tts|audio|realtime|transcribe|moderation|search/i;

/** Names by which multimodal models are known on OpenAI-compatible services and local runners. */
const SEES_IMAGES =
  /vision|multimodal|omni|(^|[^a-z])vl([^a-z]|$)|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|claude|gemini|gemma-?3|llava|bakllava|pixtral|qvq|glm-4v|glm-4\.\d+v|minicpm|internvl|moondream|grok-4|llama-?4|phi-?3\.5-vision|phi-?4-multimodal/i;

/**
 * Whether a model reads images, judged by its name. It is a guess: model lists
 * do not say. The agent setting overrides it, and a model that turns an image
 * down is treated as text-only for the rest of the turn (rejectsImages).
 */
export function seesImages(vendor: Vendor, modelId: string): boolean {
  switch (vendor) {
    case 'anthropic':
    case 'google':
      return true;
    case 'deepseek':
      return false;
    case 'openai':
      return !OPENAI_TEXT_ONLY.test(modelId);
    case 'openai-compatible':
      return SEES_IMAGES.test(modelId);
  }
}

/** The provider refused a request because of the image in it. */
export function rejectsImages(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause)) return false;
  const status = cause.statusCode ?? 0;
  return [400, 404, 415, 422, 501].includes(status) && /image|vision|multi-?modal|content.?type|unsupported content/i.test(`${cause.message} ${cause.responseBody ?? ''}`);
}
