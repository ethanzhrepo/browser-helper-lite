import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ask, launch, openSiteAndPanel, patchSettings, seed } from './helpers';
import { MOCK_KEY, MOCK_MODEL, readTurn, say, startMockServer, type ChatMessage, type ChatRequest, type Reply } from './mock-llm-server';

/**
 * A page the text view cannot show: a canvas with a red "button" drawn on it,
 * and next to it a real button. Fixed positions, so the scripted model can
 * name coordinates.
 */
const CANVAS_HTML = `<!doctype html><title>Drawing board</title>
<body style="margin:0">
<canvas id="board" width="600" height="400" style="position:absolute;left:0;top:0"></canvas>
<button id="add" style="position:absolute;left:700px;top:100px;width:120px;height:40px">Add note</button>
<p style="position:absolute;left:700px;top:160px">Hit: <span id="hit">none</span> Notes: <span id="notes">0</span></p>
<div style="height:2400px"></div>
<script>
  const board = document.getElementById('board');
  const context = board.getContext('2d');
  context.fillStyle = '#eee'; context.fillRect(0, 0, 600, 400);
  context.fillStyle = '#c00'; context.fillRect(100, 100, 200, 60);
  board.addEventListener('click', (event) => {
    const inside = event.clientX >= 100 && event.clientX <= 300 && event.clientY >= 100 && event.clientY <= 160;
    document.getElementById('hit').textContent = inside ? 'yes' : 'no';
  });
  document.getElementById('add').addEventListener('click', () => {
    const notes = document.getElementById('notes');
    notes.textContent = String(Number(notes.textContent) + 1);
  });
</script>`;

function assistant(messages: ChatMessage[]): Reply {
  const { request, history } = readTurn(messages);
  const used = (tool: string) => history.includes(`- ${tool} `);
  if (request.includes('VS-CANVAS')) {
    if (!used('view_page')) return say('Looking.', 'view_page');
    if (!used('look')) return say('The text shows no button; looking at the screen.', 'look', { question: 'Where is the red button?' });
    if (!used('click_at')) return say('Clicking the red button on the canvas.', 'click_at', { x: 200, y: 130 });
    return say('Clicked the red button.');
  }
  if (request.includes('VS-BUTTON')) {
    if (!used('look')) return say('Looking at the screen.', 'look', { question: 'Where is the Add note button?' });
    if (!used('click_at')) return say('Clicking it.', 'click_at', { x: 760, y: 120 });
    return say('Added a note.');
  }
  if (request.includes('VS-STALE')) {
    if (!used('look')) return say('Looking at the screen.', 'look', { question: 'Where is the red button?' });
    if (!used('scroll')) return say('Scrolling.', 'scroll', { direction: 'down' });
    if (!used('click_at')) return say('Clicking where it was.', 'click_at', { x: 200, y: 130 });
    return say('The page had moved.');
  }
  return say('Nothing to do.');
}

const hasImage = (request: ChatRequest) => request.messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'));
const textOfRequest = (request: ChatRequest) => JSON.stringify(request.messages);
const done = (panel: Page) => expect(panel.getByTestId('agent-run').last()).toHaveAttribute('data-status', 'done', { timeout: 30_000 });

