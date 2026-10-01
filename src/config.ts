// Runtime configuration (env-driven; safe defaults for the VPS deployment).
export const config = {
  /** Base URL of the CoachCompass API (the shim backend). On the VPS this is the loopback port. */
  apiBase: (process.env.CC_API_BASE ?? 'http://127.0.0.1:8788').replace(/\/+$/, ''),
  /** Public site URL used to build profile/booking links shown to users. */
  siteUrl: (process.env.CC_SITE_URL ?? 'https://coachcompass.co').replace(/\/+$/, ''),
  /** Where this MCP server listens (behind nginx). */
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 8791),
  /** Public hostnames accepted in the Host header (DNS-rebinding guard). */
  allowedHosts: (process.env.CC_ALLOWED_HOSTS ?? 'coachcompass.co,www.coachcompass.co,localhost,127.0.0.1')
    .split(',').map((s) => s.trim()).filter(Boolean),
  upstreamTimeoutMs: Number(process.env.CC_UPSTREAM_TIMEOUT_MS ?? 8000),
  /** Requests per client IP per minute (tool calls + list calls). */
  rateLimitPerMin: Number(process.env.CC_RATE_LIMIT_PER_MIN ?? 60),
  version: '1.0.0',
} as const;
