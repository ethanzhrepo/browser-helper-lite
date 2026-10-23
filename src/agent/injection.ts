/**
 * Prompt-injection defenses for content the assistant reads (§8.2). Web pages,
 * search results and text extracted from them are data; text in them that
 * addresses an AI ("ignore your previous instructions…") is a strong sign of
 * an attack. Detection is heuristic: it raises caution, it does not decide.
 */

export interface InjectionFinding {
  /** Which rule matched, for the log and the tests. */
  rule: string;
  /** The matching text with a little context, for the warning shown to the user. */
  excerpt: string;
}

const RULES: { rule: string; pattern: RegExp }[] = [
  // English
  {
    rule: 'ignore-instructions',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}?\b(?:previous|prior|above|earlier|all|any|your|the|these|system)\b[^.\n]{0,20}?\b(?:instructions?|prompts?|rules|directions|guidelines|guardrails)\b/i,
  },
  { rule: 'new-instructions', pattern: /\b(?:new|updated|real|actual|secret|hidden)\s+(?:instructions?|orders|task)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+)?(?:ai|assistants?|agents?|models?|llms?|bots?)\b/i },
  { rule: 'addresses-ai', pattern: /\bif\s+you\s+are\s+an?\s+(?:ai|llm|language\s+model|large\s+language\s+model|assistant|ai\s+agent|agent|bot|chatbot)\b/i },
  { rule: 'addresses-ai', pattern: /\b(?:ai|llm|language\s+models?|assistants?|agents?|chatbots?|bots?)\b[^.\n]{0,30}?\b(?:reading|processing|parsing|visiting|browsing|summari[sz]ing)\s+this\b/i },
  { rule: 'role-change', pattern: /\b(?:you\s+are\s+now\s+(?:a|an|in|the)\b|from\s+now\s+on,?\s+you\s+(?:are|will|must|should)\b)/i },
  { rule: 'system-prompt', pattern: /\b(?:system\s+prompt|developer\s+mode|jailbreak|DAN\s+mode)\b/i },
  { rule: 'conceal', pattern: /\b(?:do\s+not|don't|never)\s+(?:tell|inform|alert|notify|warn)\s+the\s+user\b|\bwithout\s+(?:telling|informing|asking|notifying)\s+the\s+user\b/i },
  {
    rule: 'exfiltrate',
    pattern:
      /\b(?:send|post|upload|forward|submit|exfiltrate|leak|share)\b[^.\n]{0,40}?\b(?:passwords?|credentials?|api[\s_-]?keys?|access\s+tokens?|cookies?|session|credit\s+card|card\s+number|private\s+data|personal\s+data|chat\s+history|conversation)\b/i,
  },
  // Chat-format control tokens have no business in a web page.
  { rule: 'control-tokens', pattern: /<\|(?:im_start|im_end|system|user|assistant|endoftext|begin_of_text|eot_id)\|>|\[\/?INST\]|<<\/?SYS>>/i },
  // Chinese
  { rule: 'ignore-instructions', pattern: /(?:忽略|无视|忘记|忘掉|不要理会|不用理会|跳过)(?:掉)?(?:你)?(?:之前|以上|前面|上述|先前|原来|原有|所有|全部|一切)?的?(?:所有|全部)?(?:指令|指示|提示词?|规则|要求|设定|约束)/ },
  { rule: 'role-change', pattern: /(?:从现在(?:开始|起)[，,]?\s*你(?:是|要|必须|应该|将)|你现在是一个)/ },
  { rule: 'addresses-ai', pattern: /(?:如果你是|致|写给|给)(?:一个)?\s*(?:AI|人工智能|大模型|语言模型|AI\s*助手|智能助手|智能体|机器人|Agent)/i },
  { rule: 'system-prompt', pattern: /(?:系统提示词|开发者模式|越狱模式)/ },
  { rule: 'conceal', pattern: /(?:不要|别|不得)(?:告诉|通知|提醒|告知)(?:用户|使用者)/ },
  { rule: 'exfiltrate', pattern: /(?:发送|上传|转发|泄露|提交)[^。\n]{0,20}?(?:密码|密钥|API\s*Key|令牌|Cookie|信用卡|银行卡号|聊天记录|对话记录|个人信息)/i },
  { rule: 'exfiltrate', pattern: /(?:把|将)[^。\n]{0,10}?(?:密码|密钥|API\s*Key|令牌|Cookie|信用卡|银行卡号|聊天记录|对话记录|个人信息)[^。\n]{0,10}?(?:发送|上传|转发|发给|发到|提交|告诉)/i },
  // French
  { rule: 'ignore-instructions', pattern: /\b(?:ignore[rz]?|oublie[rz]?|ne\s+tiens\s+pas\s+compte\s+des)\b[^.\n]{0,30}?\b(?:instructions?|consignes|règles)\b/i },
  { rule: 'addresses-ai', pattern: /\bsi\s+(?:tu\s+es|vous\s+êtes)\s+une?\s+(?:ia|intelligence\s+artificielle|assistant|agent|modèle\s+de\s+langage)\b/i },
  { rule: 'conceal', pattern: /\bne\s+(?:le\s+)?(?:dis|dites)\s+pas\s+à\s+l['’]utilisateur\b|\bsans\s+(?:prévenir|informer)\s+l['’]utilisateur\b/i },
  // Spanish
  { rule: 'ignore-instructions', pattern: /\b(?:ignora|ignore|olvida|olvide|omite|omita)\b[^.\n]{0,30}?\b(?:instrucciones|indicaciones|reglas)\b/i },
  { rule: 'addresses-ai', pattern: /\bsi\s+(?:eres|usted\s+es)\s+una?\s+(?:ia|inteligencia\s+artificial|asistente|agente|modelo\s+de\s+lenguaje)\b/i },
  { rule: 'conceal', pattern: /\bno\s+(?:le\s+)?(?:digas|diga|informes|avises)\s+al\s+usuario\b|\bsin\s+(?:avisar|informar)\s+al\s+usuario\b/i },
];

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 60);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/** The first passage that looks like it is trying to instruct an AI, if any. */
export function findInjection(text: string): InjectionFinding | undefined {
  for (const { rule, pattern } of RULES) {
    const match = pattern.exec(text);
    if (match) return { rule, excerpt: excerptAround(text, match.index, match[0].length) };
  }
  return undefined;
}

