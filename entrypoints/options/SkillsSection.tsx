import { Download, FileUp, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addressesIn } from '../../src/agent/pictures';
import { SHOPPING_SKILLS } from '../../src/chat/commands';
import type { Settings } from '../../src/shared/types';
import { BUILTIN_SKILLS } from '../../src/skills/builtin';
import {
  fetchSkill,
  MAX_INSTALLED_SKILLS,
  parseSkill,
  serializeSkill,
  SKILL_DESCRIPTION_CHARS,
  SKILL_INSTRUCTION_CHARS,
  SkillError,
  withoutSkill,
  withSkill,
  type Skill,
  type SkillSettings,
} from '../../src/skills/skills';
import { updateSettings } from '../../src/storage/settings';
import { Button, IconButton } from '../../src/ui/Button';
import { Switch } from '../../src/ui/Switch';
import { Card, Field, inputClass, Section } from './Section';

type Draft = { name: string; description: string; instructions: string };
const EMPTY: Draft = { name: '', description: '', instructions: '' };

/** The slash command of each built-in skill, for its name in the user's language. */
const COMMAND_OF = Object.fromEntries(Object.entries(SHOPPING_SKILLS).map(([command, skill]) => [skill, command]));

function saveSkills(change: (skills: SkillSettings) => SkillSettings) {
  return updateSettings((s) => ({ ...s, skills: change(s.skills) }));
}

