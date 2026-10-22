import { describe, expect, it } from 'vitest';
import { parseKeyCombo } from '../../src/agent/keys';
import type { TargetInfo } from '../../src/agent/page/types';
import { decide, policyFor } from '../../src/agent/policy';
import { classifyAction } from '../../src/agent/risk';
import { buildSearchUrl } from '../../src/agent/search';
import { DEFAULT_AGENT_SETTINGS } from '../../src/storage/settings';

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

  it('treats real links as navigation', () => {
    expect(clickRisk({ tag: 'a', text: 'Buy now', href: 'https://shop.example/checkout' }).risk).toBe(1);
    expect(clickRisk({ tag: 'a', text: 'Buy now' }).risk).toBe(3);
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
    for (const tool of ['scroll', 'extract', 'look', 'web_search', 'done']) expect(classifyAction(tool, {}).risk).toBe(0);
    expect(classifyAction('navigate', { url: 'https://x' }).risk).toBe(1);
  });
});

describe('site policies', () => {
  const policies = { 'rogers.com': 'readOnly', 'shop.rogers.com': 'auto', 'bank.example': 'blocked' } as const;

  it('matches subdomains, preferring the most specific entry', () => {
    expect(policyFor('www.rogers.com', policies)).toBe('readOnly');
    expect(policyFor('shop.rogers.com', policies)).toBe('auto');
    expect(policyFor('notrogers.com', policies)).toBe('confirmRisky');
  });

  it('decides per risk level', () => {
    expect(decide('confirmRisky', 1, { isNavigation: false })).toBe('allow');
    expect(decide('confirmRisky', 2, { isNavigation: false })).toBe('confirm');
    expect(decide('auto', 2, { isNavigation: false })).toBe('allow');
    expect(decide('auto', 3, { isNavigation: false })).toBe('confirm');
    expect(decide('confirmEach', 1, { isNavigation: false })).toBe('confirm');
    expect(decide('readOnly', 1, { isNavigation: true })).toBe('allow');
    expect(decide('readOnly', 1, { isNavigation: false })).toBe('deny');
    expect(decide('blocked', 1, { isNavigation: true })).toBe('deny');
    expect(decide('blocked', 0, { isNavigation: false })).toBe('allow');
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
    expect(buildSearchUrl(DEFAULT_AGENT_SETTINGS, 'usb c', 'fr')).toBe('https://www.google.com/search?q=usb%20c&hl=fr');
    expect(buildSearchUrl({ ...DEFAULT_AGENT_SETTINGS, searchEngine: 'duckduckgo' }, 'a&b', 'en')).toBe(
      'https://html.duckduckgo.com/html/?q=a%26b',
    );
    expect(
      buildSearchUrl({ ...DEFAULT_AGENT_SETTINGS, searchEngine: 'custom', customSearchUrl: 'https://s.example/?q=%s' }, 'x y', 'en'),
    ).toBe('https://s.example/?q=x%20y');
  });
});
