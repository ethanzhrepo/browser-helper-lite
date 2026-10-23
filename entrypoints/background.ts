import { registerAgentService } from '../src/background/agent-service';
import { registerRuntimeHandlers } from '../src/background/runtime-handlers';
import { restrictStorage } from '../src/background/trust';

export default defineBackground(() => {
  void restrictStorage();
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  registerRuntimeHandlers();
  registerAgentService();
});
