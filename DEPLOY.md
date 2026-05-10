# Deploy guide — preview environment

Stack: Cloudflare Pages (static build) + Cloudflare Access (auth) + FileMaker → Pages deploy hook (auto-rebuild on content change).

This doc covers the **preview** deployment only. When the site is ready to replace the live `www.ninetone.com`, repeat the Pages step against a separate project (or swap the custom domain) and remove the noindex layers (see "Going public" at the bottom).

---

## Prereqs

- Cloudflare account with a Pages-enabled plan (Free works).
- A subdomain you can point at Pages, e.g. `preview.ninetone.com`. (Optional — the free `*.pages.dev` URL works too.)
- The repo on GitHub (private). The `gh` CLI run already pushed `main` to `MixxMasterMike/ninetone-refresh-preview` (or whatever name we used).
- The FileMaker + Shopify secrets from `.env`.

---

## 1. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Pick the GitHub repo. If you don't see it, install the Cloudflare GitHub app and grant access to that one repo.
3. Build settings:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** *(leave blank)*
   - **Node version:** `22` (Pages defaults to 18 — set this explicitly under Environment variables → `NODE_VERSION=22.12.0`)
4. **Environment variables** (Production AND Preview branches — set both):

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22.12.0` |
   | `FM_HOST` | `files.ninetone.com` |
   | `FM_DB` | `Ninetone Group AB` |
   | `FM_USER` | *(from .env)* |
   | `FM_PASS` | *(from .env)* — mark as Secret |
   | `SHOPIFY_STORE` | `shop.ninetone.com` |
   | `SHOPIFY_STOREFRONT_TOKEN` | *(from .env)* — mark as Secret |
   | `SHOPIFY_HOMEPAGE_COLLECTION_ID` | *(from .env)* |
   | `API_BOOKING_TAG` | *(from .env)* |
   | `PUBLIC_NOINDEX` | `true` |

   Anything starting with `PUBLIC_` is exposed to the client — that is intentional for the noindex flag (it gates a `<meta>` tag at render time).

5. **Save & Deploy.** First build takes ~25-30s once the FM API responds.

---

## 2. Custom domain (optional but recommended)

1. Pages project → **Custom domains** → **Set up a custom domain**.
2. Add `preview.ninetone.com`.
3. Cloudflare auto-creates the CNAME if `ninetone.com` is on Cloudflare DNS. Otherwise add `CNAME preview <project>.pages.dev` at your registrar.
4. SSL is automatic via Cloudflare's universal cert.

---

## 3. Cloudflare Access (the login wall)

This is the auth layer. It lives in **Zero Trust** (free for up to 50 users), totally separate from Pages, and gates the URL before any HTML is served.

1. Dashboard → top-right account picker → **Zero Trust** (it's its own console). On first visit it'll prompt you to create a Zero Trust org name — pick anything, e.g. `ninetone`.
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
3. Application configuration:
   - **Application name:** Ninetone preview
   - **Session duration:** 24 hours (or longer — auto-logout interval)
   - **Application domain:** `preview.ninetone.com` (or the `*.pages.dev` host)
   - Leave path empty (gates the whole site)
4. **Identity providers:** at minimum keep **One-time PIN** (sends a 6-digit code to whitelisted email addresses — zero setup, works immediately). Add Google/Microsoft/GitHub later if you want SSO.
5. **Policies** → **Add a policy**:
   - **Policy name:** Team
   - **Action:** Allow
   - **Configure rules** → **Include** → **Emails** → list the addresses you want to give access to. Or use **Emails ending in** → `@ninetone.com` to allow the whole company at once.
6. Save. Visiting `preview.ninetone.com` now bounces to a Cloudflare login page → enters email → gets a one-time PIN → logged in for 24h.

To revoke access: remove the email from the policy. To shut the wall off entirely: delete the Application (the site stays up, just unauthenticated).

---

## 4. Auto-redeploy on FileMaker content change

Pages exposes a **Deploy Hook** — a URL you can POST to to trigger a fresh build. We hand that URL to the FileMaker admin and they wire it into the existing publish workflow.

1. Pages project → **Settings** → **Builds & deployments** → **Deploy hooks** → **Add deploy hook**.
2. Name: `FileMaker publish`. Branch: `main`. Save.
3. Copy the URL. Looks like `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<UUID>`.
4. **Send the URL to the FM admin with this ask:**

   > Could you add one script step to the existing publish/save workflow?
   >
   > Step: **Insert from URL**
   > URL: `<paste the deploy hook URL>`
   > Method: POST
   > No headers, no body needed.
   >
   > That's it — every time you publish, the website rebuilds itself within ~30s. The URL is the secret (no auth needed), please don't share it outside FM.

5. Build queue is automatic — even if the script fires 20 times in a minute, Pages dedupes and runs the latest.

**Fallback if the FM admin won't add the script:** add a GitHub Action on cron (e.g. `*/30 * * * *`) that POSTs the deploy hook. Less efficient (rebuilds on a schedule even when nothing changed) but zero FM access required. Let me know and I'll add the workflow file.

---

## 5. Verify the noindex is working

After the first deploy:

```bash
curl -sI https://preview.ninetone.com/ | grep -i robots
# expect: x-robots-tag: noindex, nofollow, noarchive, nosnippet, noimageindex

curl -s https://preview.ninetone.com/robots.txt
# expect: User-agent: *  /  Disallow: /

curl -s https://preview.ninetone.com/ | grep -i 'name="robots"'
# expect: <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
```

All three layers are belt-and-braces. Removing any one of them is fine; removing all three is launch day.

---

## Going public (later)

When ready to flip the site live:

1. **Pages env vars:** set `PUBLIC_NOINDEX=false`.
2. **`public/robots.txt`:** delete (Astro will then serve no robots file, defaulting to "crawl everything") OR replace with a real one + `Sitemap: https://www.ninetone.com/sitemap-index.xml`.
3. **`public/_headers`:** delete the `X-Robots-Tag` block at the top.
4. **Access:** delete the Application in Zero Trust → Access → Applications.
5. Trigger a rebuild (push any commit, or hit the deploy hook).

Optional but recommended: at this point repoint the Pages project at the live `www.ninetone.com` domain (Custom domains → add → set as primary), and decommission the old hosting.
