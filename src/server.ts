// HTTP entrypoint: POST/GET /mcp (Streamable HTTP, stateless) + GET /healthz. Binds loopback; nginx terminates TLS.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createHandler } from './app.js';
import { config } from './config.js';

const MAX_BODY = 256 * 1024;

export function startServer(port = config.port, host = config.host) {
  const mcp = toNodeHandler(createHandler());
  const validateHost = hostHeaderValidation(config.allowedHosts);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version: config.version }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (!validateHost(req, res)) return;
    // Public, unauthenticated, read-only endpoint: any web origin may call it (browser-based MCP clients),
    // so no Origin allowlist — there are no cookies/credentials to protect.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
        'access-control-max-age': '86400',
      }).end();
      return;
    }
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > MAX_BODY) {
      res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payload too large' }));
      return;
    }
    try {
      await mcp(req, res);
    } catch (e) {
      console.error(JSON.stringify({ t: new Date().toISOString(), http_error: String((e as Error)?.message ?? e).slice(0, 300) }));
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal error' }));
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return new Promise<ReturnType<typeof createServer>>((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then((s) => {
    const a = s.address();
    console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'coachcompass-mcp listening', addr: a, api: config.apiBase }));
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
}
