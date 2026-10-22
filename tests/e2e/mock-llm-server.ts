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

export interface ChatRequest {
  model: string;
  stream: boolean;
  messages: { role: string; content: string }[];
}

/**
 * Minimal OpenAI-compatible server: /v1/models, streaming
 * /v1/chat/completions, and a test page. No CORS headers on purpose, so the
 * extension must rely on its host permission like it does for real providers.
 */
export async function startMockServer() {
  const chatRequests: ChatRequest[] = [];

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });

  const server: Server = createServer(async (req, res) => {
    const authorized = req.headers.authorization === `Bearer ${MOCK_KEY}`;
    if (req.url === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TEST_PAGE_HTML);
      return;
    }
    if (req.url === '/v1/models' && req.method === 'GET') {
      if (!authorized) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"Invalid API key"}}');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: MOCK_MODEL }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      if (!authorized) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"Invalid API key"}}');
      chatRequests.push(JSON.parse(await readBody(req)) as ChatRequest);
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
