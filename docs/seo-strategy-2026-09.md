# SEO and AI visibility strategy

Ninetone Group (ninetone.com). September 2026.
Owners: Mikael (code), Patrik (content, accounts)

## Executive summary

The new site is well built and currently invisible on purpose. It has no canonical tags, no Open Graph, no structured data, and a sitemap listing 15 shell pages while hundreds of artist, client, booking and news pages are missing. One week of code fixes that.

The opportunity is that competitors are weak where it now matters. Sony Music Sweden and United Influencers block AI crawlers outright, so answer engines cannot cite them. Nobody in the profiled set ships structured data. Nobody owns booking searches for Sundsvall or Norrland. Nobody has written the guide content AI answers are built from.

Three things decide the outcome: fix the technical baseline before launch, configure the Cloudflare zone so AI crawlers are allowed rather than blocked by the new September 2026 default, and publish Swedish guide content that answers the questions buyers actually type.

## Where we stand

Baseline from the technical audit of the CF staging target (ninetone-site.micke-ohlen.workers.dev). P0 items are launch-blocking.

- **P0. No canonical, Open Graph, Twitter Card or JSON-LD tags anywhere.** `Base.astro` accepts only `title`, `description`, `theme`, `lang`. Confirmed against live rendered HTML on home, artist and news pages.
- **P0. The sitemap omits every dynamic detail page.** `sitemap-0.xml` has 15 static URLs. No `/records/artists/{slug}`, no `/management/clients/{slug}`, no `/team/{slug}`, no `/news/{slug}`, despite those pages returning 200. Cause: on the CF target the detail routes are SSR, so `@astrojs/sitemap`'s static crawl never sees them. This is the single biggest indexation risk.
- **P0. Three separate noindex switches must move together at launch.** The `PUBLIC_NOINDEX` meta tag in `Base.astro`, the disallow-all in `public/robots.txt`, and the `X-Robots-Tag: noindex` block in `public/_headers`. Verified on staging: on the Workers target `_headers` applies to static assets only, not to server-rendered pages. The favicon carries `X-Robots-Tag: noindex, noimageindex`; the HTML does not. The block must be removed at launch or every static asset stays excluded from image indexing.
- **P0. No redirect plan for legacy URLs.** `/previous-artists` and `/blog` have inbound links and no equivalent on the new structure.
- **P1. Meta descriptions fall back to one sitewide string** on home, all four section indexes, booking, team and the contact pages. Only artist/client detail (tagline) and news (lede) pass real copy.
- **P1. No `fetchpriority="high"` on any hero image.** Every component hardcodes `loading="lazy"`, including above-the-fold heroes.
- **P1. `i18n` declares `sv` as a locale and zero Swedish pages exist.** See the language decision below.
- **What already works:** SSR HTML means crawlers get complete markup with no JS dependency, which is a strict improvement over the static preview. Markdown bios render to real HTML. Alt text is meaningful. Fonts use `display=swap` and preconnect. The security middleware does not challenge crawlers.

Note flagged as unverified in the audit: no Lighthouse or Core Web Vitals number was captured. Run PageSpeed Insights against the production URL before launch sign-off.

## Competitive landscape

Six competitors scraped directly. Indexed-page counts sampled, not exhaustive.

| Competitor | Talent page pattern | JSON-LD | AI bots in robots.txt | Guides/FAQ |
|---|---|---|---|---|
| Sony Music Sweden | Flat demo CTA, no per-artist pages | Not verified | **Blocks GPTBot, ClaudeBot, Google-Extended, CCBot, Amazonbot, Bytespider, meta-externalagent** | No |
| Universal Music Sweden | `/artist/{slug}/`, dozens indexed, thin content | None observed | Open (only `/wp-admin/`) | No |
| MySpeaker | `/talare/{slug}/`, `/moderatorer/{slug}/` | Not confirmed | Fully open | **Yes. FAQ block on homepage, active `/nyheter/` blog** |
| Athenas | `/amne/{category}/` topic pages | Not verified | Standard, no AI rules | Not verified |
| 2Entertain | `/artister/{slug}/` | Not confirmed | Open | Not verified |
| United Influencers | No roster, case studies only | Not verified | **Blocks nearly the full AI bot list** (Squarespace default) | No |

The openings, in order of value.

