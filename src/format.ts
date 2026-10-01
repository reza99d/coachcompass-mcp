// Formatting + public-field shaping. Mirrors the frontend's src/lib/money.ts so prices read the same
// as on coachcompass.co (coaches.hourly_rate is in MAJOR units; service price_cents in MINOR units).
import { config } from './config.js';

const ZERO_DECIMAL = new Set(['jpy']);
const DEFAULT_CURRENCY = 'usd';

export function normalizeCurrency(currency?: unknown): string {
  const c = typeof currency === 'string' ? currency.trim().toLowerCase() : '';
  return /^[a-z]{3}$/.test(c) ? c : DEFAULT_CURRENCY;
}

function fmt(major: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0 }).format(major);
  } catch {
    return `${major.toFixed(ZERO_DECIMAL.has(currency) ? 0 : 2).replace(/\.00$/, '')} ${currency.toUpperCase()}`;
  }
}

/** Format a whole-unit amount (what coaches.hourly_rate stores). */
export function formatMajor(major: number, currency?: unknown): string {
  return fmt(major, normalizeCurrency(currency));
}

/** Format a minor-unit amount (cents/öre — what coach_services.price_cents stores). */
export function formatMinor(minor: number, currency?: unknown): string {
  const cur = normalizeCurrency(currency);
  return fmt(minor / (ZERO_DECIMAL.has(cur) ? 1 : 100), cur);
}

export const profileUrl = (slugOrId: string) => `${config.siteUrl}/coach/${encodeURIComponent(slugOrId)}`;
export const bookingUrl = (slugOrId: string) => `${config.siteUrl}/coach/${encodeURIComponent(slugOrId)}/book`;
export const articleUrl = (slug: string) => `${config.siteUrl}/articles/${encodeURIComponent(slug)}`;

/** Trim user-generated text: collapse whitespace, cap length. */
export function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Only http(s) URLs survive (no javascript:, data:, etc.). */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const url = new URL(u.trim(), config.siteUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const asArr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.startsWith('[')) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
  }
  return [];
};
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asBool = (v: unknown): boolean => v === true || v === 1 || v === 'true';
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The ONLY coach columns this server ever requests or returns. Private columns (email, phone,
 * address, age, user_id, payment/fee fields) are never selected — and pickCoach() drops anything
 * not built here, even if an upstream endpoint returns a full row.
 */
export const COACH_PUBLIC_COLUMNS = [
  'id', 'slug', 'name', 'title', 'category', 'specialties', 'languages', 'location', 'city', 'region', 'country',
  'bio', 'avatar_url', 'hourly_rate', 'currency', 'years_experience', 'is_verified', 'is_premium',
  'company', 'website', 'linkedin_url', 'booking_url', 'booking_mode', 'session_minutes', 'intro_call_minutes',
] as const;

export interface CoachSummary {
  slug: string;
  name: string;
  title: string | null;
  category: string | null;
  specialties: string[];
  languages: string[];
  location: string | null;
  avatar_url: string | null;
  hourly_rate: number | null;
  currency: string;
  price_label: string | null;
  years_experience: number | null;
  is_verified: boolean;
  is_premium: boolean;
  bio_excerpt: string | null;
  profile_url: string;
  booking_url: string;
  books_on_coachcompass: boolean;
}

export interface CoachDetail extends Omit<CoachSummary, 'bio_excerpt'> {
  bio: string | null;
  company: string | null;
  website: string | null;
  linkedin_url: string | null;
  external_booking_url: string | null;
  session_minutes: number | null;
  intro_call_minutes: number | null;
}

function placeLabel(r: Record<string, unknown>): string | null {
  const parts = [asStr(r.city), asStr(r.region), asStr(r.country)].filter((x): x is string => !!x);
  const uniq = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return uniq.length ? uniq.join(', ') : asStr(r.location);
}

export function pickCoach(r: Record<string, unknown>): CoachSummary | null {
  const id = asStr(r.id);
  const name = asStr(r.name);
  if (!id || !name) return null;
  const slug = asStr(r.slug) ?? id;
  const rate = asNum(r.hourly_rate);
  const currency = normalizeCurrency(r.currency);
  return {
    slug,
    name: clip(name, 120)!,
    title: clip(r.title, 160),
    category: asStr(r.category),
    specialties: asArr(r.specialties).slice(0, 12).map((s) => clip(s, 60)!).filter(Boolean),
    languages: asArr(r.languages).slice(0, 10).map((s) => clip(s, 40)!).filter(Boolean),
    location: clip(placeLabel(r), 120),
    avatar_url: safeUrl(r.avatar_url),
    hourly_rate: rate && rate > 0 ? rate : null,
    currency,
    price_label: rate && rate > 0 ? `${formatMajor(rate, currency)}/h` : null,
    years_experience: (asNum(r.years_experience) ?? 0) > 0 ? asNum(r.years_experience) : null, // 0 = not stated
    is_verified: asBool(r.is_verified),
    is_premium: asBool(r.is_premium),
    bio_excerpt: clip(r.bio, 280),
    profile_url: profileUrl(slug),
    booking_url: bookingUrl(slug),
    books_on_coachcompass: asStr(r.booking_mode) === 'in_house',
  };
}

export function pickCoachDetail(r: Record<string, unknown>): CoachDetail | null {
  const s = pickCoach(r);
  if (!s) return null;
  const { bio_excerpt: _drop, ...rest } = s;
  return {
    ...rest,
    bio: clip(r.bio, 1200),
    company: clip(r.company, 120),
    website: safeUrl(r.website),
    linkedin_url: safeUrl(r.linkedin_url),
    external_booking_url: safeUrl(r.booking_url),
    session_minutes: asNum(r.session_minutes),
    intro_call_minutes: asNum(r.intro_call_minutes),
  };
}

/** Strip LIKE wildcards and the characters that break the gateway's PostgREST or() parser. */
export function sanitizeTerm(s: unknown, max = 80): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[%_,()\\*"'`;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
