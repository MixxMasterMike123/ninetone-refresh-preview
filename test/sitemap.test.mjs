import assert from "node:assert/strict";
import test from "node:test";

import {
  staticRouteEntries,
  detailPageEntries,
  previousArtistsPaginationEntries,
  buildSitemapEntries,
  renderUrlsetXml,
  renderSitemapIndexXml,
} from "../src/lib/sitemap.ts";
import { STATIC_ROUTES, staticRoutePaths } from "../src/lib/routes.ts";

const ORIGIN = "https://ninetone.com";

test("staticRouteEntries: one entry per route, absolute, under the origin", () => {
  const entries = staticRouteEntries(ORIGIN, [
    { path: "/", changefreq: "daily" },
    { path: "/records", changefreq: "weekly" },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].loc, "https://ninetone.com/");
  assert.equal(entries[1].loc, "https://ninetone.com/records");
  for (const e of entries) assert.ok(e.loc.startsWith(ORIGIN));
});

test("detailPageEntries: builds one URL per row keyed on SLUG (uppercase field)", () => {
  const rows = [{ SLUG: "anjo" }, { SLUG: "some-artist" }];
  const entries = detailPageEntries(ORIGIN, rows, "/records/artists", "weekly");
  assert.deepEqual(
    entries.map((e) => e.loc),
    ["https://ninetone.com/records/artists/anjo", "https://ninetone.com/records/artists/some-artist"],
  );
  assert.equal(entries[0].changefreq, "weekly");
});

test("detailPageEntries: also accepts lowercase slug field (news posts)", () => {
  const rows = [{ slug: "a-headline" }];
  const entries = detailPageEntries(ORIGIN, rows, "/news");
  assert.deepEqual(entries.map((e) => e.loc), ["https://ninetone.com/news/a-headline"]);
});

test("detailPageEntries: skips rows with no usable slug rather than emitting a bare prefix URL", () => {
  const rows = [{ SLUG: "" }, {}, { SLUG: "valid" }];
  const entries = detailPageEntries(ORIGIN, rows, "/team");
  assert.deepEqual(entries.map((e) => e.loc), ["https://ninetone.com/team/valid"]);
});

test("detailPageEntries: strips a trailing slash from pathPrefix so no double-slash appears", () => {
  const entries = detailPageEntries(ORIGIN, [{ SLUG: "x" }], "/team/");
  assert.equal(entries[0].loc, "https://ninetone.com/team/x");
});

test("detailPageEntries: never emits a lastmod — no FM layout in scope exposes a real modification timestamp", () => {
  const entries = detailPageEntries(ORIGIN, [{ SLUG: "x" }], "/records/artists");
  assert.equal(entries[0].lastmod, undefined);
});

test("previousArtistsPaginationEntries: 0 extra pages when the roster fits on page 1", () => {
  const entries = previousArtistsPaginationEntries(ORIGIN, 1, 30);
  assert.equal(entries.length, 0);
});

test("previousArtistsPaginationEntries: derives page count from total/pageSize, starting at page 2 (page 1 is the bare static route)", () => {
  const entries = previousArtistsPaginationEntries(ORIGIN, 342, 30); // matches ninetone.ts's own "342 records as of writing" comment
  // ceil(342/30) = 12 total pages -> pages 2..12 = 11 entries
  assert.equal(entries.length, 11);
  assert.deepEqual(
    entries.map((e) => e.loc),
    Array.from({ length: 11 }, (_, i) => `https://ninetone.com/records/artists/previous/${i + 2}`),
  );
});

test("previousArtistsPaginationEntries: recomputes page count for a smaller/larger total (self-maintaining, not hardcoded)", () => {
  assert.equal(previousArtistsPaginationEntries(ORIGIN, 60, 30).length, 1); // pages 1-2, only page 2 extra
  assert.equal(previousArtistsPaginationEntries(ORIGIN, 61, 30).length, 2); // pages 1-3
  assert.equal(previousArtistsPaginationEntries(ORIGIN, 0, 30).length, 0);
});

function stubbedLists() {
  return {
    staticRoutes: STATIC_ROUTES,
    artists: [{ SLUG: "artist-a" }, { SLUG: "artist-b" }],
    previousArtists: Array.from({ length: 65 }, (_, i) => ({ SLUG: `old-artist-${i}` })),
    clients: [{ SLUG: "client-a" }, { SLUG: "client-b" }, { SLUG: "client-c" }],
    team: [{ SLUG: "team-a" }],
    bookingTalent: [{ SLUG: "talent-a" }, { SLUG: "talent-b" }],
    news: [{ slug: "post-a" }],
  };
}

