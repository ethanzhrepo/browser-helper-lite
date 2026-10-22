import mermaid from 'mermaid';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFrame, CopyButton } from './Markdown';

let counter = 0;
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Renders one diagram; colors follow the light or dark theme. */
async function renderDiagram(source: string, dark: boolean): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    // Strict: no HTML labels, no click handlers, sanitized output.
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: 'inherit',
  });
  const id = `mermaid-${++counter}`;
  try {
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    // On errors mermaid leaves its scratch element in the document.
    document.getElementById(`d${id}`)?.remove();
  }
}

export default function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation();
  const [dark, setDark] = useState(() => darkQuery().matches);
  const [state, setState] = useState<{ svg?: string; error?: string }>({});

  useEffect(() => {
    const query = darkQuery();
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    renderDiagram(source, dark).then(
      (svg) => !cancelled && setState({ svg }),
      (error: unknown) => !cancelled && setState({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  if (state.error) {
    return (
      <CodeFrame language="mermaid" source={source}>
        <p className="border-b border-line px-3 py-1.5 text-xs text-danger">{t('message.diagramError')}</p>
        <pre>
          <code>{source}</code>
        </pre>
      </CodeFrame>
    );
  }
  if (!state.svg) return <div className="mermaid-diagram h-24 animate-pulse rounded-[10px] bg-subtle" />;
  return (
    <div className="code-block" data-testid="mermaid-diagram">
      <div className="flex items-center justify-between border-b border-line py-1 pl-3 pr-1.5">
        <span className="font-mono text-[11px] text-faint">mermaid</span>
        <span className="flex items-center gap-0.5">
          <CopyButton text={source} />
          <CopyButton text={state.svg} label={t('message.copySvg')} />
        </span>
      </div>
      <div className="mermaid-diagram flex justify-center bg-surface p-3" dangerouslySetInnerHTML={{ __html: state.svg }} />
    </div>
  );
}