1. **Regional booking is unclaimed.** "Boka artist Sundsvall" and "boka artist Norrland" return generic marketplaces (Eventzone, Cueup) and hyper-local musician listings, not a full-service agency. Wikipedia already credits Ninetone Records as Sundsvall-based; ninetone.com does not currently reinforce that claim on-page.
2. **AI crawler access is accidentally hostile at two of six competitors.** Sony and United Influencers are almost certainly running platform defaults, not strategy. An LLM asked about Swedish labels or influencer agencies cannot cite them. We can be the one that gets cited.
3. **Nobody ships structured data.** Zero JSON-LD observed across the whole scraped set. A blank canvas.
4. **Guide content vacuum.** Only MySpeaker does FAQ blocks, and only short ones. No competitor has a real "hur skickar man en demo", "hur bokar man en artist" or "vad kostar en föreläsare" page.
5. **"Boka influencer till event" is essentially unclaimed.** The influencer agencies are brand-campaign-first. Ninetone bridges Management and Nation and can own the live-event framing.
6. **Universal's artist pages are thin.** Name, socials, embed, newsletter form. An LLM summarizing an artist gets nothing usable. Deeper artist pages out-compete on citability even against a much bigger label.
7. **Nobody combines label + management + booking under one brand.** That is our structural differentiator and it should be explicit in Organization schema and cross-linking.

## Target keyword map

Competitiveness is the researcher's judgment, not a keyword-tool volume figure.

**Records**

| Keyword | Intent | Competitiveness | Owning page |
|---|---|---|---|
| skivbolag Sverige | Informational | High | Records landing |
| independent skivbolag Sverige | Informational | Med-High | Records landing |
| skivbolag Sundsvall | Local nav | Low | Records landing (geo copy) |
| skivbolag Norrland | Local nav | Low | Records landing (geo copy) |
| skicka demo skivbolag | Transactional | High | Records contact page |
| hur skickar man en demo till ett skivbolag | Informational | Med | Guide |
| skivkontrakt Sverige | Informational | Med | Guide |
| musikproduktion Sverige | Informational | Med | Records landing |
| artistutveckling skivbolag | Informational | Med | Records landing |
| MCN Sverige | Niche informational | Low | Records landing |
| record label Sweden (EN) | Informational | Med | Records landing |
| submit demo record label Sweden (EN) | Transactional | Med | Records contact page |

**Management**

| Keyword | Intent | Competitiveness | Owning page |
|---|---|---|---|
| artistmanagement Sverige | Transactional | Med | Management landing |
| management för artister | Transactional | Med | Management landing |
| influencer management byrå Sverige | Transactional | High | Management landing |
| creator management Sverige | Transactional | Med | Management landing |
| talent management Sverige | Transactional | Med-High | Management landing |
| innehållsskapare management | Transactional | Low | Management landing |
| influencer management Sweden (EN) | Transactional | Med | Management landing |

**Nation (booking)**

| Keyword | Intent | Competitiveness | Owning page |
|---|---|---|---|
| boka artist | Transactional | Very high | Nation landing |
| boka artist företagsevent | Transactional | High | Category page (Artist) |
| bokningsbolag artister Sverige | Transactional | High | Nation landing |
| boka artist Sundsvall | Local transactional | Low | Regional page |
| boka artist Norrland | Local transactional | Low | Regional page |
| boka föreläsare | Transactional | Very high | Category page (Föreläsare) |
| boka föreläsare företag | Transactional | High | Category page (Föreläsare) |
| vad kostar det att boka en föreläsare | Informational | Low-Med | Guide |
| boka moderator | Transactional | High | Category page (Moderator) |
| boka konferencier | Transactional | Med-High | Category page (Konferencier) |
| boka influencer till event | Transactional | Low, open niche | Category page (Influencer) |
| hur bokar man en artist | Informational | Low | Guide |
| artistbokning företagsevent | Transactional | Med | Nation landing |
| book Swedish artist corporate event (EN) | Transactional | Low | Nation landing |
| talent agency Sundsvall (EN) | Local | Low | Regional page |

Brand terms (Ninetone Group, Ninetone Records, Ninetone Nation) are already ours; the work there is entity consistency, not ranking.

## AI visibility: how answer engines will see us

### The crawlers that decide citation

Training bots and citation bots are different. Blocking the training bot does not block the search bot.

