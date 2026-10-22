import { describe, expect, it } from 'vitest';
import { parseKeyCombo } from '../../src/agent/keys';
import type { TargetInfo } from '../../src/agent/page/types';
import { decide, modeDecision, policyFor, siteDecision } from '../../src/agent/policy';
import { classifyAction } from '../../src/agent/risk';
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
