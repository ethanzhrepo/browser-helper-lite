import { registerAgentService } from '../src/background/agent-service';
import { registerContextMenus } from '../src/background/menus';
import { registerRuntimeHandlers } from '../src/background/runtime-handlers';
import { registerWatchService } from '../src/background/watch-service';
import { restrictStorage } from '../src/background/trust';
import { moveLegacySkills } from '../src/skills/store';
import { openPanel } from '../src/browser/side-panel';
import { AUTO_UPDATE_CHECK } from '../src/shared/build-flags';
import { loadSettings } from '../src/storage/settings';
import { checkForUpdateIfDue, updatedByChrome } from '../src/updates/check';

export default defineBackground(() => {
  void restrictStorage();
  // Clicking the toolbar icon (or pressing its shortcut) opens the side panel on that tab only (§4.7).
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) openPanel(tab.id).catch(console.error);
  });
  // A fresh install has no model yet: open the settings where one is added.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/options.html?welcome=1#providers') });
  });
  // Skills installed with 0.3.0 move from the settings to the database.
  void moveLegacySkills().catch((error) => console.error('Could not move the installed skills', error));
  registerRuntimeHandlers();
  registerAgentService();
  registerContextMenus();
  registerWatchService();
  // Chrome never updates an unpacked extension, so look for a new release ourselves (at most daily).
  if (AUTO_UPDATE_CHECK && !updatedByChrome()) {
    void loadSettings().then((settings) => {
      if (settings.checkUpdates) void checkForUpdateIfDue();
    });
  }
});
