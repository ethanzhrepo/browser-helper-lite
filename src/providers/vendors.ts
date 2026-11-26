import type { Vendor } from '../shared/types';
import { ConfigError } from './errors';

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

/** localhost, 127.0.0.0/8, ::1, and IPv4-mapped loopback: traffic that never leaves this computer. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(host) ||
    /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host)
  );
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Loopback, unspecified, RFC1918 private ranges, link-local/metadata, IPv6 ULA/link-local, and local-only domains. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host || isLoopbackHost(host)) return true;
  if (host === '0.0.0.0' || host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  const v4MappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (v4MappedDotted) return isPrivateIpv4(v4MappedDotted[1]!);
  const v4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (v4MappedHex) {
    const hi = Number.parseInt(v4MappedHex[1]!, 16);
    const lo = Number.parseInt(v4MappedHex[2]!, 16);
    return isPrivateIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

/** True when an API key sent to this address would cross the network unencrypted. */
export function exposesKey(baseURL: string): boolean {
  try {
    const url = new URL(normalizeBaseURL(baseURL));
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The base URL for a request that carries an API key. Keys never travel over
 * plain HTTP to another machine, where anyone on the network path could read them.
 */
export function keyedBaseURL(baseURL: string, apiKey: string | undefined): string {
  if (apiKey && exposesKey(baseURL)) {
    throw new ConfigError('insecure', `Refusing to send the API key over plain HTTP to ${new URL(normalizeBaseURL(baseURL)).host}. Use https.`);
  }
  return normalizeBaseURL(baseURL);
}