test("buildSitemapEntries: produces exactly N entries for stubbed lists (static + every detail row + previous-artist pagination pages)", () => {
  const input = stubbedLists();
  const entries = buildSitemapEntries(ORIGIN, input);
  const expectedPaginationPages = previousArtistsPaginationEntries(ORIGIN, input.previousArtists.length).length;
  const expectedCount =
    input.staticRoutes.length +
    input.artists.length +
    expectedPaginationPages +
    input.previousArtists.length +
    input.clients.length +
    input.team.length +
    input.bookingTalent.length +
    input.news.length;
  assert.equal(entries.length, expectedCount);
  // With 65 previous artists at page size 30: ceil(65/30) = 3 pages -> 2 extra (pages 2, 3).
  assert.equal(expectedPaginationPages, 2);
});

test("buildSitemapEntries: previous-artist pagination page 1 is NOT duplicated (only the bare static route represents it)", () => {
  const entries = buildSitemapEntries(ORIGIN, stubbedLists());
  const locs = entries.map((e) => e.loc);
  assert.ok(locs.includes("https://ninetone.com/records/artists/previous")); // from STATIC_ROUTES
  assert.ok(!locs.includes("https://ninetone.com/records/artists/previous/1"));
  assert.ok(locs.includes("https://ninetone.com/records/artists/previous/2"));
  assert.ok(locs.includes("https://ninetone.com/records/artists/previous/3"));
});

test("buildSitemapEntries: no duplicate <loc> values", () => {
  const entries = buildSitemapEntries(ORIGIN, stubbedLists());
  const locs = entries.map((e) => e.loc);
  assert.equal(new Set(locs).size, locs.length);
});

test("buildSitemapEntries: every <loc> is absolute and under the given origin", () => {
  const entries = buildSitemapEntries(ORIGIN, stubbedLists());
  for (const e of entries) {
    assert.ok(e.loc.startsWith(`${ORIGIN}/`) || e.loc === ORIGIN, `${e.loc} not under ${ORIGIN}`);
    assert.doesNotThrow(() => new URL(e.loc));
  }
});

test("buildSitemapEntries: same detail-page path shapes the index pages actually use", () => {
  const entries = buildSitemapEntries(ORIGIN, stubbedLists());
  const locs = entries.map((e) => e.loc);
  assert.ok(locs.includes("https://ninetone.com/records/artists/artist-a"));
  assert.ok(locs.includes("https://ninetone.com/records/artists/previous/single/old-artist-0"));
  assert.ok(locs.includes("https://ninetone.com/management/clients/client-a"));
  assert.ok(locs.includes("https://ninetone.com/team/team-a"));
  assert.ok(locs.includes("https://ninetone.com/ninetone-nation/talent-a"));
  assert.ok(locs.includes("https://ninetone.com/news/post-a"));
});

test("buildSitemapEntries: with empty FM lists, only the static routes appear", () => {
  const entries = buildSitemapEntries(ORIGIN, {
    staticRoutes: STATIC_ROUTES,
    artists: [],
    previousArtists: [],
    clients: [],
    team: [],
    bookingTalent: [],
    news: [],
  });
  assert.equal(entries.length, STATIC_ROUTES.length);
});

test("routes.ts: staticRoutePaths() excludes admin/api/search-result", () => {
  const paths = staticRoutePaths();
  for (const p of paths) {
    assert.ok(!p.startsWith("/admin"), p);
    assert.ok(!p.startsWith("/api"), p);
    assert.notEqual(p, "/search-result");
  }
});

test("renderUrlsetXml: valid-looking XML, one <url> per entry, lastmod omitted when absent", () => {
  const xml = renderUrlsetXml([
    { loc: "https://ninetone.com/records" },
    { loc: "https://ninetone.com/news/post-a", lastmod: "2026-01-05" },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url>/g) ?? []).length, 2);
  assert.ok(xml.includes("<loc>https://ninetone.com/records</loc>"));
  assert.ok(!xml.includes("https://ninetone.com/records</loc><lastmod>"));
  assert.ok(xml.includes("<lastmod>2026-01-05</lastmod>"));
});

test("renderUrlsetXml: escapes XML-special characters in <loc>", () => {
  const xml = renderUrlsetXml([{ loc: "https://ninetone.com/news/a&b" }]);
  assert.ok(xml.includes("a&amp;b"));
  assert.ok(!xml.includes("a&b<"));
});

test("renderSitemapIndexXml: one <sitemap> entry per URL given", () => {
  const xml = renderSitemapIndexXml(["https://ninetone.com/sitemap-pages.xml"]);
  assert.match(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 1);
  assert.ok(xml.includes("<loc>https://ninetone.com/sitemap-pages.xml</loc>"));
});
