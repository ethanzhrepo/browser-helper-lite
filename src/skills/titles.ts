import type { TFunction } from 'i18next';
import { SHOPPING_SKILLS } from '../chat/commands';
import type { Skill } from './format';

/** The slash command that goes with a built-in skill, when it has one: the two share a title. */
const COMMAND_OF: Record<string, string> = Object.fromEntries(Object.entries(SHOPPING_SKILLS).map(([command, skill]) => [skill, command]));

export interface SkillTitle {
  /** What it is called in the interface. */
  label: string;
  /** One short line on what it does. */
  description: string;
  /** Whether the label is a title in the user's language, and not the skill's name. */
  titled: boolean;
}

/**
 * What a skill is called in the interface. A skill's name is in the Agent
 * Skills form in every language (compare-prices); the built-in ones also have
 * a title and a line in the user's language, shown next to the name. Installed
 * skills go by their name and description.
 */
export function skillTitle(t: TFunction, skill: Pick<Skill, 'name' | 'description' | 'builtin'>): SkillTitle {
  const key = COMMAND_OF[skill.name] ? `commands.${COMMAND_OF[skill.name]}` : `skills.names.${skill.name}`;
  const label = skill.builtin ? t(`${key}.label`, { defaultValue: '' }) : '';
  if (!label) return { label: skill.name, description: skill.description, titled: false };
  return { label, description: t(`${key}.description`, { defaultValue: skill.description }), titled: true };
}
