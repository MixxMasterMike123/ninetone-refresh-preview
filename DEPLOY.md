# Deploy guide — preview environment

**Live preview:** https://mixxmastermike123.github.io/ninetone-refresh-preview/

Stack:
- **Build + host:** GitHub Actions builds; GitHub Pages serves the static `dist/`
- **Auth (planned):** Cloudflare Access in front of GH Pages, via DNS proxying
- **Auto-rebuild on FM content change:** FileMaker → GitHub `repository_dispatch` webhook → Actions rebuilds → Pages republishes

This doc covers the **preview** deployment. When the site is ready to replace `www.ninetone.com`, repoint DNS, drop the `base` path in `astro.config.mjs`, set `PUBLIC_NOINDEX=false`, and remove the noindex layers (see "Going public" at the bottom).

---

## Why GitHub Pages, not Cloudflare Pages

We initially deployed to Cloudflare Pages. Their build runners returned `500 {"messages":[{"code":"802","message":"Unable to open file"}]}` from the FileMaker session endpoint on every build, while the same call from this laptop, Postman, and GitHub Actions runners (with multiple User-Agents and simulated CF headers) all returned HTTP 200. We never identified what specifically about Cloudflare's build environment trips FM's response — likely a privilege rule or proxy filter — but we don't need to: GitHub Actions runners reach FM fine, so we build there.

The Cloudflare Pages project (if it still exists) can be deleted.

---

## How the build runs

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) does it all. Triggers:

- **Push to `main`** — every code change rebuilds.
- **`repository_dispatch` event `fm-content-changed`** — FM admin POSTs here when content changes (see "FileMaker auto-rebuild" below).
- **Manual trigger** — Actions tab → Run workflow.

Build steps:
1. Checkout
2. `actions/setup-node` Node 22.12.0 (cache: npm)
3. `npm ci`
4. `npm run build` with all `FM_*` and `SHOPIFY_*` env vars from repo secrets
5. `touch dist/.nojekyll` (so Pages doesn't strip `_astro/`)
6. Upload `dist/` artifact and deploy via `actions/deploy-pages@v4`

Concurrency is `group: pages, cancel-in-progress: false` — new runs cancel queued ones, but never abort a running deploy.

---

## Required repo secrets

Already set on `MixxMasterMike123/ninetone-refresh-preview`. To rotate:

```bash
gh secret set <NAME> --body "<value>" --repo MixxMasterMike123/ninetone-refresh-preview
```

Required:

| Secret | Source |
|---|---|
| `FM_HOST` | `files.ninetone.com` |
| `FM_DB` | `Ninetone Group AB` |
| `FM_USER` | from `.env` |
| `FM_PASS` | from `.env` |
| `SHOPIFY_SHOP_DOMAIN` | `fc6d3a-d9.myshopify.com` |
| `SHOPIFY_PUBLIC_STORE_URL` | `https://shop.ninetone.com` |
| `SHOPIFY_ADMIN_TOKEN` | from `.env` |
| `SHOPIFY_HOMEPAGE_COLLECTION_ID` | `514085060873` |

`PUBLIC_NOINDEX=true` is hardcoded in the workflow until launch — flip it there, not in secrets.

---

## FileMaker auto-rebuild

GitHub fires Actions workflows when you POST to its `dispatches` endpoint with the right event type. The FM admin needs to add **one script step** to the existing publish workflow.

### What to send the FM admin

> Could you add one script step to the publish/save workflow?
>
> Step: **Insert from URL**
> URL: `https://api.github.com/repos/MixxMasterMike123/ninetone-refresh-preview/dispatches`
> Method: POST
> Headers:
> ```
> Accept: application/vnd.github.v3+json
> Authorization: Bearer <PASTE THE TOKEN I'M ABOUT TO SEND>
> Content-Type: application/json
> ```
> Body:
> ```json
> {"event_type":"fm-content-changed"}
> ```
>
> Every time you publish, the website rebuilds itself within ~90s. Please don't share the token — it's scoped to one repo and one action only.

### Generating the token

GitHub fine-grained PAT scoped to **only** the `ninetone-refresh-preview` repo with **Contents: Read** + **Metadata: Read** + **Actions: Write** permissions. Set expiry to 1 year, store it in the FM admin's password manager. To rotate: regenerate, send the new value, the FM admin updates the script step.

Generate at: https://github.com/settings/personal-access-tokens

(If you don't want to create a fine-grained PAT manually, the workflow currently allows manual triggers in the Actions tab, so any rebuild-from-FM cadence can be deferred until the FM admin is ready.)

---

## Auth: Cloudflare Access in front of GitHub Pages (TODO)

Deferred until needed. When ready, the path is:

1. **Set up Cloudflare DNS for the project** — point a subdomain like `preview.ninetone.com` at GitHub Pages via CNAME `mixxmastermike123.github.io`. Add the custom domain in the GH Pages settings. Drop the `base` from `astro.config.mjs` (now serving from `/`).
2. **Cloudflare → Zero Trust → Access → Applications → Add → Self-hosted.** Domain: `preview.ninetone.com`. Identity provider: One-time PIN (or Google). Policy: allowlist your email(s). Done.

Until this is in place, the site is publicly reachable but **noindexed at three layers**:
- `<meta name="robots" content="noindex,...">` in every HTML page
- `public/robots.txt` sitewide `Disallow: /`
- `X-Robots-Tag` header in `public/_headers` (note: GH Pages ignores `_headers` — only the meta and robots.txt apply right now)

So nothing gets indexed by Google, but anyone with the URL can view. Treat the URL as semi-private until Access is live.

---

## Verify noindex is working

```bash
URL="https://mixxmastermike123.github.io/ninetone-refresh-preview/"

curl -s "$URL" | grep -i 'name="robots"'
# expect: <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">

curl -s "$URL/robots.txt"
# expect: User-agent: *  /  Disallow: /
```

---

## Going public (later)

When ready to flip the site live on its real domain:

1. **`astro.config.mjs`:** drop the `base: "/ninetone-refresh-preview"` line; set `site: "https://www.ninetone.com"`.
2. **Workflow:** flip `PUBLIC_NOINDEX: 'false'` in `.github/workflows/deploy.yml`.
3. **`public/robots.txt`:** delete (or replace with a real one referencing the real sitemap).
4. **`public/_headers`:** delete the `X-Robots-Tag` block.
5. **Cloudflare Access:** delete the Application in Zero Trust.
6. **DNS:** repoint `www.ninetone.com` from DivHunt to the new host (GH Pages or wherever production lives).

If the production host won't be GitHub Pages: the workflow steps stay almost identical, just swap the `actions/deploy-pages` step for whatever the new host's deploy action is (`netlify`, `vercel`, `wrangler`, etc.).
