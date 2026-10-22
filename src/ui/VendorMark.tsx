import { findPreset, VENDORS } from '../providers/vendors';
import type { Connection } from '../shared/types';

/** Colored monogram per vendor (no logos). */
export const VENDOR_COLORS: Record<Connection['vendor'], string> = {
  openai: '#10a37f',
  anthropic: '#c96442',
  google: '#3b82f6',
  deepseek: '#4f6bed',
  'openai-compatible': '#5f6b73',
};

const SIZES = {
  xs: 'h-4 w-4 rounded text-[9px]',
  sm: 'h-5 w-5 rounded-md text-[10px]',
  md: 'h-9 w-9 rounded-xl text-sm shadow-soft',
} as const;

export function VendorMark({ connection, size = 'md' }: { connection: Pick<Connection, 'name' | 'vendor'>; size?: keyof typeof SIZES }) {
  const initial = (connection.name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${SIZES[size]}`}
      style={{ background: VENDOR_COLORS[connection.vendor] }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

export function vendorLabel(connection: Pick<Connection, 'vendor' | 'presetId'>): string {
  const preset = connection.vendor === 'openai-compatible' ? findPreset(connection.presetId) : undefined;
  return preset && preset.id !== 'custom' ? preset.label : VENDORS[connection.vendor].label;
}
