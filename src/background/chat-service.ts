import { streamText } from 'ai';
import { browser, type Browser } from 'wxt/browser';
import { toErrorInfo } from '../providers/errors';
import { resolveModelRef } from '../providers/resolve';
import { CHAT_PORT_NAME, type ChatClientMessage, type ChatServerMessage } from '../shared/protocol';
import { loadSettings } from '../storage/settings';

type StartMessage = Extract<ChatClientMessage, { type: 'start' }>;

/**
 * Streams chat completions to the side panel over a long-lived port.
 * API keys are only read here, never sent to pages (§5.4).
 */
export function registerChatService(): void {
  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    if (port.name !== CHAT_PORT_NAME) return;
    let controller: AbortController | undefined;
    const post = (message: ChatServerMessage) => {
      try {
        port.postMessage(message);
      } catch {
        // The side panel went away; the abort below stops the request.
      }
    };

    port.onMessage.addListener((message: ChatClientMessage) => {
      if (message.type === 'start') {
        controller?.abort();
        controller = new AbortController();
        void streamChat(message, post, controller.signal);
      } else if (message.type === 'abort') {
        controller?.abort();
      }
      // 'ping' needs no handling: receiving it keeps the service worker alive.
    });
    port.onDisconnect.addListener(() => controller?.abort());
  });
}

async function streamChat(request: StartMessage, post: (message: ChatServerMessage) => void, signal: AbortSignal) {
  try {
    const { model, providerOptions } = await resolveModelRef(await loadSettings(), request.model);

    const result = streamText({
      model,
      instructions: request.system,
      messages: request.messages,
      temperature: request.temperature,
      providerOptions,
      maxRetries: 1,
      abortSignal: signal,
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        post({ type: 'text', delta: part.text });
      } else if (part.type === 'reasoning-delta') {
        post({ type: 'reasoning', delta: part.text });
      } else if (part.type === 'error') {
        throw part.error;
      } else if (part.type === 'finish') {
        post({
          type: 'done',
          finishReason: part.finishReason,
          usage: { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens },
        });
      }
    }
  } catch (error) {
    if (!signal.aborted) post({ type: 'error', error: toErrorInfo(error) });
  }
}
