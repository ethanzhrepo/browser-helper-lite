import { browser } from 'wxt/browser';
import { showPendingPictures } from '../agent/keep-pictures';
import { toErrorInfo } from '../providers/errors';
import { fetchModelList } from '../providers/model-list';
import { pickSlot, resolveModelRef } from '../providers/resolve';
import { transcribeAudio } from '../providers/speech';
import { nativeSearch } from '../search/native';
import { searchApiKey } from '../search/keys';
import { apiSearch } from '../search/search';
import type {
  ConnectionTestRequest,
  ConnectionTestResult,
  DataClearRequest,
  RegionCaptureRequest,
  RegionCaptureResult,
  DataClearResult,
  RuntimeRequest,
  SearchTestRequest,
  SearchTestResult,
  TranscribeRequest,
  TranscribeResult,
} from '../shared/protocol';
import { ENABLE_CDP_DRIVER } from '../shared/build-flags';
import { clearConversations, db } from '../storage/db';
import { getApiKey, loadSettings } from '../storage/settings';
import { stopAllTasks } from './agent-service';
import { isExtensionPage } from './trust';
import { clearWatches } from './watch-service';

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
    const apiKey = await searchApiKey(request.provider, settings);
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
      await clearWatches();
      await db.skills.clear();
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

/**
 * A screenshot of the visible tab. Chrome allows it with access to all sites
 * or right after the user used the extension on the tab (its menu, its
 * shortcut); otherwise the debugger takes it and lets go at once.
 */
async function captureRegion(request: RegionCaptureRequest): Promise<RegionCaptureResult> {
  try {
    let tab = await browser.tabs.get(request.tabId);
    if (!tab.active) tab = (await browser.tabs.update(request.tabId, { active: true })) ?? tab;
    try {
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { ok: true, image: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/png' };
    } catch (error) {
      if (!ENABLE_CDP_DRIVER) throw error;
      const target = { tabId: request.tabId };
      // Attached already (the assistant is working there): use it and leave it attached.
      const attached = await browser.debugger.attach(target, '1.3').then(() => true, () => false);
      try {
        const shot = (await browser.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'png' })) as { data: string };
        return { ok: true, image: shot.data, mediaType: 'image/png' };
      } finally {
        if (attached) await browser.debugger.detach(target).catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn('Could not take the screenshot', error);
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
    if (message?.type === 'region.capture') {
      void captureRegion(message).then(sendResponse);
      return true;
    }
    if (message?.type === 'picture.show') {
      void loadSettings()
        .then((settings) => showPendingPictures(message.id, settings.sitePolicies))
        .then(
          (ok) => sendResponse({ ok }),
          () => sendResponse({ ok: false }),
        );
      return true;
    }
    if (message?.type === 'data.clear') {
      void clearData(message).then(sendResponse);
      return true;
    }
    return undefined;
  });
}
