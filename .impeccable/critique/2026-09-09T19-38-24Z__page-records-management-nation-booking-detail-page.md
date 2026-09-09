---
target: ninetone site — home, records, management, nation, booking, detail page
total_score: 19
max_score: 32
na_heuristics: 7,10
p0_count: 2
p1_count: 3
timestamp: 2026-09-09T19-38-24Z
slug: page-records-management-nation-booking-detail-page
---
Method: dual-agent (A: opus design-review · B: sonnet detector+browser)

> **Post-verification corrections (2026-09-09, same day):** Two Assessment B findings were re-checked with a real headless Chromium and direct HTTP probes and were FALSE: (1) the "blank/broken images" P1 — every proxy image URL on the homepage returns 200 with real bytes; (2) the "section-overlap" P0 on Records/Management — measured 95–105 px clear gap between sections at 1440 and 390. Ignore both. The green-contrast, SEO-suffix, kicker-hairline and accent-rule items were fixed in commit following this snapshot.


## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Lazy FM images leave paper-colored voids with no loading indicator; several never resolve at all |
| 2 | Match System / Real World | 3 | Industry terms correct; FM "About" copy pages speak generic marketing-ese, not Swedish industry |
| 3 | User Control and Freedom | 3 | Breadcrumb kicker, ⌘K palette, dismissible promo all present |
| 4 | Consistency and Standards | 2 | SEO-era About blocks break voice on 3 of 5 pages; one artist has two different bios at two URLs |
| 5 | Error Prevention | 3 | Few destructive paths |
| 6 | Recognition Rather Than Recall | 2 | Booking filter chip's selected state is an 11px weight change, easy to miss |
| 7 | Flexibility and Efficiency | n/a | Persuade-mode marketing site |
| 8 | Aesthetic and Minimalist Design | 3 | Real restraint undercut by an 8,888px homepage ending in three consecutive dark bands |
| 9 | Error Recovery | 1 | No focus-visible styles anywhere in global.css; failed images render as blank, unlabeled rectangles |
| 10 | Help and Documentation | n/a | Persuade-mode marketing site |
| **Total** | | **19/32** | **59% — Acceptable, verging on Poor** |

## Design Specificity Verdict

**LLM assessment:** The homepage cover is genuinely authored — a 7vw Newsreader hero, mono kicker, asymmetric two-column split, and a confident three-portal division switch are not template moves. Below the fold it decays into "any editorial site." Division identity (Records=red, Management=navy, Nation=green) is legible only if you already know to look for a 1px card mark and a low-opacity kicker hairline; nothing else on /records vs /management differs. The most damaging specificity failure is copy: the Nation "About" block runs six paragraphs of "premier booking agency… hassle-free… unforgettable experiences" — the exact phrases DESIGN.md §4 bans — sitting one click from a homepage that gets the voice right.

