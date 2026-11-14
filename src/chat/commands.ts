/** What a command needs attached before it is sent. */
export type CommandAttachment = 'page' | 'selection' | 'selectionOrPage' | 'none';

/** What people ask on a product page: these come up first there. */
export type ShoppingCommand = 'prices' | 'reviews' | 'flaws' | 'deal';
export const SHOPPING_COMMANDS: ShoppingCommand[] = ['prices', 'reviews', 'flaws', 'deal'];

export interface SlashCommand {
  id: 'summarize' | 'translate' | 'explain' | 'extractTables' | 'research' | ShoppingCommand;
  attach: CommandAttachment;
}

/** Labels and prompts live in the locale files under `commands.<id>`. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'summarize', attach: 'page' },
  { id: 'translate', attach: 'selectionOrPage' },
  { id: 'explain', attach: 'selection' },
  { id: 'extractTables', attach: 'page' },
  // The question is typed after the prompt.
  { id: 'research', attach: 'none' },
  // Shopping: the product page comes along, so the assistant knows which product is meant.
  ...SHOPPING_COMMANDS.map((id): SlashCommand => ({ id, attach: 'page' })),
];

export function matchCommands(query: string, label: (command: SlashCommand) => string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.id.toLowerCase().startsWith(q) || label(command).toLowerCase().includes(q));
}
