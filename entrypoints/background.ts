import { registerAgentService } from '../src/background/agent-service';
import { registerRuntimeHandlers } from '../src/background/runtime-handlers';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  registerRuntimeHandlers();
  registerAgentService();
});
