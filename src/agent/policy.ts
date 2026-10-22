import type { AgentMode, SitePolicy } from '../shared/types';
import type { RiskLevel } from './types';

/** Policy for a hostname; a "example.com" entry also covers its subdomains. Undefined when none is set. */
export function policyFor(hostname: string, policies: Record<string, SitePolicy>): SitePolicy | undefined {
  const host = hostname.toLowerCase();
  let best: { key: string; policy: SitePolicy } | undefined;
  for (const [key, policy] of Object.entries(policies)) {
    const k = key.toLowerCase().replace(/^\*\./, '');
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
