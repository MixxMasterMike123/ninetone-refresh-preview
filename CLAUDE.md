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
- `src/layouts/` — page layouts
- `src/lib/` — helpers (FileMaker fetch, etc.)
- `src/styles/` — Tailwind entrypoints
- `public/` — static assets
- `_old/` — legacy DivHunt SPA artifacts (ignored — do not edit)

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
