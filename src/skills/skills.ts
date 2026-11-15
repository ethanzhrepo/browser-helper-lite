import type { Settings } from '../shared/types';
import { BUILTIN_SKILLS } from './builtin';

/**
 * A skill: instructions for one kind of work ("compare prices", "sum up
 * reviews"), kept out of the system prompt until the work comes up. The
 * prompt lists each skill's name and one line about when to use it; the
 * model fetches the rest with load_skill, or the user picks the skill with a
 * slash command and it comes with the request.
 *
 * A skill is text, never code. It tells the assistant how to go about
 * something and what the answer should look like. It cannot give itself
 * permissions: modes, approvals and the prompt-injection rules apply to work
 * done under a skill as to any other.
 */
export interface Skill {
  /** Letters, digits and hyphens. What the model calls it by, and what is typed after a slash. */
  name: string;
  /** One line: when to use it. Always in the prompt, so it is kept short. */
  description: string;
  /** How to do the work, and what to hand back. Markdown. */
  instructions: string;
  /** Comes with the extension; can be turned off but not edited or removed. */
  builtin?: boolean;
}

export interface SkillSettings {
  /** Skills the user wrote or installed from a file or an address. */
  installed: Skill[];
  /** Names of skills that are turned off, built in or installed. */
  off: string[];
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = { installed: [], off: [] };

export const SKILL_NAME_CHARS = 40;
export const SKILL_DESCRIPTION_CHARS = 240;
export const SKILL_INSTRUCTION_CHARS = 8000;
export const MAX_INSTALLED_SKILLS = 40;
const SKILL_FILE_CHARS = 200_000;

/** A name that can be typed after a slash and passed to load_skill. */
export function skillName(text: string): string {
  return Array.from(
    text
      .trim()
      .toLowerCase()
      .replace(/^\/+/, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-'),
  )
    .slice(0, SKILL_NAME_CHARS)
    .join('')
    .replace(/^-+|-+$/g, '');
}

/** Every skill there is: the built-in ones, then the installed ones. An installed skill cannot take a built-in name. */
export function allSkills(settings: Pick<Settings, 'skills'>): Skill[] {
  const taken = new Set(BUILTIN_SKILLS.map((skill) => skill.name));
  return [...BUILTIN_SKILLS, ...settings.skills.installed.filter((skill) => !taken.has(skill.name))];
}

/** The skills the assistant is told about. */
export function enabledSkills(settings: Pick<Settings, 'skills'>): Skill[] {
  const off = new Set(settings.skills.off);
  return allSkills(settings).filter((skill) => !off.has(skill.name));
}

export function findSkill(settings: Pick<Settings, 'skills'>, name: string): Skill | undefined {
  const wanted = skillName(name);
  return enabledSkills(settings).find((skill) => skill.name === wanted);
}

/** A skill's text as the model gets it. */
export function renderSkill(skill: Skill): string {
  return `<skill name="${skill.name}">\n${skill.instructions.trim()}\n</skill>`;
}

// ---- Files ----

export type SkillProblem = 'header' | 'name' | 'builtinName' | 'taken' | 'description' | 'descriptionLong' | 'instructions' | 'instructionsLong' | 'tooMany' | 'address' | 'fetch';

/** Why a skill cannot be read or installed; the settings page says it in the user's language. */
export class SkillError extends Error {
  constructor(readonly problem: SkillProblem) {
    super(`Skill: ${problem}`);
    this.name = 'SkillError';
  }
}

/**
 * A skill as a file: Markdown with a short header, the way such files are
 * commonly written, so they can be read, edited and passed on by hand.
 *
 *   ---
 *   name: compare-prices
 *   description: Use when the user wants the best price for a product.
 *   ---
 *   1. Find the exact model…
 */
export function serializeSkill(skill: Skill): string {
  const line = (value: string) => value.replace(/\s+/g, ' ').trim();
  return `---\nname: ${line(skill.name)}\ndescription: ${line(skill.description)}\n---\n\n${skill.instructions.trim()}\n`;
}

/** Reads a skill file. Throws a SkillError when it is not one. */
export function parseSkill(text: string): Skill {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text.trimStart());
  if (!match) throw new SkillError('header');
  const header = new Map<string, string>();
  const lines = match[1]!.split(/\r?\n/);
  for (let at = 0; at < lines.length; at++) {
    const field = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(lines[at]!);
    if (!field) continue;
    let value = field[2]!.trim();
    // A value written over several indented lines ("description: >").
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (at + 1 < lines.length && /^\s+\S/.test(lines[at + 1]!)) parts.push(lines[++at]!.trim());
      value = parts.join(' ');
    }
    header.set(field[1]!.toLowerCase(), value.replace(/^(["'])(.*)\1$/, '$2'));
  }
  return checkSkill({ name: header.get('name') ?? '', description: header.get('description') ?? '', instructions: match[2]! });
}

/** A skill with its fields in shape. Throws a SkillError that says what is wrong. */
export function checkSkill(input: { name: string; description: string; instructions: string }): Skill {
  const name = skillName(input.name);
  const description = input.description.replace(/\s+/g, ' ').trim();
  const instructions = input.instructions.replace(/\r\n/g, '\n').trim();
  if (!name) throw new SkillError('name');
  if (BUILTIN_SKILLS.some((skill) => skill.name === name)) throw new SkillError('builtinName');
  if (!description) throw new SkillError('description');
  if (description.length > SKILL_DESCRIPTION_CHARS) throw new SkillError('descriptionLong');
  if (!instructions) throw new SkillError('instructions');
  if (instructions.length > SKILL_INSTRUCTION_CHARS) throw new SkillError('instructionsLong');
  return { name, description, instructions };
}

/**
 * The settings with a skill installed, or changed when `replacing` names the
 * one it takes the place of. A newly installed skill is on.
 */
export function withSkill(settings: SkillSettings, input: { name: string; description: string; instructions: string }, replacing?: string): SkillSettings {
  const skill = checkSkill(input);
  const others = settings.installed.filter((existing) => existing.name !== replacing);
  if (others.some((existing) => existing.name === skill.name)) throw new SkillError('taken');
  if (others.length >= MAX_INSTALLED_SKILLS) throw new SkillError('tooMany');
  const at = replacing === undefined ? -1 : settings.installed.findIndex((existing) => existing.name === replacing);
  const installed = at < 0 ? [...settings.installed, skill] : settings.installed.map((existing, index) => (index === at ? skill : existing));
  // Turned off under its old name: it stays off under the new one. A new skill starts on.
  const off = at < 0 ? settings.off.filter((name) => name !== skill.name) : settings.off.map((name) => (name === replacing ? skill.name : name));
  return { installed, off };
}

export function withoutSkill(settings: SkillSettings, name: string): SkillSettings {
  return { installed: settings.installed.filter((skill) => skill.name !== name), off: settings.off.filter((other) => other !== name) };
}

/** Where a skill file is fetched from: the page of a file on GitHub is turned into the file itself. */
export function skillFileAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new SkillError('address');
  }
  // Plain http only from this computer.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) throw new SkillError('address');
  const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  if (url.hostname === 'github.com' && blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  return url.href;
}

/**
 * Fetches a skill file for the user to read before installing it. Nothing is
 * installed here, and no cookies are sent.
 */
export async function fetchSkill(address: string, fetchImpl: typeof fetch = fetch): Promise<Skill> {
  const url = skillFileAddress(address);
  let text: string;
  try {
    const response = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(String(response.status));
    text = await response.text();
  } catch {
    throw new SkillError('fetch');
  }
  if (text.length > SKILL_FILE_CHARS) throw new SkillError('instructionsLong');
  return parseSkill(text);
}
