import { registerAgentService } from '../src/background/agent-service';
import { registerRuntimeHandlers } from '../src/background/runtime-handlers';
import { restrictStorage } from '../src/background/trust';
import { openPanel } from '../src/browser/side-panel';

export default defineBackground(() => {
  void restrictStorage();
  // Clicking the toolbar icon opens the side panel on that tab only (§4.7).
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) openPanel(tab.id).catch(console.error);
  });
  registerRuntimeHandlers();
  registerAgentService();
});
