// Forwards chat requests to the real endpoint and writes down the end of each one, to see what a model was shown
// before it did something odd. Run it, then point the evaluation at it:
//
//   UPSTREAM=https://api.example.com/v1 LOG=/tmp/requests.log PORT=8791 node tests/eval/log-proxy.mjs &
//   EVAL_BASE_URL=http://127.0.0.1:8791/v1 EVAL_ONLY=shop-cart ... pnpm eval
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const [upstream, log, port] = [process.env.UPSTREAM, process.env.LOG, Number(process.env.PORT)];
writeFileSync(log, '');
http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.url.endsWith('/chat/completions')) {
      try {
        const messages = JSON.parse(body.toString()).messages;
        appendFileSync(log, `\n===== request with ${messages.length} messages =====\n${messages.slice(-2).map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}${m.tool_calls ? ` CALLS ${JSON.stringify(m.tool_calls.map((c) => c.function))}` : ''}`).join('\n')}\n`);
      } catch {}
    }
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const answer = await fetch(upstream + req.url.replace(/^\/v1/, ''), { method: req.method, headers, body: req.method === 'GET' ? undefined : body });
    res.writeHead(answer.status, Object.fromEntries([...answer.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name))));
    if (answer.body) for await (const chunk of answer.body) res.write(chunk);
    res.end();
  })
  .listen(port, '127.0.0.1');