| Crawler | What it feeds | Priority |
|---|---|---|
| `Googlebot` | Classic Search, AI Overviews, AI Mode | Mandatory |
| `Bingbot` | Bing, Copilot, and a large share of ChatGPT search | Mandatory |
| `OAI-SearchBot` | Live ChatGPT search citations | Mandatory |
| `ChatGPT-User` | User-triggered fetch when someone asks ChatGPT to open us | High |
| `Claude-SearchBot` / `Claude-User` | Claude search and live answers | High |
| `PerplexityBot` / `Perplexity-User` | Perplexity citations (not used for training) | High |
| `Applebot` | Siri, Spotlight, Safari | Medium |
| `DuckAssistBot` | DuckDuckGo AI Assist | Medium |
| `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended` | Training only | Allowed, see below |

`Google-Extended` gates Gemini training only. It does not control AI Overviews, which use the standard Googlebot index.

### The Bing dependency

OpenAI's VP of Engineering has publicly confirmed ChatGPT Search draws heavily on Bing's index, corroborated by independent server-log analysis. **Bing Webmaster Tools and sitemap submission are therefore a direct lever on ChatGPT citation, not a Bing-only nicety.** IndexNow is the same lever for freshness.

### robots.txt: allow everything

We ship Variant A: allow all crawlers, including training bots, with an explicit content signal. Full file in the appendix.

The rationale is simple. This is marketing content whose entire purpose is to be known. Being present in future model training data means a model asked "who books Swedish artists" has seen us. For a brand, that is an asset. There is no proprietary content here to protect.

If Patrik objects to training use, the fallback is Variant B: `Disallow: /` for `GPTBot`, `ClaudeBot`, `CCBot`, `Applebot-Extended`, `Google-Extended` and `Meta-ExternalAgent`, with `Content-Signal: ai-train=no, search=yes, ai-input=yes`, and everything else falling through to `User-agent: * / Allow: /`. That keeps every citation-relevant bot fully allowed and costs only future training presence. It is a legitimate choice, just not the one that fits a company that wants to be found.

### Cloudflare zone checklist (P0, launch day)

Cloudflare's Block AI Bots docs and Content Independence Day post (both updated 1 July 2026) state that **on 15 September 2026 new domains get updated defaults: bots classified as Training or Agent are blocked on pages that display ads, Search stays allowed.** ninetone.com will be a new zone created after that date, so this default applies to us. Do not rely on it.

1. **AI Crawl Control** (Security → Bots): explicitly set Search, Agent and Training to Allow. Agent covers `ChatGPT-User`, `Claude-User`, `Perplexity-User`, which are citation-relevant.
2. **Crawlers tab:** verify `OAI-SearchBot`, `Claude-SearchBot`, `Claude-User`, `ChatGPT-User`, `PerplexityBot`, `Perplexity-User`, `Googlebot`, `Bingbot`, `Applebot` all show Allowed, not Blocked or Challenged.
3. **WAF skip rule** for those user agents, skipping managed rules and rate limiting. Cloudflare's July 2026 change removed the blanket "Verified equals always allowed" guarantee. Verified now only means allowable within its category, so an explicit skip rule is required rather than trusting verified status.
4. **Managed robots.txt: OFF.** If enabled, Cloudflare prepends its own `Content-Signal:` line reflecting dashboard toggles and can silently override the hand-authored file we serve.
5. **Pay Per Crawl: confirm off.** It can return 402 to crawlers.
6. **Bot Fight Mode / Super Bot Fight Mode:** audit for rules that challenge bot-score-1 traffic.
7. Note the existing security-audit item: the FM image proxy has no per-client limiter, so a Cloudflare rate-limit rule is wanted anyway. Make sure it excludes the crawler skip list.

### What llms.txt does and does not do

We ship `/llms.txt`, generated from FM roster data, with honest expectations.

The evidence is consistent and negative on citation impact. One analysis of 515 million AI-bot traffic events over 90 days found 408 hits to `/llms.txt`, statistically negligible. A separate study of 20,000 domains found 84 of 62,100 AI-bot requests touched it. Google's John Mueller has said no Google Search system uses it. Claims that Anthropic or Perplexity weight it in retrieval come from a secondary SEO vendor blog, not vendor docs, and the traffic studies contradict them. Flagged as unverified.

Where it does get used is IDE and coding agents, and MCP doc servers. It is cheap agent infrastructure and a hedge if adoption grows, on the logic of early schema.org. Ship it, expect nothing from it.

