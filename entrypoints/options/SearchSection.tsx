import { CheckCircle2, Cloud, ExternalLink, Eye, EyeOff, Globe, Loader2, Search, Sparkles, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { requestHostAccess } from '../../src/permissions/hosts';
import { SEARCH_KEY_URLS, searchEndpoint } from '../../src/search/search';
import type { SearchTestRequest, SearchTestResult } from '../../src/shared/protocol';
import type { CloudflareSearchSource, SearchEngineSetting, SearchProviderId, SearchSettings, Settings } from '../../src/shared/types';
import { getSearchKey, saveSearchKey, updateSettings } from '../../src/storage/settings';
import { Button } from '../../src/ui/Button';
import { errorSummary } from '../../src/ui/errors';
import { Card, ChoiceCard, Field, inputClass, Section, Toggle } from './Section';

const PROVIDERS: { id: SearchProviderId; icon: LucideIcon }[] = [
  { id: 'browser', icon: Globe },
  { id: 'deepseek', icon: Search },
  { id: 'cloudflare', icon: Cloud },
  { id: 'tavily', icon: Search },
  { id: 'brave', icon: Search },
  { id: 'exa', icon: Search },
  { id: 'native', icon: Sparkles },
];

const ENGINES: SearchEngineSetting[] = ['google', 'bing', 'duckduckgo', 'custom'];
const CLOUDFLARE_SOURCES: CloudflareSearchSource[] = ['ceramic', 'exa', 'linkup'];

/** Providers whose key is entered here (DeepSeek reuses a connection's key). */
const OWN_KEY = new Set<SearchProviderId>(['cloudflare', 'tavily', 'brave', 'exa']);

function saveSearch(patch: Partial<SearchSettings>) {
  void updateSettings((s) => ({ ...s, search: { ...s.search, ...patch } }));
}

/** Text input saved when it loses focus. */
function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft];
}

