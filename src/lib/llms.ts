/**
 * Pure llms.txt body builder. No I/O, no Astro globals — the endpoint
 * (src/pages/llms.txt.ts) fetches the FM list data that's already fetched
 * elsewhere (same helpers the sitemap and index pages use,
 * src/lib/ninetone.ts) and passes it in as plain arrays. Kept separate and
 * pure, mirroring src/lib/sitemap.ts's split, so it's unit-testable without a
 * build (test/robots-llms.test.mjs).
 *
 * This module only `import type`s from src/lib/ninetone.ts (erased at
 * runtime, so it never pulls in that file's FileMaker import chain). It does
 * take one real value import, markdownToPlainText from ./schema.ts, which in
 * turn imports renderBio (marked) — that chain is lightweight and has no FM
 * dependency, so it doesn't reintroduce the problem the type-only import
 * from ninetone.ts avoids; it's just not accurate to describe the whole file
 * as type-only, so noting it here explicitly.
 *
 * Content per docs/seo-strategy-2026-09.md Appendix B ("llms.txt skeleton"):
 * static section links plus one factual line per FM entity (name,
 * category/genre if present, tagline as plain text, absolute URL) — never
 * marketing copy, since this file is parsed rather than read.
 */

import type { Artist, TeamMember, WebPost } from "./ninetone.ts";
import { markdownToPlainText } from "./schema.ts";

/** One factual line: "- [Name](url): detail". */
function entityLine(name: string, path: string, origin: string, detail?: string): string {
  const href = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const suffix = detail ? `: ${detail}` : "";
  return `- [${name}](${href})${suffix}`;
}

/** Join non-empty fragments (genre, category, tagline) with an em dash —
 *  the "one factual line per entity" shape the brief calls for. */
function factualDetail(parts: Array<string | undefined | null>): string | undefined {
  const clean = parts.map((p) => (p ? p.trim() : "")).filter(Boolean);
  return clean.length > 0 ? clean.join(" — ") : undefined;
}

function splitGenre(v: unknown): string | undefined {
  if (!v) return undefined;
  const first = String(v).split(/\r|\n|,/).map((s) => s.trim()).filter(Boolean)[0];
  return first || undefined;
}

export function artistLine(a: Artist, origin: string): string | null {
  const slug = String(a.SLUG ?? "");
  const name = String(a["Head Artist"] ?? "");
  if (!slug || !name) return null;
  const genre = splitGenre(a.genre);
  const tagline = markdownToPlainText(String(a["Artist Presentation Title"] ?? ""), 140);
  return entityLine(name, `/records/artists/${slug}`, origin, factualDetail([genre, tagline || undefined]));
}

export function previousArtistLine(a: Artist, origin: string): string | null {
  const slug = String(a.SLUG ?? "");
  const name = String(a["Head Artist"] ?? "");
  if (!slug || !name) return null;
  const genre = splitGenre(a.genre);
  // Real route is /records/artists/previous/single/{slug} (verified against
  // src/pages/records/artists/previous/single/[slug].astro and the existing
  // search-index.json.ts generator, and matching src/lib/sitemap.ts's own
  // detailPageEntries prefix for previous artists) — the brief's Appendix B
  // skeleton shows a shorter "/records/artists/previous/{slug}" shape, which
  // does not match an actual route in this repo. Using the real, reachable
  // URL rather than the skeleton's literal text.
  return entityLine(
    name,
    `/records/artists/previous/single/${slug}`,
    origin,
    factualDetail([genre, "previous artist"]),
  );
}

export function clientLine(c: Artist, origin: string): string | null {
  const slug = String(c.SLUG ?? "");
  const name = String(c["Head Artist"] ?? "");
  if (!slug || !name) return null;
  const category = splitGenre(c.tags ?? c.genre);
  const tagline = markdownToPlainText(String(c.clientPresentationTitle ?? ""), 140);
  return entityLine(name, `/management/clients/${slug}`, origin, factualDetail([category, tagline || undefined]));
}

export function teamLine(m: TeamMember, origin: string): string | null {
  const slug = String(m.SLUG ?? "");
  const name = String(m.userNameCalc ?? "");
  if (!slug || !name) return null;
  const title = String(m.title ?? "").trim();
  return entityLine(name, `/team/${slug}`, origin, factualDetail([title || undefined]));
}

export function newsLine(p: WebPost, origin: string): string | null {
  const slug = String(p.SLUG ?? p.slug ?? "");
  const title = String(p.Title ?? p.title ?? "");
  if (!slug || !title) return null;
  const date = String(p.Date ?? "").trim();
  return entityLine(title, `/news/${slug}`, origin, factualDetail([date || undefined]));
}

/** One line per active Nation booking talent, deduped across categories
 *  (an artist bookable in more than one category gets one line, tagged with
 *  the first category encountered). Takes already-fetched category data
 *  (src/lib/ninetone.ts's getBookingCategories() shape) — no FM read here. */
export function bookingTalentLines(
  categories: Array<{ tag: string; artists: Array<{ slug: string; name: string; tagline: string }> }>,
  origin: string,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const cat of categories) {
    for (const a of cat.artists) {
      if (!a.slug || !a.name || seen.has(a.slug)) continue;
      seen.add(a.slug);
      const tagline = markdownToPlainText(a.tagline, 140);
      lines.push(
        entityLine(a.name, `/ninetone-nation/${a.slug}`, origin, factualDetail([cat.tag, tagline || undefined])),
      );
    }
  }
  return lines;
}

export interface LlmsTxtData {
  artists: Artist[];
  previousArtists: Artist[];
  clients: Artist[];
  team: TeamMember[];
  news: WebPost[];
  /** Pre-expanded ("- [Name](url): detail") lines — see bookingTalentLines(). */
  bookingLines: string[];
}

/**
 * Build the full llms.txt body. Structured as an ordered list of sections —
 * each a heading plus static links plus (for the roster sections) FM-driven
 * entity lines — so Sections 6/7 (Nation category pages, guides route) can
 * each add one more section without restructuring anything.
 */
export function buildLlmsTxt(origin: string, data: LlmsTxtData): string {
  const artistLines = data.artists.map((a) => artistLine(a, origin)).filter((l): l is string => !!l);
  const previousLines = data.previousArtists
    .map((a) => previousArtistLine(a, origin))
    .filter((l): l is string => !!l);
  const clientLines = data.clients.map((c) => clientLine(c, origin)).filter((l): l is string => !!l);
  const teamLines = data.team.map((m) => teamLine(m, origin)).filter((l): l is string => !!l);
  const newsLines = data.news.map((p) => newsLine(p, origin)).filter((l): l is string => !!l);

  const sections: string[] = [];

  sections.push("# Ninetone Group");
  sections.push(
    "> Swedish music company based in Sundsvall and Stockholm. Three divisions:\n" +
      "> Ninetone Records (label), Ninetone Management (artist and creator\n" +
      "> management), Ninetone Nation (booking for events).",
  );

  sections.push(
    [
      "## Ninetone Records",
      entityLine("Artists", "/records/artists", origin, "current roster"),
      ...artistLines,
      // Real route is the bare /records/artists/previous (Astro's paginate()
      // emits page 1 unsuffixed in [...page].astro; pages 2+ get /previous/{n})
      // — verified against a fresh dist/ build: dist/records/artists/previous/
      // index.html exists, dist/records/artists/previous/1/ does not. The
      // brief's Appendix B skeleton writes "/records/artists/previous/1",
      // which 404s; using the real, reachable URL instead, same as the
      // previous/single/{slug} deviation below.
      entityLine("Previous artists", "/records/artists/previous", origin),
      ...previousLines,
      entityLine("Contact Records", "/records/contact-records", origin, "demo submissions"),
    ].join("\n"),
  );

  sections.push(
    [
      "## Ninetone Management",
      entityLine("Clients", "/management/clients", origin, "managed artists and creators"),
      ...clientLines,
      entityLine("Contact Management", "/management/contact-management", origin),
    ].join("\n"),
  );

  sections.push(
    [
      "## Ninetone Nation",
      entityLine("Booking", "/ninetone-nation/booking", origin, "bookable talent by category"),
      ...data.bookingLines,
      entityLine("Contact Nation", "/ninetone-nation/contact-ninetone-nation", origin),
    ].join("\n"),
  );

  sections.push(
    [
      "## Company",
      entityLine("Team", "/team", origin),
      ...teamLines,
      entityLine("News", "/news", origin),
      ...newsLines,
      entityLine("Privacy", "/integritet", origin),
    ].join("\n"),
  );

  return `${sections.join("\n\n")}\n`;
}