`llms-full.txt`, NLWeb tags and Markdown content negotiation are all in the same bucket, with even less evidence. No vendor has confirmed any answer engine requests `Accept: text/markdown` or `.md` mirrors for citation. Skip them for now.

### What actually moves citation

- **Structured data.** Google says schema is not required for AI Overviews but recommends it as standard SEO. Independent studies put the visibility lift on non-Google engines at 30 to 40 percent. Perplexity specifically favours `FAQPage`.
- **Consistent entity naming.** "Ninetone Group" identically on site, Wikidata, socials and Google Business Profile. Highest leverage, lowest cost.
- **Answer-first paragraphs.** The Princeton GEO study found +40 percent for content with cited sources and +37 percent for statistics. This applies to ChatGPT, Perplexity and Claude. It is not a confirmed Google AI Overviews lever, since Google explicitly discourages chunking content for AI.
- **Freshness.** ChatGPT citation rate is roughly 3.2x higher for content updated in the last 30 days (ZipTie analysis). Argues for a visible `dateModified` on roster and news pages.
- **Wikipedia and the music databases.** Wikipedia citations alone account for about 7.8 percent of all ChatGPT citations. For a label, MusicBrainz and Discogs matter for the same reason.

## Structured data plan

All schema is built from FM fields the helpers already return. No FM-side change is needed for any row in this table.

| Page type | Schema | FM fields used |
|---|---|---|
| All pages | `Organization` (sitewide), `WebSite` + `SearchAction` | Static constants; `sameAs` list below |
| Home | `Organization`, `WebSite` | Static |
| `/records/artists/{slug}` | `MusicGroup` (or `Person`), `BreadcrumbList` | name, tagline, blurb, image, `url_spotify`, `url_applemusic`, `url_youtube_music`, `url_instagram`, `url_tiktok_artist`, `url_facebook` |
| Artist releases block | `MusicAlbum` / `MusicRelease` inside the artist node | `Green Web Category` portal: Album, Type, Releasedate First, cover, urlRelease |
| `/management/clients/{slug}` | `Person`, `BreadcrumbList` | name, tagline, blurb, image, `url_*` socials |
| `/ninetone-nation/{slug}` | `Person` + `offers` pointing at booking contact, `BreadcrumbList` | name, tagline, blurb, image, socials, booking category tag |
| `/ninetone-nation/booking` | `CollectionPage` + `ItemList` of the categories | `API_BOOKING_TAG` tagBooking, breadBooking |
| Nation category pages | `CollectionPage` + `ItemList` + `FAQPage` | Same, plus Patrik's FAQ copy |
| `/news/{slug}` | `NewsArticle` with `datePublished` and `dateModified` | title, lede, Date, image, Message body |
| `/team/{slug}` | `Person` with `worksFor` → Organization | name, role, image |
| Guides | `FAQPage` + `Article` | WebPosts record fields |
| Contact pages | `ContactPoint` on Organization | Static |

Organization `sameAs`: Wikidata Q7038555, `en.wikipedia.org/wiki/Ninetone_Records`, MusicBrainz label entry, `linkedin.com/company/ninetone`, `facebook.com/ninetone`, `youtube.com/c/Ninetone`, `soundcloud.com/ninetonegroup`, Instagram.

Implementation is a single `JsonLd.astro` component rendering `<script type="application/ld+json">`, with a per-page-type builder. No new FM reads, since the data is already in scope on each page.

## Site architecture and programmatic pages

We already have the hard part: hundreds of per-entity pages driven by FM. The programmatic lane is enrichment, not generation.

**Lane 1: enrich what exists.** Every `/records/artists/{slug}`, `/management/clients/{slug}` and `/ninetone-nation/{slug}` page gets schema, a real meta description from tagline, an answer-first opening sentence, and a "Boka {name}" CTA on Nation pages routed to the booking contact form. These pages already have unique FM copy, which is what separates them from a doorway farm.

**Lane 2: one landing page per Nation category.** FM's `API_BOOKING_TAG` already carries the categories (Artist, Föreläsare, Konferencier, Moderator, Underhållare, Influencer) with a Swedish description in `breadBooking`. Each becomes its own page with the category roster, Patrik's intro copy, and an FAQ block in `FAQPage` schema. These target the highest-value transactional terms in the keyword map and cost one route file plus copy. Empty categories stay hidden per the existing render rule.