function KeyField({ provider, onDraft }: { provider: SearchProviderId; onDraft: (key: string) => void }) {
  const { t } = useTranslation();
  const [stored, setStored] = useState(false);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    setKey('');
    void getSearchKey(provider).then((value) => setStored(Boolean(value)));
  }, [provider]);

  const commit = async () => {
    if (!key.trim()) return;
    await saveSearchKey(provider, key);
    setStored(true);
    setKey('');
    onDraft('');
  };

  const keyUrl = SEARCH_KEY_URLS[provider];
  return (
    <Field
      label={provider === 'cloudflare' ? t('search.cloudflareToken') : t('connections.fields.apiKey')}
      htmlFor="search-key"
      hint={
        <>
          {provider === 'cloudflare' ? t('search.cloudflareTokenHint') : t('search.keyHint')}{' '}
          {keyUrl && (
            <a href={keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent underline">
              {t('connections.getKey')}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      }
    >
      <div className="relative">
        <input
          id="search-key"
          type={show ? 'text' : 'password'}
          className={`${inputClass} pr-9`}
          value={key}
          placeholder={stored ? t('connections.keyKeep') : ''}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setKey(e.target.value);
            onDraft(e.target.value);
          }}
          onBlur={() => void commit()}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? t('connections.hideKey') : t('connections.showKey')}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-faint hover:text-fg"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}

function TestSearch({ settings, keyDraft }: { settings: Settings; keyDraft: string }) {
  const { t } = useTranslation();
  const provider = settings.search.provider;
  const [query, setQuery] = useState('Chrome extension side panel API');
  const [state, setState] = useState<{ busy?: boolean; result?: SearchTestResult }>({});

  useEffect(() => setState({}), [provider]);

  const run = async () => {
    // Ask for the API host inside the click, before any await.
    const endpoint = searchEndpoint(provider, settings.search, settings.connections);
    const access = endpoint ? requestHostAccess(endpoint) : Promise.resolve(true);
    setState({ busy: true });
    if (keyDraft.trim()) await saveSearchKey(provider, keyDraft);
    if (!(await access)) {
      setState({ result: { ok: false, results: [], error: { code: 'forbidden', message: t('connections.validation.permission') } } });
      return;
    }
    const request: SearchTestRequest = { type: 'search.test', provider, query };
    setState({ result: (await browser.runtime.sendMessage(request)) as SearchTestResult });
  };

  const result = state.result;
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex gap-2">
        <input
          aria-label={t('search.testQuery')}
          className={`${inputClass} min-w-0 flex-1`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
        <Button onClick={() => void run()} disabled={state.busy || !query.trim()} data-testid="search-test">
          {state.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t('search.test')}
        </Button>
      </div>
      {result && !result.ok && result.error && (
        <p className="flex items-start gap-2 text-sm text-danger" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {errorSummary(t, result.error)}
            <span className="mt-0.5 block break-all font-mono text-[11px] text-muted">{result.error.message}</span>
          </span>
        </p>
      )}
      {result?.ok && (
        <div className="space-y-2" data-testid="search-test-results">
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            {result.text ? t('search.testOkText') : t('search.testOk', { count: result.results.length })}
          </p>
          {result.text ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 text-xs text-muted">{result.text}</pre>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {result.results.slice(0, 5).map((r) => (
                <li key={r.url} className="min-w-0">
                  <a href={r.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-accent hover:underline">
                    {r.title}
                  </a>
                  <span className="line-clamp-2 text-xs text-muted">{r.snippet}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function SearchSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const search = settings.search;
  const provider = search.provider;
  const [customUrl, setCustomUrl] = useDraft(search.customUrl);
  const [accountId, setAccountId] = useDraft(search.cloudflare.accountId);
  const [gatewayId, setGatewayId] = useDraft(search.cloudflare.gatewayId);
  const [keyDraft, setKeyDraft] = useState('');
  const deepseekConnections = settings.connections.filter((c) => c.vendor === 'deepseek');

  const engineField = (
    <Field label={t('search.engine')} htmlFor="search-engine" hint={provider === 'browser' ? undefined : t('search.engineFallbackHint')}>
      <select
        id="search-engine"
        className={inputClass}
        value={search.engine}
        onChange={(e) => saveSearch({ engine: e.target.value as SearchEngineSetting })}
      >
        {ENGINES.map((engine) => (
          <option key={engine} value={engine}>
            {t(`search.engines.${engine}`)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Section title={t('search.title')} description={t('search.description')}>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('search.provider')}>
        {PROVIDERS.map(({ id, icon }) => (
          <ChoiceCard
            key={id}
            name="search-provider"
            value={id}
            checked={provider === id}
            onChange={() => saveSearch({ provider: id })}
            icon={icon}
            title={t(`search.providers.${id}.title`)}
            description={t(`search.providers.${id}.description`)}
            testId={`search-provider-${id}`}
          />
        ))}
      </div>

      <Card className="space-y-4 p-5">
        {provider === 'deepseek' &&
          (deepseekConnections.length === 0 ? (
            <p className="text-sm text-muted">
              {t('search.deepseekNoConnection')}{' '}
              <a href="#providers" className="text-accent underline">
                {t('slots.addConnection')}
              </a>
            </p>
          ) : (
            <Field label={t('search.deepseekConnection')} htmlFor="deepseek-connection" hint={t('search.deepseekHint')}>
              <select
                id="deepseek-connection"
                className={inputClass}
                value={search.deepseekConnectionId ?? deepseekConnections[0]!.id}
                onChange={(e) => saveSearch({ deepseekConnectionId: e.target.value })}
              >
                {deepseekConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}

        {provider === 'cloudflare' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('search.cloudflareAccount')} htmlFor="cf-account">
              <input
                id="cf-account"
                className={inputClass}
                value={accountId}
                spellCheck={false}
                onChange={(e) => setAccountId(e.target.value)}
                onBlur={() => saveSearch({ cloudflare: { ...search.cloudflare, accountId: accountId.trim() } })}
              />
            </Field>
            <Field label={t('search.cloudflareGateway')} htmlFor="cf-gateway">
              <input
                id="cf-gateway"
                className={inputClass}
                value={gatewayId}
                spellCheck={false}
                onChange={(e) => setGatewayId(e.target.value)}
                onBlur={() => saveSearch({ cloudflare: { ...search.cloudflare, gatewayId: gatewayId.trim() || 'default' } })}
              />
            </Field>
            <Field label={t('search.cloudflareSource')} htmlFor="cf-source">
              <select
                id="cf-source"
                className={inputClass}
                value={search.cloudflare.source}
                onChange={(e) => saveSearch({ cloudflare: { ...search.cloudflare, source: e.target.value as CloudflareSearchSource } })}
              >
                {CLOUDFLARE_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {source[0]!.toUpperCase() + source.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {OWN_KEY.has(provider) && <KeyField provider={provider} onDraft={setKeyDraft} />}
        {provider === 'native' && <p className="text-sm leading-relaxed text-muted">{t('search.nativeHint')}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          {engineField}
          {search.engine === 'custom' && (
            <Field label={t('search.customUrl')} htmlFor="custom-search" hint={t('search.customUrlHint')}>
              <input
                id="custom-search"
                className={inputClass}
                value={customUrl}
                placeholder="https://search.example.com/?q=%s"
                spellCheck={false}
                onChange={(e) => setCustomUrl(e.target.value)}
                onBlur={() => saveSearch({ customUrl: customUrl.trim() })}
              />
            </Field>
          )}
        </div>

        {provider !== 'browser' && (
          <>
            <Toggle
              id="search-fallback"
              checked={search.fallbackToBrowser}
              onChange={(fallbackToBrowser) => saveSearch({ fallbackToBrowser })}
              label={t('search.fallback')}
              hint={t('search.fallbackHint')}
            />
            <TestSearch settings={settings} keyDraft={keyDraft} />
          </>
        )}
      </Card>
      <p className="text-xs leading-relaxed text-muted">{t('search.verifyNote')}</p>
    </Section>
  );
}
