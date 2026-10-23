import { containsCardNumber, containsSecret } from './injection';
import { parseKeyCombo } from './keys';
import type { TargetInfo } from './page/types';
import type { ActionKind } from './policy';
import { matchOption } from './select';
import type { RiskLevel, RiskReason } from './types';

/**
 * Rule-based risk classification (§8.1). Button text is matched in all four
 * UI languages because a page's language need not match the UI language
 * (§4.6). A model-based second opinion is planned for M2.
 */

const PAYMENT_WORDS = [
  'pay', 'pay now', 'payment', 'purchase', 'buy', 'buy now', 'place order', 'complete order', 'confirm order',
  'confirm purchase', 'submit order', 'checkout and pay', 'transfer', 'send money', 'donate', 'subscribe and pay',
  'payer', 'paiement', 'acheter', 'commander', 'passer la commande', 'valider la commande', "confirmer l'achat", 'virement',
  'pagar', 'pago', 'comprar', 'realizar pedido', 'confirmar pedido', 'confirmar compra', 'transferir', 'transferencia',
];
const DESTRUCTIVE_WORDS = [
  'delete', 'delete account', 'remove account', 'close account', 'deactivate', 'cancel subscription', 'cancel service',
  'change password', 'authorize', 'authorise', 'grant access', 'allow access', 'approve',
  // Credentials and account security: what a hijacked assistant would go for.
  'revoke', 'generate token', 'generate new token', 'create token', 'new token', 'regenerate token', 'regenerate key',
  'create api key', 'generate api key', 'create new secret key', 'transfer ownership', 'make public', 'change visibility',
  'change email', 'reset password', 'disable two-factor', 'disable 2fa', 'turn off two-factor', 'remove two-factor',
  'add to chrome', 'install extension',
  'supprimer', 'fermer le compte', 'résilier', 'autoriser', 'changer le mot de passe', 'approuver', 'révoquer',
  'générer un jeton', 'transférer la propriété', 'réinitialiser le mot de passe', 'désactiver la double authentification',
  'ajouter à chrome',
  'eliminar', 'borrar', 'cerrar cuenta', 'cancelar suscripción', 'autorizar', 'cambiar contraseña', 'aprobar', 'revocar',
  'generar token', 'transferir la propiedad', 'restablecer contraseña', 'desactivar la verificación en dos pasos',
  'añadir a chrome', 'agregar a chrome',
];
const EFFECT_WORDS = [
  'submit', 'send', 'post', 'publish', 'reply', 'comment', 'save', 'confirm', 'book', 'book now', 'reserve', 'apply',
  'register', 'sign up', 'add to cart', 'add to bag', 'add to basket', 'checkout', 'check out', 'share', 'follow',
  'upload', 'invite', 'accept', 'decline', 'subscribe', 'unsubscribe', 'remove', 'cancel booking',
  'envoyer', 'soumettre', 'publier', 'répondre', 'commenter', 'enregistrer', 'confirmer', 'réserver', "s'inscrire",
  'postuler', 'ajouter au panier', 'passer à la caisse', 'partager', 'suivre', 'téléverser', 'inviter', 'accepter',
  'refuser', 'retirer',
  'enviar', 'publicar', 'responder', 'comentar', 'guardar', 'confirmar', 'reservar', 'registrarse', 'inscribirse',
  'solicitar', 'añadir al carrito', 'agregar al carrito', 'finalizar compra', 'compartir', 'seguir', 'subir',
  'invitar', 'aceptar', 'rechazar', 'quitar',
];
// Chinese has no word boundaries, so these match as substrings.
const PAYMENT_ZH = ['支付', '付款', '购买', '下单', '提交订单', '确认订单', '转账', '汇款', '捐款'];
const DESTRUCTIVE_ZH = [
  '删除', '注销', '销户', '取消订阅', '授权', '修改密码', '批准', '吊销', '撤销授权', '撤销令牌', '撤销访问',
  '生成令牌', '创建令牌', '生成密钥', '创建密钥', '新建密钥', '重新生成密钥', '转让', '设为公开', '重置密码',
  '更换邮箱', '修改邮箱', '关闭两步验证', '关闭双重验证', '关闭二次验证', '添加至 Chrome', '添加到 Chrome', '安装扩展',
];
const EFFECT_ZH = ['提交', '发送', '发布', '回复', '评论', '保存', '确认', '预订', '预约', '报名', '申请', '注册', '加入购物车', '结算', '分享', '关注', '上传', '邀请', '接受', '拒绝', '移除'];

function wordPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  // Unicode-aware word boundaries so "réserver" and "añadir" match whole words.
  return new RegExp(`(?:^|[^\\p{L}])(?:${escaped.join('|')})(?:$|[^\\p{L}])`, 'iu');
}

const PAYMENT = wordPattern(PAYMENT_WORDS);
const DESTRUCTIVE = wordPattern(DESTRUCTIVE_WORDS);
const EFFECT = wordPattern(EFFECT_WORDS);
const includesAny = (text: string, words: string[]) => words.some((w) => text.includes(w));

export interface Classification {
  risk: RiskLevel;
  reason?: RiskReason;
  /** Set when the action must never be done by the agent. */
  forbidden?: 'password' | 'payment' | 'oneTimeCode';
}

function classifyText(text: string): Classification | undefined {
  if (PAYMENT.test(text) || includesAny(text, PAYMENT_ZH)) return { risk: 3, reason: 'payment' };
  if (DESTRUCTIVE.test(text) || includesAny(text, DESTRUCTIVE_ZH)) return { risk: 3, reason: 'destructive' };
  if (EFFECT.test(text) || includesAny(text, EFFECT_ZH)) return { risk: 2, reason: 'submit' };
  return undefined;
}

/** Files that run code once opened, and archives that may hold such files. */
const EXECUTABLE = /\.(?:exe|msi|msix|appx|dmg|pkg|apk|aab|ipa|deb|rpm|appimage|run|bat|cmd|scr|cpl|ps1|psm1|vbs|vbe|wsf|hta|jar|sh|command|crx|xpi|iso)$/i;
const ARCHIVE = /\.(?:zip|rar|7z|tar|gz|tgz|bz2|xz|cab)$/i;

/** Downloading a program is high risk; an archive or another file is L2 (§8.1). */
export function downloadRisk(url: string): Classification | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  if (EXECUTABLE.test(path)) return { risk: 3, reason: 'download' };
  if (ARCHIVE.test(path)) return { risk: 2, reason: 'download' };
  return undefined;
}

