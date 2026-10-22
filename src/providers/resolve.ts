import type { LanguageModel } from 'ai';
import type { Capability, Connection, ModelRef, Settings } from '../shared/types';
import { getApiKey } from '../storage/settings';
import { ConfigError } from './errors';
import { createLanguageModel, providerOptionsFor } from './language-model';
import { vendorRequiresKey } from './vendors';

export interface ResolvedModel {
  model: LanguageModel;
  ref: ModelRef;
  connection: Connection;
  providerOptions: ReturnType<typeof providerOptionsFor>;
}

export async function resolveModelRef(settings: Settings, ref: ModelRef): Promise<ResolvedModel> {
  const connection = settings.connections.find((c) => c.id === ref.connectionId);
  if (!connection || !ref.modelId) throw new ConfigError('noModel', `Unknown connection ${ref.connectionId}`);
  const apiKey = await getApiKey(connection.id);
  if (!apiKey && vendorRequiresKey(connection.vendor, connection.presetId)) {
    throw new ConfigError('noKey', connection.name);
  }
  return {
    model: createLanguageModel(connection, apiKey, ref.modelId),
    ref,
    connection,
    providerOptions: providerOptionsFor(connection),
  };
}

/** The first configured slot in order of preference, e.g. ['vision', 'agent', 'chat']. */
export function pickSlot(settings: Settings, preference: Capability[]): ModelRef | undefined {
  for (const capability of preference) {
    const slot = settings.slots[capability];
    if (slot?.connectionId && slot.modelId) return { connectionId: slot.connectionId, modelId: slot.modelId };
  }
  return undefined;
}
