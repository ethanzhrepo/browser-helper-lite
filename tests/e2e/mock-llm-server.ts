import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MOCK_MODEL = 'mock-model';
export const MOCK_KEY = 'test-key';
/** Streamed in pieces; rendered as Markdown with a table. */
export const MOCK_REPLY = [
  'Based on **Mobile Plans Test**:\n\n',
  '| Plan | Price | Data | US roaming |\n',
  '|---|---|---|---|\n',
  '| A | $40/mo | 50 GB | No |\n',
  '| B | $65/mo | Unlimited | Yes |\n\n',
  '**Plan B** is the one that ',
  'includes US roaming.',
];

export const TEST_PAGE_HTML = `<!doctype html>
<html lang="en"><head><title>Mobile Plans Test</title></head>
<body><main><article>
<h1>Mobile plans</h1>
<p>${'Pick the plan that suits you. '.repeat(20)}</p>
<h2>Plan A</h2><p>Plan A costs $40 per month and includes 50 GB of data.</p>
<h2>Plan B</h2><p>Plan B costs $65 per month and includes unlimited data in Canada and the US.</p>
<p id="selectable">Roaming in the US is included with Plan B.</p>
</article></main></body></html>`;

type Content = string | { type: string; text?: string; image_url?: { url: string } }[];

export interface ChatRequest {
  model: string;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  messages: { role: string; content: Content }[];
}

export const SHOP_HTML = `<!doctype html>
<html lang="en"><head><title>Test Shop</title>
<style>.card{border:1px solid #ccc;margin:8px;padding:8px;width:220px;display:inline-block}</style></head>
<body><h1>Test Shop</h1>
<form id="search"><input name="q" placeholder="Search products"><button>Search</button></form>
<p id="cart">Cart: 0 items</p>
<div id="results"></div>
<script>
  const products = [
    { name: 'Cable A', price: '$9.99', alt: 'Plain white cable' },
    { name: 'Cable B', price: '$5.49', alt: 'Braided black cable' },
  ];
  let count = 0;
  document.getElementById('search').addEventListener('submit', (event) => {
    event.preventDefault();
    const results = document.getElementById('results');
    results.innerHTML = products.map((p) =>
      '<div class="card"><h3>' + p.name + '</h3><p>' + p.price + '</p><p>' + p.alt + '</p>' +
      '<button aria-label="Add ' + p.name + ' to cart">Add to cart</button></div>').join('');
    for (const button of results.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        count += 1;
        document.getElementById('cart').textContent = 'Cart: ' + count + ' item' + (count === 1 ? '' : 's');
      });
    }
  });
</script></body></html>`;

export const PARK_HTML = `<!doctype html>
<html lang="en"><head><title>Test Park day pass</title></head>
<body><h1>Test Park day pass</h1>
<div class="g-recaptcha" id="captcha" style="padding:20px;border:1px solid #999;width:260px">
  <button id="robot">I'm not a robot</button>
</div>
<form id="booking" hidden>
  <label>Date <select id="date"><option value="">Choose a date</option><option>Nov 2</option><option>Nov 3</option></select></label>
  <button type="button" id="continue">Continue</button>
</form>
<section id="payment" hidden><p>Total: $25 for <span id="chosen"></span></p><button id="pay">Pay now</button></section>
<p id="paid" hidden>Payment complete</p>
<script>
  document.getElementById('robot').addEventListener('click', () => {
    document.getElementById('captcha').remove();
    document.getElementById('booking').hidden = false;
  });
  document.getElementById('continue').addEventListener('click', () => {
    const date = document.getElementById('date').value;
    if (!date) return;
    document.getElementById('booking').hidden = true;
    document.getElementById('payment').hidden = false;
    document.getElementById('chosen').textContent = date;
  });
  document.getElementById('pay').addEventListener('click', () => { document.getElementById('paid').hidden = false; });
</script></body></html>`;

const searchHtml = (origin: string, query: string) => `<!doctype html>
<html lang="en"><head><title>${query} - Test Search</title></head><body>
<a href="${origin}/review.html"><h3>USB-C cable buying guide</h3></a><p>Braided cables last longer than plain ones.</p>
<a href="${origin}/shop.html"><h3>Test Shop – cables</h3></a><p>Cables from $5.</p>
</body></html>`;

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

const textOf = (content: Content | undefined): string =>
  typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('\n');

const section = (prompt: string, name: string) => new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(prompt)?.[1] ?? '';

function indexOf(state: string, pattern: RegExp): number {
  const match = pattern.exec(state);
  if (!match) throw new Error(`Mock agent: no element matching ${pattern} in state:\n${state}`);
  return Number(match[1]);
}

