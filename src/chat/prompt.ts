import { escapeTrustedTags, neutralizeControlTokens, redactSensitive } from '../agent/injection';
import type { ContextSnapshot, MessageRecord } from '../shared/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderContext(context: ContextSnapshot): string {
  // Escape our tag so page text cannot end its block or open a fake one; card
  // numbers, keys and chat control tokens never reach the model (§8.2).
  const body = escapeTrustedTags(neutralizeControlTokens(redactSensitive(context.content))).replace(/<(\/?)context\b/gi, '&lt;$1context');
  const attributes = [
    `type="${context.kind}"`,
    `title="${escapeAttribute(neutralizeControlTokens(context.title.replace(/\s+/g, ' ').trim().slice(0, 200)))}"`,
    `url="${escapeAttribute(context.url)}"`,
    ...(context.truncated ? ['truncated="true"'] : []),
  ].join(' ');
  return `<context ${attributes}>\n${body}\n</context>`;
}

export function renderUserMessage(message: Pick<MessageRecord, 'content' | 'contexts' | 'images'>): string {
  const contexts = (message.contexts ?? []).map(renderContext);
  // The pictures themselves go with the request they belong to (see the runtime); later turns only know they were there.
  const images = (message.images ?? []).map((image) => `<attached_image size="${image.width}x${image.height}"${image.url ? ` from="${escapeAttribute(image.url)}"` : ''} />`);
  return [...contexts, ...images, message.content].join('\n\n');
}

/**
 * Converts stored messages into model turns for a new reply:
 * - failed replies are skipped, stopped ones kept only if they produced text;
 * - replies after the last user message are dropped (a retry replaces them);
 * - consecutive turns of the same role are merged (answers to the agent's
 *   questions follow the request they belong to).
 */
export function buildHistory(messages: MessageRecord[], note?: (message: MessageRecord, last: boolean) => string | undefined): ChatTurn[] {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const turns: ChatTurn[] = [];
  for (const [index, message] of messages.slice(0, lastUser + 1).entries()) {
    let turn: ChatTurn | undefined;
    if (message.role === 'user') {
      // A note that goes with the message (the tab the user was on), the same whenever the message is sent again.
      const extra = note?.(message, index === lastUser);
      turn = { role: 'user', content: extra ? `${renderUserMessage(message)}\n\n${extra}` : renderUserMessage(message) };
    }
    if (message.role === 'assistant' && (message.status === 'done' || (message.status === 'aborted' && message.content.trim()))) {
      // A reply may quote a page; a skill block in it is not one.
      turn = { role: 'assistant', content: escapeTrustedTags(message.content) };
    }
    if (!turn) continue;
    const previous = turns.at(-1);
    if (previous?.role === turn.role) previous.content = `${previous.content}\n\n${turn.content}`;
    else if (turns.length > 0 || turn.role === 'user') turns.push(turn);
  }
  return turns;
}
