// Fixed-window per-client rate limit (in memory; one process). Keys are already hashed IPs.
const windows = new Map<string, { start: number; n: number }>();

export function allow(key: string, perMinute: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= 60_000) {
    windows.set(key, { start: now, n: 1 });
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    return true;
  }
  w.n += 1;
  return w.n <= perMinute;
}

export function resetRateLimits() { windows.clear(); }
