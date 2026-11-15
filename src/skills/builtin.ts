import { parseSkillFile, type Skill } from './format';

/**
 * The skills that come with the extension, one folder each under
 * src/skills/builtin/, in the Agent Skills format. They are read when the
 * extension is built. The shopping slash commands use them by name (see
 * commands.ts).
 */
const FILES = import.meta.glob('./builtin/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The order they are listed in; others follow by name. */
const ORDER = ['compare-prices', 'review-analysis', 'reputation', 'buying-checks', 'deal-check'];

export const BUILTIN_SKILLS: Skill[] = Object.entries(FILES)
  .map(([path, text]): Skill => {
    const folder = path.split('/').at(-2)!;
    const skill = parseSkillFile(text);
    // As the format says: the name is the folder's.
    if (skill.name !== folder) throw new Error(`The built-in skill in ${path} is called "${skill.name}"; it must be called "${folder}".`);
    return { ...skill, builtin: true };
  })
  .sort((a, b) => {
    const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });
