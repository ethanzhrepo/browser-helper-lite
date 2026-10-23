import { describe, expect, it } from 'vitest';
import { parseKeyCombo } from '../../src/agent/keys';
import type { TargetInfo } from '../../src/agent/page/types';
import { decide, modeDecision, policyFor, siteDecision } from '../../src/agent/policy';
import { actionKind, classifyAction } from '../../src/agent/risk';
import { buildSearchUrl } from '../../src/search/search';
import { DEFAULT_SEARCH_SETTINGS } from '../../src/storage/settings';

const target = (overrides: Partial<TargetInfo> = {}): TargetInfo => ({
  tag: 'button',
  text: '',
  inForm: false,
  isSubmit: false,
  isPassword: false,
  isPaymentField: false,
  isOneTimeCode: false,
  isSelect: false,
  isSearchField: false,
  editable: false,
  disabled: false,
  label: 'button',
  ...overrides,
});

const clickRisk = (overrides: Partial<TargetInfo>) => classifyAction('click', { index: 1 }, target(overrides));

describe('classifyAction', () => {
  it('rates payments and destructive buttons as high risk in every UI language', () => {
    for (const text of ['Pay now', 'Place order', 'Payer maintenant', 'Realizar pedido', '确认付款', '立即购买']) {
      expect(clickRisk({ text }), text).toMatchObject({ risk: 3, reason: 'payment' });
    }
    for (const text of ['Delete account', 'Supprimer', 'Eliminar', '删除']) {
      expect(clickRisk({ text }), text).toMatchObject({ risk: 3, reason: 'destructive' });
    }
  });

  it('rates submitting, sending and adding to cart as effects', () => {
    for (const text of ['Add to cart', 'Ajouter au panier', 'Añadir al carrito', '加入购物车', 'Send', 'Réserver']) {
      expect(clickRisk({ text }), text).toMatchObject({ risk: 2 });
    }
    expect(clickRisk({ text: 'Go', isSubmit: true })).toMatchObject({ risk: 2, reason: 'submit' });
  });

  it('matches whole words only', () => {
    expect(clickRisk({ text: 'Display settings' }).risk).toBe(1);
    expect(clickRisk({ text: 'PayPal help' }).risk).toBe(1);
    expect(clickRisk({ text: 'Next' }).risk).toBe(1);
  });

  it('treats real links as navigation, unless their text says otherwise', () => {
    expect(clickRisk({ tag: 'a', text: 'Plan details', href: 'https://shop.example/plans' }).risk).toBe(1);
    // GET links can delete or pay too.
    expect(clickRisk({ tag: 'a', text: 'Buy now', href: 'https://shop.example/checkout' }).risk).toBe(3);
    expect(clickRisk({ tag: 'a', text: 'Delete account', href: 'https://shop.example/account/delete' }).risk).toBe(3);
    expect(clickRisk({ tag: 'a', text: 'Buy now' }).risk).toBe(3);
  });

  it('judges a form submit by the form\'s submit button', () => {
    const coupon = target({ tag: 'input', inForm: true, editable: true, formSubmitText: 'Place order' });
    expect(classifyAction('type', { index: 1, text: 'SAVE10', submit: true }, coupon)).toMatchObject({ risk: 3, reason: 'payment' });
    expect(classifyAction('type', { index: 1, text: 'SAVE10', submit: true }, target({ tag: 'input', inForm: true, editable: true, formSubmitText: 'Apply' })).risk).toBe(2);
    expect(classifyAction('type', { index: 1, text: 'cables', submit: true }, target({ tag: 'input', inForm: true, editable: true, isSearchField: true, formSubmitText: 'Pay' })).risk).toBe(1);
  });

  it('judges key presses by what they act on', () => {
    const press = (keys: string, focused?: Partial<TargetInfo>) => classifyAction('press', { keys }, focused ? target(focused) : undefined);
    expect(press('Enter', { text: 'Place order' })).toMatchObject({ risk: 3, reason: 'payment' });
    expect(press('Space', { text: 'Delete account' })).toMatchObject({ risk: 3 });
    expect(press('Enter', { tag: 'input', editable: true, inForm: true, formSubmitText: 'Pay now' })).toMatchObject({ risk: 3 });
    expect(press('Enter', { tag: 'textarea', editable: true })).toMatchObject({ risk: 2 });
    expect(press('Control+V', { tag: 'input', editable: true })).toMatchObject({ risk: 3, reason: 'clipboard' });
    expect(press('Meta+V', { tag: 'textarea', editable: true })).toMatchObject({ risk: 3, reason: 'clipboard' });
    expect(press('Shift+Insert', { tag: 'input', editable: true })).toMatchObject({ risk: 3, reason: 'clipboard' });
    expect(press('Control+C', { tag: 'input', editable: true })).toMatchObject({ risk: 2 });
    expect(press('Control+A').risk).toBe(1);
    expect(press('Tab').risk).toBe(1);
    expect(press('Escape', { text: 'Pay now' }).risk).toBe(1);
    expect(press('Enter').risk).toBe(1);
  });

  it('applies the typing rules to single key presses', () => {
    const press = (keys: string, focused: Partial<TargetInfo>) => classifyAction('press', { keys }, target(focused));
    expect(press('a', { tag: 'input', editable: true, isPassword: true })).toMatchObject({ forbidden: 'password' });
    expect(press('4', { tag: 'input', editable: true, isPaymentField: true })).toMatchObject({ forbidden: 'payment' });
    expect(press('7', { tag: 'input', editable: true, isOneTimeCode: true })).toMatchObject({ forbidden: 'oneTimeCode' });
    // The last digit of a card number typed one key at a time.
    expect(press('1', { tag: 'input', editable: true, text: '411111111111111' })).toMatchObject({ forbidden: 'payment' });
    expect(press('1', { tag: 'input', editable: true, text: '41111' }).risk).toBe(1);
    expect(press('Tab', { tag: 'input', editable: true, isPassword: true }).risk).toBe(1);
  });

  it('checks the whole field value when text is appended', () => {
    const field = target({ tag: 'input', editable: true, text: '4111 1111 1111' });
    expect(classifyAction('type', { index: 1, text: ' 1111', clear: false }, field)).toMatchObject({ forbidden: 'payment' });
    expect(classifyAction('type', { index: 1, text: ' 1111' }, field).risk).toBe(1);
  });

  it('asks before typing keys or tokens anywhere', () => {
    const field = target({ tag: 'input', editable: true, label: 'input "Coupon"' });
    expect(classifyAction('type', { index: 1, text: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345' }, field)).toMatchObject({ risk: 3, reason: 'secret' });
    expect(classifyAction('type', { index: 1, text: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, field)).toMatchObject({ risk: 3, reason: 'secret' });
    expect(classifyAction('type', { index: 1, text: 'AKIAIOSFODNN7EXAMPLE' }, field)).toMatchObject({ risk: 3, reason: 'secret' });
    expect(classifyAction('type', { index: 1, text: 'task-force meeting notes' }, field).risk).toBe(1);
  });

  it('rates clicks and keys that land in another site\'s frame as high risk', () => {
    const framed = target({ tag: 'div', text: 'Continue', frameOrigin: 'https://pay.example' });
    expect(classifyAction('click', { index: 1 }, framed)).toMatchObject({ risk: 3, reason: 'frame' });
    const frame = target({ tag: 'iframe', frameOrigin: 'https://pay.example' });
    expect(classifyAction('press', { keys: 'Enter' }, frame)).toMatchObject({ risk: 3, reason: 'frame' });
    expect(classifyAction('press', { keys: 'x' }, frame)).toMatchObject({ risk: 3, reason: 'frame' });
    expect(classifyAction('press', { keys: 'Tab' }, frame).risk).toBe(1);
  });

  it('judges select_option by the option it will pick', () => {
    const select = target({
      tag: 'select',
      isSelect: true,
      options: [
        { text: 'Keep my account', value: 'keep' },
        { text: 'Delete my account', value: 'opt-2' },
      ],
    });
    expect(classifyAction('select_option', { index: 1, option: 'opt-2' }, select)).toMatchObject({ risk: 3, reason: 'destructive' });
    expect(classifyAction('select_option', { index: 1, option: 'keep' }, select).risk).toBe(1);
  });

  it('rates downloads by what they fetch', () => {
    expect(clickRisk({ tag: 'a', text: 'Get the app', href: 'https://x.example/files/setup.exe' })).toMatchObject({ risk: 3, reason: 'download' });
    expect(clickRisk({ tag: 'a', text: 'Source', href: 'https://x.example/src.tar.gz' })).toMatchObject({ risk: 2, reason: 'download' });
    expect(clickRisk({ tag: 'a', text: 'Report', href: 'https://x.example/report.pdf', download: true })).toMatchObject({ risk: 2, reason: 'download' });
    expect(clickRisk({ tag: 'a', text: 'Report', href: 'https://x.example/report.pdf' }).risk).toBe(1);
  });

  it('rates credential and account-security buttons as high risk', () => {
    for (const text of ['Generate new token', 'Revoke', 'Transfer ownership', 'Approve', 'Add to Chrome', '生成令牌', '关闭两步验证', 'Révoquer', 'Revocar']) {
      expect(clickRisk({ text }).risk, text).toBe(3);
    }
    // Undo in Chinese UIs is "撤销"; only revoking access counts.
    expect(clickRisk({ text: '撤销' }).risk).toBe(1);
  });

  it('sorts actions into browsing, searching and changing', () => {
    const link = target({ tag: 'a', text: 'Plans', href: 'https://x.example/plans' });
    const search = target({ tag: 'input', editable: true, isSearchField: true });
    expect(actionKind('click', { index: 1 }, link, classifyAction('click', { index: 1 }, link))).toBe('browse');
    expect(actionKind('press', { keys: 'Enter' }, link, classifyAction('press', { keys: 'Enter' }, link))).toBe('browse');
    expect(actionKind('type', { index: 1, text: 'x', submit: true }, search, classifyAction('type', { index: 1, text: 'x', submit: true }, search))).toBe('search');
    const payLink = target({ tag: 'a', text: 'Pay now', href: 'https://x.example/pay' });
    expect(actionKind('click', { index: 1 }, payLink, classifyAction('click', { index: 1 }, payLink))).toBe('change');
  });

  it('forbids typing secrets and flags typing that submits a form', () => {
    expect(classifyAction('type', { index: 1, text: 'x' }, target({ tag: 'input', isPassword: true })).forbidden).toBe('password');
    expect(classifyAction('type', { index: 1, text: 'x' }, target({ tag: 'input', isPaymentField: true })).forbidden).toBe('payment');
    expect(classifyAction('type', { index: 1, text: 'x', submit: true }, target({ tag: 'input', inForm: true })).risk).toBe(2);
    expect(classifyAction('type', { index: 1, text: 'hi', submit: true }, target({ tag: 'textarea' })).risk).toBe(2);
    expect(classifyAction('type', { index: 1, text: 'usb', submit: true }, target({ tag: 'input', inForm: true, isSearchField: true })).risk).toBe(1);
    expect(classifyAction('type', { index: 1, text: 'x' }, target({ tag: 'input', inForm: true })).risk).toBe(1);
  });

  it('keeps reading tools at risk 0', () => {
    for (const tool of ['read_page', 'view_page', 'scroll', 'extract', 'look', 'web_search']) expect(classifyAction(tool, {}).risk).toBe(0);
    expect(classifyAction('navigate', { url: 'https://x' }).risk).toBe(1);
  });
});

describe('site policies', () => {
  const policies = { 'rogers.com': 'readOnly', 'shop.rogers.com': 'auto', 'bank.example': 'blocked' } as const;

  it('matches subdomains, preferring the most specific entry', () => {
    expect(policyFor('www.rogers.com', policies)).toBe('readOnly');
    expect(policyFor('shop.rogers.com', policies)).toBe('auto');
    expect(policyFor('notrogers.com', policies)).toBeUndefined();
  });

  it('decides per risk level and kind of action', () => {
    expect(siteDecision(undefined, 2, 'change')).toBe('allow');
    expect(siteDecision('confirmRisky', 1, 'change')).toBe('allow');
    expect(siteDecision('confirmRisky', 2, 'change')).toBe('confirm');
    expect(siteDecision('auto', 2, 'change')).toBe('allow');
    expect(siteDecision('auto', 3, 'change')).toBe('confirm');
    expect(siteDecision('confirmEach', 1, 'change')).toBe('confirm');
    expect(siteDecision('confirmEach', 1, 'browse')).toBe('allow');
    expect(siteDecision('readOnly', 1, 'browse')).toBe('allow');
    expect(siteDecision('readOnly', 1, 'search')).toBe('allow');
    expect(siteDecision('readOnly', 1, 'change')).toBe('deny');
    expect(siteDecision('blocked', 1, 'browse')).toBe('deny');
    expect(siteDecision('blocked', 0, 'change')).toBe('allow');
  });
});

describe('modes', () => {
  it('query mode only reads, searches and follows links', () => {
    expect(modeDecision('query', 0, 'change')).toBe('allow');
    expect(modeDecision('query', 1, 'browse')).toBe('allow');
    expect(modeDecision('query', 1, 'search')).toBe('allow');
    expect(modeDecision('query', 1, 'change')).toBe('deny');
    expect(modeDecision('query', 2, 'change')).toBe('deny');
  });

  it('auto mode confirms only high-risk actions', () => {
    expect(modeDecision('auto', 1, 'change')).toBe('allow');
    expect(modeDecision('auto', 2, 'change')).toBe('allow');
    expect(modeDecision('auto', 3, 'change')).toBe('confirm');
  });

  it('manual mode confirms every change but not browsing', () => {
    expect(modeDecision('manual', 1, 'browse')).toBe('allow');
    expect(modeDecision('manual', 1, 'search')).toBe('allow');
    expect(modeDecision('manual', 1, 'change')).toBe('confirm');
    expect(modeDecision('manual', 2, 'change')).toBe('confirm');
  });

  it('combines mode and site policy: the stricter wins', () => {
    expect(decide('auto', 'blocked', 1, 'change')).toBe('deny');
    expect(decide('auto', 'confirmRisky', 2, 'change')).toBe('confirm');
    expect(decide('auto', 'readOnly', 1, 'change')).toBe('deny');
    expect(decide('query', 'auto', 2, 'change')).toBe('deny');
    expect(decide('auto', undefined, 2, 'change')).toBe('allow');
  });

  it('lets sites marked automatic skip manual approval, but never for high risk', () => {
    expect(decide('manual', 'auto', 2, 'change')).toBe('allow');
    expect(decide('manual', 'auto', 3, 'change')).toBe('confirm');
    expect(decide('manual', undefined, 2, 'change')).toBe('confirm');
    expect(decide('auto', 'auto', 3, 'change')).toBe('confirm');
  });
});

describe('parseKeyCombo', () => {
  it('parses named keys, letters and modifiers', () => {
    expect(parseKeyCombo('Enter')).toMatchObject({ key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: false });
    expect(parseKeyCombo('Control+a')).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
    expect(parseKeyCombo('Shift+Tab')).toMatchObject({ key: 'Tab', shiftKey: true });
  });
});

describe('buildSearchUrl', () => {
  it('builds engine URLs and custom templates', () => {
    expect(buildSearchUrl(DEFAULT_SEARCH_SETTINGS, 'usb c', 'fr')).toBe('https://www.google.com/search?q=usb%20c&hl=fr');
    expect(buildSearchUrl({ ...DEFAULT_SEARCH_SETTINGS, engine: 'duckduckgo' }, 'a&b', 'en')).toBe('https://html.duckduckgo.com/html/?q=a%26b');
    expect(buildSearchUrl({ ...DEFAULT_SEARCH_SETTINGS, engine: 'custom', customUrl: 'https://s.example/?q=%s' }, 'x y', 'en')).toBe(
      'https://s.example/?q=x%20y',
    );
  });
});
