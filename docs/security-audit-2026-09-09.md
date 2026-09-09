# Ninetone launch security audit — 2026-09-09

## Outcome

This review found and fixed stored cross-site scripting through FileMaker markdown, unsafe CMS-driven link schemes, cache-separation weaknesses, an unbounded in-memory cache, and an insufficiently protected Publish endpoint. It also removed logging and false success responses from contact/newsletter endpoints that had no delivery provider, removed consent-bypassing no-script trackers, hardened the FileMaker image proxy, and verified and strengthened the new site's existing active-only booking behavior.

This was a source review with automated regression tests and build-output inspection. It was not an external penetration test. Cloudflare account configuration, DNS/TLS state, WAF rules, secret values/rotation, FileMaker server configuration, GitHub organization controls, and third-party accounts were outside the accessible scope.

## Findings and remediation

### High — stored XSS in FileMaker-authored markdown (fixed)

`marked` accepted raw HTML from FileMaker and several pages inserted its result with Astro `set:html`. A CMS value could therefore execute tags or event handlers in a visitor's origin. [The shared renderer](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/lib/markdown.ts) now escapes raw HTML and rejects link/image schemes outside an allowlist. Regression coverage includes raw event-handler HTML, `javascript:` links, control-character-obfuscated schemes, and safe HTTPS links.

### High — FileMaker image proxy validation and response handling (fixed)

The public proxy previously needed stronger route/identifier validation and upstream response controls. [The proxy](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/worker-fm-proxy/src/index.ts) now validates route identifiers before they reach FileMaker, constrains resolved upstream streaming URLs to the configured HTTPS FileMaker host (including redirects), restricts accepted image media types, copies only selected response headers, returns `nosniff`, rejects unsupported methods, and redacts upstream errors. It now also applies a 15-second upstream timeout across the whole redirect chain and a 15 MiB response size cap enforced via a streaming counter, so a hung or oversized upstream response cannot pin a Worker invocation or exhaust memory. Proxy regression tests exercise malformed paths, untrusted redirect targets, MIME rejection, successful responses, upstream-header stripping, method handling, the size cap, and the timeout.

### High — vulnerable application dependencies (partially fixed; residual high advisories)

The baseline audit reported 13 vulnerabilities, including one critical. [Dependencies](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/package.json) were upgraded from Astro 6.3.1 to 7.3.2, the Cloudflare adapter from 13.7.0 to 14.3.1, and Wrangler to 4.130.0. Astro 7.2.8 patched the critical untrusted-AVIF image-optimization RCE, `GHSA-26w7-cxv4-gfx2`. The current root production audit reports 5 high advisories, all in the Cloudflare tooling chain and rooted in `sharp <0.35.4` (`GHSA-rgj7-g3m4-5g8c`) through Miniflare/Wrangler and the adapter. This site configures Astro's passthrough image service and does not accept visitor image uploads, which reduces the documented AVIF precondition, but the advisories remain open until that dependency chain resolves a patched Sharp. The dependency tree is not vulnerability-free.

### Medium — shared edge-cache leakage and cache abuse (fixed)

The edge key did not separate request origins, and cache eligibility did not consider Authorization, arbitrary query strings, or an application's `private`/`no-store`/`no-cache` response directive. This created unsafe behavior if host-dependent or authenticated output were introduced. [The middleware](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/middleware.ts) now includes origin in keys; an `Authorization` header or any non-tracking query parameter bypasses the shared cache, while [the policy](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/lib/cache-policy.ts) treats analytics cookies (e.g. `_ga`, `_fbp`) and known tracking parameters (`utm_*`, `fbclid`, `gclid`, `ttclid`, and similar) as not affecting the response, so they neither defeat caching nor appear in the cache key — the key is built from the path alone. Private directives, redirects, failures, and cookie-setting responses are not stored. It also handles immutable platform response headers safely. [The data cache](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/lib/cache.ts) is capped at 500 entries so request-derived slugs cannot grow a long-lived isolate without bound.

### Medium — Publish endpoint abuse and request handling (fixed)

The shared-password cache invalidation endpoint had no attempt limit and trusted ordinary body parsing. [The endpoint](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/pages/api/publish.ts) now requires the configured Cloudflare rate-limit binding and fails closed if protection is missing or unavailable; keys are a SHA-256 digest of the connecting IP. It rejects cross-site requests, reads at most 4 KiB from the actual stream even without `Content-Length`, accepts only JSON or URL-encoded bodies, uses fixed-length SHA-256 values with Node's native `timingSafeEqual`, returns `no-store`, and reports KV failures without throwing. Tests verify limiter denial/absence/failure, cross-origin requests, malformed/null/wrong/correct passwords, streamed oversize bodies, and that rejected attempts never write KV.

### Medium — unsafe CMS and search-result URLs (fixed)

Social/streaming links and client-rendered search results consumed CMS-generated URLs. HTML attribute escaping alone does not make a `javascript:` URL safe. External links now accept HTTP(S) only. Search navigation is restricted to the current origin and search images to HTTP(S).

