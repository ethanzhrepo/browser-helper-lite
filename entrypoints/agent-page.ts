import { createPageAgent } from '../src/agent/page/page-agent';
import type { PageAgentApi } from '../src/agent/page/types';

/**
 * Injected on demand into pages the agent works on. Installs the page agent
 * once per document; later injections reuse it, so element indices survive
 * between calls.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as { __browserHelperAgent?: PageAgentApi };
  scope.__browserHelperAgent ??= createPageAgent();
  return true;
});
