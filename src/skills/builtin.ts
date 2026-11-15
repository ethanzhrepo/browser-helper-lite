import { parseSkillFile, type Skill, type SkillFile } from './format';

/**
 * The skills that come with the extension, one folder each under
 * src/skills/builtin/, in the Agent Skills format. They are read when the
 * extension is built. The shopping slash commands use them by name (see
 * commands.ts).
 */
const FILES = import.meta.glob('./builtin/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** The other files of their folders (references/, assets/), read when the instructions point to them. */
const OTHER_FILES = import.meta.glob(['./builtin/*/**/*.{md,txt,json,csv}', '!./builtin/*/SKILL.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The order they are listed in (shopping first); others follow by name. */
const ORDER = [
  'buying-guide',
  'compare-prices',
  'review-analysis',
  'reputation',
  'buying-checks',
  'deal-check',
  'site-trust',
  'travel-compare',
  'terms-review',
  'fact-check',
  'long-read',
  'news-perspectives',
  'form-filling',
  'cancel-subscription',
  'data-extraction',
  'job-posting',
  'docs-lookup',
  'github-thread',
];

function filesOf(folder: string): SkillFile[] {
  return Object.entries(OTHER_FILES)
    .filter(([path]) => path.split('/')[2] === folder)
    .map(([path, text]) => ({ path: path.split('/').slice(3).join('/'), text }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export const BUILTIN_SKILLS: Skill[] = Object.entries(FILES)
  .map(([path, text]): Skill => {
    const folder = path.split('/').at(-2)!;
    const skill = parseSkillFile(text);
    // As the format says: the name is the folder's.
    if (skill.name !== folder) throw new Error(`The built-in skill in ${path} is called "${skill.name}"; it must be called "${folder}".`);
    const files = filesOf(folder);
    return { ...skill, ...(files.length > 0 ? { files } : {}), builtin: true };
  })
  .sort((a, b) => {
    const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });
