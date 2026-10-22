import type { LucideIcon } from 'lucide-react';
import { Switch } from '../../src/ui/Switch';
import type { ReactNode } from 'react';

export function Section({ title, description, actions, children }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Default padding only when the caller sets none (Tailwind can't override by class order).
  const padding = /(^|\s)p-\S+/.test(className) ? '' : 'p-4';
  return <div className={`rounded-xl border border-line bg-surface shadow-soft ${padding} ${className}`}>{children}</div>;
}

export function Field({ label, hint, htmlFor, children }: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg shadow-soft transition-colors placeholder:text-faint hover:border-line-strong focus:border-accent/60 focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-50';

/** Small square icon badge used at the start of cards. */
export function IconBadge({ icon: Icon, className = '' }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ${className}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function Toggle({ id, checked, disabled, onChange, label, hint }: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-60' : ''}`}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** A radio choice shown as a card with a title and a description. */
export function ChoiceCard({ name, value, checked, onChange, icon: Icon, title, description, testId }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
        checked ? 'border-accent/50 bg-accent-soft/60' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 accent-[var(--accent)]" />
      {Icon && (
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-accent text-on-accent' : 'bg-subtle text-muted'}`}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </span>
    </label>
  );
}
