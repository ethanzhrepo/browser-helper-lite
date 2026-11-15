import { AlertTriangle, Download, FileText, FileUp, Link2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../../src/shared/types';
import { BUILTIN_SKILLS } from '../../src/skills/builtin';
import { fetchSkill, readSkillUpload, zipSkill } from '../../src/skills/package';
import {
  allSkills,
  checkSkill,
  isSkillName,
  MAX_INSTALLED_SKILLS,
  SKILL_DESCRIPTION_CHARS,
  SKILL_INSTRUCTION_CHARS,
  SkillError,
  sitesIn,
  toSkillName,
  usedSkills,
  type Skill,
} from '../../src/skills/skills';
import { skillTitle } from '../../src/skills/titles';
import { installSkill, removeSkill } from '../../src/skills/store';
import { useInstalledSkills } from '../../src/skills/useInstalledSkills';
import { updateSettings } from '../../src/storage/settings';
import { Button, IconButton } from '../../src/ui/Button';
import { Switch } from '../../src/ui/Switch';
import { Card, Field, inputClass, Section } from './Section';

/** The skill in the form: one being written, read before installing, or changed. */
type Draft = Skill & {
  /** The installed skill it takes the place of. */
  replacing?: string;
  /** Where it was read from: a file's name or an address. */
  source?: string;
  from?: 'file' | 'address';
};
const EMPTY: Draft = { name: '', description: '', instructions: '' };

function download(skill: Skill) {
  const url = URL.createObjectURL(new Blob([zipSkill(skill) as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${skill.name}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const size = (text: string) => `${Math.max(1, Math.round(new TextEncoder().encode(text).length / 1024))} KB`;

/** Optional fields of the format, shown as they are: none of them changes what the assistant may do. */
function Extras({ skill }: { skill: Skill }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ...(skill.license ? [[t('skills.form.license'), skill.license] as [string, string]] : []),
    ...(skill.compatibility ? [[t('skills.form.compatibility'), skill.compatibility] as [string, string]] : []),
    ...Object.entries(skill.metadata ?? {}).map(([key, value]): [string, string] => [key, value]),
    ...(skill.allowedTools ? [[t('skills.form.allowedTools'), `${skill.allowedTools} · ${t('skills.form.allowedToolsNote')}`] as [string, string]] : []),
  ];
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="skill-extras">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-faint">{key}</dt>
          <dd className="min-w-0 break-words text-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What the folder held besides SKILL.md: the files kept, and those left out with the reason. */
function Files({ skill }: { skill: Skill }) {
  const { t } = useTranslation();
  const files = skill.files ?? [];
  const skipped = skill.skipped ?? [];
  if (files.length === 0 && skipped.length === 0) return null;
  return (
    <div className="space-y-2 text-xs" data-testid="skill-files">
      {files.length > 0 && (
        <div>
          <div className="font-medium">{t('skills.form.files', { count: files.length })}</div>
          <ul className="mt-1 space-y-1">
            {files.map((file) => (
              <li key={file.path}>
                <details>
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-muted hover:text-fg">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono">{file.path}</span>
                    <span className="text-faint">{size(file.text)}</span>
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-2 font-mono leading-relaxed">{file.text}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
      {skipped.length > 0 && (
        <div data-testid="skill-skipped">
          <div className="font-medium">{t('skills.form.skipped', { count: skipped.length })}</div>
          <ul className="mt-1 space-y-0.5 text-muted">
            {skipped.map((file) => (
              <li key={file.path}>
                <span className="font-mono">{file.path}</span> · {t(`skills.form.skippedReason.${file.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SkillsSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const installed = useInstalledSkills();
  const off = settings.skills.off;
  const [draft, setDraft] = useState<Draft | undefined>();
  /** What went wrong, and with what: shown where it happened. */
  const [problem, setProblem] = useState<{ text: string; where: 'add' | 'form' } | undefined>();
  const [address, setAddress] = useState('');
  const [fetching, setFetching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const say = (error: unknown, where: 'add' | 'form', source?: string) => {
    const reason = error instanceof SkillError ? error.problem : 'header';
    const detail = error instanceof SkillError ? error.detail : undefined;
    const text = t(`skills.errors.${reason}`, { max: MAX_INSTALLED_SKILLS, detail });
    setProblem({ text: source ? `${source}: ${text}` : text, where });
  };

  const turn = (name: string, on: boolean) => void updateSettings((s) => ({ ...s, skills: { ...s.skills, off: on ? s.skills.off.filter((other) => other !== name) : [...new Set([...s.skills.off, name])] } }));

  /** Starts on something new: the form and the last problem go. */
  const begin = () => {
    setProblem(undefined);
    setDraft(undefined);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    begin();
    try {
      setDraft({ ...(await readSkillUpload(file)), source: file.name, from: 'file' });
    } catch (error) {
      say(error, 'add', file.name);
    }
  };

  const openAddress = async () => {
    begin();
    setFetching(true);
    try {
      setDraft({ ...(await fetchSkill(address)), source: address.trim(), from: 'address' });
      setAddress('');
    } catch (error) {
      say(error, 'add');
    } finally {
      setFetching(false);
    }
  };

  const install = async () => {
    if (!draft) return;
    setProblem(undefined);
    const { replacing, source, from: _from, ...skill } = draft;
    try {
      await installSkill(skill, { replacing, source });
      setDraft(undefined);
    } catch (error) {
      say(error, 'form');
    }
  };

  // What is wrong with the form as it is, before anything is saved.
  let invalid: string | undefined;
  if (draft) {
    try {
      checkSkill(draft);
    } catch (error) {
      invalid = error instanceof SkillError ? error.problem : 'header';
    }
  }
  const sites = draft ? sitesIn(draft) : [];
  /** The skills the one in the form builds on: they are loaded with it. */
  const draftUses = draft ? usedSkills(draft, allSkills(installed)).map((used) => used.name) : [];

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
              const title = skillTitle(t, skill);
              const uses = usedSkills(skill, BUILTIN_SKILLS).map((used) => used.name);
              return (
                <li key={skill.name} className="px-3 py-2" data-testid="skill-row" data-skill={skill.name}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {title.label} {title.titled && <span className="font-mono text-xs font-normal text-faint">{skill.name}</span>}
                      </div>
                      <div className="truncate text-xs text-muted">{title.description}</div>
                    </div>
                    <IconButton label={t('skills.export')} onClick={() => download(skill)} className="h-7 w-7">
                      <Download className="h-3.5 w-3.5" />
                    </IconButton>
                    <Switch id={`skill-${skill.name}`} checked={!off.includes(skill.name)} onChange={(on) => turn(skill.name, on)} />
                  </div>
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer select-none text-faint hover:text-fg">{t('skills.show')}</summary>
                    <p className="mt-1.5 text-muted">{skill.description}</p>
                    {uses.length > 0 && (
                      <p className="mt-1 text-muted" data-testid="skill-uses">
                        {t('skills.uses', { names: uses.join(', ') })}
                      </p>
                    )}
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
              {installed.map((skill) => {
                const valid = isSkillName(skill.name);
                return (
                  <li key={skill.name} className="flex items-center gap-2 py-1.5 pl-3 pr-2" data-testid="skill-row" data-skill={skill.name}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-accent">
                        /{skill.name}
                        {(skill.files ?? []).length > 0 && <span className="font-sans font-normal text-faint">· {t('skills.form.files', { count: skill.files!.length })}</span>}
                      </div>
                      {valid ? (
                        <div className="truncate text-xs text-muted" title={skill.description}>
                          {skill.description}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-warning" data-testid="skill-rename">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {t('skills.rename')}
                        </div>
                      )}
                    </div>
                    <IconButton label={t('common.edit')} onClick={() => (begin(), setDraft({ ...skill, name: valid ? skill.name : toSkillName(skill.name), replacing: skill.name }))} className="h-7 w-7">
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t('skills.export')} onClick={() => download(skill)} disabled={!valid} className="h-7 w-7">
                      <Download className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={() => void removeSkill(skill.name)} className="h-7 w-7">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                    <Switch id={`skill-${skill.name}`} checked={valid && !off.includes(skill.name)} disabled={!valid} onChange={(on) => turn(skill.name, on)} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => fileInput.current?.click()} data-testid="skill-from-file">
                <FileUp className="h-4 w-4" />
                {t('skills.add.file')}
              </Button>
              <Button variant="secondary" onClick={() => (begin(), setDraft(EMPTY))} data-testid="skill-write">
                <Plus className="h-4 w-4" />
                {t('skills.add.write')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,.zip,text/markdown,application/zip"
                className="hidden"
                data-testid="skill-file"
                onChange={(e) => {
                  void openFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
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
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {t('skills.add.fetch')}
              </Button>
            </form>
            <p className="text-xs text-faint">{t('skills.add.formats')}</p>
          </div>
          {problem?.where === 'add' && (
            <p role="alert" className="text-xs text-danger" data-testid="skill-problem">
              {problem.text}
            </p>
          )}
        </div>
      </Card>

      {draft && (
        <Card className="space-y-4 p-5">
          <div data-testid="skill-form" className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">{draft.replacing ? t('skills.form.change') : draft.from ? t('skills.form.review') : t('skills.form.write')}</h3>
              {draft.source && <p className="mt-0.5 break-all font-mono text-xs text-faint">{draft.source}</p>}
              {/* What installing means, said where the text is read. */}
              <p className="mt-1 text-xs leading-relaxed text-muted">{t('skills.form.note')}</p>
            </div>
            <Field label={t('skills.form.name')} htmlFor="skill-name" hint={t('skills.form.nameHint')}>
              <input
                id="skill-name"
                className={`${inputClass} font-mono sm:w-72`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: toSkillName(e.target.value) })}
                onBlur={() => setDraft({ ...draft, name: draft.name.replace(/-+$/, '') })}
                aria-invalid={invalid === 'name' || invalid === 'nameRule'}
              />
            </Field>
            <Field label={t('skills.form.description')} htmlFor="skill-description" hint={t('skills.form.descriptionHint', { max: SKILL_DESCRIPTION_CHARS })}>
              <textarea id="skill-description" rows={2} className={`${inputClass} h-auto resize-y py-1.5`} maxLength={SKILL_DESCRIPTION_CHARS} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label={t('skills.form.instructions')} htmlFor="skill-instructions" hint={t('skills.form.instructionsHint', { used: draft.instructions.length, max: SKILL_INSTRUCTION_CHARS })}>
              <textarea
                id="skill-instructions"
                className={`${inputClass} h-64 resize-y font-mono text-xs leading-relaxed`}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              />
            </Field>
            <Extras skill={draft} />
            <Files skill={draft} />
            {sites.length > 0 && (
              <p className="text-xs text-muted" data-testid="skill-sites">
                {t('skills.form.sites', { sites: sites.join(', ') })}
              </p>
            )}
            {draftUses.length > 0 && (
              <p className="text-xs text-muted" data-testid="skill-uses">
                {t('skills.uses', { names: draftUses.join(', ') })}
              </p>
            )}
            {problem?.where === 'form' && (
              <p role="alert" className="text-xs text-danger" data-testid="skill-problem">
                {problem.text}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void install()} data-testid="skill-install">
                {draft.replacing ? t('common.save') : t('skills.form.install')}
              </Button>
              <Button variant="secondary" onClick={begin}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </Section>
  );
}
