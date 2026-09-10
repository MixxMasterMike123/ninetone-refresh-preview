import type { APIRoute } from "astro";
import { getArtists, getPreviousArtists, getClients, getTeam, getNews, getBookingCategories } from "../lib/ninetone";
import { buildLlmsTxt, bookingTalentLines } from "../lib/llms";
import { pageJsonLdOrigin } from "../lib/site";

/**
 * /llms.txt — generated from FM roster data, per docs/seo-strategy-2026-09.md
 * Appendix B. Uses the same list helpers the sitemap and index pages already
 * fetch with (src/lib/ninetone.ts) — no new FM reads. `{slug}` expansion and
 * section structure live in src/lib/llms.ts (kept pure/unit-tested, mirroring
 * src/lib/sitemap.ts's split from src/pages/sitemap-pages.xml.ts).
 *
 * Static routes for company/contact links are inlined directly below rather
 * than imported from src/lib/routes.ts: only a handful of top-level links are
 * needed here (Records/Management/Nation/Team/News/Privacy landings) versus
 * the sitemap's full static-route list, and each is written next to the
 * FM-driven entity lines it introduces (see src/lib/llms.ts buildLlmsTxt) so
 * adding Sections 6/7's category and guide links is a one-line addition per
 * section rather than a cross-file change.
 *
 * Per the strategy doc's own honesty note: llms.txt has negligible measured
 * effect on AI citation today. Shipped anyway as cheap agent infrastructure
 * (IDE/coding agents, MCP doc servers) — expect nothing from it.
 *
 * No explicit `prerender` export, same reasoning as robots.txt.ts: Astro's
 * per-target default (static build => prerendered at build time from FM data
 * available then; server build => rendered per-request from live FM data) is
 * exactly right for both targets here — this endpoint has no runtime-only
 * branching that would need forcing either way.
 */
export const GET: APIRoute = async ({ request }) => {
  // pageJsonLdOrigin(), not a bare siteOrigin(): on the still-preview gh
  // target the site is served from a sub-path (/ninetone-refresh-preview),
  // and every generated link must resolve there, not 404. Mirrors
  // src/pages/sitemap-pages.xml.ts's own reasoning for the same fix.
  const origin = pageJsonLdOrigin(request);

  const [artists, previousArtists, clients, team, news, bookingCategories] = await Promise.all([
    getArtists(),
    getPreviousArtists(),
    getClients(),
    getTeam(),
    getNews(),
    getBookingCategories(),
  ]);

  const bookingLines = bookingTalentLines(bookingCategories, origin);

  const body = buildLlmsTxt(origin, { artists, previousArtists, clients, team, news, bookingLines });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
