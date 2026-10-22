/** Accessible on/off switch. */
export function Switch({ id, checked, disabled, onChange }: {
  id?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-45 ${
        checked ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-soft transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
