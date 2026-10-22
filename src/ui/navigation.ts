import { browser } from 'wxt/browser';

export type OptionsSection = 'providers' | 'models' | 'sites' | 'language' | 'about';

export function openOptions(section: OptionsSection = 'providers'): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${section}`) });
}