### Medium — upstream error disclosure (fixed)

FileMaker session/find failures included upstream response bodies or message text in application errors. Errors now retain the HTTP status and FileMaker numeric codes needed for diagnosis without copying upstream bodies into Worker/build logs.

### Low — baseline browser controls and tracking fallback (fixed)

Responses now set `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, a restrictive `Permissions-Policy`, HSTS (without asserting policy over unaudited subdomains), and a compatible CSP baseline for `base-uri`, objects, and frame ancestors. The CSP deliberately does not yet restrict scripts because the current analytics setup uses inline scripts. Google Tag Manager and Meta no-script pixels were removed because browsers with JavaScript disabled cannot express consent through the site's consent UI. `public/_headers` is a Cloudflare Pages/Netlify convention that GitHub Pages ignores outright, so these headers are enforced only on the Cloudflare target via the middleware above — the GitHub Pages preview build does not receive them.

### Low — build artifact audit leaked URLs and did not gate failures (fixed)

[The post-build audit](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/scripts/audit-dist.mjs) previously printed complete leaked FileMaker streaming URLs and always exited successfully. It now redacts those URLs and fails the build when an FM URL leak or audit execution failure is detected.

### Functional/privacy — contact and newsletter delivery (deferred by user)

These endpoints logged submitted personal data and returned success without sending it anywhere. Logging and false success were removed. The contact UI now directs visitors to the relevant Ninetone email address and the nonfunctional newsletter form is removed. Provider integration is explicitly deferred for Patrik/Ninetone; there is no hidden queue or retained submission.

### Functional — active-only booking publication (verified and strengthened)

The new site already queried FileMaker for `Active` booking records. This audit verified that behavior against live data, then added a strict shared predicate that fails closed on blank, variant, or contradictory local/portal status fields. Live evidence contained 15 `Active` and 15 `Not Active` portal-category rows. Set-to-build verification found 9 unique active slugs and 7 unique inactive-only slugs; output contained all 9 active links/detail pages, zero inactive-only links/pages, and no booking link without a corresponding detail page.

## Verification

- `npm test` — 14/14 application tests passed (booking status, markdown/URL security, cache policy and middleware integration, Publish authorization/rate/body behavior).
- `npm audit --omit=dev --json` — 0 critical, 5 high, 0 moderate, 0 low in the root production tree; residual chain described above.
- Final static build passed. Artifact checks found all three contact routes using the correct direct email links and no forms, no rendered newsletter capture, 9 active booking links with 9 matching detail directories, and no inactive-only booking output. Two existing invalid Shopify collection IDs produced non-fatal Management-page warnings.
- `npm run build:cf` — Cloudflare server build passed. Wrangler could not write its optional debug log under the filesystem sandbox, but the build completed successfully with exit code 0.
- `cd worker-fm-proxy && npm test` — 5/5 proxy security tests passed.
- `cd worker-fm-proxy && npm audit --json` — 0 critical, 3 high, 0 moderate, 0 low; the three reports are the same Wrangler → Miniflare → Sharp residual chain described above.
- Rectified source/configuration checks found environment-variable references and secret names, but no committed credential value. Git history was not scanned; repository-host secret scanning still needs verification.
- Follow-up review, 2026-09-09: `renderBio`'s `safeUrl` resolved hrefs against a `https://markdown.invalid/` base, so a protocol-relative link (`//evil.com/...`) parsed as a live `https://evil.com/...` URL and passed the scheme allowlist. [The renderer](/Users/mikaelohlen/Documents/CursorSites/ninetone_refresh/src/lib/markdown.ts) now rejects any href starting with `//` or a backslash variant before URL parsing; relative paths and `https://`/`mailto:`/`tel:` links are unaffected.

No deployment or production-state change was performed as part of this audit.

## Launch items outside this code audit

- Provider-backed contact/newsletter delivery remains deferred by the user to Patrik/Ninetone.
- Confirm production `PUBLIC_NOINDEX=false`, remove the preview `X-Robots-Tag` noindex block, and verify `robots.txt` at cutover.
- Confirm real tracker/container IDs and consent behavior before enabling analytics; placeholders must not be treated as configured integrations.
- Verify Cloudflare custom-domain TLS, WAF/rate-limit behavior, binding presence, least-privilege secrets, log redaction/retention, and access controls in the production account.
- The public FileMaker image proxy has no per-client limiter in the reviewed code. Confirm an account-level Cloudflare rate-limit or WAF rule before launch to limit uncached upstream amplification.
- Verify GitHub branch protection, Actions permissions, dependency update automation, and secret scanning in the repository settings.
- Re-run `npm audit` regularly and update when the Cloudflare chain resolves `sharp` to 0.35.4 or newer.

## Primary references

- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare Workers Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare security headers guidance](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [GitHub advisory GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
- [Astro advisory GHSA-26w7-cxv4-gfx2](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2)
