// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dual-target config — one codebase, two deploys:
 *
 *  - `gh` (default): fully static, served from GH Pages under the preview
 *    sub-path. Content is frozen at build time. This is the review-phase
 *    preview and stays alive until launch.
 *  - `cf` (DEPLOY_TARGET=cf): server-rendered on Cloudflare Workers Static
 *    Assets. Every page renders from live FM data behind the tiered edge
 *    cache in src/middleware.ts. This is the production architecture
 *    (docs/cms-architecture.md) — staging on workers.dev until DNS flips.
 *
 * Build commands: `npm run build` (gh) / `npm run build:cf` (cf).
 *
 * History note (why the adapter was once removed): with static output the
 * adapter wrapped the prerender step in Miniflare, whose fetch failed against
 * the FileMaker host. In cf mode nothing fetches FM at build time — pages
 * render on demand — so that failure mode no longer exists.
 */
const TARGET = process.env.DEPLOY_TARGET === "cf" ? "cf" : "gh";

const site =
  TARGET === "cf"
    ? process.env.SITE_URL ?? "https://ninetone-site.micke-ohlen.workers.dev"
    : "https://mixxmastermike123.github.io";

// Adapter is imported lazily so plain `npm run build` (gh) never loads the
// Cloudflare module graph — it needs Node >=22.15 (module.registerHooks),
// while the static path keeps working on the team's `nvm use 22` default.
const cloudflare = TARGET === "cf" ? (await import("@astrojs/cloudflare")).default : null;

