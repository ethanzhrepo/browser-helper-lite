import { browser } from 'wxt/browser';
import { toErrorInfo } from '../providers/errors';
import { fetchModelList } from '../providers/model-list';
import { pickSlot, resolveModelRef } from '../providers/resolve';
import { transcribeAudio } from '../providers/speech';
import { nativeSearch } from '../search/native';
import { apiSearch, deepseekConnection } from '../search/search';
import type {
  ConnectionTestRequest,
  ConnectionTestResult,
  DataClearRequest,
  DataClearResult,
  RuntimeRequest,
  SearchTestRequest,
  SearchTestResult,
  TranscribeRequest,
  TranscribeResult,
} from '../shared/protocol';
import { clearConversations } from '../storage/db';
import { getApiKey, getSearchKey, loadSettings } from '../storage/settings';
import { stopAllTasks } from './agent-service';
import { isExtensionPage } from './trust';

export async function testConnection(request: ConnectionTestRequest): Promise<ConnectionTestResult> {
  const apiKey = request.apiKey || (request.connectionId ? await getApiKey(request.connectionId) : undefined);
  try {
    const models = await fetchModelList(request.vendor, request.baseURL, apiKey);
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: toErrorInfo(error) };
  }
}

async function testSearch(request: SearchTestRequest): Promise<SearchTestResult> {
  try {
    const settings = await loadSettings();
    if (request.provider === 'native') {
      const ref = pickSlot(settings, ['chat']);
      if (!ref) throw new Error('Choose a model first.');
      return { ok: true, results: [], text: await nativeSearch(await resolveModelRef(settings, ref), request.query) };
    }
    const connection = request.provider === 'deepseek' ? deepseekConnection(settings.search, settings.connections) : undefined;
    const apiKey = connection ? await getApiKey(connection.id) : await getSearchKey(request.provider);
    const results = await apiSearch(request.provider, request.query, { settings: settings.search, connections: settings.connections, apiKey });
    return { ok: true, results };
  } catch (error) {
    return { ok: false, results: [], error: toErrorInfo(error) };
  }
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
  try {
    const text = await transcribeAudio(await loadSettings(), fromBase64(request.audio), request.mediaType, request.language);
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: '', error: toErrorInfo(error) };
  }
}

async function clearData(request: DataClearRequest): Promise<DataClearResult> {
  try {
    await stopAllTasks();
    await clearConversations();
    if (request.scope === 'everything') {
      await browser.storage.local.clear();
      await browser.storage.session.clear();
      // Site access granted at runtime goes too; access a build declares itself cannot be removed.
      const { origins = [] } = await browser.permissions.getAll();
      await Promise.all(origins.map((origin) => browser.permissions.remove({ origins: [origin] }).catch(() => false)));
    }
    return { ok: true };
  } catch (error) {
    console.error('Could not erase the data', error);
    return { ok: false };
  }
}

export function registerRuntimeHandlers(): void {
  browser.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
    // These use stored API keys: only our own pages may ask.
    if (!isExtensionPage(sender)) return undefined;
    if (message?.type === 'connection.test') {
      void testConnection(message).then(sendResponse);
      return true;
    }
    if (message?.type === 'search.test') {
      void testSearch(message).then(sendResponse);
      return true;
    }
    if (message?.type === 'stt.transcribe') {
      void transcribe(message).then(sendResponse);
      return true;
    }
    if (message?.type === 'data.clear') {
      void clearData(message).then(sendResponse);
      return true;
    }
    return undefined;
  });
}