**Deterministic scan:** `detect.mjs` returned exit 2, 2 warnings, both likely false positives given the intentional system: `overused-font` flagged Space Grotesk (one of the three deliberately chosen typefaces documented in DESIGN.md) and an `em-dash-overuse` advisory (11 across all of Base.astro's rendered output, mixing FM copy with UI copy — not attributable to one source). No genuine detector findings beyond these two.

**Visual/measured evidence:** Browser automation was unavailable in the review environment; Assessment B substituted MCP screenshot capture (full-page, 1440×900 and 390×844) across home, /records, /management, /ninetone-nation, /ninetone-nation/booking, and one detail page. No user-visible in-page overlay exists from this run — the findings below are direct visual/measurement evidence, not an injected overlay.

## Overall Impression

The homepage cover works. Everything after it plateaus, and two pages (Records, Management) carry a real layout bug where stacked sections overlap and a rule line cuts through live body text. The system's own rules are being followed structurally — square corners are consistent everywhere, no dark-mode leakage, no rounded corners found in any screenshot — but the *execution* underdelivers the ambition in color commitment, copy voice, and image reliability. The single biggest opportunity: the division pages currently read as three copies of one page with a different word in the kicker; committing the accent color further (still zero brand backgrounds) would fix more perceived "genericness" than any new section would.

## What's Working

1. **The hero survives at both ends of the viewport range.** At 1440px the h1 spans roughly 45% of viewport height at 4 lines; at 390px it still holds ~40px with tight leading and the full kicker/tagline/dual-CTA stack intact. Most sites claiming "oversized editorial" scale collapse this on mobile — this one doesn't.
2. **The detail-page archetype is the best-executed pattern in the system.** Sticky image column, breadcrumb kicker, italic tagline, drop-cap lede, and a named "Represented by" A&R contact with a real email turn an anonymous roster entry into a person you can call — the most agency-specific touch on the site.
3. **The ink MetricsPanel earns its one full-color surface.** Display-serif numbers with mono captions, no icon decoration, and a genuinely confident editorial line ("1 — house built around studios, people and ideas") as one of the four metrics.
4. **Square corners and the paper canvas hold with zero exceptions** across every screenshot at both viewports — the system's hardest rule is being followed with total discipline in execution.

## Priority Issues

**[P0] Section-overlap layout bug on Records and Management — stacked sections overlap by ~15-20px, a rule line cuts through live body text.**
Why it matters: reproduced independently at both desktop and mobile on the FM "About copy" block — visible on Records ("...we don't just produce music, we nurture careers...") and Management ("Limitless Opportunities: From Books to Broadcasts") — this is a rendering defect a launch visitor will see immediately, not a taste question.
Fix: find the component rendering the long-form FM About/WebPosts block on division pages (likely `WebPostsSection.astro` or the section immediately below it) and check for a negative margin, absolute-positioned rule, or a fixed min-height colliding with variable-length FM copy at these two specific record lengths.
Suggested command: `/impeccable audit` (or a direct dev fix — this is a CSS/layout bug, not a design-taste issue)

**[P0] SEO-era "About" copy is live in production on three division pages, in direct violation of the project's own voice rules.**
Why it matters: DESIGN.md §4 explicitly bans "premier," "hassle-free," "unforgettable," and agency-speak generally — and those words are live, in the brand's own serif, on /records, /management, /ninetone-nation, and /ninetone-nation/booking's tagline. A visitor arriving on a division page via search (the page's actual entry point) reads generic filler before reaching anything that would convince them; the homepage that nails the voice is one click away and they may never see it.
Fix: this is a content fix, not a code fix — rewrite the three FM `WebPosts` About records to the §4 unit (one headline + one italic tagline + one paragraph), and strip any `| Ninetone X` SEO-title suffix before it reaches `bookingPresentationTitle` so it stops rendering inside an italic display tagline.
Suggested command: `/impeccable clarify` for the title-string sanitization; the paragraph rewrite itself is an editorial task for Patrik/Ninetone, not a design-system change.

**[P1] Broken/blank images on specific card components — RosterStrip tiles, several NewsCard thumbnails, and 3 of 10 Records CD-shop tiles render as flat empty color blocks, not mid-loading-shimmer, just empty.**
Why it matters: the booking roster and detail-page hero photos load correctly, so this isn't a global proxy outage — it's isolated to specific components or specific FM records whose image URLs don't resolve, and it undercuts the "artist photography is the visual" rule in DESIGN.md §7 exactly where it matters (the roster strip that's supposed to prove "the roster is bigger than the page").
Fix: audit which `LAYOUT_CONFIG` route(s) feed RosterStrip and the affected NewsCard/merch tiles, and confirm those FM records actually carry a resolvable image field — separately from the Worker/proxy fix already shipped, this looks like a data or routing gap.
Suggested command: `/impeccable harden` (edge-case: missing/unresolvable image data)

**[P1] Division color is under-committed — red/navy/green appear only as a 60%-opacity kicker hairline and a 1px card mark, both measured, both real.**
Why it matters: the three divisions are the site's core IA and DESIGN.md's own rule says identity should come from kicker + accent rule + CTA color, but two of those three currently render at near-invisible weight. The Booking page's green CTA button is the one place this is done right, and it's why Booking reads as "Nation" more clearly than the Nation page itself does.
Fix, entirely inside existing rules (no new backgrounds, no new colors): promote the `SectionIntro` accent rule under each division h1 from a hairline to a 2px full-width rule; raise the `.kicker::before` hairline opacity from 0.6 to ~0.8; extend the accent to section kickers and h6 metadata on division pages, matching what booking.astro already does with its CTA fill.
Suggested command: `/impeccable colorize`

**[P1] Green accent measures 3.48:1 against paper — confirmed twice, independently, by both assessments — failing WCAG AA (4.5:1) for normal text; DESIGN.md §6 states 4.6:1, which is wrong.**
Why it matters: every Nation kicker, label, and green card mark set at body-text scale fails accessibility today, and the design system's own accessibility checklist has a false pass recorded for it.
Fix: swap `text-ninetone-green` to the already-defined `--color-ninetone-green-dark` (`#126b51`, ≈5.6:1 on paper) for any text-scale use — kickers, labels, links — keeping the brighter `#1a936f` only for large-text or fills on ink, where it already measures acceptably (~4.8:1). Correct the DESIGN.md §6 figure in the same change.
Suggested command: `/impeccable audit` (a11y) then a one-line token-usage fix, no `/impeccable colorize` needed since the token already exists

**[P2] Homepage closes with three consecutive dark bands — the page's own ink CTA, the Footer's built-in ink demo band (same "Talk to us" kicker), then the ink footer itself.**
Why it matters: after a real emotional rise in the hero, the page plateaus through mid-page sections and then dribbles to a close instead of landing a second peak — DESIGN.md's own minimalism rule ("every element earns its pixel") is undercut by ~600px of duplicated CTA.
Fix: the Footer component already accepts props — suppress or vary its demo band specifically on `/`, or give the homepage's own closing CTA the paper treatment so only one ink band closes the page.
Suggested command: `/impeccable layout`

**[P2] No `:focus-visible` styles are defined anywhere in global.css.**
Why it matters: DESIGN.md §6 says to rely on the browser default ring, but on the site's square, high-contrast ink-on-paper surfaces the default UA ring is close to invisible on ink CTAs and inside the ⌘K palette — a real accessibility gap for keyboard users, not a taste call.
Fix: one rule, fully in-system (no radius, no color outside the palette): `:focus-visible { outline: 2px solid var(--color-ninetone-ink); outline-offset: 2px; }` plus an inverted (paper-colored) variant for focus states on ink surfaces.
Suggested command: `/impeccable audit` (a11y)

## Persona Red Flags

**Jordan (first-timer, brand buyer arriving via search):** Lands on /ninetone-nation expecting to see who they can book, gets six paragraphs of "premier booking agency" before a single face appears. The homepage that would have actually convinced them is a page they never see. They also can't tell what distinguishes Records from Nation, because the two pages read and look nearly identical apart from a kicker word.

**Casey (mobile, fan following an artist link):** The hero survives mobile beautifully, but scrolling further hits a roster strip of blank paper-colored tiles where photos should be, and a release-link row rendered as bare two-letter service initials at thumb scale — unreadable as icons at that size on a phone.

**Riley (stress tester):** No visible focus ring anywhere — tabbing to the green Booking CTA or a filter chip gives no confirmation of focus. Filtering the booking roster to one category shows only an 11px mono weight shift as feedback, easy to miss at a glance. Also finds the same person (Anjo) exists at two different URLs (`/ninetone-nation/anjo` and `/records/artists/anjo`) with two different bios — a real content-consistency bug, not a taste issue.

## Minor Observations

- Dates render US-format (`07/29/2026`) on a Swedish-copy site; should be `2026-07-29` or `29 juli 2026`.
- Homepage mixes English headlines with Swedish body copy throughout; may be deliberate, but the SV language toggle currently links back to the same page, so it reads unfinished rather than intentional.
- Raw FM hashtags (`#Folkmusik #Polka #Dansglädje`) leak into display prose on some artist pages.
- `robots: noindex, nofollow` is set site-wide — correct for staging, but confirm it's flipped off at cutover per the security audit's own launch checklist.
