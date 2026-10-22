import type { SitePolicy } from '../shared/types';
import type { RiskLevel } from './types';

export const DEFAULT_SITE_POLICY: SitePolicy = 'confirmRisky';

/** Policy for a hostname; a "example.com" entry also covers its subdomains. */
export function policyFor(hostname: string, policies: Record<string, SitePolicy>): SitePolicy {
  const host = hostname.toLowerCase();
  let best: { key: string; policy: SitePolicy } | undefined;
  for (const [key, policy] of Object.entries(policies)) {
    const k = key.toLowerCase().replace(/^\*\./, '');
    if ((host === k || host.endsWith(`.${k}`)) && (!best || k.length > best.key.length)) best = { key: k, policy };
  }
  return best?.policy ?? DEFAULT_SITE_POLICY;
}

export type Decision = 'allow' | 'confirm' | 'deny';

/**
 * Whether an action may run under a site policy (§6). L3 always needs
 * confirmation; read-only sites still allow reading and following links.
 */
export function decide(policy: SitePolicy, risk: RiskLevel, { isNavigation }: { isNavigation: boolean }): Decision {
  if (risk === 0) return 'allow';
  switch (policy) {
    case 'blocked':
      return 'deny';
    case 'readOnly':
      return isNavigation && risk === 1 ? 'allow' : 'deny';
    case 'confirmEach':
      return 'confirm';
    case 'confirmRisky':
      return risk >= 2 ? 'confirm' : 'allow';
    case 'auto':
      return risk >= 3 ? 'confirm' : 'allow';
  }
}
