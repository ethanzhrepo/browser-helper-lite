import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { COMPACT_SCREEN_EDGE, screenSize } from '../../src/agent/screenshot';
import { screenshotReason } from '../../src/agent/vision';
import { rejectsImages, seesImages } from '../../src/providers/vision';

const none = { drawn: 0, frames: 0, pictures: 0, unlabeled: 0 };
const page = { elements: 12, textChars: 2000 };

describe('when a page view needs a screenshot', () => {
  it('does not for an ordinary page, however short', () => {
    expect(screenshotReason(none, page, 0)).toBeUndefined();
    expect(screenshotReason(none, { elements: 1, textChars: 40 }, 0)).toBeUndefined();
    expect(screenshotReason({ ...none, drawn: 0.05, unlabeled: 1 }, page, 0)).toBeUndefined();
    // Pictures next to plenty of text are decoration.
    expect(screenshotReason({ ...none, pictures: 0.6 }, page, 0)).toBeUndefined();
  });

  it('does for drawn content, foreign frames, unnamed controls, picture pages and repeated failures', () => {
    expect(screenshotReason({ ...none, drawn: 0.5 }, page, 0)).toBe('drawn');
    expect(screenshotReason({ ...none, frames: 0.3 }, page, 0)).toBe('frames');
    expect(screenshotReason({ ...none, unlabeled: 5 }, page, 0)).toBe('icons');
    expect(screenshotReason({ ...none, unlabeled: 3 }, { elements: 40, textChars: 2000 }, 0)).toBeUndefined();
    expect(screenshotReason({ ...none, pictures: 0.6 }, { elements: 2, textChars: 80 }, 0)).toBe('pictures');
    expect(screenshotReason(none, page, 2)).toBe('errors');
  });

  it('supports off, auto (including noChange and many unlabeled controls), and always (DOM + compact SoM) strategies', () => {
    // Off disables automatic screenshots even on canvas pages.
    expect(screenshotReason({ ...none, drawn: 0.8 }, page, 3, { strategy: 'off', noChange: true, canReadDirectly: true })).toBeUndefined();
    // Auto triggers on noChange after an interactive action and on pages with >= 8 unlabeled controls (e.g. color swatches).
    expect(screenshotReason(none, page, 0, { strategy: 'auto', noChange: true })).toBe('noChange');
    expect(screenshotReason({ ...none, unlabeled: 8 }, { elements: 60, textChars: 2000 }, 0, { strategy: 'auto' })).toBe('icons');
    // Always attaches a compact screenshot for multimodal models on ordinary pages, while keeping specific triggers first.
    expect(screenshotReason(none, page, 0, { strategy: 'always', canReadDirectly: true })).toBe('always');
    expect(screenshotReason({ ...none, drawn: 0.5 }, page, 0, { strategy: 'always', canReadDirectly: true })).toBe('drawn');
    // Text-only models using a separate vision model do not fire `always` on every ordinary step.
    expect(screenshotReason(none, page, 0, { strategy: 'always', canReadDirectly: false })).toBeUndefined();
  });
});

describe('which models read images', () => {
  it('goes by vendor and name', () => {
    expect(seesImages('anthropic', 'claude-sonnet-5-5')).toBe(true);
    expect(seesImages('google', 'gemini-2.5-flash')).toBe(true);
    expect(seesImages('deepseek', 'deepseek-chat')).toBe(false);
    // DeepSeek's Flash models read images, under its own name and behind other services.
    expect(seesImages('deepseek', 'deepseek-flash')).toBe(true);
    expect(seesImages('deepseek', 'deepseek-v4.1-flash')).toBe(true);
    expect(seesImages('deepseek', 'deepseek-v4-pro')).toBe(false);
    expect(seesImages('openai-compatible', 'deepseek/deepseek-v4-flash-0731')).toBe(true);
    expect(seesImages('openai-compatible', 'gpt-6-luna')).toBe(true);
    expect(seesImages('openai', 'gpt-5-mini')).toBe(true);
    expect(seesImages('openai', 'gpt-4o')).toBe(true);
    expect(seesImages('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(seesImages('openai', 'o3-mini')).toBe(false);
    expect(seesImages('openai', 'whisper-1')).toBe(false);
    for (const id of ['qwen-vl-max', 'qwen3-vl-plus', 'glm-4v-flash', 'llava:13b', 'openai/gpt-4o', 'anthropic/claude-opus-5', 'moonshot-v1-8k-vision-preview', 'pixtral-large']) {
      expect(seesImages('openai-compatible', id), id).toBe(true);
    }
    for (const id of ['deepseek-chat', 'qwen-plus', 'llama3.1:8b', 'kimi-k2', 'mock-model']) {
      expect(seesImages('openai-compatible', id), id).toBe(false);
    }
  });

  it('recognizes a provider turning an image down', () => {
    const refusal = (statusCode: number, body: string) => new APICallError({ message: 'Bad Request', url: 'https://x', requestBodyValues: {}, statusCode, responseBody: body });
    expect(rejectsImages(refusal(400, '{"error":{"message":"image input is not supported by this model"}}'))).toBe(true);
    expect(rejectsImages(refusal(400, '{"error":{"message":"This model does not support vision"}}'))).toBe(true);
    expect(rejectsImages(refusal(400, '{"error":{"message":"max_tokens is too large"}}'))).toBe(false);
    expect(rejectsImages(refusal(500, 'image'))).toBe(false);
    expect(rejectsImages(new Error('image'))).toBe(false);
  });
});

describe('screenshot size', () => {
  it('is the capture in CSS pixels, whatever the display density', () => {
    expect(screenSize({ width: 1200, height: 800 }, 1)).toEqual({ width: 1200, height: 800, scale: 1 });
    expect(screenSize({ width: 2400, height: 1600 }, 2)).toEqual({ width: 1200, height: 800, scale: 1 });
  });

  it('is scaled down to the longest edge a model keeps, and maps back by the scale', () => {
    const large = screenSize({ width: 5120, height: 2880 }, 2);
    expect(large).toEqual({ width: 1280, height: 720, scale: 2 });
    expect(640 * large.scale).toBe(1280);
  });

  it('is never stretched when the capture is shorter than the viewport claims', () => {
    // 1280 CSS pixels wide, but only 520 of the 720 were captured.
    expect(screenSize({ width: 1280, height: 520 }, 1)).toEqual({ width: 1280, height: 520, scale: 1 });
    // Narrower too: a window 606 pixels wide shows the left part of a page laid out for 1280. A pixel is still a pixel.
    expect(screenSize({ width: 606, height: 620 }, 1)).toEqual({ width: 606, height: 620, scale: 1 });
    expect(screenSize({ width: 1212, height: 1240 }, 2)).toEqual({ width: 606, height: 620, scale: 1 });
    // Compact SoM screenshots scale to COMPACT_SCREEN_EDGE and keep exact CSS coordinate mapping.
    const compact = screenSize({ width: 2560, height: 1600 }, 2, COMPACT_SCREEN_EDGE);
    expect(compact.width).toBe(COMPACT_SCREEN_EDGE);
    expect(compact.height).toBe(600);
    expect(Math.round(compact.width * compact.scale)).toBe(1280);
  });
});
