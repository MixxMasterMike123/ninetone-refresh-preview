# SEO Phase 1 — implementation brief

Companion to [seo-strategy-2026-09.md](seo-strategy-2026-09.md). This is the build spec for the code items in Phase 1. Written so an agent can execute it without re-deciding anything. Work on branch `seo-phase-1`; deploy to staging only; Fable reviews before merge to main.

## Ground rules

- Read CLAUDE.md and DESIGN.md first. No FileMaker-side changes. All FM reads through the existing helpers in `src/lib/ninetone.ts`. Every internal URL through `url()`.
- **Origin is never hardcoded.** Add `src/lib/site.ts` exporting `siteOrigin(request?: Request): string` which returns, in order: `PUBLIC_SITE_ORIGIN` env if set; else on the CF target the request origin (from `Astro.url` / `request.url`); else the static `site` from `astro.config.mjs`. Every canonical, OG URL, sitemap `<loc>`, llms.txt link and JSON-LD `url`/`@id` goes through it. When ninetone.com goes live, nothing changes but one env var.
- Both build targets must keep passing: `npm run build` (static GH Pages, sub-path base) and `npm run build:cf` (SSR). Anything runtime-only is guarded by `PUBLIC_HAS_RUNTIME` the way `ContactForm.astro` does it.
- Tests in `test/` with node:test, same style as `test/contact.test.mjs`. Pure builders get unit tests; endpoints get handler-level tests with stubbed data.
- Design rules still apply to any visible change (favicons/theme colour are not visible; category pages and guides route are, and follow the Editorial section archetype in DESIGN.md §3A).

## 1. Head metadata — `src/layouts/Base.astro`

Extend Props: `canonical?: string` (absolute or path; default = current path), `ogImage?: string` (absolute; default = a static `/og-default.png` to be added to `public/`, 1200×630, paper canvas with the wordmark — generate with an existing image tool, keep under 200 KB), `ogType?: "website" | "article" | "profile"` (default `website`), `noindex?: boolean` (page-level override, ORed with the env flag), `jsonLd?: object | object[]`.
Emit: `<link rel="canonical">`, `og:site_name` "Ninetone Group", `og:title`, `og:description`, `og:url`, `og:image`, `og:type`, `og:locale` from `lang` (`sv_SE` / `en_GB`), `twitter:card=summary_large_image`, `twitter:title/description/image`, `<meta name="theme-color" content="#f5f3ee">`, the favicon set (`favicon.svg` type image/svg+xml, `favicon.ico` sizes 32x32, `apple-touch-icon` 180×180 to be generated into `public/`). Strip the sub-path base from canonical on the static target only if `url()` already adds it; canonical must be the absolute production-shaped URL, never the GH Pages one, when `PUBLIC_SITE_ORIGIN` is set.
OG image per page type: artist/client/talent hero image (proxy URL, already absolute), news lead image, else default.

## 2. Structured data — `src/components/JsonLd.astro` + `src/lib/schema.ts`

`JsonLd.astro` renders one `<script type="application/ld+json">` per object, JSON-escaped for `</script>` (replace `<` with `<`). `src/lib/schema.ts` exports pure builders returning plain objects, each unit-tested:
- `organization(origin)` — `@type: Organization`, `@id: origin + "/#org"`, name "Ninetone Group", url, logo (absolute), `sameAs`: Wikidata `https://www.wikidata.org/wiki/Q7038555`, `https://en.wikipedia.org/wiki/Ninetone_Records`, LinkedIn `https://www.linkedin.com/company/ninetone`, `https://www.facebook.com/ninetone`, `https://www.youtube.com/c/Ninetone`, `https://soundcloud.com/ninetonegroup`, plus Instagram if present in Footer socials. `contactPoint` ×2: booking@ninetone.com (contactType "sales", areaServed SE) and office@ninetone.com ("customer service"). `address`: Sundsvall, SE (no street unless it already appears on the site).
- `website(origin)` — `WebSite` with `potentialAction: SearchAction` targeting `${origin}/search-result?q={search_term_string}` (verify the real query param in `search-result.astro` first).
- `breadcrumbs(origin, items: {name, path}[])`.
- `musicGroup(origin, artist)` for `/records/artists/{slug}`: name, url, image, description (tagline or first 200 chars of blurb, plain text), `sameAs` from `url_spotify`, `url_applemusic`, `url_youtube_music`, `url_youtube_link`, `url_instagram`, `url_tiktok_artist`, `url_facebook`, `url_twitter` (only http(s) values, reuse `externalUrl()` from `src/lib/url.ts`), `memberOf` → org `@id`. If releases are in scope on the page, `album: MusicAlbum[]` with name, datePublished (ISO), image, url.
- `person(origin, entity, {role, worksFor})` for management clients (`Person`, `sameAs` as above), team (`Person` + `jobTitle` + `worksFor`), Nation talent (`Person` + `sameAs` + `offers: Offer { availability: InStock, url: ${origin}/ninetone-nation/contact-ninetone-nation }` and `additionalType` per booking category).
- `newsArticle(origin, post)` — headline, datePublished, dateModified (fall back to datePublished), image, articleBody plain text (strip markdown via the existing renderer then tags), `publisher` → org `@id`, `mainEntityOfPage`.
- `collectionPage(origin, {name, path, items: {name, path}[]})` — `CollectionPage` + `mainEntity: ItemList`.
- `faqPage(items: {q, a}[])`.
- `contactPage(origin, path)`.
Wire: every page gets `organization` + `website`; detail pages add breadcrumbs + their entity; booking index gets `collectionPage`; contact pages `contactPage`. No new FM reads: builders take the data already in scope.

