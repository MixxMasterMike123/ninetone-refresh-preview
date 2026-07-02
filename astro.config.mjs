// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
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
  trailingSlash: "ignore",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
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
