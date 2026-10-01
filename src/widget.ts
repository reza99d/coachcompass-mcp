// The coach-cards UI resource (MCP Apps standard; ChatGPT reads the same resource via openai/outputTemplate).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { config } from './config.js';

export const WIDGET_URI = 'ui://coachcompass/coach-cards-v1.html';

const here = path.dirname(fileURLToPath(import.meta.url));
let html: string | null = null;
function widgetHtml(): string {
  // Built by widget/build.mjs. Compiled: dist/src → dist/widget; from source (tests): src → dist/widget.
  if (html) return html;
  for (const p of ['../widget/coach-cards.html', '../dist/widget/coach-cards.html']) {
    try { html = readFileSync(path.resolve(here, p), 'utf8'); return html; } catch { /* try next */ }
  }
  throw new Error('widget not built — run `npm run build:widget`');
}

export function registerWidget(server: McpServer) {
  const site = config.siteUrl;
  const uiMeta = {
    ui: {
      // The widget makes no network requests of its own; it only loads coach avatars from our site.
      csp: { connectDomains: [] as string[], resourceDomains: [site] },
      prefersBorder: true,
    },
    // ChatGPT compatibility keys (Apps SDK).
    'openai/widgetDescription': 'Cards for CoachCompass coaches: photo, name, title, location, price, languages, with buttons to open the profile or booking page.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': { connect_domains: [] as string[], resource_domains: [site] },
  };
  registerAppResource(server, 'CoachCompass coach cards', WIDGET_URI, {
    description: 'Interactive cards for CoachCompass coach search results and profiles.',
    _meta: uiMeta,
  }, async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(), _meta: uiMeta }],
  }));
}