/** Scripted agent: picks the next tool call from the task, history and state. */
export function scriptedAgent(prompt: string): { thought: string; calls: ToolCall[] } {
  const task = section(prompt, 'task');
  const history = section(prompt, 'history');
  const state = section(prompt, 'state');
  const call = (thought: string, name: string, args: Record<string, unknown> = {}) => ({ thought, calls: [{ name, args }] });

  if (task.includes('TEST-SHOP')) {
    if (!history.includes('- web_search')) return call('I will check reviews first.', 'web_search', { query: 'best usb-c cable' });
    if (!history.includes('- type ')) {
      return call('Searching the shop.', 'type', { index: indexOf(state, /\[(\d+)\]<input[^\n]*placeholder="Search products"/), text: 'usb-c cable', submit: true });
    }
    if (!history.includes('- extract ')) return call('Reading prices.', 'extract', { query: 'product names and prices' });
    if (!history.includes('- look ')) return call('Checking the pictures.', 'look', { question: 'Which cable looks braided?' });
    if (!/- click \[\d+\] button "Add Cable B to cart" → ok/.test(history)) {
      return call('Adding the cheapest braided cable.', 'click', { index: indexOf(state, /\[(\d+)\]<button[^\n]*aria-label="Add Cable B to cart"/) });
    }
    return call('Done.', 'done', {
      success: true,
      summary: 'Added **Cable B** ($5.49) to the cart.\n\n| Cable | Price |\n|---|---|\n| Cable A | $9.99 |\n| Cable B | $5.49 |',
    });
  }

  if (task.includes('TEST-PARK')) {
    if (!history.includes('- ask_user')) return call('I need a date.', 'ask_user', { question: 'Which date would you like: Nov 2 or Nov 3?' });
    const answer = /The user answered: (.+)/.exec(history)?.[1]?.trim() ?? 'Nov 3';
    if (!history.includes('- select_option')) {
      return call('Choosing the date.', 'select_option', { index: indexOf(state, /\[(\d+)\]<select/), option: answer });
    }
    if (!/button "Continue" → ok/.test(history)) {
      return call('Continuing.', 'click', { index: indexOf(state, /\[(\d+)\]<button[^\n]*>Continue<\/button>/) });
    }
    if (!history.includes('rejected')) {
      return call('Trying to pay.', 'click', { index: indexOf(state, /\[(\d+)\]<button[^\n]*>Pay now<\/button>/) });
    }
    return call('Stopping before payment.', 'done', {
      success: true,
      summary: `Your day pass for **${answer}** costs $25. I stopped at the payment step; please pay yourself.`,
    });
  }

  // TEST-STOP and anything else: keep waiting until stopped.
  return call('Waiting.', 'wait', { seconds: 1 });
}

function completion(content: string | null, calls: ToolCall[] = []) {
  return JSON.stringify({
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: MOCK_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(calls.length > 0
            ? { tool_calls: calls.map((c, i) => ({ id: `call_${Date.now()}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
            : {}),
        },
        finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
  });
}

/**
 * Minimal OpenAI-compatible server: /v1/models, streaming
 * /v1/chat/completions, and a test page. No CORS headers on purpose, so the
 * extension must rely on its host permission like it does for real providers.
 */
export async function startMockServer() {
  const chatRequests: ChatRequest[] = [];
  const agentRequests: ChatRequest[] = [];
  const extractRequests: ChatRequest[] = [];
  const lookRequests: ChatRequest[] = [];

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });

  const server: Server = createServer(async (req, res) => {
    const authorized = req.headers.authorization === `Bearer ${MOCK_KEY}`;
    const html = (body: string) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    if (req.url === '/page.html') return void html(TEST_PAGE_HTML);
    if (req.url === '/shop.html') return void html(SHOP_HTML);
    if (req.url === '/park.html') return void html(PARK_HTML);
    if (req.url === '/review.html') return void html('<!doctype html><title>Guide</title><p>Braided cables last longer.</p>');
    if (req.url?.startsWith('/search')) {
      const query = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
      return void html(searchHtml(`http://${req.headers.host}`, query));
    }
    if (req.url === '/v1/models' && req.method === 'GET') {
      if (!authorized) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"Invalid API key"}}');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: MOCK_MODEL }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      if (!authorized) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"Invalid API key"}}');
      const body = JSON.parse(await readBody(req)) as ChatRequest;
      const json = (text: string) => res.writeHead(200, { 'content-type': 'application/json' }).end(text);
      if (body.tools) {
        agentRequests.push(body);
        const { thought, calls } = scriptedAgent(textOf(body.messages.at(-1)?.content));
        return void json(completion(thought, calls));
      }
      if (textOf(body.messages[0]?.content).includes('You extract information')) {
        extractRequests.push(body);
        return void json(completion('Cable A: $9.99 (plain white). Cable B: $5.49 (braided black).'));
      }
      if (body.messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'))) {
        lookRequests.push(body);
        return void json(completion('The product with the braided black cable is Cable B.'));
      }
      chatRequests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: MOCK_MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }));
      for (const piece of MOCK_REPLY) {
        res.write(chunk({ content: piece }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      res.write(chunk({}, 'stop'));
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: MOCK_MODEL, choices: [], usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 } })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    chatRequests,
    agentRequests,
    extractRequests,
    lookRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
