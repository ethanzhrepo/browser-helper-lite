import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * The Agent Skills format (https://agentskills.io/specification), as this
 * extension reads and writes it.
 *
 * A skill is a folder named after the skill, holding a SKILL.md: YAML front
 * matter (name, description; optionally license, compatibility, metadata,
 * allowed-tools) and Markdown instructions. Other files of the folder
 * (references/, assets/, …) are read by the assistant when the instructions
 * point to them.
 *
 * A skill is text here, never code: scripts are not installed, because this
 * extension runs none, and allowed-tools approves nothing in advance. Modes,
 * approvals and the prompt-injection rules apply to work done under a skill
 * as to any other.
 */
export interface SkillFile {
  /** Relative to the skill's folder, with "/": "references/sizes.md". */
  path: string;
  text: string;
}

/** A file of the skill's folder that was left out, and why. */
export interface SkippedFile {
  path: string;
  reason: 'script' | 'binary' | 'large' | 'many';
}

export interface Skill {
  /** Lower-case letters, digits and single hyphens (see isSkillName). What load_skill takes, and what is typed after a slash. */
  name: string;
  /** What it does and when to use it. Always in the prompt. */
  description: string;
  /** The body of SKILL.md: how to do the work, and what to hand back. */
  instructions: string;
  license?: string;
  /** What the skill needs to work (a product, packages, network access). */
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Shown to the user; it approves nothing here. */
  allowedTools?: string;
  /** The text files of the folder besides SKILL.md. */
  files?: SkillFile[];
  skipped?: SkippedFile[];
  /** Comes with the extension; can be turned off but not changed or removed. */
  builtin?: boolean;
}

export const SKILL_NAME_CHARS = 64;
export const SKILL_DESCRIPTION_CHARS = 1024;
export const SKILL_COMPATIBILITY_CHARS = 500;
/** The format recommends under 5000 tokens for the body; this is the most that is accepted. */
export const SKILL_INSTRUCTION_CHARS = 50_000;
export const MAX_SKILL_FILES = 50;
export const SKILL_FILE_BYTES = 200_000;
export const SKILL_FILES_BYTES = 1_000_000;
const LICENSE_CHARS = 500;
const ALLOWED_TOOLS_CHARS = 1000;
const METADATA_ENTRIES = 50;
const METADATA_CHARS = 1000;

export type SkillProblem =
  | 'header'
  | 'name'
  | 'nameRule'
  | 'dirName'
  | 'builtinName'
  | 'taken'
  | 'description'
  | 'descriptionLong'
  | 'compatibilityLong'
  | 'instructions'
  | 'instructionsLong'
  | 'tooMany'
  | 'noSkillFile'
  | 'several'
  | 'archive'
  | 'tooLarge'
  | 'address'
  | 'fetch';

/** Why a skill cannot be read or installed; the settings page says it in the user's language. */
export class SkillError extends Error {
  constructor(
    readonly problem: SkillProblem,
    /** What the message names: a folder, the skills an archive holds. */
    readonly detail?: string,
  ) {
    super(`Skill: ${problem}${detail ? ` (${detail})` : ''}`);
    this.name = 'SkillError';
  }
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 1 to 64 characters: lower-case letters a–z, digits and hyphens, not at either end, never two in a row. */
export function isSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= SKILL_NAME_CHARS && NAME.test(name);
}

/** What is typed in the name field, made into a name as far as it can be: lower case, spaces as hyphens, other characters left out. */
export function toSkillName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, SKILL_NAME_CHARS);
}

export type SkillFields = Pick<Skill, 'name' | 'description' | 'instructions' | 'license' | 'compatibility' | 'metadata' | 'allowedTools'>;

const optional = (value: string | undefined, limit: number): string | undefined => {
  const clean = value?.trim();
  return clean ? clean.slice(0, limit) : undefined;
};

/** The fields in shape, or a SkillError that says what is wrong. */
export function checkSkill(input: SkillFields): SkillFields {
  const name = input.name.trim();
  if (!name) throw new SkillError('name');
  if (!isSkillName(name)) throw new SkillError('nameRule');
  const description = input.description.replace(/\s+/g, ' ').trim();
  if (!description) throw new SkillError('description');
  if (description.length > SKILL_DESCRIPTION_CHARS) throw new SkillError('descriptionLong');
  const instructions = input.instructions.replace(/\r\n/g, '\n').trim();
  if (!instructions) throw new SkillError('instructions');
  if (instructions.length > SKILL_INSTRUCTION_CHARS) throw new SkillError('instructionsLong');
  const compatibility = input.compatibility?.trim();
  if (compatibility && compatibility.length > SKILL_COMPATIBILITY_CHARS) throw new SkillError('compatibilityLong');
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {})
      .slice(0, METADATA_ENTRIES)
      .map(([key, value]) => [key.slice(0, 64), String(value).slice(0, METADATA_CHARS)]),
  );
  return {
    name,
    description,
    instructions,
    ...(optional(input.license, LICENSE_CHARS) ? { license: optional(input.license, LICENSE_CHARS) } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(optional(input.allowedTools, ALLOWED_TOOLS_CHARS) ? { allowedTools: optional(input.allowedTools, ALLOWED_TOOLS_CHARS) } : {}),
  };
}

const scalar = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

/** Reads a SKILL.md. Throws a SkillError when it is not one. */
export function parseSkillFile(text: string): SkillFields {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text.trimStart());
  if (!match) throw new SkillError('header');
  let header: unknown;
  try {
    header = parseYaml(match[1]!, { maxAliasCount: 10 });
  } catch {
    throw new SkillError('header');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new SkillError('header');
  const fields = header as Record<string, unknown>;
  const metadata =
    fields.metadata && typeof fields.metadata === 'object' && !Array.isArray(fields.metadata)
      ? Object.fromEntries(Object.entries(fields.metadata as Record<string, unknown>).flatMap(([key, value]) => (scalar(value) === undefined ? [] : [[key, scalar(value)!]])))
      : undefined;
  return checkSkill({
    name: scalar(fields.name) ?? '',
    description: scalar(fields.description) ?? '',
    instructions: match[2]!,
    license: scalar(fields.license),
    compatibility: scalar(fields.compatibility),
    metadata,
    allowedTools: scalar(fields['allowed-tools']),
  });
}

/** The SKILL.md of a skill. */
export function serializeSkill(skill: SkillFields): string {
  const header: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
    ...(skill.license ? { license: skill.license } : {}),
    ...(skill.compatibility ? { compatibility: skill.compatibility } : {}),
    ...(skill.metadata && Object.keys(skill.metadata).length > 0 ? { metadata: skill.metadata } : {}),
    ...(skill.allowedTools ? { 'allowed-tools': skill.allowedTools } : {}),
  };
  return `---\n${stringifyYaml(header, { lineWidth: 0 }).trimEnd()}\n---\n\n${skill.instructions.trim()}\n`;
}

/** The sites a skill's text names: where it may send the assistant. */
export function sitesIn(skill: Pick<Skill, 'instructions' | 'files'>): string[] {
  const hosts = new Set<string>();
  for (const text of [skill.instructions, ...(skill.files ?? []).map((file) => file.text)]) {
    for (const address of text.match(/https?:\/\/[^\s<>"'`\\)\]]+/gi) ?? []) {
      try {
        hosts.add(new URL(address).hostname);
      } catch {
        // Not an address after all.
      }
    }
  }
  return [...hosts].slice(0, 20);
}
