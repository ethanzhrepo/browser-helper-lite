import type { ContextSnapshot, MessageRecord } from '../shared/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderContext(context: ContextSnapshot): string {
  // Neutralize closing tags so page text cannot break out of its block.
  const body = context.content.replace(/<\/context/gi, '&lt;/context');
  const attributes = [
    `type="${context.kind}"`,
    `title="${escapeAttribute(context.title)}"`,
    `url="${escapeAttribute(context.url)}"`,
    ...(context.truncated ? ['truncated="true"'] : []),
  ].join(' ');
  return `<context ${attributes}>\n${body}\n</context>`;
}

export function renderUserMessage(message: Pick<MessageRecord, 'content' | 'contexts'>): string {
  const contexts = (message.contexts ?? []).map(renderContext);
  return [...contexts, message.content].join('\n\n');
}

/**
 * Converts stored messages into model turns for a new reply:
 * - failed replies are skipped, stopped ones kept only if they produced text;
 * - replies after the last user message are dropped (a retry replaces them);
 * - consecutive turns of the same role are merged (answers to the agent's
 *   questions follow the request they belong to).
 */
export function buildHistory(messages: MessageRecord[]): ChatTurn[] {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const turns: ChatTurn[] = [];
  for (const message of messages.slice(0, lastUser + 1)) {
    let turn: ChatTurn | undefined;
    if (message.role === 'user') turn = { role: 'user', content: renderUserMessage(message) };
    else if (message.status === 'done' || (message.status === 'aborted' && message.content.trim())) {
      turn = { role: 'assistant', content: message.content };
    }
    if (!turn) continue;
    const previous = turns.at(-1);
    if (previous?.role === turn.role) previous.content = `${previous.content}\n\n${turn.content}`;
    else if (turns.length > 0 || turn.role === 'user') turns.push(turn);
  }
  return turns;
}
