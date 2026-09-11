import type { APIContext, APIRoute } from "astro";
import {
  getArtists,
  getPreviousArtists,
  getClients,
  getTeam,
  getNews,
  getBookingCategories,
  getWebPosts,
} from "../lib/ninetone";
import {
  buildLlmsTxt,
  bookingTalentLines,
  bookingCategoryLines,
  guideLines,
  LLMS_CHROME_STRINGS,
  type LlmsChromeTable,
} from "../lib/llms";
import { guidesFromCategory } from "../lib/guides";
import { pageJsonLdOrigin } from "../lib/site";
import { sharedT } from "../lib/t.ts";
import type { Lang } from "../lib/translate.ts";

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
 *
 * SECTION 5 (i18n Phase 2) — this file now serves Swedish (the default
 * locale, decision 1) and is also what a CF-target `/en/llms.txt` request
 * renders THROUGH, via src/middleware.ts's locale rewrite: the middleware
 * strips `/en` from ANY pathname (it has no page/endpoint allowlist — only
 * `/en/api/*` and `/en/en/*` are special-cased) and calls
 * `next("/llms.txt")`, which resolves to this exact route file with
 * `locals.lang` already set to "en". `renderLlmsTxt()` below reads
 * `locals.lang` and, for "en", resolves the small fixed chrome vocabulary
 * (LLMS_CHROME_STRINGS — see src/lib/llms.ts's "ENGLISH CONTENT STRATEGY"
 * doc comment for the full reasoning) through `sharedT()`; entity content
 * (every artist/client/team/news/booking/guide line) is never translated
 * here — it renders in whatever language it already exists in.
 *
 * The gh/static target has no rewrite (decision 2 — HAS_RUNTIME-gated in
 * the middleware), so this file alone never produces an /en/ variant
 * there; src/pages/en/llms.txt.ts is the dedicated route that exists for
 * that target (see its own doc comment for why it 404s on gh instead of
 * emitting stale/unreachable content).
 */
export async function renderLlmsTxt(context: APIContext, lang: Lang): Promise<Response> {
  const { request, locals } = context;
  // pageJsonLdOrigin(), not a bare siteOrigin(): on the still-preview gh
  // target the site is served from a sub-path (/ninetone-refresh-preview),
  // and every generated link must resolve there, not 404. Mirrors
  // src/pages/sitemap-pages.xml.ts's own reasoning for the same fix.
  const origin = pageJsonLdOrigin(request);

  const [artists, previousArtists, clients, team, news, bookingCategories, guiderSections] = await Promise.all([
    getArtists(),
    getPreviousArtists(),
    getClients(),
    getTeam(),
    getNews(),
    getBookingCategories(),
    getWebPosts("Guider"),
  ]);

  const bookingLines = bookingTalentLines(bookingCategories, origin);
  // Section 6: one line per Nation category page that actually exists
  // (bookingCategoryLines() applies the same populated-only filter the
  // category page's own getStaticPaths() uses).
  const bookingCatLines = bookingCategoryLines(bookingCategories, origin);
  // Section 7: one line per guide that actually exists (guidesFromCategory()
  // is the exact same helper the guide pages' own getStaticPaths() uses, so
  // this list can't drift from the real routes — [] when "Guider" is absent).
  const guideTxtLines = guideLines(guidesFromCategory(guiderSections[0]), origin);

  // Chrome table (Section 5's English-content strategy — see this file's
  // and src/lib/llms.ts's doc comments). Swedish is the source language
  // these literals are written in (decision 1), so a Swedish render needs
  // no lookups at all: `buildLlmsTxt` already falls back to the source
  // string for any key not present in `chrome`, and `undefined` (no table)
  // behaves identically to an empty one. Only "en" does any translation
  // work, and only for this ~20-string fixed vocabulary — never per-entity
  // content. `sharedT()` (not `createT()` directly) so this shares the
  // per-request budget/memo table with everything else `locals` touches on
  // this request — see src/lib/t.ts's own doc comment (binding note C/D).
  let chrome: LlmsChromeTable | undefined;
  if (lang === "en") {
    // `opts.lang` rather than a `{ ...locals, lang }` spread: the
    // caller-supplied `lang` IS the source of truth for this render
    // (src/pages/en/llms.txt.ts's gh-target guard passes "en" explicitly,
    // independent of whatever locals.lang says), but spreading would hand
    // sharedT a NEW object — and sharedT stashes the per-request
    // RequestBudget on that object and keys its memo WeakMap by its
    // identity. A spread therefore forks both, giving this render a private
    // 25-call ceiling and an empty memo, which is exactly the
    // budget-fragmentation Implementation note C added sharedT to prevent.
    // Harmless at 21 chrome strings; a trap the moment anyone adds more or
    // renders a component here. The override keeps the real locals object.
    const t = sharedT(locals, { lang });
    const entries = await Promise.all(
      LLMS_CHROME_STRINGS.map(async (source) => [source, await t(source)] as const),
    );
    chrome = Object.fromEntries(entries);
  }

  const body = buildLlmsTxt(
    origin,
    {
      artists,
      previousArtists,
      clients,
      team,
      news,
      bookingLines,
      bookingCategoryLines: bookingCatLines,
      guideLines: guideTxtLines,
    },
    { chrome },
  );

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const GET: APIRoute = async (context) => {
  const lang: Lang = (context.locals as { lang?: Lang }).lang ?? "sv";
  return renderLlmsTxt(context, lang);
};
