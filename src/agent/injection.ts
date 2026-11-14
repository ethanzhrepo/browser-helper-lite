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

/**
 * The rules look for text that tells an AI what to do, not for text that is
 * about AI. "Send your API key in the header" is documentation, and "this is
 * called a system prompt" is an encyclopedia; a wrong alarm makes the rest
 * of the task ask for approval at every turn, so each rule needs the shape
 * of an order: who is addressed, what to drop, where to send it.
 */
const RULES: { rule: string; pattern: RegExp }[] = [
  // English
  {
    rule: 'ignore-instructions',
    // "ignore the previous instructions", "disregard your rules". Not "drivers who ignore the rules", "do not ignore the instructions on the label".
    pattern:
      /(?<!\b(?:not|never|who|that|to|they|we|people|users|can|cannot|could|would|might|may|should|often|sometimes|safely)\s|n't\s)\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}?\b(?:(?:previous|prior|above|earlier|preceding|system|original|initial)\b[^.\n]{0,20}?\b(?:instructions?|prompts?|rules|directions|guidelines|guardrails)|(?:all|any|your|these|the)\b[^.\n]{0,20}?\b(?:instructions?|prompts?|guardrails)|your\b[^.\n]{0,20}?\b(?:rules|directions|guidelines))\b/i,
  },
  { rule: 'new-instructions', pattern: /\b(?:new|updated|real|actual|secret|hidden)\s+(?:instructions?|orders|task)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+)?(?:ai|assistants?|agents?|models?|llms?|bots?)\b/i },
  {
    rule: 'addresses-ai',
    // An estate agent or an assistant professor is not meant.
    pattern:
      /\bif\s+you\s+are\s+an?\s+(?:ai\b|llm\b|(?:large\s+)?language\s+model|chatbot|bot\b|(?:ai|virtual|automated|digital)\s+assistant|(?:ai|automated|autonomous|browser|browsing|web)\s+agent|assistant\b(?!\s+(?:professor|manager|director|coach|editor|teacher|principal|engineer|nurse|secretary)))/i,
  },
  { rule: 'addresses-ai', pattern: /\b(?:ai|llm|language\s+models?|assistants?|agents?|chatbots?|bots?)\b[^.\n]{0,30}?\b(?:reading|processing|parsing|visiting|browsing|summari[sz]ing)\s+this\b/i },
  {
    rule: 'role-change',
    // "From now on, you are a pirate", "you are now in developer mode". Not "you are now in the queue", "from now on you will receive our newsletter".
    pattern:
      /\byou\s+are\s+now\s+(?:(?:an?|the|my)\s+)?(?:ai\b|assistant|agent|bot|chatbot|dan\b|unrestricted|unfiltered|jailbroken|free\s+(?:of|from)|in\s+(?:developer|jailbreak|dan|god|admin)\s+mode)|\bfrom\s+now\s+on,?\s+you\s+(?:are\s+(?:an?|the|my|no\s+longer)\b|(?:will|must|should|shall)\s+(?:act|behave|respond|answer|reply|ignore|obey|follow|pretend|only|always|never|not)\b)/i,
  },
  {
    rule: 'system-prompt',
    // Asking for the instructions, or switching a made-up "mode" on; naming them is not enough. Phones and Chrome have a real developer mode that people are told to turn on.
    pattern:
      /\b(?:reveal|show|print|repeat|output|display|leak|share|recite|tell\s+me|give\s+me|ignore|override|forget|disregard)\b[^.\n]{0,30}?\b(?:your|the)\s+(?:system\s+prompt|initial\s+instructions|hidden\s+instructions|original\s+instructions)\b|\b(?:enter|enable|activate|switch\s+to|turn\s+on)\s+(?:jailbreak|dan|god)\s+mode\b/i,
  },
  {
    rule: 'conceal',
    pattern:
      /\b(?:do\s+not|don't|never)\s+(?:tell|inform|alert|notify|warn)\s+the\s+user\b|\b(?:proceed|continue|act|do\s+(?:this|it|so)|complete|click|submit|send|buy|approve|confirm)\b[^.\n]{0,40}?\bwithout\s+(?:telling|informing|asking|notifying|alerting)\s+the\s+user\b/i,
  },
  {
    rule: 'exfiltrate',
    // Something private, and somewhere to send it. "Send your API key in the Authorization header" has no somewhere.
    pattern:
      /\b(?:send|post|upload|forward|submit|exfiltrate|leak|share|e-?mail|transmit)\b[^.\n]{0,40}?\b(?:passwords?|credentials?|api[\s_-]?keys?|access\s+tokens?|cookies?|session\s+(?:tokens?|cookies?|ids?)|credit\s+card|card\s+numbers?|private\s+data|personal\s+(?:data|information)|chat\s+history|conversation(?:\s+history)?)\b[^.\n]{0,40}?\bto\s+(?:https?:\/\/|www\.|[\w.+-]+@[\w-]+\.|[\w-]+\.[a-z]{2,}\b|me\b|us\b|my\s|this\s+(?:address|url|e-?mail|number|site|server|endpoint|form)|the\s+following)/i,
  },
  // Chat-format control tokens have no business in a web page.
  { rule: 'control-tokens', pattern: /<\|(?:im_start|im_end|system|user|assistant|endoftext|begin_of_text|eot_id)\|>|\[\/?INST\]|<<\/?SYS>>/i },
  // Chinese
  { rule: 'ignore-instructions', pattern: /(?:忽略|无视|忘记|忘掉|不要理会|不用理会|跳过)(?:掉)?(?:你)?(?:之前|以上|前面|上述|先前|原来|原有|所有|全部|一切)?的?(?:所有|全部)?(?:指令|指示|提示词?|规则|要求|设定|约束)/ },
  {
    rule: 'role-change',
    // 「从现在开始，你是一个……」。不是「从现在开始，你将收到通知」。
    pattern: /从现在(?:开始|起)[，,]?\s*你(?:是(?:一个|一名|一位|我的)|要扮演|将扮演|将作为|只(?:能|需|要)|(?:必须|应该|要)(?:听从|服从|按照|遵守|遵循|忽略|无视))|你现在是一(?:个|名|位)(?:AI|人工智能|助手|机器人|智能体|没有(?:任何)?限制)/i,
  },
  { rule: 'addresses-ai', pattern: /(?:如果你是|假如你是|若你是|致|写给)(?:一个|一名)?\s*(?:AI|人工智能|大模型|语言模型|智能助手|智能体|机器人|Agent)/i },
  { rule: 'addresses-ai', pattern: /(?:AI|人工智能)\s*(?:助手|模型|智能体)?[，,：:]?\s*请(?:注意|你|务必)/i },
  { rule: 'system-prompt', pattern: /(?:输出|显示|透露|泄露|告诉我|打印|复述|重复|忽略|无视)[^。\n]{0,10}(?:你的|你)?(?:系统提示词?|初始指令|原始指令)|(?:进入|开启|启用|切换到)(?:越狱|DAN)模式/i },
  { rule: 'conceal', pattern: /(?:不要|别|不得)(?:告诉|通知|提醒|告知)(?:用户|使用者)/ },
  { rule: 'exfiltrate', pattern: /(?:发送|上传|转发|泄露|提交)[^。\n]{0,20}?(?:密码|密钥|API\s*Key|令牌|Cookie|信用卡|银行卡号|聊天记录|对话记录|个人信息)[^。\n]{0,10}?(?:到|给|至)/i },
  { rule: 'exfiltrate', pattern: /(?:把|将)[^。\n]{0,10}?(?:密码|密钥|API\s*Key|令牌|Cookie|信用卡|银行卡号|聊天记录|对话记录|个人信息)[^。\n]{0,10}?(?:发送到|发送给|上传到|转发给|转发到|发给|发到|提交到|提交给|告诉)/i },
  // French
  // "ignore" and "instructions" are English words too: the French and Spanish rules need their articles.
  {
    rule: 'ignore-instructions',
    pattern:
      /\b(?:ignore[rz]?|oublie[rz]?)\s+(?:toutes\s+)?(?:(?:les|tes|vos|ces)\s+(?:instructions|consignes)|(?:tes|vos)\s+règles|les\s+règles\s+précédentes)\b|\bne\s+tiens\s+pas\s+compte\s+des\s+(?:instructions|consignes)\b/i,
  },
  { rule: 'addresses-ai', pattern: /\bsi\s+(?:tu\s+es|vous\s+êtes)\s+une?\s+(?:ia|intelligence\s+artificielle|assistant|agent|modèle\s+de\s+langage)\b/i },
  { rule: 'conceal', pattern: /\bne\s+(?:le\s+)?(?:dis|dites)\s+pas\s+à\s+l['’]utilisateur\b|\bsans\s+(?:prévenir|informer)\s+l['’]utilisateur\b/i },
  // Spanish
  {
    rule: 'ignore-instructions',
    pattern: /(?<!\b(?:no|nunca|quien|que)\s)\b(?:ignora|ignore|olvida|olvide|omite|omita)\s+(?:todas\s+)?(?:(?:las|tus|sus|estas)\s+(?:instrucciones|indicaciones)|(?:tus|sus)\s+reglas|las\s+reglas\s+(?:anteriores|previas))\b/i,
  },
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