export function isNavigationLink(target: TargetInfo): boolean {
  if (target.tag !== 'a' || !target.href) return false;
  try {
    const url = new URL(target.href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Fields the agent never types into: logging in and paying are up to the user. */
function sensitiveField(target: TargetInfo): Classification | undefined {
  if (target.isPassword) return { risk: 3, reason: 'sensitiveField', forbidden: 'password' };
  if (target.isPaymentField) return { risk: 3, reason: 'sensitiveField', forbidden: 'payment' };
  if (target.isOneTimeCode) return { risk: 3, reason: 'sensitiveField', forbidden: 'oneTimeCode' };
  return undefined;
}

const READ_ONLY_TOOLS = new Set(['read_page', 'view_page', 'scroll', 'wait', 'extract', 'look', 'web_search', 'hover', 'switch_tab', 'ask_user', 'hand_off']);

/** Submitting the form a field belongs to, judged by the form's submit button ("Place order" is a payment). */
function classifySubmit(target: TargetInfo): Classification {
  if (target.isSearchField) return { risk: 1 };
  return classifyText(target.formSubmitText ?? '') ?? { risk: 2, reason: 'submit' };
}

/** Clicking (or pressing Enter/Space on) an element. Links get the same text check as buttons. */
function classifyActivation(target: TargetInfo): Classification {
  // A click that lands in another site's frame acts on something the extension cannot see.
  if (target.frameOrigin) return { risk: 3, reason: 'frame' };
  const byText = classifyText([target.text, target.ariaLabel].filter(Boolean).join(' '));
  if (byText) return byText;
  const download = target.href ? downloadRisk(target.href) : undefined;
  if (download) return download;
  if (target.download) return { risk: 2, reason: 'download' };
  // Following a real link only navigates; effects happen on the next page.
  if (isNavigationLink(target)) return { risk: 1 };
  if (target.isSubmit) return classifyText(target.formSubmitText ?? '') ?? { risk: 2, reason: 'submit' };
  return { risk: 1 };
}

/**
 * A key press acts on the focused element, so it is judged like what it
 * triggers: Enter or Space on a button is a click, Enter in a form field
 * submits the form, and shortcuts such as paste get no less than L2.
 */
function classifyPress(keys: string, target: TargetInfo | undefined): Classification {
  const combo = parseKeyCombo(keys);
  const shortcut = combo.ctrlKey || combo.metaKey || combo.altKey;
  // Pasting puts the user's clipboard, which the model has never seen, into the page.
  if (((combo.ctrlKey || combo.metaKey) && /^v$/i.test(combo.key)) || (combo.shiftKey && /^insert$/i.test(combo.key))) {
    return { risk: 3, reason: 'clipboard' };
  }
  const character = !shortcut && combo.key.length === 1;
  if (target && (character || combo.key === 'Enter') && target.frameOrigin) return { risk: 3, reason: 'frame' };
  if (target && character) {
    // Typing one key at a time gets the same checks as type.
    const blocked = sensitiveField(target);
    if (blocked) return blocked;
    if (target.editable && containsCardNumber(`${target.text}${combo.key}`)) return { risk: 3, reason: 'sensitiveField', forbidden: 'payment' };
  }
  if (shortcut) return /^a$/i.test(combo.key) ? { risk: 1 } : { risk: 2, reason: 'submit' };
  if (!target || (combo.key !== 'Enter' && combo.key !== ' ')) return { risk: 1 };
  if (target.editable) {
    if (combo.key === ' ') return { risk: 1 };
    // Enter in a text area or rich editor may send a message.
    return target.tag === 'input' ? classifySubmit(target) : { risk: 2, reason: 'submit' };
  }
  return classifyActivation(target);
}

export function classifyAction(tool: string, args: Record<string, unknown>, target?: TargetInfo): Classification {
  if (READ_ONLY_TOOLS.has(tool)) return { risk: 0 };
  if (tool === 'navigate' || tool === 'go_back' || tool === 'open_tab' || tool === 'close_tab') return { risk: 1 };
  if (tool === 'press') return classifyPress(String(args.keys ?? ''), target);
  if (!target) return { risk: 1 };

  if (tool === 'type') {
    const blocked = sensitiveField(target);
    if (blocked) return blocked;
    if (target.frameOrigin) return { risk: 3, reason: 'frame' };
    const text = String(args.text ?? '');
    // A card number in any field (a page can label its fields however it likes), also when typed in pieces.
    if (containsCardNumber(args.clear === false ? `${target.text}${text}` : text)) return { risk: 3, reason: 'sensitiveField', forbidden: 'payment' };
    // Keys and tokens are approved one at a time, whatever the field says it is for.
    if (containsSecret(text)) return { risk: 3, reason: 'secret' };
    // Enter in a search box only searches; elsewhere it submits the form, judged by its submit button.
    if (args.submit !== true) return { risk: 1 };
    return target.tag === 'input' ? classifySubmit(target) : target.isSearchField ? { risk: 1 } : { risk: 2, reason: 'submit' };
  }

  if (tool === 'click') return classifyActivation(target);
  if (tool === 'select_option') {
    // Judged by the option that will be picked, which may be matched by its value.
    const chosen = matchOption(target.options ?? [], String(args.option ?? ''));
    return classifyText(chosen?.text ?? String(args.option ?? '')) ?? { risk: 1 };
  }
  return { risk: 1 };
}

/** What kind of action this is for the modes (§M1.5 B6): following a link, searching, or changing the page. */
export function actionKind(tool: string, args: Record<string, unknown>, target: TargetInfo | undefined, classification: Classification): ActionKind {
  if (classification.risk > 1 || !target) return 'change';
  const key = tool === 'press' ? parseKeyCombo(String(args.keys ?? '')).key : undefined;
  if ((tool === 'click' || key === 'Enter') && isNavigationLink(target)) return 'browse';
  if ((tool === 'type' || key === 'Enter') && target.isSearchField) return 'search';
  return 'change';
}
