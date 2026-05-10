# Ninetone Group website

Astro 6 + Tailwind v4 + GitHub Pages. FileMaker-driven content for Ninetone Group's three divisions (Records, Management, Nation) plus team, news, and Shopify-powered merch.

**Live preview:** https://mixxmastermike123.github.io/ninetone-refresh-preview/ (noindexed)

## Stack

| Layer | Tool |
|---|---|
| Framework | Astro 6, fully static (`output: "static"`) |
| Styling | Tailwind v4 (Vite plugin) + `@tailwindcss/typography` |
| Search | `fuse.js` (client-side fuzzy, with name-prefix priority) |
| Markdown | `marked` |
| Sitemap | `@astrojs/sitemap` |
| Hosting | GitHub Pages, served from `gh-pages` |
| Build | GitHub Actions (`.github/workflows/deploy.yml`) |
| Image proxy | Cloudflare Worker (`worker-fm-proxy/`) — see DEPLOY.md |
| Node | >=22.12.0 (use `nvm use 22`; system 20.x will fail) |

## Layout

```
src/
  pages/        Astro routes
  components/   Reusable .astro components
  layouts/      Base.astro (the only layout)
  lib/          Helpers — FileMaker client, Shopify, sections, base-aware url()
  styles/       Tailwind entrypoint + design tokens (global.css)
public/         Static assets (logos, images, robots.txt, _headers)
worker-fm-proxy/  Cloudflare Worker source (own README + deploy)
docs/           API + integration notes
DESIGN.md       Design system reference (load-bearing — read it)
DEPLOY.md       Hosting, deploy hooks, Worker setup, going-public checklist
CLAUDE.md       Project rules for AI agents (also load-bearing)
```

## Run

```bash
nvm use 22
npm install
npm run dev      # local dev (port 4321 / falls back to 4322)
npm run build    # production build → dist/
npm run preview  # serve built output
```

Copy `.env.example` to `.env` and fill in FileMaker + Shopify credentials.

## How it builds

1. GitHub Actions checks out `main`, sets up Node 22, runs `npm ci`
2. `npm run build` → Astro fetches all data from FileMaker (artists, clients, booking entertainers, news, team, web posts) and Shopify (merch products), embeds it in static HTML
3. The build also rewrites every FileMaker `Streaming_SSL/...` image URL to a Cloudflare Worker proxy URL (more on this in DEPLOY.md — it's the load-bearing piece that makes images work)
4. `dist/` is uploaded as a Pages artifact, deployed to GH Pages

Build is ~10s warm, ~30s cold, runs on every push to `main` and on `repository_dispatch` (the FM admin's webhook hook).

## Why FileMaker → static HTML, plus a Worker for images

The site reads from a 15+ year old FileMaker database that's the source of truth for Ninetone's roster, clients, releases, and team. We pull at build time over the FileMaker Data API, embed JSON-derived data into HTML, and ship to GH Pages.

**FileMaker streaming image URLs rotate per call and expire with the session token (~15 min).** A static site that embeds them shows broken images within minutes. The Cloudflare Worker (`worker-fm-proxy/`) handles this: holds a live FM session token, refreshes every 12 min, resolves a fresh streaming URL on every visitor request, streams the bytes through. Static site stays static, images stay live.

Full detail in [DEPLOY.md](DEPLOY.md) → "FM image proxy Worker".

## Design system

[DESIGN.md](DESIGN.md) is the source of truth. Don't add or restyle components without reading it first — it's short and load-bearing.

One-line summary: editorial-magazine confidence with restraint — paper canvas (`#f5f3ee`), oversized Newsreader serif headlines, Space Mono kickers, brand colors (`red`/`navy`/`green`) used as accents only, square corners, surgical motion.

## Deploying

[DEPLOY.md](DEPLOY.md) covers:

- The GitHub Pages flow + workflow file
- The Worker proxy (what it is, how to update, secrets)
- The FileMaker auto-rebuild webhook (one script step on the FM admin's side)
- Cloudflare Access setup (deferred — currently noindexed but URL-public)
- Going-public checklist for cutover

## Conventions worth knowing

- Internal links use the `url()` helper from [`src/lib/url.ts`](src/lib/url.ts) so the site works under the GH Pages sub-path (`/ninetone-refresh-preview/`). Drop the helper + the `base` config when going public.
- All FileMaker fetches go through [`src/lib/filemaker.ts`](src/lib/filemaker.ts) which caches the session token + per-call response.
- All images that come from FM go through [`src/lib/fm-image-mirror.ts`](src/lib/fm-image-mirror.ts) which rewrites URLs to the proxy. New layouts/fields need to be added here AND in the Worker's route table.
- Cards have a shimmer-skeleton + fade-in pattern (`.fm-img-frame` + `.fm-img` in `global.css`). Apply to anything that loads through the FM proxy.

## Repo notes

- `_old/` (legacy DivHunt SPA) and `Screenshots/` (working artifacts) are gitignored.
- Worker code is in this repo under `worker-fm-proxy/`. Deployed independently via `wrangler deploy`. Has its own `package.json`.
- No `.env` in git. Production values live in GitHub Secrets (build) and Cloudflare Worker secrets (Worker).

## License & ownership

Source code is private to Ninetone Group AB. Repo is public on GitHub for GH Pages free-tier hosting only — see DEPLOY.md for the rationale.
