/** Key combinations like "Enter", "Control+A" or "Shift+Tab", shared by both drivers. */
export interface KeyCombo {
  key: string;
  code: string;
  /** Windows virtual key code, needed by CDP. */
  keyCode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  return: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

export function parseKeyCombo(keys: string): KeyCombo {
  const parts = keys.split('+').map((part) => part.trim()).filter(Boolean);
  const main = parts.pop() ?? '';
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  const named = NAMED_KEYS[main.toLowerCase()];
  let key = main;
  let code = main;
  let keyCode = 0;
  if (named) {
    ({ key, code, keyCode } = named);
  } else if (/^[a-z]$/i.test(main)) {
    code = `Key${main.toUpperCase()}`;
    keyCode = main.toUpperCase().charCodeAt(0);
  } else if (/^\d$/.test(main)) {
    code = `Digit${main}`;
    keyCode = main.charCodeAt(0);
  }
  return {
    key,
    code,
    keyCode,
    ctrlKey: modifiers.has('control') || modifiers.has('ctrl'),
    altKey: modifiers.has('alt'),
    shiftKey: modifiers.has('shift'),
    metaKey: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
  };
}
