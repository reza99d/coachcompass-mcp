// Tiny TTL cache with a size cap (protects the single-writer SQLite backend from repeated reads).
interface Entry { at: number; ttl: number; value: Promise<unknown> }
const store = new Map<string, Entry>();
const MAX = 500;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: now, ttl: ttlMs, value });
  value.catch(() => store.delete(key)); // never cache failures
  if (store.size > MAX) {
    for (const [k, e] of store) if (now - e.at >= e.ttl) store.delete(k);
    while (store.size > MAX) store.delete(store.keys().next().value!);
  }
  return value;
}

export function clearCache() { store.clear(); }
