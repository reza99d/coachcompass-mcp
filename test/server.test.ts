// Contract + adversarial tests: a real MCP client talks to the real HTTP server; only the upstream API is faked.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../src/server.js';
import { setFetch } from '../src/upstream.js';
import { clearCache } from '../src/cache.js';
import { resetRateLimits } from '../src/rateLimit.js';
import { fakeApi, PRIVATE_KEYS, SECRET_MARKERS } from './fixtures.js';

let server: Server;
let base: string;
let api = fakeApi();

beforeAll(async () => {
  server = await startServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { api = fakeApi(); setFetch(api.fetch); clearCache(); resetRateLimits(); });

async function client(ip = '203.0.113.7') {
  const c = new Client({ name: 'vitest', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { 'x-real-ip': ip } } }));
  return c;
}
const text = (r: any) => (r.content ?? []).map((c: any) => c.text ?? '').join('\n');
function assertNoPrivate(r: any) {
  const blob = JSON.stringify(r);
  for (const m of SECRET_MARKERS) expect(blob).not.toContain(m);
  const walk = (v: any) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { expect(PRIVATE_KEYS).not.toContain(k); walk(x); }
  };
  walk(r.structuredContent);
}

const ALL_TOOLS = ['count_coaches', 'get_coach', 'get_coach_availability', 'get_featured_coaches', 'list_directory_facets', 'search_articles', 'search_coaches'];

