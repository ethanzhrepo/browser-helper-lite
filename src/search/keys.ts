import type { SearchProviderId, Settings } from '../shared/types';
import { getApiKey, getSearchKey } from '../storage/settings';
import { deepseekConnection } from './search';

/** The stored key for an API search provider. DeepSeek search uses a DeepSeek connection's key unless it has its own. */
export async function searchApiKey(provider: SearchProviderId, settings: Settings): Promise<string | undefined> {
  const connection = provider === 'deepseek' ? deepseekConnection(settings.search, settings.connections) : undefined;
  return connection ? getApiKey(connection.id) : getSearchKey(provider);
}
