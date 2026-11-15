import 'katex/dist/katex.min.css';
import { liveQuery } from 'dexie';
import { ArrowDown, ArrowUp, Check, Copy, Download, ImageOff } from 'lucide-react';
import { Children, createContext, isValidElement, lazy, memo, Suspense, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { urlDataLeak } from '../agent/injection';
import { pictureKey, type ReplyPicture } from '../agent/pictures';
import { db } from '../storage/db';
import { normalizeMath } from './math';
import { sortOrder, toCsv } from './table';

// Mermaid is large; it loads only when a reply contains a diagram.
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
  position?: { start?: { offset?: number } };
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

/** The pictures kept for the conversation on screen, by address (see `usePictures`). */
export const PicturesContext = createContext<ReadonlyMap<string, ReplyPicture>>(new Map());

/** The small copies of the pictures in a conversation's replies, as they are stored (also by the background, while a reply is written). */
export function usePictures(conversationId: string | undefined): ReadonlyMap<string, ReplyPicture> {
  const [pictures, setPictures] = useState<ReadonlyMap<string, ReplyPicture>>(new Map());
  useEffect(() => {
    if (!conversationId) return setPictures(new Map());
    const subscription = liveQuery(() => db.pictures.where('conversationId').equals(conversationId).toArray()).subscribe({
      next: (stored) => setPictures(new Map(stored.map((picture) => [picture.url, picture]))),
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
  }, [conversationId]);
  return pictures;
}

/**
 * A picture in a reply. The panel loads nothing from the network: it shows
 * the small copy the extension fetched for an address the assistant had read
 * (see pictures.ts), and for any other address a link you can open yourself.
 */
function ReplyImage({ src, alt }: { src?: string; alt?: string }) {
  const stored = useContext(PicturesContext).get(src ? pictureKey(src) : '');
  if (!stored) return <BlockedImage src={src} alt={alt} />;
  return (
    <img
      src={`data:${stored.mediaType};base64,${stored.image}`}
      alt={alt ?? ''}
      title={alt?.trim() || hostOf(stored.url)}
      width={stored.width}
      height={stored.height}
      data-testid="reply-picture"
      className="my-1 inline-block h-auto max-h-40 w-auto max-w-full rounded-lg border border-line bg-white object-contain align-middle"
    />
  );
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

interface TableState {
  /** Where each header cell starts in the source, to tell the columns apart. */
  columns: (number | undefined)[];
  sort?: { column: number; descending: boolean };
  order?: number[];
  toggle: (column: number) => void;
}

const TableContext = createContext<TableState | undefined>(undefined);

const elements = (node: HastNode | undefined, tag: string) => (node?.children ?? []).filter((child) => child.tagName === tag);
const rowCells = (row: HastNode) => (row.children ?? []).filter((c) => c.tagName === 'td' || c.tagName === 'th').map((c) => textOf(c).replace(/\s+/g, ' ').trim());

/**
 * A table in a reply: click a header to sort by it, and take the data along
 * as CSV. Comparisons are what the assistant is asked for most.
 */
function DataTable({ node, streaming, children }: { node?: HastNode; streaming: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<TableState['sort']>();
  const headRow = elements(elements(node, 'thead')[0], 'tr')[0];
  const head = headRow ? rowCells(headRow) : [];
  const body = elements(elements(node, 'tbody')[0], 'tr').map(rowCells);
  const sortable = !streaming && body.length > 1;
  const order = sortable && sort ? sortOrder(body, sort.column, sort.descending) : undefined;
  const state: TableState = {
    columns: sortable ? elements(headRow, 'th').map((cell) => cell.position?.start?.offset) : [],
    sort,
    order,
    toggle: (column) => setSort((now) => (now?.column !== column ? { column, descending: false } : now.descending ? undefined : { column, descending: true })),
  };
  const csv = () => toCsv([head, ...(order ? order.map((i) => body[i]!) : body)]);
  const download = () => {
    // The mark at the start tells spreadsheets the file is UTF-8.
    const url = URL.createObjectURL(new Blob(['\ufeff', csv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'table.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <TableContext.Provider value={state}>
      <div className="data-table" data-testid="data-table">
        <table>{children}</table>
        {!streaming && body.length > 0 && (
          <div className="flex justify-end gap-0.5 pt-1">
            <CopyButton text={csv()} label={t('message.copyCsv')} />
            <button
              type="button"
              onClick={download}
              data-testid="download-csv"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Download className="h-3 w-3" />
              {t('message.downloadCsv')}
            </button>
          </div>
        )}
      </div>
    </TableContext.Provider>
  );
}

function HeaderCell({ node, children }: { node?: HastNode; children: ReactNode }) {
  const { t } = useTranslation();
  const table = useContext(TableContext);
  const column = table ? table.columns.indexOf(node?.position?.start?.offset) : -1;
  if (!table || column < 0 || node?.position?.start?.offset === undefined) return <th>{children}</th>;
  const sorted = table.sort?.column === column ? (table.sort.descending ? 'descending' : 'ascending') : undefined;
  return (
    <th aria-sort={sorted ?? 'none'}>
      <button type="button" onClick={() => table.toggle(column)} title={t('message.sortBy')} className="inline-flex items-center gap-1 font-[inherit] text-left hover:text-accent">
        {children}
        {sorted === 'ascending' && <ArrowUp className="h-3 w-3 shrink-0 text-accent" />}
        {sorted === 'descending' && <ArrowDown className="h-3 w-3 shrink-0 text-accent" />}
      </button>
    </th>
  );
}

function TableBody({ children }: { children: ReactNode }) {
  const table = useContext(TableContext);
  const rows = Children.toArray(children).filter(isValidElement);
  return <tbody>{table?.order && table.order.length === rows.length ? table.order.map((i) => rows[i]) : rows}</tbody>;
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
          img: ({ src, alt }) => <ReplyImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
          table: ({ node, children }) => (
            <DataTable node={node as HastNode | undefined} streaming={streaming}>
              {children}
            </DataTable>
          ),
          th: ({ node, children }) => <HeaderCell node={node as HastNode | undefined}>{children}</HeaderCell>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
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
