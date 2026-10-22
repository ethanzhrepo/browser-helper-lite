import { AudioLines, CheckCircle2, Mic } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings, VoiceEngine, VoiceSettings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Button } from '../../src/ui/Button';
import { openMicPermissionPage } from '../../src/voice/useVoiceInput';
import { Card, ChoiceCard, Field, inputClass, Section, Toggle } from './Section';

const LANGUAGES = ['zh-CN', 'zh-TW', 'yue-Hant-HK', 'en-US', 'en-GB', 'fr-FR', 'fr-CA', 'es-ES', 'es-MX', 'ja-JP', 'ko-KR', 'de-DE'];

function saveVoice(patch: Partial<VoiceSettings>) {
  void updateSettings((s) => ({ ...s, voice: { ...s.voice, ...patch } }));
}

function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function VoiceSection({ settings }: { settings: Settings }) {
  const { t, i18n } = useTranslation();
  const voice = settings.voice;
  const [micGranted, setMicGranted] = useState<boolean>();

  useEffect(() => {
    let status: PermissionStatus | undefined;
    const update = () => setMicGranted(status?.state === 'granted');
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        status = result;
        update();
        result.addEventListener('change', update);
      })
      .catch(() => setMicGranted(false));
    return () => status?.removeEventListener('change', update);
  }, []);

  const sttSlot = settings.slots.stt;
  const engines: { id: VoiceEngine; icon: typeof Mic }[] = [
    { id: 'browser', icon: Mic },
    { id: 'stt', icon: AudioLines },
  ];

  return (
    <Section title={t('voice.title')} description={t('voice.description')}>
      <div className="space-y-2" role="radiogroup" aria-label={t('voice.engine')}>
        {engines.map(({ id, icon }) => (
          <ChoiceCard
            key={id}
            name="voice-engine"
            value={id}
            checked={voice.engine === id}
            onChange={() => saveVoice({ engine: id })}
            icon={icon}
            title={t(`voice.engines.${id}.title`)}
            description={
              id === 'stt' && !sttSlot ? (
                <>
                  {t('voice.engines.stt.description')}{' '}
                  <a href="#models" className="text-accent underline">
                    {t('voice.setSttModel')}
                  </a>
                </>
              ) : (
                t(`voice.engines.${id}.description`)
              )
            }
          />
        ))}
      </div>
      <Card className="space-y-4 p-5">
        <Field label={t('voice.language')} htmlFor="voice-language">
          <select
            id="voice-language"
            className={`${inputClass} sm:w-72`}
            value={voice.language}
            onChange={(e) => saveVoice({ language: e.target.value })}
          >
            <option value="auto">{t('voice.languageAuto')}</option>
            {LANGUAGES.map((tag) => (
              <option key={tag} value={tag}>
                {languageName(tag, i18n.language)} ({tag})
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          id="voice-autosend"
          checked={voice.autoSend}
          onChange={(autoSend) => saveVoice({ autoSend })}
          label={t('voice.autoSend')}
          hint={t('voice.autoSendHint')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-sm font-medium">{t('voice.microphone')}</p>
            <p className="text-xs text-muted">{micGranted ? t('voice.micGranted') : t('voice.micHint')}</p>
          </div>
          {micGranted ? (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              {t('voice.micAllowed')}
            </span>
          ) : (
            <Button onClick={openMicPermissionPage}>
              <Mic className="h-4 w-4" />
              {t('voice.allowMic')}
            </Button>
          )}
        </div>
      </Card>
    </Section>
  );
}
