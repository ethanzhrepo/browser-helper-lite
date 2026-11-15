import type { Settings } from '../shared/types';
import { BUILTIN_SKILLS } from './builtin';
import { isSkillName, type Skill, type SkillFile } from './format';

export * from './format';

/**
 * Skills (see format.ts for what one is). The prompt lists each enabled
 * skill by name and description; the model fetches the instructions with
 * load_skill, and the files they point to with read_skill_file. A skill the
 * user picks with a slash command comes with the request instead. A skill can
 * build on others: it calls one "the <name> skill", and that one is loaded
 * with it (see usedSkills).
 */

/** A skill the user installed or wrote; kept in the extension's database (see store.ts). */
export interface InstalledSkill extends Skill {
  installedAt: number;
  updatedAt: number;
  /** Where it came from: a file's name or an address. */
  source?: string;
}

/** Version 0.3.0 kept installed skills in the settings; they are moved to the database (see store.ts). */
export interface LegacySkill {
  name: string;
  description: string;
  instructions: string;
}

export interface SkillSettings {
  /** Names of skills that are turned off, built in or installed. */
  off: string[];
  /** Only in settings saved by 0.3.0, until they are moved. */
  installed?: LegacySkill[];
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = { off: [] };

export const MAX_INSTALLED_SKILLS = 40;

/**
 * Every skill there is: the built-in ones, then the installed ones. An
 * installed skill cannot take a built-in name, and one whose name is not in
 * the format's form (from 0.3.0, which allowed any letters) waits until it is
 * renamed.
 */
export function allSkills(installed: readonly Skill[] = []): Skill[] {
  const taken = new Set(BUILTIN_SKILLS.map((skill) => skill.name));
  return [...BUILTIN_SKILLS, ...installed.filter((skill) => isSkillName(skill.name) && !taken.has(skill.name))];
}

/** The skills the assistant is told about. */
export function enabledSkills(settings: Pick<Settings, 'skills'>, installed: readonly Skill[] = []): Skill[] {
  const off = new Set(settings.skills.off);
  return allSkills(installed).filter((skill) => !off.has(skill.name));
}

/** An enabled skill by its name, as the model or the user wrote it ("/compare-prices" works too). */
export function findSkill(settings: Pick<Settings, 'skills'>, installed: readonly Skill[], name: string): Skill | undefined {
  const wanted = name.trim().replace(/^\/+/, '').toLowerCase();
  return enabledSkills(settings, installed).find((skill) => skill.name === wanted);
}

const kilobytes = (text: string) => `${Math.max(1, Math.round(new TextEncoder().encode(text).length / 1024))} KB`;

/**
 * A skill's instructions as the model gets them, with what else its folder
 * holds. Every untrusted block has `<skill` escaped (see injection.ts), so a
 * page cannot pass for one of these.
 */
export function renderSkill(skill: Skill): string {
  const parts = [`<skill name="${skill.name}">`, skill.instructions.trim()];
  const files = skill.files ?? [];
  if (files.length > 0) {
    parts.push('', `Files of this skill, to read with read_skill_file when the instructions point to them: ${files.map((file) => `${file.path} (${kilobytes(file.text)})`).join(', ')}.`);
  }
  const scripts = (skill.skipped ?? []).filter((file) => file.reason === 'script').map((file) => file.path);
  if (scripts.length > 0) {
    parts.push('', `The skill's scripts (${scripts.join(', ')}) are not installed: this assistant runs no code. Where the instructions say to run one, do what it is for with your own tools, or tell the user that it cannot be done here.`);
  }
  parts.push('</skill>');
  return parts.join('\n');
}

/** The most skills that are loaded along with one, however many it names. */
export const MAX_USED_SKILLS = 4;

/**
 * The skills a skill builds on: those its instructions call "the <name>
 * skill", and those these name in turn, nearest first. `known` is every skill
 * there is, so one that is turned off is found too (see loadSkill).
 */
export function usedSkills(skill: Skill, known: readonly Skill[]): Skill[] {
  const found: Skill[] = [];
  const seen = new Set([skill.name]);
  const queue = [skill];
  while (queue.length > 0 && found.length < MAX_USED_SKILLS) {
    const from = queue.shift()!;
    for (const other of known) {
      if (seen.has(other.name) || found.length >= MAX_USED_SKILLS) continue;
      // Names are lowercase letters, digits and hyphens: nothing to escape.
      if (!new RegExp(`\\bthe ${other.name} skill(?![\\w-])`).test(from.instructions)) continue;
      seen.add(other.name);
      found.push(other);
      queue.push(other);
    }
  }
  return found;
}

/**
 * A skill as load_skill returns it: its instructions, then the skills it
 * builds on that are not in the conversation yet. Those are told that the
 * first one leads, so two sets of stages do not run at once. `loaded` gets
 * the names of what was returned.
 */
export function loadSkill(skill: Skill, settings: Pick<Settings, 'skills'>, installed: readonly Skill[], loaded: Set<string>): string {
  const enabled = new Set(enabledSkills(settings, installed).map((s) => s.name));
  const used = usedSkills(skill, allSkills(installed));
  const along = used.filter((s) => enabled.has(s.name) && !loaded.has(s.name));
  const off = used.filter((s) => !enabled.has(s.name)).map((s) => s.name);
  const parts = [renderSkill(skill)];
  if (along.length > 0) {
    parts.push(
      `"${skill.name}" builds on ${along.length > 1 ? 'the skills' : 'the skill'} below, loaded with it. Use ${along.length > 1 ? 'their' : 'its'} method where "${skill.name}" says so. The stages, the reports and the form of the answer are those of "${skill.name}"; where they differ, "${skill.name}" decides.`,
      ...along.map(renderSkill),
    );
  }
  if (off.length > 0) parts.push(`The user turned off ${off.map((name) => `"${name}"`).join(', ')}, which "${skill.name}" names: do that part as "${skill.name}" describes it, without ${off.length > 1 ? 'them' : 'it'}.`);
  loaded.add(skill.name);
  for (const s of along) loaded.add(s.name);
  return parts.join('\n');
}

/** The most of a skill's file that one read_skill_file returns. */
export const SKILL_FILE_READ_CHARS = 30_000;

/** A file of a skill, as read_skill_file returns it, from `offset` on. */
export function renderSkillFile(skill: Skill, file: SkillFile, offset = 0): string {
  const start = Math.max(0, Math.min(Math.floor(offset), file.text.length));
  const part = file.text.slice(start, start + SKILL_FILE_READ_CHARS);
  const rest = file.text.length - start - part.length;
  const more = rest > 0 ? `\n\n(${rest} more characters: read again with offset ${start + part.length}.)` : '';
  return `<skill_file skill="${skill.name}" path="${file.path.replace(/"/g, '')}">\n${part}${more}\n</skill_file>`;
}

/** A file of a skill by its path as the instructions give it ("./references/a.md" works too). */
export function findSkillFile(skill: Skill, path: string): SkillFile | undefined {
  const wanted = path.trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
  const files = skill.files ?? [];
  // As written first; then whatever the case, as a model may write "CN.md" for "cn.md".
  return files.find((file) => file.path === wanted) ?? files.find((file) => file.path.toLowerCase() === wanted.toLowerCase());
}
