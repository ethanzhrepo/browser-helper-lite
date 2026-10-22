/** What a command needs attached before it is sent. */
export type CommandAttachment = 'page' | 'selection' | 'selectionOrPage';

export interface SlashCommand {
  id: 'summarize' | 'translate' | 'explain' | 'extractTables';
  attach: CommandAttachment;
}

/** Labels and prompts live in the locale files under `commands.<id>`. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'summarize', attach: 'page' },
  { id: 'translate', attach: 'selectionOrPage' },
  { id: 'explain', attach: 'selection' },
  { id: 'extractTables', attach: 'page' },
];

export function matchCommands(query: string, label: (command: SlashCommand) => string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.id.toLowerCase().startsWith(q) || label(command).toLowerCase().includes(q));
}
