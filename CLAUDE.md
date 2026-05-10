# Ninetone Refresh

Astro + Tailwind v4 + Cloudflare Pages site for Ninetone Group. Content is FileMaker-driven.

## Stack

- **Framework:** Astro 6 with `@astrojs/cloudflare` adapter
- **Styling:** Tailwind v4 (Vite plugin) + `@tailwindcss/typography`
- **Search:** `fuse.js` client-side
- **Markdown:** `marked`
- **Sitemap:** `@astrojs/sitemap`
- **Node:** >=22.12.0 (use `nvm use 22` — system default 20.x will fail)

## Run

```bash
nvm use 22
npm run dev      # local dev (port 4321 / falls back to 4322)
npm run build    # production build
npm run preview  # serve built output
```

## Layout

- `src/pages/` — Astro routes
- `src/components/` — reusable Astro components
- `src/layouts/` — page layouts (only `Base.astro`)
- `src/lib/` — helpers (FileMaker fetch, Shopify, sections palette, etc.)
- `src/styles/` — Tailwind entrypoints + design tokens
- `public/` — static assets
- `_old/` — legacy DivHunt SPA artifacts (ignored — do not edit)

## Design system

**Source of truth:** [DESIGN.md](DESIGN.md). Always read it before adding or restyling components — it is short and load-bearing.

**One-line summary:** Editorial-magazine confidence with restraint — paper canvas, oversized Newsreader serif headlines (h1 `clamp(2.75rem, 7vw, 6.5rem)`), Space Mono kickers, brand colors (`red`/`navy`/`green`) used as accents only, square corners, surgical motion.

**Hard rules — do not break:**

1. **Page canvas is `bg-ninetone-paper`.** Brand-color full backgrounds are reserved for Footer / PromoBar / MetricsPanel / MarqueeBand / portal-card hover state. Don't paint a page or section in `bg-ninetone-red`/`navy`/`green`.
2. **Section identity comes from the kicker + accent rule + CTA color**, not from the canvas. Drive coloring through `sectionAccent[theme]` from [src/lib/sections.ts](src/lib/sections.ts) — never hardcode `bg-ninetone-red`/etc. when a `theme` prop is available.
3. **Kicker = mono uppercase 11px tracked 0.12em with leading hairline.** Use the `.kicker` class. It's the most-repeated UI primitive.
4. **Square corners.** No `rounded-md` on cards/tiles/buttons. Tailwind v4 base radius is 0 — keep it that way unless the element is a badge or input.
5. **Card hover signature:** `h-1 w-12 bg-{accent}` mark in the top-left grows to `w-full` on `group-hover` over 300ms. Same on every image-led card.
6. **Hover-text-color discipline.** When text changes color on hover *over an animated background*, snap the bg color first (150ms) and delay the text transition (`delay-100 group-hover:delay-100`). Otherwise mid-transition produces white-on-near-white. See the homepage portal pattern in [src/pages/index.astro](src/pages/index.astro) — copy from there.
7. **Sentence case for headlines.** All-caps is for kickers/badges only.
8. **Italic display for taglines** under headlines (`font-display italic` with `text-ninetone-ink/75`). Keeps voice without raising volume.
9. **Three-archetype rule:** every page is one of (a) Editorial section page (kicker + h1 + lede + accent rule), (b) Detail page (sticky split, image col-span-5 / content col-span-7), (c) Landing/portal. See DESIGN.md §3.
10. **No new fonts** without updating both [Base.astro](src/layouts/Base.astro) `<link>` AND `--font-*` tokens in [global.css](src/styles/global.css). Current stack: Newsreader (display) + Space Grotesk (sans) + Space Mono (mono). All Google Fonts, all OFL.

**Reusable primitives — check before building anew:** `BentoTile`, `ArtistCard`, `NewsCard`, `MerchCard`, `RosterStrip`, `MetricsPanel`, `EditorialNewsBlock`, `MarqueeBand`, `StreamingRow`, `ContactForm`, `SectionIntro`, `SplitPortalHero`. Full inventory in DESIGN.md §2.

**FM data conventions** (Phase 2/3 surface area): see DESIGN.md §5. New data helpers go in [src/lib/ninetone.ts](src/lib/ninetone.ts) — `getPromo`, `getFeaturedArtists/Clients/Booking`, etc.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke context-save
- Code quality, health check → invoke health
