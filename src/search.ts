// Coach search → gateway descriptor. Mirrors coach-advisor's buildCoachWhere semantics (published,
// non-demo, free text across the coach's own words, keyword-ish specialty/language matching) using
// only the public /data/query surface.
import { COACH_PUBLIC_COLUMNS, sanitizeTerm } from './format.js';
import type { Filter, QueryDescriptor } from './upstream.js';

export interface CoachFilters {
  query?: string;
  category?: string;
  country?: string;
  city?: string;
  languages?: string[];
  specialties?: string[];
  gender?: string;
  max_hourly_rate?: number;
  min_years_experience?: number;
  verified_only?: boolean;
}

// Common local/alternate country names → the English names stored in coaches.country.
const COUNTRY_ALIASES: Record<string, string> = {
  sverige: 'Sweden', schweden: 'Sweden', suède: 'Sweden', suede: 'Sweden',
  danmark: 'Denmark', dänemark: 'Denmark', norge: 'Norway', norwegen: 'Norway', suomi: 'Finland',
  deutschland: 'Germany', tyskland: 'Germany', allemagne: 'Germany', frankrike: 'France', frankreich: 'France',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', england: 'United Kingdom', britain: 'United Kingdom',
  'great britain': 'United Kingdom', storbritannien: 'United Kingdom',
  usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States', us: 'United States', america: 'United States',
  'united states of america': 'United States', españa: 'Spain', spanien: 'Spain', italia: 'Italy', italien: 'Italy',
  nederland: 'Netherlands', holland: 'Netherlands', schweiz: 'Switzerland', suisse: 'Switzerland',
};
export function canonicalCountry(raw: string): string {
  const k = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[k] ?? raw.trim();
}

const TEXT_COLS = ['name', 'title', 'bio', 'location', 'city', 'region', 'country', 'company', 'specialties'];

const words = (s: string | undefined, max: number) =>
  sanitizeTerm(s ?? '', 120).split(' ').filter((w) => w.length >= 2).slice(0, max);

const list = (xs: string[] | undefined, max: number) =>
  (xs ?? []).map((x) => sanitizeTerm(x, 40)).filter((x) => x.length >= 2).slice(0, max);

/** Filters + or()-groups shared by search and count (they must stay in lockstep). */
export function buildCoachQuery(f: CoachFilters): Pick<QueryDescriptor, 'filters' | 'or'> {
  const filters: Filter[] = [{ col: 'is_demo', op: 'eq', val: false }];
  const or: string[] = [];

  // Each free-text word must appear in at least one of the coach's text fields (AND of ORs).
  for (const w of words(f.query, 6)) or.push(TEXT_COLS.map((c) => `${c}.ilike.%${w}%`).join(','));

  const category = sanitizeTerm(f.category, 30).toLowerCase();
  if (category) filters.push({ col: 'category', op: 'eq', val: category });

  const country = sanitizeTerm(f.country, 60);
  if (country) filters.push({ col: 'country', op: 'like', val: canonicalCountry(country) }); // LIKE w/o wildcards = case-insensitive equality

  const city = sanitizeTerm(f.city, 60);
  if (city) or.push(['city', 'location', 'region'].map((c) => `${c}.ilike.%${city}%`).join(','));

  const specs = list(f.specialties, 5);
  if (specs.length) or.push(specs.flatMap((s) => [`specialties.ilike.%${s}%`, `title.ilike.%${s}%`]).join(','));

  const langs = list(f.languages, 3);
  if (langs.length) or.push(langs.map((l) => `languages.ilike.%${l}%`).join(','));

  const gender = sanitizeTerm(f.gender, 20).toLowerCase();
  if (gender) filters.push({ col: 'gender', op: 'eq', val: gender });

  if (typeof f.max_hourly_rate === 'number') {
    filters.push({ col: 'hourly_rate', op: 'lte', val: Math.floor(f.max_hourly_rate) });
    filters.push({ col: 'hourly_rate', op: 'gt', val: 0 }); // a price ceiling implies "has a listed price"
  }
  if (typeof f.min_years_experience === 'number') filters.push({ col: 'years_experience', op: 'gte', val: Math.floor(f.min_years_experience) });
  if (f.verified_only) filters.push({ col: 'is_verified', op: 'eq', val: true });

  return { filters, or };
}

export function searchDescriptor(f: CoachFilters, limit: number, offset: number): QueryDescriptor {
  return {
    table: 'coaches',
    columns: COACH_PUBLIC_COLUMNS.join(','),
    ...buildCoachQuery(f),
    order: [{ col: 'is_premium', ascending: false }, { col: 'is_verified', ascending: false }, { col: 'years_experience', ascending: false }, { col: 'name', ascending: true }],
    range: [offset, offset + limit - 1],
    count: true,
  };
}

export function countDescriptor(f: CoachFilters): QueryDescriptor {
  return { table: 'coaches', columns: 'id', ...buildCoachQuery(f), head: true, count: true };
}
