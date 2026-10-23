import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

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

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: e2eGrantAllHosts ? '.output-e2e' : '.output',
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    action: {
      default_title: '__MSG_actionTitle__',
    },
    permissions: [
      'sidePanel',
      'storage',
      'scripting',
      'activeTab',
      'tabs',
      'tabGroups',
      'notifications',
      // Favicons through Chrome's local service, so our pages never load remote images.
      'favicon',
      ...(enableCdpDriver ? ['debugger'] : []),
    ],
    // Our pages load scripts and images only from the extension itself. Model
    // output can therefore never make the side panel contact a server, e.g.
    // through an image URL carrying your data (§8.2).
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: blob:",
    },
    // Site access is requested at runtime, per site or for all sites (§6).
    optional_host_permissions: ['<all_urls>'],
    ...(e2eGrantAllHosts ? { host_permissions: ['<all_urls>'] } : {}),
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __ENABLE_CDP_DRIVER__: JSON.stringify(enableCdpDriver),
    },
  }),
});