function download(skill: Skill) {
  const url = URL.createObjectURL(new Blob([serializeSkill(skill)], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${skill.name}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The sites a skill's text names: where it may send the assistant. */
function sitesIn(text: string): string[] {
  const hosts = new Set<string>();
  for (const address of addressesIn(text)) {
    try {
      hosts.add(new URL(address).hostname);
    } catch {
      // Not an address after all.
    }
  }
  return [...hosts].slice(0, 12);
}

export function SkillsSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const { installed, off } = settings.skills;
  /** The skill being written, read before installing, or changed. `replacing` names the installed one it takes the place of. */
  const [draft, setDraft] = useState<(Draft & { replacing?: string; from?: 'file' | 'address' }) | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [address, setAddress] = useState('');
  const [fetching, setFetching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const say = (error: unknown) => setProblem(t(`skills.errors.${error instanceof SkillError ? error.problem : 'header'}`, { max: MAX_INSTALLED_SKILLS }));

  const turn = (name: string, on: boolean) => void saveSkills((skills) => ({ ...skills, off: on ? skills.off.filter((other) => other !== name) : [...new Set([...skills.off, name])] }));

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(undefined);
    try {
      setDraft({ ...parseSkill(await file.text()), from: 'file' });
    } catch (error) {
      say(error);
    }
  };

  const openAddress = async () => {
    setProblem(undefined);
    setFetching(true);
    try {
      setDraft({ ...(await fetchSkill(address)), from: 'address' });
      setAddress('');
    } catch (error) {
      say(error);
    } finally {
      setFetching(false);
    }
  };

  const install = async () => {
    if (!draft) return;
    setProblem(undefined);
    try {
      // Checked here for the message; the settings are changed from what is stored at that moment.
      withSkill(settings.skills, draft, draft.replacing);
      await saveSkills((skills) => withSkill(skills, draft, draft.replacing));
      setDraft(undefined);
    } catch (error) {
      say(error);
    }
  };

  const sites = draft ? sitesIn(draft.instructions) : [];

  return (
    <Section title={t('skills.title')} description={t('skills.description')}>
      <Card className="p-5">
        <div className="space-y-3" data-testid="builtin-skills">
          <div>
            <h3 className="text-sm font-medium">{t('skills.builtin')}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('skills.builtinHint')}</p>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {BUILTIN_SKILLS.map((skill) => {
              const command = COMMAND_OF[skill.name];
              return (
                <li key={skill.name} className="px-3 py-2" data-testid="skill-row" data-skill={skill.name}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {command ? t(`commands.${command}.label`) : skill.name} <span className="font-mono text-xs font-normal text-faint">{skill.name}</span>
                      </div>
                      <div className="truncate text-xs text-muted">{command ? t(`commands.${command}.description`) : skill.description}</div>
                    </div>
                    <Switch id={`skill-${skill.name}`} checked={!off.includes(skill.name)} onChange={(on) => turn(skill.name, on)} />
                  </div>
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer select-none text-faint hover:text-fg">{t('skills.show')}</summary>
                    <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-2.5 font-sans leading-relaxed">{skill.instructions}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card className="p-5">
        <div className="space-y-3" data-testid="installed-skills">
          <div>
            <h3 className="text-sm font-medium">{t('skills.installed')}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('skills.installedHint')}</p>
          </div>
          {installed.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {installed.map((skill) => (
                <li key={skill.name} className="flex items-center gap-2 py-1.5 pl-3 pr-2" data-testid="skill-row" data-skill={skill.name}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-medium text-accent">/{skill.name}</div>
                    <div className="truncate text-xs text-muted" title={skill.description}>
                      {skill.description}
                    </div>
                  </div>
                  <IconButton label={t('common.edit')} onClick={() => (setProblem(undefined), setDraft({ ...skill, replacing: skill.name }))} className="h-7 w-7">
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label={t('skills.export')} onClick={() => download(skill)} className="h-7 w-7">
                    <Download className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label={t('common.delete')} onClick={() => void saveSkills((skills) => withoutSkill(skills, skill.name))} className="h-7 w-7">
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                  <Switch id={`skill-${skill.name}`} checked={!off.includes(skill.name)} onChange={(on) => turn(skill.name, on)} />
                </li>
              ))}
            </ul>
          )}
          {!draft && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => fileInput.current?.click()} data-testid="skill-from-file">
                  <FileUp className="h-4 w-4" />
                  {t('skills.add.file')}
                </Button>
                <Button variant="secondary" onClick={() => (setProblem(undefined), setDraft(EMPTY))} data-testid="skill-write">
                  <Plus className="h-4 w-4" />
                  {t('skills.add.write')}
                </Button>
                <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" data-testid="skill-file" onChange={(e) => (void openFile(e.target.files?.[0]), (e.target.value = ''))} />
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void openAddress();
                }}
              >
                <input className={inputClass} type="url" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('skills.add.addressPlaceholder')} aria-label={t('skills.add.address')} data-testid="skill-address" />
                <Button type="submit" variant="secondary" disabled={!address.trim() || fetching} data-testid="skill-fetch">
                  <Link2 className="h-4 w-4" />
                  {t('skills.add.fetch')}
                </Button>
              </form>
            </div>
          )}
          {problem && !draft && (
            <p role="alert" className="text-xs text-danger" data-testid="skill-problem">
              {problem}
            </p>
          )}
        </div>
      </Card>

      {draft && (
        <Card className="space-y-4 p-5">
          <div data-testid="skill-form" className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">{draft.replacing ? t('skills.form.change') : draft.from ? t('skills.form.review') : t('skills.form.write')}</h3>
              {/* What installing means, said where the text is read. */}
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('skills.form.note')}</p>
            </div>
            <Field label={t('skills.form.name')} htmlFor="skill-name" hint={t('skills.form.nameHint')}>
              <input id="skill-name" className={`${inputClass} font-mono sm:w-72`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t('skills.form.description')} htmlFor="skill-description" hint={t('skills.form.descriptionHint')}>
              <input id="skill-description" className={inputClass} maxLength={SKILL_DESCRIPTION_CHARS} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label={t('skills.form.instructions')} htmlFor="skill-instructions" hint={t('skills.form.instructionsHint', { used: draft.instructions.length, max: SKILL_INSTRUCTION_CHARS })}>
              <textarea
                id="skill-instructions"
                className={`${inputClass} h-64 resize-y font-mono text-xs leading-relaxed`}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              />
            </Field>
            {sites.length > 0 && (
              <p className="text-xs text-muted" data-testid="skill-sites">
                {t('skills.form.sites', { sites: sites.join(', ') })}
              </p>
            )}
            {problem && (
              <p role="alert" className="text-xs text-danger" data-testid="skill-problem">
                {problem}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void install()} data-testid="skill-install">
                {draft.replacing ? t('common.save') : t('skills.form.install')}
              </Button>
              <Button variant="secondary" onClick={() => (setDraft(undefined), setProblem(undefined))}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </Section>
  );
}