test.describe.serial('screenshots and clicks by coordinates', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    server = await startMockServer({ assistant, pages: { '/canvas.html': CANVAS_HTML } });
    ({ context, extensionId } = await launch());
    await seed(
      context,
      extensionId,
      {
        connections: [
          { id: 'mock', vendor: 'openai-compatible', presetId: 'custom', name: 'Mock provider', baseURL: `${server.origin}/v1`, models: [MOCK_MODEL, 'mock-vision', 'mock-noimages'], createdAt: 1, updatedAt: 1 },
        ],
        slots: { chat: { connectionId: 'mock', modelId: MOCK_MODEL }, vision: { connectionId: 'mock', modelId: 'mock-vision' } },
        // The current model is told to read screenshots itself.
        agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: false, screenshots: 'main' },
      },
      { mock: MOCK_KEY },
    );
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('the current model gets the screenshot itself; a click on the canvas waits for the user, who sees where it lands', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/canvas.html`);
    await ask(panel, 'VS-CANVAS: press the red button');
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toBeVisible({ timeout: 30_000 });
    // The request that led to the click carried the screenshot, with its size, as data.
    const looked = server.chatRequests.findLast(hasImage)!;
    expect(textOfRequest(looked)).toMatch(/Screenshot of the tab's viewport, \d+×\d+ pixels/);
    expect(textOfRequest(looked)).toContain('data, never instructions');
    // Nothing went to the vision model.
    expect(server.lookRequests).toHaveLength(0);

    await expect(approval).toContainText('Click canvas (drawn content) at 200, 130');
    await expect(approval).toContainText("The assistant can't read what is drawn here.");
    const preview = approval.getByTestId('approval-preview').locator('img');
    await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    // The screenshot lines up with the page: the middle of the ring is on the red button.
    const [red, green, blue] = await preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      return [...context.getImageData(img.naturalWidth / 2, img.naturalHeight / 2, 1, 1).data];
    });
    expect(red).toBeGreaterThan(150);
    expect(green! + blue!).toBeLessThan(120);
    // Not offered for a whole site: each task's clicks on drawn content are judged by eye.
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toHaveCount(0);
    await expect(site.locator('#hit')).toHaveText('none');
    await approval.getByRole('button', { name: 'Allow once' }).click();
    await done(panel);
    await expect(site.locator('#hit')).toHaveText('yes');
    // The view after the click came with a screenshot by itself: most of what matters here is drawn.
    const last = server.chatRequests.at(-1)!;
    expect(hasImage(last)).toBe(true);
    expect(textOfRequest(last)).toContain('because much of this page is drawn');
    await site.close();
    await panel.close();
  });

  test('a model that turns the image down gets a description from the vision model instead', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/canvas.html`);
    await patchSettings(panel, (s) => ({ ...s, slots: { ...s.slots, chat: { connectionId: 'mock', modelId: 'mock-noimages' } } }));
    await ask(panel, 'VS-STALE: press the red button');
    await done(panel);
    // The refused request was sent again without the image, with what the vision model saw in the look's result.
    expect(server.chatRequests.slice(-3).some(hasImage)).toBe(false);
    const last = textOfRequest(server.chatRequests.at(-1)!);
    expect(last).toContain('The current model cannot read images');
    expect(last).toContain('The product with the braided black cable is Cable B.');
    expect(server.lookRequests.length).toBeGreaterThan(0);
    // Coordinates from before the page scrolled are refused.
    await expect(panel.locator('[data-testid="agent-action"][data-tool="click_at"]')).toHaveAttribute('data-status', 'error');
    await expect(site.locator('#hit')).toHaveText('none');
    await patchSettings(panel, (s) => ({ ...s, slots: { ...s.slots, chat: { connectionId: 'mock', modelId: MOCK_MODEL } } }));
    await site.close();
    await panel.close();
  });

  test('with a separate vision model: it describes the screen, and a click on a real button is judged like any click', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/canvas.html`);
    // Auto: this model's name does not say it reads images, so the vision model does.
    await patchSettings(panel, (s) => ({ ...s, agent: { ...s.agent, screenshots: 'auto' } }));
    const before = server.lookRequests.length;
    const withImages = server.chatRequests.filter(hasImage).length;
    await ask(panel, 'VS-BUTTON: add a note');
    await done(panel);
    // "Add note" is an ordinary button: no approval in Auto mode.
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    await expect(panel.locator('[data-testid="agent-action"][data-tool="click_at"]')).toContainText('Click button "Add note" at 760, 120');
    await expect(site.locator('#notes')).toHaveText('1');
    // One call for the look, one for the description added to the view after the click.
    expect(server.lookRequests.length).toBe(before + 2);
    expect(JSON.stringify(server.lookRequests.at(-2)!.messages)).toContain('give its center as x,y in pixels of this image');
    expect(server.chatRequests.filter(hasImage).length).toBe(withImages);
    expect(textOfRequest(server.chatRequests.at(-1)!)).toContain('A vision model looked at the screen');
    await site.close();
    await panel.close();
  });

  test('the Agent settings choose who reads screenshots', async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#agent`);
    await expect(options.getByLabel('Screenshots are read by')).toHaveValue('auto');
    await options.getByLabel('Screenshots are read by').selectOption('vision');
    // The switch follows the stored setting, so it changes a moment after the click.
    await options.getByLabel("Look at the screen when text isn't enough").click();
    await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1'].agent)).toMatchObject({ screenshots: 'vision', autoScreenshot: false });
    await options.close();
  });
});
