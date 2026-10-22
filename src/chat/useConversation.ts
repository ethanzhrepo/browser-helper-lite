import { useCallback, useState } from 'react';
import type { ContextSnapshot, ConversationRecord, MessageRecord } from '../shared/types';
import { appendMessage, createConversation, deriveTitle, getConversation, getMessages } from '../storage/db';

/**
 * The open conversation and its stored messages. Replies are written by the
 * background service (one assistant turn per request, M1.5); the panel only
 * appends the user's messages and reloads.
 */
export function useConversation() {
  const [conversation, setConversation] = useState<ConversationRecord>();
  const [messages, setMessages] = useState<MessageRecord[]>([]);

  /** Appends a user message, creating the conversation on the first one. */
  const appendUser = useCallback(
    async ({ text, contexts, taskId }: { text: string; contexts?: ContextSnapshot[]; taskId: string }) => {
      const current = conversation ?? (await createConversation(deriveTitle(text)));
      setConversation(current);
      const message = await appendMessage({ conversationId: current.id, role: 'user', content: text, contexts, status: 'done', taskId });
      setMessages((previous) => [...previous, message]);
      return { conversationId: current.id, message };
    },
    [conversation],
  );

  /** Re-reads messages, e.g. after the service stored a reply. */
  const reload = useCallback(async () => {
    if (!conversation) return;
    setMessages(await getMessages(conversation.id));
  }, [conversation]);

  const open = useCallback(async (conversationId: string) => {
    const [record, history] = await Promise.all([getConversation(conversationId), getMessages(conversationId)]);
    setConversation(record);
    setMessages(record ? history : []);
  }, []);

  const reset = useCallback(() => {
    setConversation(undefined);
    setMessages([]);
  }, []);

  return { conversation, messages, appendUser, reload, open, reset };
}
