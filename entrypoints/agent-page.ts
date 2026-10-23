import { createPageAgent } from '../src/agent/page/page-agent';
import type { PageAgentApi } from '../src/agent/page/types';

/**
 * Injected on demand into pages the agent works on. Installs the page agent
 * once per document; later injections reuse it, so element indices survive
 * between calls. The key is a symbol: an element with a matching id cannot
 * shadow it the way it can shadow a window property name.
 */
export default defineUnlistedScript(() => {
  const key = Symbol.for('browser-helper-agent');
  const scope = globalThis as unknown as Record<symbol, PageAgentApi | undefined>;
  if (typeof scope[key]?.snapshot !== 'function') scope[key] = createPageAgent();
  return true;
});
