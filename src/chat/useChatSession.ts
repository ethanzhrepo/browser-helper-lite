import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { CHAT_PORT_NAME, type ChatClientMessage, type ChatServerMessage } from '../shared/protocol';
import type {
  ContextSnapshot,
  ConversationRecord,
  ErrorInfo,
  Locale,
  MessageRecord,
  MessageStatus,
  ModelRef,
  SlotAssignment,
} from '../shared/types';
import {
  appendMessage,
  createConversation,
  deriveTitle,
  getConversation,
  getMessages,
  type NewMessage,
} from '../storage/db';
import { buildSystemPrompt, toChatTurns } from './prompt';

/** Assistant reply being streamed; it is written to the database once finished. */
export interface StreamingReply {
  content: string;
  reasoning: string;
  model: ModelRef;
}

const KEEPALIVE_MS = 20_000;

export function useChatSession({ chatSlot, locale }: { chatSlot?: SlotAssignment; locale: Locale }) {
  const [conversation, setConversation] = useState<ConversationRecord>();
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [streaming, setStreaming] = useState<StreamingReply>();
  const stopRef = useRef<(() => void) | undefined>(undefined);

  const stop = useCallback(() => stopRef.current?.(), []);

  // Stop streaming if the panel unmounts.
  useEffect(() => stop, [stop]);

  const generate = useCallback(
    (conversationId: string, history: MessageRecord[], slot: SlotAssignment) => {
      const port = browser.runtime.connect({ name: CHAT_PORT_NAME });
      const reply: StreamingReply = {
        content: '',
        reasoning: '',
        model: { connectionId: slot.connectionId, modelId: slot.modelId },
      };
      setStreaming({ ...reply });
      const post = (message: ChatClientMessage) => port.postMessage(message);
      const keepalive = setInterval(() => post({ type: 'ping' }), KEEPALIVE_MS);

      let finished = false;
      const finish = async (status: MessageStatus, extra: Pick<NewMessage, 'error' | 'usage'> = {}) => {
        if (finished) return;
        finished = true;
        stopRef.current = undefined;
        clearInterval(keepalive);
        try {
          port.disconnect();
        } catch {
          // Already disconnected by the service worker.
        }
        const record = await appendMessage({
          conversationId,
          role: 'assistant',
          content: reply.content,
          reasoning: reply.reasoning || undefined,
          status,
          model: reply.model,
          ...extra,
        });
        setStreaming(undefined);
        setMessages((previous) => [...previous, record]);
      };

      port.onMessage.addListener((message: ChatServerMessage) => {
        if (message.type === 'text') {
          reply.content += message.delta;
          setStreaming({ ...reply });
        } else if (message.type === 'reasoning') {
          reply.reasoning += message.delta;
          setStreaming({ ...reply });
        } else if (message.type === 'done') {
          void finish('done', { usage: message.usage });
        } else if (message.type === 'error') {
          void finish('error', { error: message.error });
        }
      });
      // Only fires when the service worker side closes the port unexpectedly.
      port.onDisconnect.addListener(() => {
        const lost: ErrorInfo = { code: 'unknown', message: 'Connection to the background service was lost.' };
        void finish(reply.content ? 'aborted' : 'error', reply.content ? {} : { error: lost });
      });

      stopRef.current = () => {
        post({ type: 'abort' });
        void finish('aborted');
      };
      post({
        type: 'start',
        model: reply.model,
        temperature: slot.temperature,
        system: buildSystemPrompt({ locale, now: new Date() }),
        messages: toChatTurns(history),
      });
    },
    [locale],
  );

  const send = useCallback(
    async ({ text, contexts }: { text: string; contexts: ContextSnapshot[] }) => {
      if (!chatSlot?.modelId || stopRef.current) return;
      const current = conversation ?? (await createConversation(deriveTitle(text)));
      setConversation(current);
      const user = await appendMessage({ conversationId: current.id, role: 'user', content: text, contexts, status: 'done' });
      const history = [...messages, user];
      setMessages(history);
      generate(current.id, history, chatSlot);
    },
    [chatSlot, conversation, messages, generate],
  );

  /**
   * Appends a user message without asking the chat model (agent goals and
   * answers). Returns the conversation id, creating the conversation if needed.
   */
  const addUserMessage = useCallback(
    async ({ text, taskId }: { text: string; taskId: string }): Promise<string> => {
      const current = conversation ?? (await createConversation(deriveTitle(text)));
      setConversation(current);
      const user = await appendMessage({ conversationId: current.id, role: 'user', content: text, status: 'done', taskId });
      setMessages((previous) => [...previous, user]);
      return current.id;
    },
    [conversation],
  );

  /** Re-reads messages, e.g. after the agent appended its summary. */
  const reload = useCallback(async () => {
    if (!conversation) return;
    setMessages(await getMessages(conversation.id));
  }, [conversation]);

  /** Generates a new reply to the existing history (after an error or a stop). */
  const retry = useCallback(() => {
    if (!conversation || !chatSlot?.modelId || stopRef.current) return;
    generate(conversation.id, messages, chatSlot);
  }, [conversation, chatSlot, messages, generate]);

  const open = useCallback(
    async (conversationId: string) => {
      stop();
      const [record, history] = await Promise.all([getConversation(conversationId), getMessages(conversationId)]);
      setConversation(record);
      setMessages(record ? history : []);
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setConversation(undefined);
    setMessages([]);
  }, [stop]);

  return { conversation, messages, streaming, send, retry, stop, open, reset, addUserMessage, reload };
}
