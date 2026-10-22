import type { TargetInfo } from './page/types';
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
  'change password', 'authorize', 'grant access',
  'supprimer', 'fermer le compte', 'résilier', 'autoriser', 'changer le mot de passe',
  'eliminar', 'borrar', 'cerrar cuenta', 'cancelar suscripción', 'autorizar', 'cambiar contraseña',
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
const DESTRUCTIVE_ZH = ['删除', '注销', '销户', '取消订阅', '授权', '修改密码'];
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

export function isNavigationLink(target: TargetInfo): boolean {
  if (target.tag !== 'a' || !target.href) return false;
  try {
    const url = new URL(target.href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const READ_ONLY_TOOLS = new Set(['scroll', 'wait', 'extract', 'look', 'web_search', 'hover', 'switch_tab', 'ask_user', 'hand_off', 'done']);

export function classifyAction(tool: string, args: Record<string, unknown>, target?: TargetInfo): Classification {
  if (READ_ONLY_TOOLS.has(tool)) return { risk: 0 };
  if (tool === 'navigate' || tool === 'go_back' || tool === 'open_tab' || tool === 'close_tab') return { risk: 1 };
  if (!target) return { risk: 1 };

  if (tool === 'type') {
    if (target.isPassword) return { risk: 3, reason: 'sensitiveField', forbidden: 'password' };
    if (target.isPaymentField) return { risk: 3, reason: 'sensitiveField', forbidden: 'payment' };
    if (target.isOneTimeCode) return { risk: 3, reason: 'sensitiveField', forbidden: 'oneTimeCode' };
    // Enter in a search box only searches; elsewhere it may submit a form or send a message.
    return args.submit === true && !target.isSearchField ? { risk: 2, reason: 'submit' } : { risk: 1 };
  }

  if (tool === 'click') {
    // Following a real link only navigates; effects happen on the next page.
    if (isNavigationLink(target)) return { risk: 1 };
    const text = [target.text, target.ariaLabel].filter(Boolean).join(' ');
    const byText = classifyText(text);
    if (byText) return byText;
    if (target.isSubmit) return { risk: 2, reason: 'submit' };
  }
  return { risk: 1 };
}
