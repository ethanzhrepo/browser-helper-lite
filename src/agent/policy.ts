import type { AgentMode, SitePolicy } from '../shared/types';
import type { RiskLevel, RiskReason } from './types';

const normalizeHost = (hostname: string) => hostname.toLowerCase().replace(/\.+$/, '');

/** Policy for a hostname; a "example.com" entry also covers its subdomains. Undefined when none is set. */
export function policyFor(hostname: string, policies: Record<string, SitePolicy>): SitePolicy | undefined {
  const host = normalizeHost(hostname);
  if (!host) return undefined;
  let best: { key: string; policy: SitePolicy } | undefined;
  for (const [key, policy] of Object.entries(policies)) {
    const k = normalizeHost(key).replace(/^\*\./, '');
    if (!k) continue;
    if ((host === k || host.endsWith(`.${k}`)) && (!best || k.length > best.key.length)) best = { key: k, policy };
  }
  return best?.policy;
}

export type Decision = 'allow' | 'confirm' | 'deny';

/**
 * What an action does, beyond its risk level:
 * - browse: navigation, following a link, switching tabs, scrolling, hovering
 * - search: typing into a search box (and pressing Enter there)
 * - change: anything else that acts on the page (buttons, forms, keys)
 */
export type ActionKind = 'browse' | 'search' | 'change';

const STRICTNESS: Record<Decision, number> = { allow: 0, confirm: 1, deny: 2 };

function strictest(...decisions: Decision[]): Decision {
  return decisions.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a));
}

/** The global mode's rule (§M1.5 B6). */
export function modeDecision(mode: AgentMode, risk: RiskLevel, kind: ActionKind): Decision {
  if (risk === 0) return 'allow';
  const browsing = kind !== 'change' && risk <= 1;
  switch (mode) {
    case 'query':
      return browsing ? 'allow' : 'deny';
    case 'manual':
      return browsing ? 'allow' : 'confirm';
    case 'auto':
      return risk >= 3 ? 'confirm' : 'allow';
  }
}

/** A site policy's rule (§6). No policy means no extra restriction. */
export function siteDecision(policy: SitePolicy | undefined, risk: RiskLevel, kind: ActionKind): Decision {
  if (risk === 0) return 'allow';
  switch (policy) {
    case undefined:
      return 'allow';
    case 'blocked':
      return 'deny';
    case 'readOnly':
      return kind !== 'change' && risk <= 1 ? 'allow' : 'deny';
    case 'confirmEach':
      return kind === 'browse' ? 'allow' : 'confirm';
    case 'confirmRisky':
      return risk >= 2 ? 'confirm' : 'allow';
    case 'auto':
      return risk >= 3 ? 'confirm' : 'allow';
  }
}

/**
 * Combines the mode and the site policy: the stricter one wins, so a blocked
 * site stays untouched in Auto mode. One exception: a site marked "auto"
 * ("Always allow on this site") skips Manual mode's approvals. High-risk
 * actions always need approval.
 */
export function decide(mode: AgentMode, policy: SitePolicy | undefined, risk: RiskLevel, kind: ActionKind): Decision {
  const site = siteDecision(policy, risk, kind);
  const decision = mode === 'manual' && policy === 'auto' ? site : strictest(modeDecision(mode, risk, kind), site);
  return risk >= 3 ? strictest(decision, 'confirm') : decision;
}

export interface GuardInput {
  mode: AgentMode;
  policy: SitePolicy | undefined;
  host: string;
  risk: RiskLevel;
  kind: ActionKind;
  reason?: RiskReason;
  confirm?: boolean;
  /** On a forum or social site, acting in the user's name (like, vote, follow, post). */
  social?: boolean;
  /** Account security, keys, consoles or payments page. */
  sensitivePage?: boolean;
  /** The turn already saw prompt injection, and this action changes a page or follows an untrusted link. */
  injection?: boolean;
}

export interface GuardOutcome {
  decision: Decision;
  risk: RiskLevel;
  reason: RiskReason;
  /** Key in allowedThisTask; undefined when actions must be approved one at a time. */
  allowKey?: string;
  canAllowSite: boolean;
}

/**
 * Full approval decision combining mode/site policy with unconditional
 * escalations (unseen drawn content, social actions, sensitive pages, and
 * post-injection caution). Escalations apply even when the base decision is
 * already `confirm` (e.g. Manual mode or confirmEach/confirmRisky), so
 * one-by-one approval and injection isolation are never bypassed.
 */
export function evaluateGuard(input: GuardInput): GuardOutcome {
  let decision = decide(input.mode, input.policy, input.risk, input.kind);
  const fallbackReason: RiskReason = input.mode === 'manual' ? 'manualMode' : 'confirmEach';
  if (decision === 'deny') {
    return { decision: 'deny', risk: input.risk, reason: input.reason ?? fallbackReason, canAllowSite: false };
  }

  const isUnseen = Boolean(input.confirm) || input.reason === 'unseen';
  const isSocial = Boolean(input.social) && input.kind === 'change';
  const isSensitive = Boolean(input.sensitivePage) && input.risk >= 1 && input.kind !== 'browse';
  const isInjection = Boolean(input.injection) && input.risk >= 1;

  if (input.confirm || isSocial || isSensitive || isInjection) decision = 'confirm';
  const risk = (isSocial ? Math.max(input.risk, 2) : input.risk) as RiskLevel;

  const reason: RiskReason =
    risk >= 3 && input.reason
      ? input.reason
      : isSensitive
        ? 'sensitivePage'
        : isInjection
          ? 'injection'
          : isUnseen
            ? 'unseen'
            : isSocial
              ? 'social'
              : (input.reason ?? fallbackReason);

  const oneByOne = risk >= 3 || isSensitive || reason === 'exfiltration' || reason === 'secret';
  const scopes = [isInjection ? 'injection' : '', isUnseen ? 'unseen' : '', isSocial ? 'social' : ''].filter(Boolean);
  const allowScope = scopes.length > 0 ? scopes.join('+') : String(risk);
  const allowKey = oneByOne ? undefined : `${allowScope}|${normalizeHost(input.host)}`;
  const canAllowSite = !oneByOne && !isInjection && !isUnseen && !isSocial && !['newSite', 'download', 'watch'].includes(reason);

  return { decision, risk, reason, allowKey, canAllowSite };
}
