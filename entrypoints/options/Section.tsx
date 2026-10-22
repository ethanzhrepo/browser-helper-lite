import type { LucideIcon } from 'lucide-react';
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
