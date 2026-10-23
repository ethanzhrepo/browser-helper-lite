import 'katex/dist/katex.min.css';
import { Check, Copy, ImageOff } from 'lucide-react';
import { lazy, memo, Suspense, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { urlDataLeak } from '../agent/injection';
import { normalizeMath } from './math';

// Mermaid is large; it loads only when a reply contains a diagram.
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function languageOf(code: HastNode | undefined): string | undefined {
  const classes = code?.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  return list.find((c) => c.startsWith('language-'))?.slice('language-'.length);
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      {copied ? t('message.copied') : (label ?? t('message.copy'))}
    </button>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Images in replies are not loaded: a reply shaped by a malicious page could
 * point an image at an attacker's server with your data in the URL (§8.2).
 * They are shown as a link you can open yourself.
 */
function BlockedImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const label = alt?.trim() || t('message.image');
  const safe = src && /^https?:/i.test(src) ? src : undefined;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      title={src}
      data-testid="blocked-image"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-subtle px-2 py-0.5 align-middle text-xs text-muted no-underline hover:text-fg"
    >
      <ImageOff className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {safe && <span className="shrink-0 text-faint">· {hostOf(safe)}</span>}
    </a>
  );
}

/**
 * Links in replies. The full address shows on hover, so a link's real target
 * is visible before clicking. A link whose address carries data (an email
 * address, a long code) could hand your data to a site a page picked, so the
 * first click shows the whole address and only the second one opens it.
 */
function ReplyLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const carriesData = href ? urlDataLeak(href) !== undefined : false;
  return (
    <>
      <a
        {...props}
        href={href}
        title={href}
        target="_blank"
        rel="noreferrer noopener"
        data-testid={carriesData ? 'data-link' : undefined}
        onClick={(event) => {
          if (carriesData && !checked) {
            event.preventDefault();
            setChecked(true);
          }
        }}
      >
        {children}
      </a>
      {carriesData && checked && (
        <span className="my-1 block rounded-md border border-warning/25 bg-warning-soft px-2 py-1 text-xs leading-relaxed" data-testid="data-link-warning">
          {t('message.linkData')} <code className="break-all">{href}</code>
        </span>
      )}
    </>
  );
}

function CodeBlock({ node, streaming, children }: { node?: HastNode; streaming: boolean; children: ReactNode }) {
  const code = node?.children?.find((child) => child.tagName === 'code');
  const language = languageOf(code);
  const source = textOf(code).replace(/\n$/, '');

  if (language === 'mermaid') {
    // Render once the block is complete; until then show the source.
    return streaming ? (
      <CodeFrame language="mermaid" source={source}>
        <pre>
          <code>{source}</code>
        </pre>
      </CodeFrame>
    ) : (
      <Suspense fallback={<div className="mermaid-diagram h-24 animate-pulse rounded-[10px] bg-subtle" />}>
        <MermaidDiagram source={source} />
      </Suspense>
    );
  }
  return (
    <CodeFrame language={language} source={source}>
      <pre>{children}</pre>
    </CodeFrame>
  );
}

export function CodeFrame({ language, source, children, actions }: {
  language?: string;
  source: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="code-block" data-testid="code-block">
      <div className="flex items-center justify-between border-b border-line py-1 pl-3 pr-1.5">
        <span className="font-mono text-[11px] text-faint">{language ?? 'text'}</span>
        <span className="flex items-center gap-0.5">
          {actions}
          <CopyButton text={source} />
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Assistant Markdown: GFM tables, highlighted code, math (KaTeX) and Mermaid
 * diagrams. Raw HTML in replies is never rendered.
 */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          [rehypeHighlight, { detect: false, plainText: ['mermaid', 'text', 'txt', 'plain'] }],
        ]}
        components={{
          a: ({ node: _node, ...props }) => <ReplyLink {...props} />,
          img: ({ src, alt }) => <BlockedImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
          pre: ({ node, children }) => (
            <CodeBlock node={node as HastNode | undefined} streaming={streaming}>
              {children}
            </CodeBlock>
          ),
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
});
