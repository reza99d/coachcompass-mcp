// Coach cards View (MCP Apps). Renders structuredContent from search_coaches / get_featured_coaches / get_coach.
// Security: every value is written with textContent / setAttribute on vetted http(s) URLs — never innerHTML.
import { App } from '@modelcontextprotocol/ext-apps';

interface Coach {
  name: string; slug: string; title: string | null; location: string | null; avatar_url: string | null;
  price_label: string | null; languages: string[]; specialties: string[]; years_experience: number | null;
  is_verified: boolean; bio_excerpt?: string | null; bio?: string | null; profile_url: string; booking_url: string;
  books_on_coachcompass: boolean; external_booking_url?: string | null;
  rating?: { average: number; count: number } | null;
  services?: Array<{ name: string | null; duration_minutes: number | null; price_label: string | null }>;
}
interface Payload { kind?: string; coaches?: Coach[]; coach?: Coach; total_found?: number; offset?: number }

const SITE = 'https://coachcompass.co';
const root = document.getElementById('root')!;
const app = new App({ name: 'CoachCompass coach cards', version: '1.0.0' });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const isSafe = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; }
};
const isOurs = (u: unknown): u is string => isSafe(u) && new URL(u).origin === SITE;

async function open(url: string) {
  if (!isSafe(url)) return;
  try {
    const r = await app.openLink({ url });
    if (r?.isError) window.open(url, '_blank', 'noopener');
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function avatar(c: Coach): HTMLElement {
  const wrap = el('div', 'avatar');
  const initials = c.name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  wrap.textContent = initials;
  if (isSafe(c.avatar_url)) {
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { wrap.textContent = ''; wrap.appendChild(img); };
    img.src = c.avatar_url; // CSP decides; on failure the initials stay
  }
  return wrap;
}

function card(c: Coach, detailed: boolean): HTMLElement {
  const card = el('article', 'card');
  const head = el('div', 'head');
  head.appendChild(avatar(c));
  const who = el('div', 'who');
  const nameRow = el('div', 'name', c.name);
  if (c.is_verified) { const b = el('span', 'badge', 'Verified'); b.title = 'Verified by CoachCompass'; nameRow.appendChild(b); }
  who.appendChild(nameRow);
  if (c.title) who.appendChild(el('div', 'title', c.title));
  const meta = [c.location, c.years_experience != null ? `${c.years_experience} yrs` : null,
    c.rating ? `★ ${c.rating.average} (${c.rating.count})` : null].filter(Boolean).join(' · ');
  if (meta) who.appendChild(el('div', 'meta', meta));
  head.appendChild(who);
  if (c.price_label) head.appendChild(el('div', 'price', c.price_label));
  card.appendChild(head);

  const chips = el('div', 'chips');
  for (const l of c.languages.slice(0, 4)) chips.appendChild(el('span', 'chip lang', l));
  for (const s of c.specialties.slice(0, detailed ? 8 : 3)) chips.appendChild(el('span', 'chip', s));
  if (chips.childElementCount) card.appendChild(chips);

  const bio = detailed ? c.bio : c.bio_excerpt;
  if (bio) card.appendChild(el('p', detailed ? 'bio full' : 'bio', bio));

  if (detailed && c.services?.length) {
    const ul = el('ul', 'services');
    for (const s of c.services.slice(0, 6)) {
      const li = el('li');
      li.appendChild(el('span', '', `${s.name ?? 'Session'}${s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}`));
      if (s.price_label) li.appendChild(el('span', 'sprice', s.price_label));
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  const actions = el('div', 'actions');
  const view = el('button', 'btn', 'View profile');
  view.type = 'button';
  view.onclick = () => open(c.profile_url);
  actions.appendChild(view);
  const bookUrl = c.books_on_coachcompass ? c.booking_url : c.external_booking_url ?? null;
  if (bookUrl && (isOurs(bookUrl) || isSafe(bookUrl))) {
    const book = el('button', 'btn primary', 'Book');
    book.type = 'button';
    book.onclick = () => open(bookUrl);
    actions.appendChild(book);
  }
  card.appendChild(actions);
  return card;
}

function render(p: Payload | undefined) {
  root.textContent = '';
  if (!p) { root.appendChild(el('div', 'empty', 'Loading coaches…')); return; }
  if (p.kind === 'coach_detail' && p.coach) { root.appendChild(card(p.coach, true)); return; }
  const coaches = Array.isArray(p.coaches) ? p.coaches : [];
  if (!coaches.length) { root.appendChild(el('div', 'empty', 'No coaches matched.')); return; }
  const grid = el('div', 'grid');
  for (const c of coaches) grid.appendChild(card(c, false));
  root.appendChild(grid);
  const total = typeof p.total_found === 'number' ? p.total_found : coaches.length;
  const foot = el('div', 'foot');
  foot.appendChild(el('span', '', total > coaches.length ? `Showing ${coaches.length} of ${total} coaches` : `${coaches.length} coach${coaches.length === 1 ? '' : 'es'}`));
  const more = el('button', 'link', 'Browse all on CoachCompass');
  more.type = 'button';
  more.onclick = () => open(`${SITE}/browse`);
  foot.appendChild(more);
  root.appendChild(foot);
}

function applyTheme(theme: unknown) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

app.ontoolresult = (params) => render(params.structuredContent as Payload | undefined);
app.onhostcontextchanged = (ctx) => { if (ctx?.theme) applyTheme(ctx.theme); };

render(undefined);
app.connect().then(() => {
  applyTheme(app.getHostContext()?.theme);
}).catch(() => {
  // Fallback for hosts that only expose the legacy ChatGPT bridge.
  const oa = (window as unknown as { openai?: { toolOutput?: Payload; theme?: string } }).openai;
  if (oa?.toolOutput) { applyTheme(oa.theme); render(oa.toolOutput); }
});
