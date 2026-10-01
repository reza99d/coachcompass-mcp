import { describe, expect, it } from 'vitest';
import { clip, formatMajor, formatMinor, pickCoach, pickCoachDetail, safeUrl, sanitizeTerm, COACH_PUBLIC_COLUMNS } from '../src/format.js';
import { buildCoachQuery, canonicalCountry, searchDescriptor } from '../src/search.js';
import { allow, resetRateLimits } from '../src/rateLimit.js';
import { COACHES, PRIVATE_KEYS } from './fixtures.js';

describe('money formatting (mirrors src/lib/money.ts)', () => {
  it('formats major units in the coach currency', () => {
    expect(formatMajor(1200, 'sek')).toMatch(/SEK\s?1,200/);
    expect(formatMajor(150, null)).toBe('$150'); // FE default currency is USD
    expect(formatMajor(99.5, 'eur')).toBe('€99.5');
    expect(formatMajor(5000, 'jpy')).toMatch(/¥5,000/);
  });
  it('formats minor units', () => {
    expect(formatMinor(50000, 'sek')).toMatch(/SEK\s?500/);
    expect(formatMinor(5000, 'jpy')).toMatch(/¥5,000/);
    expect(formatMinor(1999, 'gbp')).toBe('£19.99');
  });
  it('falls back on junk currency codes', () => {
    expect(formatMajor(10, 'x1')).toBe('$10');
    expect(formatMajor(10, 'zzz')).toMatch(/ZZZ/);
  });
});

describe('public field shaping', () => {
  it('never includes private columns', () => {
    for (const row of COACHES) {
      const s = pickCoach(row)!, d = pickCoachDetail(row)!;
      for (const k of PRIVATE_KEYS) { expect(s).not.toHaveProperty(k); expect(d).not.toHaveProperty(k); }
      const blob = JSON.stringify([s, d]);
      expect(blob).not.toContain('secret@example.com');
      expect(blob).not.toContain('+46700000000');
    }
  });
  it('the column allowlist has no private columns', () => {
    for (const k of PRIVATE_KEYS) expect(COACH_PUBLIC_COLUMNS as readonly string[]).not.toContain(k);
  });
  it('drops dangerous URLs and treats 0 as unknown', () => {
    const d = pickCoachDetail(COACHES[0])!;
    expect(d.website).toBeNull(); // javascript:
    expect(d.linkedin_url).toBe('https://linkedin.com/in/anna');
    const b = pickCoach(COACHES[1])!;
    expect(b.avatar_url).toBeNull(); // data:
    expect(b.price_label).toBeNull();
    expect(b.years_experience).toBeNull();
    expect(b.books_on_coachcompass).toBe(true);
  });
  it('builds slug-based links and location labels', () => {
    const a = pickCoach(COACHES[0])!;
    expect(a.profile_url).toBe('https://coachcompass.co/coach/anna-svensson');
    expect(a.location).toBe('Stockholm, Stockholms län, Sweden');
    expect(pickCoach(COACHES[1])!.location).toBe('United Kingdom');
  });
  it('rejects rows without id/name', () => {
    expect(pickCoach({ id: 'x' })).toBeNull();
    expect(pickCoach({})).toBeNull();
  });
  it('safeUrl/clip/sanitizeTerm', () => {
    expect(safeUrl('/api/storage/a.jpg')).toBe('https://coachcompass.co/api/storage/a.jpg');
    expect(safeUrl('vbscript:x')).toBeNull();
    expect(clip('a'.repeat(50), 10)).toHaveLength(10);
    expect(sanitizeTerm("50%_off,(x) 'or' 1=1;--")).toBe('50 off x or 1=1 --');
  });
});

describe('search descriptor', () => {
  it('always excludes demo coaches and pages correctly', () => {
    const d = searchDescriptor({}, 6, 12);
    expect(d.filters).toContainEqual({ col: 'is_demo', op: 'eq', val: false });
    expect(d.range).toEqual([12, 17]);
    expect(d.columns.split(',')).not.toContain('email');
  });
  it('turns each query word into an OR group, with no wildcards from user input', () => {
    const q = buildCoachQuery({ query: 'burnout %% startup,(founders)' });
    expect(q.or).toHaveLength(3);
    for (const g of q.or!) {
      expect(g).not.toMatch(/[(),]%|%%/);
      for (const clause of g.split(',')) expect(clause).toMatch(/^[a-z_]+\.ilike\.%[^%,()]+%$/);
    }
  });
  it('maps country aliases', () => {
    expect(canonicalCountry('Sverige')).toBe('Sweden');
    expect(canonicalCountry('usa')).toBe('United States');
    expect(canonicalCountry('Narnia')).toBe('Narnia');
    expect(buildCoachQuery({ country: 'sverige' }).filters).toContainEqual({ col: 'country', op: 'like', val: 'Sweden' });
  });
  it('price ceiling excludes unpriced coaches; caps keyword lists', () => {
    const q = buildCoachQuery({ max_hourly_rate: 999.9, specialties: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'] });
    expect(q.filters).toContainEqual({ col: 'hourly_rate', op: 'lte', val: 999 });
    expect(q.filters).toContainEqual({ col: 'hourly_rate', op: 'gt', val: 0 });
    expect(q.or![0].split(',')).toHaveLength(10); // 5 specialties × (specialties,title)
  });
});

describe('rate limiter', () => {
  it('allows N per minute per key, then blocks, then resets', () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allow('k', 3, t)).toBe(true);
    expect(allow('k', 3, t)).toBe(false);
    expect(allow('other', 3, t)).toBe(true);
    expect(allow('k', 3, t + 60_001)).toBe(true);
  });
});
