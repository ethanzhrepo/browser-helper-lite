import { db } from '../storage/db';
import { loadSettings, updateSettings } from '../storage/settings';
import { BUILTIN_SKILLS } from './builtin';
import { checkSkill, MAX_SKILL_FILES, SKILL_FILE_BYTES, SKILL_FILES_BYTES, SkillError, type Skill, type SkillFile, type SkippedFile } from './format';
import { MAX_INSTALLED_SKILLS, type InstalledSkill, type LegacySkill } from './skills';

/**
 * Installed skills live in the extension's database, not in the settings: a
 * skill may bring a megabyte of reference files, which the settings storage
 * has no room for. Which skills are turned off stays in the settings.
 */

const SKIPPED_REASONS = new Set<SkippedFile['reason']>(['script', 'binary', 'large', 'many']);

/** A skill as it is kept: its fields checked, its files within the limits and inside its folder. */
export function checkInstalled(skill: Skill): Skill {
  const fields = checkSkill(skill);
  const files: SkillFile[] = [];
  let total = 0;
  for (const file of skill.files ?? []) {
    const path = String(file.path).replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
    if (!path || path === 'SKILL.md' || path.split('/').includes('..') || typeof file.text !== 'string') continue;
    const size = new TextEncoder().encode(file.text).length;
    if (files.length >= MAX_SKILL_FILES || size > SKILL_FILE_BYTES || total + size > SKILL_FILES_BYTES) continue;
    total += size;
    files.push({ path, text: file.text });
  }
  const skipped = (skill.skipped ?? [])
    .filter((file) => SKIPPED_REASONS.has(file.reason) && typeof file.path === 'string')
    .slice(0, 500)
    .map((file) => ({ path: file.path.slice(0, 300), reason: file.reason }));
  return { ...fields, ...(files.length > 0 ? { files } : {}), ...(skipped.length > 0 ? { skipped } : {}) };
}

export async function listInstalledSkills(): Promise<InstalledSkill[]> {
  return (await db.skills.toArray()).sort((a, b) => a.installedAt - b.installedAt || a.name.localeCompare(b.name));
}

/**
 * Installs a skill, or changes the one named `replacing`. A new skill starts
 * on; a changed one stays on or off as it was, under its new name too.
 */
export async function installSkill(skill: Skill, { replacing, source }: { replacing?: string; source?: string } = {}): Promise<InstalledSkill> {
  const checked = checkInstalled(skill);
  if (BUILTIN_SKILLS.some((builtin) => builtin.name === checked.name)) throw new SkillError('builtinName');
  const now = Date.now();
  const saved = await db.transaction('rw', db.skills, async () => {
    const all = await db.skills.toArray();
    const others = all.filter((existing) => existing.name !== replacing);
    if (others.some((existing) => existing.name === checked.name)) throw new SkillError('taken');
    if (others.length >= MAX_INSTALLED_SKILLS) throw new SkillError('tooMany');
    const before = replacing === undefined ? undefined : all.find((existing) => existing.name === replacing);
    if (before && before.name !== checked.name) await db.skills.delete(before.name);
    const from = source ?? before?.source;
    const record: InstalledSkill = { ...checked, installedAt: before?.installedAt ?? now, updatedAt: now, ...(from ? { source: from } : {}) };
    await db.skills.put(record);
    return record;
  });
  await updateSettings((s) => ({
    ...s,
    skills: {
      ...s.skills,
      off: replacing === undefined ? s.skills.off.filter((name) => name !== saved.name) : s.skills.off.map((name) => (name === replacing ? saved.name : name)),
    },
  }));
  return saved;
}

export async function removeSkill(name: string): Promise<void> {
  await db.skills.delete(name);
  await updateSettings((s) => ({ ...s, skills: { ...s.skills, off: s.skills.off.filter((other) => other !== name) } }));
}

/**
 * Skills from a backup: each is checked as an installed one would be, and
 * one that is not in shape (a name the format does not allow, a built-in
 * name, too long) is left out. Returns how many were kept.
 */
export async function restoreSkills(skills: readonly Skill[]): Promise<number> {
  const builtin = new Set(BUILTIN_SKILLS.map((skill) => skill.name));
  const now = Date.now();
  const kept: InstalledSkill[] = [];
  for (const [index, skill] of skills.entries()) {
    try {
      const checked = checkInstalled(skill);
      if (builtin.has(checked.name) || kept.some((other) => other.name === checked.name)) continue;
      kept.push({ ...checked, installedAt: now + index, updatedAt: now + index });
    } catch {
      // Not in shape: left out.
    }
  }
  return db.transaction('rw', db.skills, async () => {
    const names = new Set(await db.skills.toCollection().primaryKeys());
    let restored = 0;
    for (const skill of kept) {
      // One of the same name is replaced; a new one only while there is room.
      if (!names.has(skill.name)) {
        if (names.size >= MAX_INSTALLED_SKILLS) continue;
        names.add(skill.name);
      }
      await db.skills.put(skill);
      restored += 1;
    }
    return restored;
  });
}

/**
 * Version 0.3.0 kept installed skills in the settings. They move to the
 * database as they are, also when their name is not in the format's form:
 * such a one is listed with a request to rename it, and is not offered to
 * the assistant until then.
 */
export async function moveLegacySkills(): Promise<number> {
  const legacy = (await loadSettings()).skills.installed ?? [];
  if (legacy.length === 0) return 0;
  const moved = await keepLegacySkills(legacy);
  await updateSettings((s) => ({ ...s, skills: { off: s.skills.off } }));
  return moved;
}

/** Puts skills saved by 0.3.0 into the database as they are, next to those there; one of a name already there is left out. */
export async function keepLegacySkills(legacy: readonly LegacySkill[]): Promise<number> {
  const now = Date.now();
  return db.transaction('rw', db.skills, async () => {
    let kept = 0;
    for (const [index, skill] of legacy.entries()) {
      if (typeof skill?.name !== 'string' || !skill.name || (await db.skills.get(skill.name)) || (await db.skills.count()) >= MAX_INSTALLED_SKILLS) continue;
      await db.skills.put({ name: skill.name, description: String(skill.description ?? ''), instructions: String(skill.instructions ?? ''), installedAt: now + index, updatedAt: now + index });
      kept += 1;
    }
    return kept;
  });
}
