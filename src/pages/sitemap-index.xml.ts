import type { APIRoute } from "astro";
import { renderSitemapIndexXml } from "../lib/sitemap";
import { pageJsonLdOrigin } from "../lib/site";

/**
 * Sitemap index — the single URL submitted to search engines
 * (`Sitemap: ${origin}/sitemap-index.xml` in robots.txt, Section 4). Today
 * it references exactly one page sitemap (sitemap-pages.xml.ts); kept as an
 * index rather than a single flat sitemap so a second one (e.g. an images
 * sitemap) can be added later without changing the submitted URL.
 *
 * @astrojs/sitemap was dropped (see astro.config.mjs) in favour of this
 * hand-written pair of endpoints — the integration only knows about routes
 * it can discover from the static build output, with no way to attach real
 * FM data, our own lastmod rules, or siteOrigin()-based URLs, and it would
 * have collided with this file's own default output path
 * (sitemap-index.xml) had it been kept. One implementation, both targets:
 * prerendered automatically under output: "static" (gh), server-rendered
 * per-request under output: "server" (cf) — same file, same logic, correct
 * origin resolution on both.
 *
 * Uses pageJsonLdOrigin() rather than a bare siteOrigin() so the referenced
 * sitemap-pages.xml URL actually resolves under the GH Pages preview
 * sub-path too (see sitemap-pages.xml.ts's doc comment for the full
 * rationale) — a no-op passthrough of siteOrigin() once production-shaped.
 */
export const GET: APIRoute = async ({ request }) => {
  const origin = pageJsonLdOrigin(request);
  const xml = renderSitemapIndexXml([`${origin}/sitemap-pages.xml`]);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
