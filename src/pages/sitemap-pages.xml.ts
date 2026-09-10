import type { APIRoute } from "astro";
import {
  getArtists,
  getPreviousArtists,
  getClients,
  getTeam,
  getAllActiveBookingSlugs,
  getBookingCategories,
  getNews,
  getWebPosts,
} from "../lib/ninetone";
import { STATIC_ROUTES } from "../lib/routes";
import { buildSitemapEntries, renderUrlsetXml } from "../lib/sitemap";
import { guidesFromCategory } from "../lib/guides";
import { pageJsonLdOrigin } from "../lib/site";

/**
 * The page sitemap referenced by /sitemap-index.xml. Lists every static
 * route (src/lib/routes.ts) plus every active artist, previous artist,
 * client, team member, Nation talent, and news article — using the same
 * list helpers the index pages already fetch with (src/lib/ninetone.ts), so
 * this can never enumerate a detail page that doesn't actually exist.
 *
 * Deliberately excludes: /admin, /api, /search-result, and contact
 * thank-you states (there are none as distinct routes — see routes.ts doc).
 *
 * Runs prerendered on the static (gh) target (Astro forces full prerender
 * under output: "static", so no explicit `export const prerender` is
 * needed there) and per-request on the CF (server) target, where it reads
 * live FM data and the real request origin — exactly the "replace
 * @astrojs/sitemap's output with our own endpoint" behaviour the brief asks
 * for on that target.
 *
 * Uses pageJsonLdOrigin() rather than a bare siteOrigin(): on the still-
 * preview gh target the site is served from a sub-path
 * (`/ninetone-refresh-preview`), and every <loc> must be a URL that actually
 * resolves there, not 404 — the same "GH Pages sub-path leaked out of an
 * absolute URL built from a bare origin" bug jsonLdOrigin()/
 * pageJsonLdOrigin() (src/lib/site.ts) already exist to prevent for JSON-LD.
 * Once PUBLIC_SITE_ORIGIN is set (production-shaped), this is a no-op
 * passthrough of siteOrigin() — see jsonLdOrigin()'s own doc comment.
 */
export const GET: APIRoute = async ({ request }) => {
  const origin = pageJsonLdOrigin(request);

  const [artists, previousArtists, clients, team, bookingSlugs, bookingCategories, news, guiderSections] =
    await Promise.all([
      getArtists(),
      getPreviousArtists(),
      getClients(),
      getTeam(),
      getAllActiveBookingSlugs(),
      getBookingCategories(),
      getNews(),
      getWebPosts("Guider"),
    ]);
  // Section 7: guides derived from the same helper the guide pages'
  // getStaticPaths() uses, so a guide can never appear here without a real
  // page behind it (or vice versa).
  const guides = guidesFromCategory(guiderSections[0]);

  const entries = buildSitemapEntries(origin, {
    staticRoutes: STATIC_ROUTES,
    artists,
    previousArtists,
    clients,
    team,
    // getAllActiveBookingSlugs() (not getBookingRoster()) — this is the
    // EXACT set /ninetone-nation/[slug].astro generates pages for (via
    // getBookingPageSet(), same underlying helper). getBookingRoster() is
    // the stricter API_Booking query and misses booking-only talents that
    // exist only in the API_BOOKING_TAG portal (e.g. Quireboys, Asta Kask —
    // see ninetone.ts's own comment on getBookingPageSet). The two sets
    // happen to coincide today but will silently diverge the moment such a
    // talent reappears; using the roster helper here would then omit a real
    // page from the sitemap.
    bookingTalent: bookingSlugs.map((slug) => ({ SLUG: slug })),
    // Section 6 category pages (src/pages/ninetone-nation/kategori/[category].astro)
    // — bookingCategoryEntries() applies the same "at least one artist"
    // filter that page's getStaticPaths() uses, so only populated categories
    // ever appear here.
    bookingCategories,
    news,
    guides,
  });

  return new Response(renderUrlsetXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
