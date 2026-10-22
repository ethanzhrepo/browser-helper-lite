import { browser } from 'wxt/browser';
import { toErrorInfo } from '../providers/errors';
import { fetchModelList } from '../providers/model-list';
import type { ConnectionTestRequest, ConnectionTestResult, RuntimeRequest } from '../shared/protocol';
import { getApiKey } from '../storage/settings';

export async function testConnection(request: ConnectionTestRequest): Promise<ConnectionTestResult> {
  const apiKey = request.apiKey || (request.connectionId ? await getApiKey(request.connectionId) : undefined);
  try {
    const models = await fetchModelList(request.vendor, request.baseURL, apiKey);
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: toErrorInfo(error) };
  }
}

export function registerRuntimeHandlers(): void {
  browser.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
    if (message?.type === 'connection.test') {
      void testConnection(message).then(sendResponse);
      return true;
    }
    return undefined;
  });
}
