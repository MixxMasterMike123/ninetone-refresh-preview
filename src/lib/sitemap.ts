/**
 * Pure sitemap-entry builder. No I/O, no Astro globals — callers
 * (src/pages/sitemap-pages.xml.ts) gather the FM list data that's already
 * fetched elsewhere (same helpers the index pages use, src/lib/ninetone.ts)
 * and pass it in as plain arrays. Kept separate and pure so it's unit
 * testable without a build (test/sitemap.test.mjs).
 *
 * `<lastmod>` is intentionally almost always omitted: none of the FM layouts
 * behind these lists expose a modification timestamp distinct from a
 * "published" date (API_NEWS has only `Date`; releases have only
 * `releaseDate`; artists/clients/team/booking rows have no date field at
 * all beyond FM's internal `__recordId`, which is a creation-order serial,
 * not a timestamp). Per the brief: never fabricate a date. Every builder
 * below therefore emits no `lastmod` for any entity — there is nothing
 * truthful to put there today. If a genuine modification-timestamp field
 * ever appears in a fetched layout, thread it through here explicitly
 * rather than guessing from an adjacent date field.
 */

import type { StaticRoute } from "./routes";

/**
 * Page size for /records/artists/previous/{n} pagination — MUST match
 * `PAGE_SIZE` in src/pages/records/artists/previous/[...page].astro exactly.
 * Duplicated rather than imported: that file is an .astro component (top-
 * level `Astro.*` global reads), not importable from a plain .ts module or
 * from node:test. If that file's PAGE_SIZE ever changes, update this too —
 * previousArtistsPaginationEntries() derives the *page count* from it and
 * the live previous-artists total, so only this one number needs updating
 * by hand, not a hardcoded page count.
 */
const PREVIOUS_ARTISTS_PAGE_SIZE = 30;

export interface SitemapEntry {
  /** Absolute URL — origin + path, no trailing slash added/removed beyond
   *  what the input path already has. */
  loc: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  /** ISO date string. Omitted whenever no real modification timestamp
   *  exists for the entity — see module doc. Never fabricated. */
  lastmod?: string;
}

function joinPath(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

/** Static hand-maintained routes (src/lib/routes.ts) as sitemap entries. */
export function staticRouteEntries(origin: string, routes: StaticRoute[]): SitemapEntry[] {
  return routes.map((r) => ({
    loc: joinPath(origin, r.path),
    changefreq: r.changefreq,
  }));
}

export interface SlugSource {
  SLUG?: unknown;
  slug?: unknown;
}

/**
 * Build sitemap entries for a list of FM rows that each resolve to one
 * detail page at `${pathPrefix}/${slug}`. Skips rows with no usable slug
 * (mirrors the `if (!slug) continue` guard search-index.json.ts uses for
 * the same lists) so a blank/malformed FM row never emits a bare
 * `pathPrefix` URL.
 */
export function detailPageEntries(
  origin: string,
  rows: SlugSource[],
  pathPrefix: string,
  changefreq?: SitemapEntry["changefreq"],
): SitemapEntry[] {
  const prefix = pathPrefix.replace(/\/$/, "");
  const out: SitemapEntry[] = [];
  for (const row of rows) {
    const slug = String(row.SLUG ?? row.slug ?? "");
    if (!slug) continue;
    out.push({ loc: joinPath(origin, `${prefix}/${slug}`), changefreq });
  }
  return out;
}

/**
 * Page 2..lastPage of the previous-artists roster listing
 * (src/pages/records/artists/previous/[...page].astro) — real, crawlable,
 * paginated list pages, distinct from the individual previous-artist detail
 * pages (already covered by `detailPageEntries` at
 * "/records/artists/previous/single/{slug}"). Page 1 lives at the bare
 * "/records/artists/previous" (see src/lib/routes.ts) and is NOT repeated
 * here. `totalPreviousArtists` is the live count from the same
 * getPreviousArtists() call the sitemap endpoint already makes — no new FM
 * read, and the page count self-maintains as the roster grows or shrinks.
 */
export function previousArtistsPaginationEntries(
  origin: string,
  totalPreviousArtists: number,
  pageSize: number = PREVIOUS_ARTISTS_PAGE_SIZE,
): SitemapEntry[] {
  const lastPage = Math.max(1, Math.ceil(totalPreviousArtists / pageSize));
  const out: SitemapEntry[] = [];
  for (let n = 2; n <= lastPage; n++) {
    out.push({ loc: joinPath(origin, `/records/artists/previous/${n}`), changefreq: "monthly" });
  }
  return out;
}

/**
 * Assemble the full `sitemap-pages.xml` entry list: static routes + every
 * FM-driven detail page, using the exact list helpers/shapes the index
 * pages already fetch with (src/lib/ninetone.ts) — no new FM reads here,
 * callers pass already-fetched rows in.
 */
export function buildSitemapEntries(
  origin: string,
  input: {
    staticRoutes: StaticRoute[];
    artists: SlugSource[];
    previousArtists: SlugSource[];
    clients: SlugSource[];
    team: SlugSource[];
    bookingTalent: SlugSource[];
    news: SlugSource[];
  },
): SitemapEntry[] {
  return [
    ...staticRouteEntries(origin, input.staticRoutes),
    ...detailPageEntries(origin, input.artists, "/records/artists", "weekly"),
    ...previousArtistsPaginationEntries(origin, input.previousArtists.length),
    ...detailPageEntries(origin, input.previousArtists, "/records/artists/previous/single", "yearly"),
    ...detailPageEntries(origin, input.clients, "/management/clients", "weekly"),
    ...detailPageEntries(origin, input.team, "/team", "monthly"),
    ...detailPageEntries(origin, input.bookingTalent, "/ninetone-nation", "weekly"),
    ...detailPageEntries(origin, input.news, "/news", "monthly"),
  ];
}

/** Serialize entries to a `urlset` sitemap XML document. */
export function renderUrlsetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : "";
      const changefreq = e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : "";
      return `<url><loc>${escapeXml(e.loc)}</loc>${lastmod}${changefreq}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

/** Serialize a `sitemapindex` document referencing one or more page
 *  sitemaps. Kept generic (a list of absolute URLs) even though Phase 1
 *  only ever has one member — the shape a second sitemap would need later
 *  (e.g. an images sitemap) costs nothing extra now. */
export function renderSitemapIndexXml(sitemapUrls: string[]): string {
  const items = sitemapUrls.map((u) => `<sitemap><loc>${escapeXml(u)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