## 3. Dynamic sitemap — `src/pages/sitemap-index.xml.ts` + `src/pages/sitemap-pages.xml.ts`

On the CF target, replace `@astrojs/sitemap`'s output with our own endpoints (keep the integration for the static target if it is simpler; otherwise drop it and serve the same endpoints prerendered). `sitemap-pages.xml` lists: static routes (from a hand-maintained list in `src/lib/routes.ts`, also used by llms.txt), plus every active artist, previous artist, client, team member, Nation talent, and news article, using the same list helpers the index pages use. `<lastmod>` from FM modification timestamps where a field exists in the fetched data, else omitted (never fake it). Origin via `siteOrigin()`. `Cache-Control: public, max-age=3600`. Exclude `/admin`, `/api`, `/search-result`, contact thank-you states. Test: builder produces N entries for stubbed lists, no duplicates, all absolute, all under the origin.

## 4. robots.txt and llms.txt as endpoints

Delete `public/robots.txt`. Add `src/pages/robots.txt.ts`: if `PUBLIC_NOINDEX !== "false"` serve `User-agent: *\nDisallow: /`; else serve Variant A from the strategy appendix with `Sitemap: ${origin}/sitemap-index.xml` and the `Content-Signal` line. Add `src/pages/llms.txt.ts` generating Appendix B with `{slug}` expanded from the same helpers as the sitemap, one factual line per entity (name, category/genre if present, tagline plain text, absolute URL). Both `text/plain; charset=utf-8`, `Cache-Control: public, max-age=3600`. Remove the `X-Robots-Tag` block from `public/_headers` only when the env flag flips (leave a comment linking the launch checklist); do not remove it now.

## 5. Meta descriptions

Pass `description` from each page for: home, `/records`, `/management`, `/ninetone-nation`, `/records/artists`, `/management/clients`, `/team`, `/news`, `/ninetone-nation/booking`, the three contact pages, `/integritet`. Source: existing page copy where it exists (lede/kicker text), otherwise one sentence written in DESIGN.md §4 voice, sentence case, ≤155 characters, Swedish where the page copy is Swedish. Keep a table of what was written in the PR description so Patrik can edit.

## 6. Nation category pages — `src/pages/ninetone-nation/kategori/[category].astro`

One page per category from `API_BOOKING_TAG` (Artist, Föreläsare, Konferencier, Moderator, Underhållare, Influencer), slugged (`foerelaesare` → prefer `forelasare`; decide one transliteration and use it in `routes.ts`). Editorial section archetype: kicker "Nation · {category}", h1 = category name, italic tagline from `breadBooking` if present, roster grid of that category's active talent via `getBookingCategories()` filtered, an FAQ block rendered from a `faq` WebPosts category named `FAQ {category}` if present (hide the block entirely if absent, rule 12), `faqPage` JSON-LD when present, `collectionPage` JSON-LD always, CTA to the Nation contact form. Empty categories are not generated. Link each category page from the booking index category headers. Add to sitemap and llms.txt.

## 7. Guides route — `src/pages/guider/index.astro` + `src/pages/guider/[slug].astro`

Render the WebPosts category `Guider` (create nothing in FM; if the category is absent the index shows nothing and no detail routes exist). Article layout following the news article page. JSON-LD: `Article` + `faqPage` built from any `## Vanliga frågor` / `## FAQ` section in the markdown (parse H3 question + following paragraph). Swedish `lang`. Add to sitemap and llms.txt.

## 8. Redirects

Add to `astro.config.mjs` `redirects`: `/previous-artists` → `/records/artists/previous/1`, `/blog` → `/news` (301). Verify both on `build:cf` with wrangler dev.

## 9. Images and freshness

`fetchpriority="high"` and no `loading="lazy"` on the single hero image per detail page and the homepage hero tile; keep lazy elsewhere. Add `aspect-ratio` fallback on `.fm-img-frame` in `global.css` (DESIGN.md-compatible, only when the caller sets none). Visible `dateModified` line (mono kicker style, "Uppdaterad {date}") on news articles only for now.

## 10. IndexNow (dormant)

`src/lib/indexnow.ts`: `pingIndexNow(origin, urls)` POSTing to `https://api.indexnow.org/IndexNow` with key from `INDEXNOW_KEY` env; key file endpoint `src/pages/[key].txt.ts` that only responds when the path equals the configured key. Called from the Publish handler after a successful epoch bump, **only when** `siteOrigin()` host ends with `ninetone.com`. Unit-test the guard.

## Definition of done

- `npm test` green, both builds green, post-build audit clean.
- Staging shows: canonical/OG/JSON-LD on home, an artist page, a client page, a talent page, a news page; `/sitemap-index.xml` referencing a page sitemap with every detail URL; `/robots.txt` still disallow-all (flag not flipped); `/llms.txt` populated; category pages render for non-empty categories; redirects work.
- Validate three pages' JSON-LD with Google's Rich Results test or `npx structured-data-testing-tool` and paste results in the PR description.
- PR description lists every meta description written (§5) and any place where a decision in this brief was impossible to follow as written, with the substitute chosen.
