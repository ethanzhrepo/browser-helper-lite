import type { Vendor } from '../shared/types';

export interface VendorInfo {
  id: Vendor;
  label: string;
  defaultBaseURL: string;
  /** Where users create an API key. */
  keyUrl?: string;
}

export const VENDORS: Record<Vendor, VendorInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseURL: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseURL: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    defaultBaseURL: '',
  },
};

export const VENDOR_ORDER: Vendor[] = ['openai', 'anthropic', 'google', 'deepseek', 'openai-compatible'];

export interface CompatiblePreset {
  id: string;
  label: string;
  baseURL: string;
  requiresKey: boolean;
  /** i18n key of an extra hint shown in the connection form. */
  hintKey?: string;
}

/** Base URLs are prefilled and stay editable (e.g. to switch region). */
export const COMPATIBLE_PRESETS: CompatiblePreset[] = [
  { id: 'qwen', label: 'Qwen (DashScope)', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', requiresKey: true, hintKey: 'connections.hints.region' },
  { id: 'kimi', label: 'Kimi (Moonshot)', baseURL: 'https://api.moonshot.cn/v1', requiresKey: true, hintKey: 'connections.hints.region' },
  { id: 'zhipu', label: 'Zhipu GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', requiresKey: true },
  { id: 'doubao', label: 'Doubao (Volcengine Ark)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', requiresKey: true },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', requiresKey: true },
  { id: 'siliconflow', label: 'SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1', requiresKey: true },
  { id: 'xai', label: 'xAI', baseURL: 'https://api.x.ai/v1', requiresKey: true },
  { id: 'mistral', label: 'Mistral', baseURL: 'https://api.mistral.ai/v1', requiresKey: true },
  { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', requiresKey: true },
  { id: 'ollama', label: 'Ollama', baseURL: 'http://localhost:11434/v1', requiresKey: false, hintKey: 'connections.hints.ollama' },
  { id: 'lmstudio', label: 'LM Studio', baseURL: 'http://localhost:1234/v1', requiresKey: false },
  { id: 'custom', label: 'Custom', baseURL: '', requiresKey: false },
];

export function findPreset(id: string | undefined): CompatiblePreset | undefined {
  return COMPATIBLE_PRESETS.find((preset) => preset.id === id);
}

export function vendorRequiresKey(vendor: Vendor, presetId?: string): boolean {
  if (vendor !== 'openai-compatible') return true;
  return findPreset(presetId)?.requiresKey ?? false;
}

export function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '');
}
