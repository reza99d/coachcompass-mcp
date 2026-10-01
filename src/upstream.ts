// Thin, read-only client for the CoachCompass API. Every call runs as an ANONYMOUS actor (no
// Authorization header is ever sent), so the backend's own authz (published rows only) applies.
import { config } from './config.js';

export class UpstreamError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Filter { col: string; op: 'eq' | 'neq' | 'in' | 'gte' | 'gt' | 'lte' | 'lt' | 'like' | 'is'; val: unknown; not?: boolean }
export interface QueryDescriptor {
  table: string;
  columns: string;
  filters?: Filter[];
  or?: string[];
  order?: Array<{ col: string; ascending?: boolean }>;
  limit?: number;
  range?: [number, number];
  count?: boolean;
  head?: boolean;
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...a) => fetch(...a);
/** Test hook: swap the HTTP layer. */
export function setFetch(f: FetchLike) { fetchImpl = f; }

async function request(path: string, init: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.upstreamTimeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${config.apiBase}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': `coachcompass-mcp/${config.version}`, ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new UpstreamError(503, (e as Error)?.name === 'AbortError' ? 'CoachCompass API timed out' : 'CoachCompass API unreachable');
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. nginx 502 page) */ }
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } | string } | null)?.error;
    const m = typeof msg === 'string' ? msg : msg?.message;
    throw new UpstreamError(res.status, m ? String(m).slice(0, 200) : `CoachCompass API error ${res.status}`);
  }
  return body;
}

/** Structured select via /data/query (select only — this module has no write path). */
export async function select<T = Record<string, unknown>>(q: QueryDescriptor): Promise<{ rows: T[]; count: number }> {
  const body = (await request('/data/query', { method: 'POST', body: JSON.stringify({ ...q, op: 'select' }) })) as
    { data: T[] | null; count?: number; error: { message?: string } | null } | null;
  if (!body || body.error) throw new UpstreamError(502, body?.error?.message?.slice(0, 200) ?? 'bad gateway response');
  const rows = Array.isArray(body.data) ? body.data : [];
  return { rows, count: typeof body.count === 'number' ? body.count : rows.length };
}

/** Invoke a public backend function (POST /functions/v1/:name). */
export async function invoke<T = unknown>(name: 'get-featured-coaches', payload: Record<string, unknown>): Promise<T> {
  return (await request(`/functions/v1/${name}`, { method: 'POST', body: JSON.stringify(payload) })) as T;
}

/** GET /functions/v1/availability-public (query-string endpoint). */
export async function availability(params: { coach_id: string; from: string; to: string; service_id?: string; intro?: boolean }): Promise<unknown> {
  const qs = new URLSearchParams({ coach_id: params.coach_id, from: params.from, to: params.to });
  if (params.service_id) qs.set('service_id', params.service_id);
  if (params.intro) qs.set('intro', '1');
  try {
    return await request(`/functions/v1/availability-public?${qs}`, { method: 'GET' });
  } catch (e) {
    // availability-public answers 4xx with a JSON {success:false,error} body we want to surface as data.
    if (e instanceof UpstreamError && e.status >= 400 && e.status < 500) return { success: false, error: e.message, status: e.status };
    throw e;
  }
}
