import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent shadow-soft hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-fg shadow-soft hover:border-line-strong hover:bg-subtle',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'border border-line bg-surface text-danger shadow-soft hover:border-danger/40 hover:bg-danger-soft',
  soft: 'bg-accent-soft text-accent hover:bg-accent-soft-strong',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1 rounded-md px-2.5 text-xs',
  md: 'h-8 gap-1.5 rounded-lg px-3 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

/** Small round brand mark used in headers and empty states. */
export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'md' ? 'h-7 w-7 rounded-lg' : 'h-6 w-6 rounded-md';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${box}`}>
      <img src="/icon/128.png" alt="" className="h-full w-full" />
    </span>
  );
}
