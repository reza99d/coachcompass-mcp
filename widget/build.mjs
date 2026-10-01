// Bundles widget/coach-cards.ts into ONE self-contained HTML file: dist/widget/coach-cards.html.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../dist/widget');

const res = await build({
  entryPoints: [path.join(here, 'coach-cards.ts')],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const css = `
:root{--bg:#fff;--card:#fff;--fg:#14213d;--muted:#5b6475;--line:#e3e7ee;--chip:#f1f4f9;--accent:#0f766e;--accent-fg:#fff;--badge:#e6f4f1}
:root[data-theme=dark]{--bg:transparent;--card:#1d2130;--fg:#eef1f7;--muted:#a3abbd;--line:#30364a;--chip:#272c3d;--accent:#2dd4bf;--accent-fg:#06221f;--badge:#123b36}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#root{padding:4px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.head{display:flex;gap:12px;align-items:flex-start}.who{flex:1;min-width:0}
.avatar{width:48px;height:48px;border-radius:50%;background:var(--chip);color:var(--muted);display:flex;align-items:center;justify-content:center;font-weight:600;flex:none;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.name{font-weight:650;font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}
.badge{font-size:11px;font-weight:600;background:var(--badge);color:var(--accent);border-radius:999px;padding:1px 8px}
.title{color:var(--fg);opacity:.85;overflow-wrap:anywhere}.meta{color:var(--muted);font-size:12.5px;margin-top:2px}
.price{font-weight:650;white-space:nowrap;font-size:13.5px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--chip);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.lang{color:var(--fg)}
.bio{margin:0;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.bio.full{display:block}
.services{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.services li{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.sprice{font-weight:600;white-space:nowrap}
.actions{display:flex;gap:8px;margin-top:auto}
.btn{flex:1;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:10px;padding:8px 10px;font:inherit;font-weight:600;cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}.btn:focus-visible,.link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;margin-top:10px;flex-wrap:wrap}
.link{background:none;border:0;color:var(--accent);font:inherit;font-weight:600;cursor:pointer;padding:0}
.empty{color:var(--muted);padding:12px}`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoachCompass coaches</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'coach-cards.html'), html);
console.log(`widget: ${(html.length / 1024).toFixed(1)} KiB → dist/widget/coach-cards.html`);