export default defineConfig({
  site,
  // On launch: drop to "/" everywhere (url() becomes a no-op).
  base: TARGET === "cf" ? "/" : "/ninetone-refresh-preview",
  output: TARGET === "cf" ? "server" : "static",
  // Image optimization is unused (plain <img> + FM proxy) — passthrough
  // avoids any IMAGES binding expectations on the Worker.
  adapter: cloudflare ? cloudflare({ imageService: "passthrough" }) : undefined,
  // gh (static): "ignore" — GH Pages serves directory index files
  // (/records/index.html for both /records and /records/), so either shape
  // must keep working with no redirect (there's no server to issue one).
  // cf (server): "never" — canonical shape is the bare path; src/middleware.ts
  // 301s any "/path/" to "/path" ahead of the cache lookup (seo-phase-1b-brief
  // P0 item 5), so a trailing slash is never the URL that gets rendered or
  // cached. Conditional on TARGET the same way `base` and `output` are above.
  trailingSlash: TARGET === "cf" ? "never" : "ignore",
  // SEO Phase 1 §8 — legacy path redirects, both 301.
  //
  // Destinations are written as bare logical paths (no `base` prefix) to
  // match every other route string in this config/codebase; Astro does not
  // prepend `base` to redirect destinations itself (known inconsistency,
  // see withastro/astro#7774), so these are only guaranteed correct on the
  // `cf` target, where `base` is "/" and the bare path IS the real path.
  // That's fine: the `gh` target is the noindexed preview with no inbound
  // links to these legacy paths, and GitHub Pages has no server-side
  // redirect mechanism anyway — Astro's static build falls back to a
  // <meta http-equiv="refresh"> HTML page for `redirects` entries there,
  // which is the correct and expected outcome on that platform, not a bug.
  //
  // DEVIATION FROM BRIEF: the brief's target for /previous-artists is
  // "/records/artists/previous/1", which does not exist. Astro's
  // paginate() (src/pages/records/artists/previous/[...page].astro) emits
  // page 1 at the route's own BARE path and pages 2+ at "/previous/{n}" —
  // confirmed in src/lib/routes.ts's STATIC_ROUTES comment and in a fresh
  // build (dist/records/artists/previous/index.html exists,
  // dist/records/artists/previous/1/ does not). Redirecting to ".../1"
  // would 404. Redirect to the bare path instead, matching the existing
  // (currently-inert on both deploy targets — see public/_redirects and
  // DEPLOY.md) /previous-artists rule and every other internal link to
  // this page (ArtistsTabs.astro, Footer.astro).
  redirects: {
    "/previous-artists": {
      status: 301,
      destination: "/records/artists/previous",
    },
    // The old site had per-artist deep links under /previous-artists/single/,
    // which is exactly the shape that survives in the wild (Discogs, forums,
    // old press). public/_redirects still carries the legacy rules and is
    // where these came from. Astro's [slug] param is carried through to the
    // destination by name.
        // SEO Phase 1b P0 §2 — the *live* legacy site actually serves per-artist
    // pages at the bare "/previous-artists/<slug>" (no "/single/" segment):
    // verified "/previous-artists/kuokka" is 200 there while
    // "/previous-artists/single/kuokka" 404s. So this shorter shape needs its
    // own rule, not just the /single/ one above.
    //
    // Ordering vs. "/previous-artists/single/[slug]" above: Astro's route
    // comparator (core/routing/priority.js) sorts by per-segment specificity,
    // not config declaration order — a literal path segment always outranks
    // a dynamic one at the same position. At segment 1, "single" (literal)
    // beats "[slug]" (dynamic), so "/previous-artists/single/kuokka" always
    // resolves against the "/single/[slug]" rule above and lands on
    // ".../previous/single/kuokka" — never on this rule, which would
    // otherwise produce the wrong ".../previous/single/single" double-single
    // bug. Confirmed by reading the comparator, not assumed.
    //
    // _redirects collision check: on the `cf` target this never touches
    // public/_redirects at all — Astro's `redirects` entries are real
    // Worker-rendered routes (core/redirects/render.js returns the 301
    // Response directly), and the same specificity-based router picks the
    // right one before falling through to anything static-asset-shaped. On
    // the `gh` static target, Astro appends "/previous-artists/:slug ...
    // 301" to public/_redirects's existing "/previous-artists/* ... 301"
    // splat line — two different literal patterns (single dynamic segment
    // vs. a splat), not the same path string, so this does not reproduce the
    // "Duplicate rule for path" failure from Phase 1 (that was two rules for
    // the *identical* path). It's moot either way: GH Pages never reads
    // _redirects (falls back to the <meta http-equiv="refresh"> page, see
    // the /previous-artists rule above), and only `wrangler deploy` for `cf`
    // parses that file, where these routes are Worker-rendered and never
    // reach it.
        // The old `_redirects` splat rule (/previous-artists/* -> .../previous/:splat)
    // has no Astro equivalent: Astro validates that a dynamic redirect's
    // destination matches a real route, and the paginated route's param is
    // named [...page], so "/records/artists/previous/[...rest]" is rejected
    // as InvalidRedirectDestination. Matching the name doesn't help either —
    // the legacy paths beneath /previous-artists were per-artist detail
    // pages (covered by the /single/[slug] and [slug] rules above), not
    // pagination, so a splat would mostly map onto URLs that never existed.
    // Deliberately omitted rather than forced.
    "/blog": {
      status: 301,
      destination: "/news",
    },
  },
  // No integrations: src/pages/sitemap-index.xml.ts + sitemap-pages.xml.ts
  // (SEO Phase 1 §3) replace @astrojs/sitemap with hand-written endpoints
  // that use siteOrigin() and the real FM list helpers — see that file's
  // doc comment for why the integration was dropped rather than kept
  // alongside them.
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
    define: {
      // Baked per build. Part of every edge-cache key (src/middleware.ts) so a
      // DEPLOY naturally starts a fresh cache generation — old-code pages are
      // never served after a release. Content freshness is the KV epoch's job.
      __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
      // Single source of truth for "are we on the Cloudflare (server) target".
      // DEPLOY_TARGET itself is a build-time process.env var, invisible to
      // client <script> tags and not conventionally read from Astro
      // frontmatter — this re-exposes the same decision as a PUBLIC_ var so
      // components can branch consistently in both places via
      // `import.meta.env.PUBLIC_HAS_RUNTIME`.
      "import.meta.env.PUBLIC_HAS_RUNTIME": JSON.stringify(TARGET === "cf"),
    },
    build: {
      rollupOptions: {
        // src/lib/cf.ts imports this dynamically; in the gh/static build it
        // must stay external (Node throws at runtime and we catch it — the
        // cf adapter externalizes it itself).
        external: ["cloudflare:workers"],
      },
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "sv"],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
});
