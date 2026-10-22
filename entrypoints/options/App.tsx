import { Bot, Info, Languages, Mic, Plug, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../../src/shared/types';
import { BrandMark } from '../../src/ui/Button';
import { useSettings } from '../../src/ui/useSettings';
import { AboutSection } from './AboutSection';
import { AgentSection } from './AgentSection';
import { ConnectionsSection } from './ConnectionsSection';
import { LanguageSection } from './LanguageSection';
import { SearchSection } from './SearchSection';
import { SitesSection } from './SitesSection';
import { SlotsSection } from './SlotsSection';
import { VoiceSection } from './VoiceSection';

type SectionId = 'providers' | 'models' | 'agent' | 'search' | 'voice' | 'sites' | 'language' | 'about';

const SECTIONS: { id: SectionId; icon: ComponentType<{ className?: string }>; render: (s: Settings) => ReactNode }[] = [
  { id: 'providers', icon: Plug, render: (s) => <ConnectionsSection settings={s} /> },
  { id: 'models', icon: SlidersHorizontal, render: (s) => <SlotsSection settings={s} /> },
  { id: 'agent', icon: Bot, render: (s) => <AgentSection settings={s} /> },
  { id: 'search', icon: Search, render: (s) => <SearchSection settings={s} /> },
  { id: 'voice', icon: Mic, render: (s) => <VoiceSection settings={s} /> },
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
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <BrandMark size="md" />
          <h1 className="text-[15px] font-semibold tracking-tight">Browser Helper Lite</h1>
          <span className="text-faint">/</span>
          <span className="text-sm text-muted">{t('options.subtitle')}</span>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:gap-10 md:py-10">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:sticky md:top-24 md:w-52 md:flex-col md:self-start" aria-label={t('options.nav')}>
          {SECTIONS.map(({ id, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={id === section ? 'page' : undefined}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                id === section
                  ? 'bg-surface font-medium text-fg shadow-soft ring-1 ring-line'
                  : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${id === section ? 'text-accent' : ''}`} />
              {t(`options.sections.${id}`)}
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1 animate-fade-in" key={section}>
          {settings && active.render(settings)}
        </main>
      </div>
    </div>
  );
}