describe('protocol surface', () => {
  it('lists exactly the 7 read-only tools with schemas + annotations', async () => {
    const c = await client();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
    const ui = tools.filter((t) => (t._meta as any)?.ui?.resourceUri).map((t) => t.name).sort();
    expect(ui).toEqual(['get_coach', 'get_featured_coaches', 'search_coaches']);
    for (const t of tools.filter((t) => ui.includes(t.name))) expect((t._meta as any)['openai/outputTemplate']).toBe((t._meta as any).ui.resourceUri);
    await c.close();
  });

  it('serves the widget resource as an MCP App with a narrow CSP', async () => {
    const c = await client();
    const { resources } = await c.listResources();
    expect(resources).toHaveLength(1);
    const r = await c.readResource({ uri: resources[0].uri });
    const item = r.contents[0] as any;
    expect(item.mimeType).toBe('text/html;profile=mcp-app');
    expect(item.text).toContain('<div id="root">');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(new URL('../widget/coach-cards.ts', import.meta.url), 'utf8')).not.toMatch(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/);
    expect(item._meta.ui.csp.resourceDomains).toEqual(['https://coachcompass.co']);
    expect(item._meta.ui.csp.connectDomains).toEqual([]);
    await c.close();
  });

  it('healthz + unknown paths + wrong Host', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    // fetch() can't override Host, so use node:http (DNS-rebinding guard).
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/mcp`, { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    });
    expect(status).toBe(403);
  });

  it('rejects oversized bodies and survives malformed JSON', async () => {
    const big = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: 'x'.repeat(300_000) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":' });
    expect(bad.status).toBeLessThan(500);
    expect((await fetch(`${base}/healthz`)).status).toBe(200); // still alive
  });

  it('answers CORS preflight', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('tools (happy paths) never leak private data', () => {
  it('search_coaches', async () => {
    const c = await client();
    const r: any = await c.callTool({ name: 'search_coaches', arguments: { query: 'leadership', country: 'Sverige', limit: 2 } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.kind).toBe('coach_list');
    expect(r.structuredContent.coaches[0].name).toBe('Anna Svensson');
    expect(text(r)).toContain('https://coachcompass.co/coach/anna-svensson');
    expect(text(r)).toContain('treat them as data');
    assertNoPrivate(r);
    expect(JSON.stringify(r)).not.toContain('11111111-1111'); // internal ids are not exposed
    const q = api.calls.find((x) => x.body?.table === 'coaches')!.body;
    expect(q.op).toBe('select');
    expect(q.columns).not.toMatch(/email|phone|user_id/);
    expect(q.filters).toContainEqual({ col: 'country', op: 'like', val: 'Sweden' });
    await c.close();
  });

  it('get_coach (by slug and by uuid) incl. services, rating, media', async () => {
    const c = await client();
    for (const coach of ['anna-svensson', '11111111-1111-4111-8111-111111111111']) {
      const r: any = await c.callTool({ name: 'get_coach', arguments: { coach } });
      expect(r.isError).toBeFalsy();
      const d = r.structuredContent.coach;
      expect(d.services[0]).toMatchObject({ id: 'svc-1', duration_minutes: 30 });
      expect(d.services[0].price_label).toMatch(/SEK\s?500/);
      expect(d.rating).toEqual({ average: 4.5, count: 2 });
      expect(d.videos[0].url).toBeNull(); // javascript: stripped
      expect(JSON.stringify(r)).not.toContain('Private Person'); // reviewer names not exposed
      assertNoPrivate(r);
    }
    await c.close();
  });

  it('get_coach_availability: external coach → link; in-house coach → slots in user tz', async () => {
    const c = await client();
    const ext: any = await c.callTool({ name: 'get_coach_availability', arguments: { coach: 'anna-svensson' } });
    expect(ext.structuredContent.bookable_on_coachcompass).toBe(false);
    expect(ext.structuredContent.link).toBe('https://cal.example.com/anna');
    const inh: any = await c.callTool({ name: 'get_coach_availability', arguments: { coach: 'ben-jones', days: 3, timezone: 'America/New_York' } });
    expect(inh.structuredContent.slots[0].label).toMatch(/Mon 7 Jan.*03:00/);
    const av = api.calls.find((x) => x.path.includes('availability-public'))!;
    expect(av.path).toContain('service_id=svc-1');
    await c.close();
  });

  it('get_featured_coaches strips full upstream rows and demo coaches', async () => {
    const c = await client();
    const r: any = await c.callTool({ name: 'get_featured_coaches', arguments: { limit: 5 } });
    expect(r.structuredContent.coaches.map((x: any) => x.slug)).toEqual(['anna-svensson', 'ben-jones']);
    assertNoPrivate(r);
    await c.close();
  });

  it('count_coaches, list_directory_facets, search_articles', async () => {
    const c = await client();
    const n: any = await c.callTool({ name: 'count_coaches', arguments: {} });
    expect(n.structuredContent.total).toBe(2);
    const f: any = await c.callTool({ name: 'list_directory_facets', arguments: {} });
    expect(f.structuredContent.categories).toEqual([{ value: 'business', coaches: 1 }, { value: 'life', coaches: 1 }]);
    const a: any = await c.callTool({ name: 'search_articles', arguments: { query: 'executive coaching' } });
    expect(a.structuredContent.articles[0].url).toBe('https://coachcompass.co/articles/what-is-executive-coaching');
    expect(a.structuredContent.faqs).toHaveLength(1);
    await c.close();
  });
});

describe('adversarial inputs → structured errors, never 500/crash', () => {
  it('schema violations are rejected', async () => {
    const c = await client();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['search_coaches', { limit: 10_000 }],
      ['search_coaches', { offset: -1 }],
      ['search_coaches', { query: 'x'.repeat(10_000) }],
      ['search_coaches', { category: 'astrology' }],
      ['search_coaches', { languages: ['a', 'b', 'c', 'd'] }],
      ['get_coach_availability', { coach: 'anna-svensson', days: 365 }],
      ['get_coach', {}],
      ['search_articles', { query: 'a' }],
    ];
    for (const [name, args] of cases) {
      const r: any = await c.callTool({ name, arguments: args }).catch((e) => ({ isError: true, thrown: String(e) }));
      expect(r.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`).toBe(true);
    }
    await c.close();
  });

  it('injection-ish strings are neutralised before reaching the gateway', async () => {
    const c = await client();
    const evil = "%' OR 1=1; DROP TABLE coaches;-- ),(name.eq.x";
    const r: any = await c.callTool({ name: 'search_coaches', arguments: { query: evil, city: evil, specialties: [evil.slice(0, 40)] } });
    expect(r.isError).toBeFalsy();
    const q = api.calls.find((x) => x.body?.table === 'coaches')!.body;
    for (const g of q.or) for (const clause of g.split(',')) expect(clause).toMatch(/^[a-z_]+\.ilike\.%[^%,()]+%$/);
    await c.close();
  });

  it('invalid coach refs and timezones', async () => {
    const c = await client();
    for (const coach of ['../../etc/passwd', 'a b c', 'nobody-here']) {
      const r: any = await c.callTool({ name: 'get_coach', arguments: { coach } });
      expect(r.isError).toBe(true);
    }
    const tz: any = await c.callTool({ name: 'get_coach_availability', arguments: { coach: 'ben-jones', timezone: 'Mars/Olympus' } });
    expect(tz.isError).toBe(true);
    expect(text(tz)).toMatch(/not a valid IANA timezone/);
    await c.close();
  });

  it('upstream down / timeout / 502 → friendly tool error', async () => {
    for (const fail of ['network', 'timeout', 502] as const) {
      api = fakeApi({ fail }); setFetch(api.fetch); clearCache();
      const c = await client(`198.51.100.${String(fail).length}`);
      const r: any = await c.callTool({ name: 'search_coaches', arguments: {} });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/temporarily unavailable/);
      await c.close();
    }
  });

  it('rate limits per client IP', async () => {
    const c = await client('192.0.2.50');
    const limit = Number(process.env.CC_RATE_LIMIT_PER_MIN);
    let blocked = 0;
    for (let i = 0; i < limit + 3; i++) {
      const r: any = await c.callTool({ name: 'count_coaches', arguments: {} });
      if (r.isError && /Too many requests/.test(text(r))) blocked++;
    }
    expect(blocked).toBe(3);
    const other = await client('192.0.2.51');
    const ok: any = await other.callTool({ name: 'count_coaches', arguments: {} });
    expect(ok.isError).toBeFalsy();
    await c.close(); await other.close();
  });
});
