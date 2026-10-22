import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { requestHostAccess } from '../../src/permissions/hosts';
import { suggestChatModel } from '../../src/providers/suggest';
import {
  COMPATIBLE_PRESETS,
  findPreset,
  normalizeBaseURL,
  VENDOR_ORDER,
  VENDORS,
  vendorRequiresKey,
} from '../../src/providers/vendors';
import type { ConnectionTestRequest, ConnectionTestResult } from '../../src/shared/protocol';
import type { Connection, ErrorInfo, Settings, Vendor } from '../../src/shared/types';
import { saveConnection, updateSettings } from '../../src/storage/settings';
import { Button } from '../../src/ui/Button';
import { errorSummary } from '../../src/ui/errors';
import { Card, Field, inputClass } from './Section';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'tested'; result: ConnectionTestResult }
  | { kind: 'invalid'; messageKey: string };

function defaultName(vendor: Vendor, presetId?: string): string {
  const preset = vendor === 'openai-compatible' ? findPreset(presetId) : undefined;
  return preset && preset.id !== 'custom' ? preset.label : VENDORS[vendor].label;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function ConnectionForm({ settings, initial, onDone }: {
  settings: Settings;
  initial?: Connection;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [vendor, setVendor] = useState<Vendor>(initial?.vendor ?? 'openai');
  const [presetId, setPresetId] = useState(initial?.presetId ?? COMPATIBLE_PRESETS[0]!.id);
  const [name, setName] = useState(initial?.name ?? defaultName('openai'));
  const [nameTouched, setNameTouched] = useState(Boolean(initial));
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? VENDORS.openai.defaultBaseURL);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const effectivePreset = vendor === 'openai-compatible' ? presetId : undefined;
  const preset = findPreset(effectivePreset);
  const keyRequired = vendorRequiresKey(vendor, effectivePreset);
  const keyUrl = VENDORS[vendor].keyUrl;

  const applyDefaults = (nextVendor: Vendor, nextPreset?: string) => {
    const url = nextVendor === 'openai-compatible' ? (findPreset(nextPreset)?.baseURL ?? '') : VENDORS[nextVendor].defaultBaseURL;
    setBaseURL(url);
    if (!nameTouched) setName(defaultName(nextVendor, nextPreset));
    setStatus({ kind: 'idle' });
  };

  const validate = (): string | undefined => {
    if (!isValidUrl(baseURL.trim())) return 'connections.validation.baseURL';
    if (keyRequired && !apiKey.trim() && !initial) return 'connections.validation.apiKey';
    return undefined;
  };

  const runTest = async (): Promise<ConnectionTestResult> => {
    const request: ConnectionTestRequest = {
      type: 'connection.test',
      vendor,
      baseURL: normalizeBaseURL(baseURL),
      apiKey: apiKey.trim() || undefined,
      connectionId: initial?.id,
    };
    return (await browser.runtime.sendMessage(request)) as ConnectionTestResult;
  };

  /**
   * Both buttons first ask for access to the API host. That keeps install-time
   * permissions empty and avoids CORS limits on custom endpoints (§5.2).
   * `requestHostAccess` must run before any await to keep the user gesture.
   */
  const withHostAccess = async (action: () => Promise<void>) => {
    const invalid = validate();
    if (invalid) {
      setStatus({ kind: 'invalid', messageKey: invalid });
      return;
    }
    const granted = requestHostAccess(baseURL.trim());
    setStatus({ kind: 'busy' });
    if (!(await granted)) {
      setStatus({ kind: 'invalid', messageKey: 'connections.validation.permission' });
      return;
    }
    await action();
  };

  const handleTest = () =>
    withHostAccess(async () => {
      setStatus({ kind: 'tested', result: await runTest() });
    });

  const handleSave = () =>
    withHostAccess(async () => {
      const previous = status.kind === 'tested' ? status.result : undefined;
      const result = previous ?? (await runTest());
      const now = Date.now();
      const connection: Connection = {
        id: initial?.id ?? crypto.randomUUID(),
        vendor,
        presetId: effectivePreset,
        name: name.trim() || defaultName(vendor, effectivePreset),
        baseURL: normalizeBaseURL(baseURL),
        models: result.ok ? result.models : (initial?.models ?? []),
        modelsFetchedAt: result.ok ? now : initial?.modelsFetchedAt,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
      };
      // An empty key field while editing keeps the stored key.
      await saveConnection(connection, apiKey.trim() || (initial ? undefined : ''));

      // First connection: pick a chat model so the side panel works right away.
      if (!settings.slots.chat && connection.models.length > 0) {
        const modelId = suggestChatModel(connection.vendor, connection.models);
        if (modelId) {
          await updateSettings((s) => ({ ...s, slots: { ...s.slots, chat: { connectionId: connection.id, modelId } } }));
        }
      }
      onDone();
    });

  const busy = status.kind === 'busy';

  return (
    <Card className="animate-fade-in space-y-5 p-5 shadow-card ring-1 ring-accent/25">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('connections.fields.vendor')} htmlFor="vendor">
          <select
            id="vendor"
            className={inputClass}
            value={vendor}
            onChange={(e) => {
              const next = e.target.value as Vendor;
              setVendor(next);
              applyDefaults(next, presetId);
            }}
          >
            {VENDOR_ORDER.map((id) => (
              <option key={id} value={id}>
                {id === 'openai-compatible' ? t('connections.compatible') : VENDORS[id].label}
              </option>
            ))}
          </select>
        </Field>
        {vendor === 'openai-compatible' && (
          <Field label={t('connections.fields.preset')} htmlFor="preset">
            <select
              id="preset"
              className={inputClass}
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                applyDefaults(vendor, e.target.value);
              }}
            >
              {COMPATIBLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === 'custom' ? t('connections.customPreset') : p.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('connections.fields.name')} htmlFor="name">
          <input
            id="name"
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </Field>
        <Field label={t('connections.fields.baseURL')} htmlFor="baseURL">
          <input
            id="baseURL"
            className={inputClass}
            value={baseURL}
            placeholder="https://…/v1"
            spellCheck={false}
            onChange={(e) => {
              setBaseURL(e.target.value);
              setStatus({ kind: 'idle' });
            }}
          />
        </Field>
      </div>

      <Field
        label={keyRequired ? t('connections.fields.apiKey') : t('connections.fields.apiKeyOptional')}
        htmlFor="apiKey"
        hint={
          <>
            {t('connections.keyHint')}{' '}
            {keyUrl && (
              <a href={keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent">
                {t('connections.getKey')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </>
        }
      >
        <div className="flex gap-2">
          <input
            id="apiKey"
            type={showKey ? 'text' : 'password'}
            className={inputClass}
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={initial ? t('connections.keyKeep') : ''}
            onChange={(e) => {
              setApiKey(e.target.value);
              setStatus({ kind: 'idle' });
            }}
          />
          <Button className="h-9 w-9 px-0" aria-label={showKey ? t('connections.hideKey') : t('connections.showKey')} onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </Field>

      {preset?.hintKey && (
        <p className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-xs leading-relaxed">{t(preset.hintKey)}</p>
      )}

      <TestStatus status={status} />

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="primary" disabled={busy} onClick={() => void handleSave()}>
          {t('common.save')}
        </Button>
        <Button disabled={busy} onClick={() => void handleTest()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('connections.test')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

function TestStatus({ status }: { status: Status }) {
  const { t } = useTranslation();
  if (status.kind === 'invalid') {
    return <p className="text-sm text-danger">{t(status.messageKey)}</p>;
  }
  if (status.kind !== 'tested') return null;
  const { result } = status;
  if (result.ok) {
    return (
      <p className="flex animate-fade-in items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-sm font-medium text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t('connections.testOk', { count: result.models.length })}
      </p>
    );
  }
  return <TestError error={result.error!} />;
}

function TestError({ error }: { error: ErrorInfo }) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-in rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm">
      <p className="flex items-center gap-2 font-medium text-danger">
        <XCircle className="h-4 w-4 shrink-0" />
        {errorSummary(t, error)}
      </p>
      {error.code === 'notFound' && <p className="mt-1">{t('connections.noModelsEndpoint')}</p>}
      <p className="mt-1 break-all font-mono text-xs text-muted">{error.message}</p>
    </div>
  );
}
