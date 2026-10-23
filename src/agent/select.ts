/** How select_option picks an option, shared by the page script and the risk check. */
export interface OptionInfo {
  text: string;
  value: string;
}

export function matchOption<T extends OptionInfo>(options: T[], option: string): T | undefined {
  const wanted = option.trim().toLowerCase();
  return (
    options.find((o) => o.text.trim().toLowerCase() === wanted) ??
    options.find((o) => o.value.toLowerCase() === wanted) ??
    options.find((o) => o.text.toLowerCase().includes(wanted))
  );
}
