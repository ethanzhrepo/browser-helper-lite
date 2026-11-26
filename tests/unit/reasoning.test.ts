import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  auxiliaryReasoning,
  isSimpleRequest,
  minimumReasoningFor,
  rejectsReasoning,
  resolveStepReasoning,
  temperatureFor,
  type StepReasoningContext,
} from '../../src/providers/reasoning';

const baseCtx = (overrides: Partial<StepReasoningContext> = {}): StepReasoningContext => ({
  effort: 'auto',
  vendor: 'openai',
  modelId: 'gpt-5.2',
  stepCount: 0,
  atLimit: false,
  chatOnly: false,
  consecutiveErrors: 0,
  routineFollowUp: false,
  complexTask: false,
  simpleRequest: false,
  ...overrides,
});

describe('isSimpleRequest', () => {
  it('detects short lightweight intents in English and Chinese', () => {
    expect(isSimpleRequest('Summarize this page', false, false)).toBe(true);
    expect(isSimpleRequest('帮我总结一下这个页面', false, false)).toBe(true);
    expect(isSimpleRequest('翻译成中文', false, true)).toBe(true);
    expect(isSimpleRequest('Click the login button', false, false)).toBe(true);
    expect(isSimpleRequest('What is this?', false, true)).toBe(true);
  });

  it('keeps analytical, multi-source, or skill-backed tasks out of simple mode', () => {
    expect(isSimpleRequest('Compare 65W USB-C chargers on Amazon and AliExpress', false, false)).toBe(false);
    expect(isSimpleRequest('帮我比价这个商品并做表格', false, false)).toBe(false);
    expect(isSimpleRequest('审计这个项目的安全问题', false, false)).toBe(false);
    expect(isSimpleRequest('Summarize this page', true, false)).toBe(false);
  });
});

describe('minimumReasoningFor', () => {
  it('uses each vendor/model minimum supported effort so OpenAI does not fall back to medium', () => {
    expect(minimumReasoningFor('openai', 'o3')).toBe('low');
    expect(minimumReasoningFor('openai', 'o4-mini')).toBe('low');
    expect(minimumReasoningFor('openai', 'o1-preview')).toBe('low');
    expect(minimumReasoningFor('openai', 'gpt-5')).toBe('minimal');
    expect(minimumReasoningFor('openai', 'gpt-5-mini')).toBe('minimal');
    expect(minimumReasoningFor('openai', 'gpt-5.2')).toBe('none');
    expect(minimumReasoningFor('anthropic', 'claude-sonnet-4-6')).toBe('none');
    expect(minimumReasoningFor('google', 'gemini-2.5-flash')).toBe('none');
    expect(minimumReasoningFor('deepseek', 'deepseek-v4-pro')).toBe('none');
    expect(minimumReasoningFor('openai-compatible', 'qwen3')).toBe('none');
  });
});

describe('resolveStepReasoning', () => {
  it('honors explicit user levels across off, low, medium, and high', () => {
    expect(resolveStepReasoning(baseCtx({ effort: 'off', vendor: 'google', modelId: 'gemini-3-flash-preview' }))).toBe('none');
    expect(resolveStepReasoning(baseCtx({ effort: 'off', vendor: 'openai', modelId: 'o3' }))).toBe('low');
    expect(resolveStepReasoning(baseCtx({ effort: 'low' }))).toBe('low');
    expect(resolveStepReasoning(baseCtx({ effort: 'medium' }))).toBe('medium');
    expect(resolveStepReasoning(baseCtx({ effort: 'high' }))).toBe('high');
  });

  it('adapts automatically by step role under auto effort', () => {
    // Simple initial request -> low; complex initial request -> medium.
    expect(resolveStepReasoning(baseCtx({ stepCount: 0, simpleRequest: true }))).toBe('low');
    expect(resolveStepReasoning(baseCtx({ stepCount: 0, simpleRequest: false }))).toBe('medium');
    expect(resolveStepReasoning(baseCtx({ stepCount: 0, simpleRequest: true, complexTask: true }))).toBe('medium');

    // Clean routine browser step follow-up -> low.
    expect(resolveStepReasoning(baseCtx({ stepCount: 3, routineFollowUp: true }))).toBe('low');

    // Synthesis after search/extract/read -> medium.
    expect(resolveStepReasoning(baseCtx({ stepCount: 3, routineFollowUp: false }))).toBe('medium');

    // Error recovery or final at-limit synthesis always steps up to medium.
    expect(resolveStepReasoning(baseCtx({ stepCount: 3, routineFollowUp: true, consecutiveErrors: 1 }))).toBe('medium');
    expect(resolveStepReasoning(baseCtx({ stepCount: 10, routineFollowUp: true, atLimit: true }))).toBe('medium');
  });
});

describe('auxiliaryReasoning and temperatureFor', () => {
  it('keeps helper calls lightweight regardless of main effort', () => {
    expect(auxiliaryReasoning('auto', 'google', 'gemini-2.5-flash')).toBe('none');
    expect(auxiliaryReasoning('auto', 'openai', 'o3')).toBe('low');
    expect(auxiliaryReasoning('off', 'deepseek', 'deepseek-v4-flash')).toBe('none');
    expect(auxiliaryReasoning('high', 'anthropic', 'claude-sonnet-4-6')).toBe('low');
  });

  it('drops temperature only when Anthropic or DeepSeek thinking is active', () => {
    expect(temperatureFor('anthropic', 'medium', 0.7)).toBeUndefined();
    expect(temperatureFor('deepseek', 'low', 0.7)).toBeUndefined();
    expect(temperatureFor('anthropic', 'none', 0.7)).toBe(0.7);
    expect(temperatureFor('deepseek', 'none', 0.7)).toBe(0.7);
    expect(temperatureFor('openai', 'medium', 0.7)).toBe(0.7);
    expect(temperatureFor('google', 'high', 0.7)).toBe(0.7);
    expect(temperatureFor('openai', 'low', undefined)).toBeUndefined();
  });
});

describe('rejectsReasoning', () => {
  const err = (statusCode: number, body: string) =>
    new APICallError({ message: 'Bad Request', url: 'https://x', requestBodyValues: {}, statusCode, responseBody: body });

  it('detects provider rejections caused by unsupported reasoning parameters', () => {
    expect(rejectsReasoning(err(400, '{"error":{"message":"Unknown parameter: reasoning_effort"}}'))).toBe(true);
    expect(rejectsReasoning(err(422, '{"detail":[{"type":"extra_forbidden","loc":["body","reasoning_effort"]}]}'))).toBe(true);
    expect(rejectsReasoning(err(400, '{"error":{"message":"Unsupported value: \'none\' for reasoning.effort"}}'))).toBe(true);
    expect(rejectsReasoning(err(400, '{"error":{"message":"invalid thinking budget_tokens"}}'))).toBe(true);
    expect(rejectsReasoning(err(400, '{"error":{"message":"context length exceeded"}}'))).toBe(false);
    expect(rejectsReasoning(err(500, 'reasoning_effort'))).toBe(false);
    expect(rejectsReasoning(new Error('reasoning_effort'))).toBe(false);
  });
});