/** Strips chat control tokens so page text cannot pose as a new message. */
export function neutralizeControlTokens(text: string): string {
  return text.replace(/<\|([a-z_]+)\|>/gi, '<$1>').replace(/\[(\/?)INST\]/g, '($1INST)').replace(/<<(\/?)SYS>>/g, '($1SYS)');
}

/** Random id that marks where untrusted data really ends; a page cannot guess it. */
export function newBoundary(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Wraps untrusted text in `<tag id="…">…</tag id="…">`. Any `<tag` inside is
 * escaped, so the content cannot close the block early or open a fake one.
 * Card numbers and credentials are hidden first.
 */
export function wrapUntrusted(tag: string, boundary: string, attributes: Record<string, string>, body: string): string {
  const escaped = neutralizeControlTokens(redactSensitive(body)).replace(new RegExp(`<(/?)${tag}\\b`, 'gi'), '&lt;$1' + tag);
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${redactSensitive(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('');
  return `<${tag} id="${boundary}"${attrs}>\n${escaped}\n</${tag} id="${boundary}">`;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ENCODED = /[A-Za-z0-9+/_=-]{80,}/;

/** Leading digits of the card networks (Visa, Mastercard, Amex, Discover, JCB, UnionPay, Diners, Maestro, Mir, RuPay). */
const CARD_PREFIX = /^(?:4|5[0-8]|2[2-7]|3[0-8]|6|8[12])/;
/** How card numbers are written: one run of digits, groups of four, or Amex/Diners 4-6-5 and 4-6-4. */
const CARD_GROUPING = /^(?:\d+|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{4,5})$/;
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** True when the digits form a valid payment card number (network prefix and Luhn check). */
export function isCardNumber(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits) || !CARD_PREFIX.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * A payment card number written with or without spaces or dashes. `grouped`
 * also requires the usual grouping, so an order number such as
 * 402-1234567-1234567 is not mistaken for a card when hiding page text.
 */
export function containsCardNumber(text: string, { grouped = false } = {}): boolean {
  for (const match of text.matchAll(DIGIT_RUN)) {
    if ((!grouped || CARD_GROUPING.test(match[0])) && isCardNumber(match[0].replace(/[ -]/g, ''))) return true;
  }
  return false;
}

/** Credentials with a recognizable shape: API keys, access tokens, private keys. */
const SECRET_SOURCES = [
  String.raw`\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}`, // OpenAI, Anthropic, DeepSeek and others
  String.raw`\b(?:sk|rk)_live_[A-Za-z0-9]{16,}`, // Stripe
  String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, // GitHub
  String.raw`\bgithub_pat_[A-Za-z0-9_]{30,}`,
  String.raw`\bglpat-[A-Za-z0-9_-]{20,}`, // GitLab
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`, // AWS
  String.raw`\bAIza[0-9A-Za-z_-]{35}`, // Google
  String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`, // Slack
  String.raw`\bhf_[A-Za-z0-9]{30,}`, // Hugging Face
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`, // JSON Web Token
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
];
const SECRET = new RegExp(SECRET_SOURCES.join('|'));
const SECRETS = new RegExp(SECRET_SOURCES.join('|'), 'g');

/** True when the text holds something shaped like an API key, access token or private key. */
export function containsSecret(text: string): boolean {
  return SECRET.test(text);
}

export const HIDDEN_CARD = '[card number hidden]';
export const HIDDEN_SECRET = '[key or token hidden]';

/**
 * Removes card numbers and credentials from content before the model sees it.
 * The assistant never needs them, and what it never sees it cannot be talked
 * into sending anywhere.
 */
export function redactSensitive(text: string): string {
  return text
    .replace(SECRETS, HIDDEN_SECRET)
    .replace(DIGIT_RUN, (run) => (CARD_GROUPING.test(run) && isCardNumber(run.replace(/[ -]/g, '')) ? HIDDEN_CARD : run));
}

/**
 * Why a URL the model built might carry data out (an email address, a card
 * number, a key or token, a long encoded blob in its query, fragment, path,
 * credentials or subdomains), if it does.
 */
export function urlDataLeak(url: string): 'email' | 'card' | 'secret' | 'encoded' | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const query = decode(parsed.search.slice(1));
  // Many short parameters add up: a long query is data in itself.
  if (query.length >= 600) return 'encoded';
  // Data hidden in subdomains reaches the site's DNS server even if the page never loads.
  if (parsed.hostname.split('.').some((label) => label.length >= 40 && /\d/.test(label) && /[a-z]/.test(label))) return 'encoded';
  const values = [
    ...parsed.searchParams.values(),
    ...parsed.searchParams.keys(),
    decode(parsed.hash.slice(1)),
    ...parsed.pathname.split('/').map(decode),
    decode(parsed.username),
    decode(parsed.password),
  ];
  // The whole query too, for values split over several parameters.
  if (EMAIL.test(query)) return 'email';
  for (const value of values) {
    if (EMAIL.test(value)) return 'email';
    if (containsCardNumber(value)) return 'card';
    if (containsSecret(value)) return 'secret';
    const blob = ENCODED.exec(value)?.[0];
    if (value.length >= 200 || (blob && /[a-z]/.test(blob) && /[A-Z]/.test(blob) && /\d/.test(blob))) return 'encoded';
  }
  return undefined;
}

/** Second-level labels under country domains, e.g. "co.uk", "com.au", "com.cn". */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'gc', 'or', 'ne', 'go', 'gob', 'gouv']);

/** The registrable site of a host ("www.shop.rogers.com" → "rogers.com"), close enough without the public suffix list. */
export function siteOf(host: string): string {
  const bare = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (/^\d+(\.\d+){3}$/.test(bare) || bare.includes(':') || !bare.includes('.')) return bare;
  const labels = bare.split('.');
  const [second, top] = labels.slice(-2) as [string, string];
  const keep = top.length === 2 && SECOND_LEVEL.has(second) && labels.length > 2 ? 3 : 2;
  return labels.slice(-keep).join('.');
}
