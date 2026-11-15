import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'wxt';
import { thirdPartyLicenses } from './scripts/third-party-licenses';

/**
 * Build flag: when true (default) the manifest declares the `debugger`
 * permission so the agent can drive pages through CDP (trusted input events).
 * Build with `ENABLE_CDP_DRIVER=false` to drop it, e.g. for a store build.
 * See docs/product-design.md §7.4.
 */
const enableCdpDriver = process.env.ENABLE_CDP_DRIVER !== 'false';

/**
 * Test-only: grant every host at install so Playwright never meets Chrome's
 * permission prompt, which it cannot click. Never set this for real builds.
 */
const e2eGrantAllHosts = process.env.E2E_GRANT_ALL_HOSTS === 'true';

/**
 * Our pages load scripts, styles, images, fonts and media only from the
 * extension itself, and embed no frames or plugins. Model output can therefore
 * never make the side panel contact a server, e.g. through an image or a
 * stylesheet URL carrying your data (§8.2). `default-src` covers whatever is
 * not listed. Requests made by our own code go to the provider you configure:
 * any https address, or http for a model on your own machine or network.
 */
function extensionPagesCsp(dev: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Mermaid and KaTeX style their output inline; stylesheets from elsewhere stay blocked.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' https: http:${dev ? ' ws://localhost:*' : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: e2eGrantAllHosts ? '.output-e2e' : '.output',
  manifest: ({ command }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // sidePanel.open() for a single tab (background.ts, §4.7).
    minimum_chrome_version: '116',
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // Opens the side panel on the current tab, like a click on the toolbar button.
    // Change it under chrome://extensions/shortcuts.
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+H' },
      },
    },
    permissions: [
      'sidePanel',
      'storage',
      'scripting',
      'activeTab',
      'tabs',
      'tabGroups',
      'notifications',
      // Timers for watched pages: they wake the extension to look at a page again.
      'alarms',
      // "Ask about the selection" and "Summarize this page" in the page's right-click menu.
      'contextMenus',
      // Favicons through Chrome's local service, so our pages never load remote images.
      'favicon',
      ...(enableCdpDriver ? ['debugger'] : []),
    ],
    content_security_policy: {
      extension_pages: extensionPagesCsp(command === 'serve'),
    },
    // Site access is requested at runtime, per site or for all sites (§6).
    optional_host_permissions: ['<all_urls>'],
    ...(e2eGrantAllHosts ? { host_permissions: ['<all_urls>'] } : {}),
  }),
  hooks: {
    // No global side panel, which would show on every tab: it opens per tab,
    // from the toolbar button (background.ts, §4.7).
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.side_panel;
    },
    // The license, and the notices of the dependencies bundled into it, ship
    // with every build anyone could pass on.
    'build:publicAssets': (wxt, files) => {
      files.push({ absoluteSrc: path.resolve('LICENSE'), relativeDest: 'LICENSE' });
      if (wxt.config.command === 'build') {
        files.push({ contents: thirdPartyLicenses(), relativeDest: 'THIRD_PARTY_LICENSES.txt' });
      }
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __ENABLE_CDP_DRIVER__: JSON.stringify(enableCdpDriver),
      // Test builds never look for updates: tests must not depend on the network.
      __AUTO_UPDATE_CHECK__: JSON.stringify(!e2eGrantAllHosts),
      __IP_REGION_LOOKUP__: JSON.stringify(!e2eGrantAllHosts),
    },
  }),
});