**Lane 3: exactly one regional page.** Sundsvall and Norrland, combined. Not twenty city pages.

The reason to stop at one: a city-list farm requires genuinely different content per city to survive, and we do not have city-specific artists, city-specific pricing or city-specific case studies. Twenty near-identical pages is the textbook doorway pattern Google demotes, and it dilutes the internal link equity that should concentrate on the one page that has a real claim. Ninetone is genuinely from Sundsvall, has Wikipedia backing that claim, and faces no strong regional competitor. One page that is actually true beats twenty that are not. If we later win Sundsvall and have real Norrland case material, a second page is easy.

**Would need an FM-side change, fold into the cutover ask:** per-artist genre tags, event/gig data for `Event` schema, and streaming/engagement aggregates. The FM layout split verified in May 2026 confirmed those aggregates live on `_INTERNAL` layouts only, not the public one we query. Not a plan item here.

## Content plan

Patrik or Ninetone writes this. Voice rule from DESIGN.md §4: sentence case headlines, cinematic short copy, one headline plus one tagline plus one paragraph as the editorial unit, no agency-speak, no feature-list dumps. Guides are the exception where length is warranted, but the same plainness applies.

1. **Division about copy** for Records, Management and Nation landing pages. Each needs a real paragraph that says what the division does, where it is based, and who it is for. This is also what fixes the sitewide meta description problem and reinforces the Sundsvall claim on-page.
2. **Three guides, in Swedish, each with an FAQ block:**
   - Hur bokar man en artist till ett event
   - Vad kostar det att boka en föreläsare
   - Hur skickar man en demo till ett skivbolag
3. **FAQ blocks** for each Nation category page. Three to five questions each, answered in one short paragraph, question phrased the way a buyer types it.
4. **Category intro copy** for the six Nation category pages, if `breadBooking` is not already the right length.
5. **The language decision** (below).

Guides can live as a WebPosts category the site already renders. The `getWebPosts` mechanism handles arbitrary categories today. A dedicated `/guider/` route with FAQPage schema and proper listing is a small code task on top, and worth doing so the guides are not buried in the news feed.

## The language decision

This is the biggest strategic question in this document and it is Patrik's call.

The facts. The target buyers, meaning event bookers, Swedish brands and Swedish artists sending demos, search in Swedish. The keyword map is overwhelmingly Swedish. The site's headlines are English with Swedish body copy in places. `astro.config.mjs` declares `sv` as a locale with zero Swedish pages behind it. Right now we are asking Google to rank English pages for Swedish queries.

**Recommendation: Swedish becomes the primary language for Nation and Management, and for every guide and FAQ. English stays for Records, where the audience is international labels, distributors and press.** Set `lang` correctly per page rather than the current static prop. Add hreflang only once genuine alternate versions of a page exist. Hreflang pointing at pages that are not real translations is worse than no hreflang.

Do not machine-translate the whole site. The voice is the product here, and a translated version of an editorial paper-canvas brand reads as neither language. Translate what earns it: the pages with commercial intent and the guides.

If Patrik declines a Swedish-primary Nation, the fallback is Swedish guides plus Swedish category pages only, English everywhere else. That captures most of the search value and none of the brand risk.

## Migration and launch checklist

**Redirects.** Implement twice: Astro `redirects` in the config, and Cloudflare Bulk Redirects at the zone. The zone rule survives redeploys and is the cleaner long-term home; the Astro rule covers us before DNS moves.

| Old URL | New URL |
|---|---|
| `/previous-artists` | `/records/artists/previous/1` |
| `/blog` | `/news` |
| `/*?collection_id=...` | Let 404. The old robots.txt already blocked these from indexing. |

Everything else maps one to one: `/`, `/news`, `/records`, `/records/artists`, `/management`, `/management/clients`, `/team`, `/ninetone-nation`, `/ninetone-nation/booking`, `/records/contact-records`, `/ninetone-nation/contact-ninetone-nation`, `/search-result`. `trailingSlash: "ignore"` handles the slash variants.

**The three noindex flips, all on the same day:**

