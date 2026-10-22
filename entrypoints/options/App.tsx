import { Bot, Info, Languages, Plug, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../../src/shared/types';
import { useSettings } from '../../src/ui/useSettings';
import { AboutSection } from './AboutSection';
import { AgentSection } from './AgentSection';
import { ConnectionsSection } from './ConnectionsSection';
import { LanguageSection } from './LanguageSection';
import { SitesSection } from './SitesSection';
import { SlotsSection } from './SlotsSection';

type SectionId = 'providers' | 'models' | 'agent' | 'sites' | 'language' | 'about';

const SECTIONS: { id: SectionId; icon: ComponentType<{ className?: string }>; render: (s: Settings) => ReactNode }[] = [
  { id: 'providers', icon: Plug, render: (s) => <ConnectionsSection settings={s} /> },
  { id: 'models', icon: SlidersHorizontal, render: (s) => <SlotsSection settings={s} /> },
  { id: 'agent', icon: Bot, render: (s) => <AgentSection settings={s} /> },
  { id: 'sites', icon: ShieldCheck, render: (s) => <SitesSection settings={s} /> },
  { id: 'language', icon: Languages, render: (s) => <LanguageSection settings={s} /> },
  { id: 'about', icon: Info, render: () => <AboutSection /> },
];

function currentSection(): SectionId {
  const id = location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : 'providers';
}

export function App() {
  const { t } = useTranslation();
  const settings = useSettings();
  const [section, setSection] = useState<SectionId>(currentSection);

  useEffect(() => {
    const onHashChange = () => setSection(currentSection());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${t(`options.sections.${section}`)} · Browser Helper Lite`;
  }, [section, t]);

  const active = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <img src="/icon/48.png" alt="" className="h-8 w-8" />
          <div>
            <h1 className="text-base font-semibold">Browser Helper Lite</h1>
            <p className="text-sm text-muted">{t('options.subtitle')}</p>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col" aria-label={t('options.nav')}>
          {SECTIONS.map(({ id, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={id === section ? 'page' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                id === section ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(`options.sections.${id}`)}
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1">{settings && active.render(settings)}</main>
      </div>
    </div>
  );
}
