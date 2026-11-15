/** What a command needs attached before it is sent. */
export type CommandAttachment = 'page' | 'selection' | 'selectionOrPage' | 'none';

/** What people ask on a product page: these come up first there. */
export type ShoppingCommand = 'prices' | 'reviews' | 'reputation' | 'flaws' | 'deal' | 'trust';
/** Each with the built-in skill that says how it is done (see skills/builtin.ts). */
export const SHOPPING_SKILLS: Record<ShoppingCommand, string> = {
  prices: 'compare-prices',
  reviews: 'review-analysis',
  reputation: 'reputation',
  flaws: 'buying-checks',
  deal: 'deal-check',
  trust: 'site-trust',
};
export const SHOPPING_COMMANDS = Object.keys(SHOPPING_SKILLS) as ShoppingCommand[];

export interface SlashCommand {
  id: 'summarize' | 'translate' | 'explain' | 'extractTables' | 'research' | ShoppingCommand;
  attach: CommandAttachment;
  /** Skills that go with the request. */
  skills?: string[];
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
  ...SHOPPING_COMMANDS.map((id): SlashCommand => ({ id, attach: 'page', skills: [SHOPPING_SKILLS[id]] })),
];

export function matchCommands(query: string, label: (command: SlashCommand) => string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.id.toLowerCase().startsWith(q) || label(command).toLowerCase().includes(q));
}