1. `PUBLIC_NOINDEX=false` in the Cloudflare Worker production environment. Note this same flag gates GA4 and Meta Pixel firing, so confirm analytics IDs are real before flipping, per the security audit's launch items.
2. `public/robots.txt` replaced with the Variant A file in the appendix.
3. The `X-Robots-Tag` noindex block removed from `public/_headers`. On Workers that file governs static assets only (verified with `curl -I` on staging), so leaving it would keep favicons and any static images out of image search while pages index normally.

`base` is already target-conditional in `astro.config.mjs` (`/` on the Cloudflare target), so no config change is needed for URLs at cutover.

**Accounts to create or claim:**

- Google Search Console. Verify the domain, submit `sitemap-index.xml`.
- Bing Webmaster Tools. Same, plus generate the IndexNow key.
- IndexNow key file at `/{key}.txt`, submission fired from the existing Publish flow, gated to the production host only. Submitting from staging risks a 403 that invalidates the key.
- Google Business Profile for the Sundsvall office.
- Wikidata Q7038555. Update to reflect the Group structure and add the site URL.
- Wikipedia (Ninetone Records). Update to reflect the Group structure. Follow Wikipedia's conflict-of-interest guidance; propose edits on the talk page rather than editing the article directly.
- MusicBrainz label entry. Verify and cross-link.

## Measurement

- **Cloudflare AI Crawl Control → Metrics.** Per-crawler request counts, allowed/blocked breakdown, status codes, referral traffic from AI platforms, CSV export and a GraphQL API. This is the direct evidence that GPTBot, PerplexityBot and the rest are actually reaching us and getting 200s rather than challenges.
- **Google Search Console.** Standard Performance and Coverage. Note there is no AI Overviews reporting surface in GSC. Google says so explicitly.
- **Bing Webmaster Tools.** Crawl stats and index coverage, doubling as the ChatGPT proxy.
- **Monthly prompt probes.** Run the same 15 to 20 brand, roster and booking queries across ChatGPT, Claude, Perplexity, Google AI Mode and Copilot. Log cited or not cited. Single runs are non-deterministic, so run each query 3 to 5 times per platform.
- **Third-party GEO tools** worth evaluating but not independently verified in this research: Otterly AI, Peec AI, ZipTie, LLMrefs.
- Run PageSpeed Insights against production once at launch and quarterly after.

## The four phases

**Phase 1: code, pre-launch, this week. Owner: Mikael / agent.**

- [ ] `Base.astro`: add `canonical`, `ogImage`, `ogType` props; emit canonical link, `og:*`, `twitter:card=summary_large_image`
- [ ] `JsonLd.astro` component plus per-page-type builders per the structured data table
- [ ] Dynamic sitemap endpoint on the CF target, built from the same FM list helpers the index pages already use
- [ ] Per-page meta descriptions on home, the four section indexes, booking, team, contact pages
- [ ] Env-aware `robots.txt` (endpoint, not a static file, so preview stays blocked and production ships Variant A)
- [ ] `/llms.txt` endpoint generated from FM roster data
- [ ] `fetchpriority="high"` and no lazy attribute on the single largest above-fold image per page type
- [ ] Favicon set (`favicon.svg`, `favicon.ico`, apple-touch-icon) and `theme-color` meta
- [ ] Astro `redirects` for `/previous-artists` and `/blog`
- [ ] Nation category page route
- [ ] `/guider/` route rendering the guides WebPosts category with `FAQPage` schema

**Phase 2: content, pre-launch. Owner: Patrik.**

- [ ] Language decision
- [ ] Division about copy for Records, Management, Nation
- [ ] Three guides
- [ ] FAQ blocks for each Nation category
- [ ] Category intro copy where `breadBooking` is thin
- [ ] Sundsvall/Norrland regional page copy

**Phase 3: cutover day. Owners: Mikael (1-4), Patrik (5-8).**

- [ ] Cloudflare zone checklist, all six items
- [ ] `PUBLIC_NOINDEX=false`, confirm analytics IDs are real first
- [ ] `robots.txt` → Variant A; remove the `_headers` noindex block
- [ ] Cloudflare Bulk Redirects
- [ ] Google Search Console + sitemap
- [ ] Bing Webmaster Tools + sitemap + IndexNow key
- [ ] Google Business Profile
- [ ] Wikidata and Wikipedia updates

**Phase 4: post-launch. Shared.**

- [ ] IndexNow ping wired into the Publish flow, production host only
- [ ] First monthly prompt probe, 30 days after launch
- [ ] Iterate category pages on what the probes and GSC show
- [ ] Regional page live and internally linked
- [ ] Visible `dateModified` on roster and news pages
- [ ] Per-artist MusicBrainz, Discogs and Spotify `sameAs` from existing `url_*` fields
- [ ] PageSpeed Insights baseline and quarterly re-run

## Open decisions for Patrik

1. **Language.** Swedish-primary for Nation and Management, English for Records. Recommended above. Blocks Phase 2 content.
2. **Training-bot stance.** Variant A allows model training. Recommended. Variant B is one config change away if he objects.
3. **Google Business Profile ownership.** Who verifies it and holds the account. It needs to sit with Ninetone, not a personal account.
4. **Who writes the guides.** Patrik, someone at Ninetone, or a freelancer briefed on DESIGN.md §4. Three guides at roughly 800 to 1,200 words each is the single highest-value content investment in this plan.

---

## Appendix A: robots.txt (Variant A, production)

```
User-agent: *
Allow: /

Sitemap: https://ninetone.com/sitemap-index.xml
Content-Signal: ai-train=yes, search=yes, ai-input=yes
```

Serve this from an endpoint that checks the deploy target and host, so preview deployments keep serving the current disallow-all.

## Appendix B: llms.txt skeleton

Real routes, verified against `src/pages`. Roster entries are generated from FM and should be one factual line each (genre, notable release, category) rather than marketing copy, since this file is parsed rather than read.

```markdown
# Ninetone Group

> Swedish music company based in Sundsvall and Stockholm. Three divisions:
> Ninetone Records (label), Ninetone Management (artist and creator
> management), Ninetone Nation (booking for events).

## Ninetone Records
- [Artists](https://ninetone.com/records/artists): current roster
- [Artist pages](https://ninetone.com/records/artists/{slug}): bio, releases, links
- [Previous artists](https://ninetone.com/records/artists/previous/1)
- [Contact Records](https://ninetone.com/records/contact-records): demo submissions

## Ninetone Management
- [Clients](https://ninetone.com/management/clients): managed artists and creators
- [Client pages](https://ninetone.com/management/clients/{slug})
- [Contact Management](https://ninetone.com/management/contact-management)

## Ninetone Nation
- [Booking](https://ninetone.com/ninetone-nation/booking): bookable talent by category
- [Talent pages](https://ninetone.com/ninetone-nation/{slug})
- [Contact Nation](https://ninetone.com/ninetone-nation/contact-ninetone-nation)

## Company
- [Team](https://ninetone.com/team) and [team pages](https://ninetone.com/team/{slug})
- [News](https://ninetone.com/news) and [articles](https://ninetone.com/news/{slug})
- [Privacy](https://ninetone.com/integritet)
```

The `{slug}` placeholders are expanded at generation time from the same FM helpers that feed the sitemap.

## Appendix C: sources

Crawler and platform docs:
- developers.cloudflare.com/ai-crawl-control/reference/bots/
- developers.openai.com/api/docs/bots
- support.claude.com/en/articles/8896518
- docs.perplexity.ai/docs/resources/perplexity-crawlers
- support.apple.com/en-us/119829
- developers.google.com/search/docs/fundamentals/ai-optimization-guide

Cloudflare policy:
- developers.cloudflare.com/bots/additional-configurations/block-ai-bots/ (updated 1 Jul 2026)
- blog.cloudflare.com/content-independence-day-ai-options/ (1 Jul 2026)
- developers.cloudflare.com/bots/concepts/bot-score/
- contentsignals.org

llms.txt evidence:
- llmstxt.org
- limy.ai/blog/llms-txt-in-2026-the-full-guide
- medium.com/@kaispriestersbach/the-llms-txt-is-dead-more-precisely-a-dud-ab7bee4f469c
- derivatex.agency/blog/llms-txt-guide/

Bing / ChatGPT dependency and IndexNow:
- seroundtable.com/bing-powers-chatgpt-search-38345.html
- bing.com/indexnow/getstarted

Competitor and entity sources inspected directly:
- ninetone.com, en.wikipedia.org/wiki/Ninetone_Records (Wikidata Q7038555)
- sonymusic.se, universalmusic.se, athenas.se, myspeaker.se, unitedinfluencers.com, 2entertain.com (each plus robots.txt)
- rexiusrecords.com/sv/skivbolag-i-sverige/
