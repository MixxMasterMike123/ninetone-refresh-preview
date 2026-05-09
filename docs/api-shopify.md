# Shopify API — Merch source

The current DivHunt site pulls merch from a Shopify store via the Admin REST API.

## Current call (from DivHunt config)

```
GET https://shop.ninetone.com/admin/api/2023-01/products.json
?collection_id=514085060873

Headers:
  X-Shopify-Access-Token: <REDACTED — rotate before reuse>

Response key: products
```

- `collection_id` is dynamic — passed via DivHunt "properties"
- Conditional on `$client->get('admin') == true` (only fetched in admin/build context)

## Known collection IDs

| Collection | ID |
|---|---|
| Homepage merch (Ninetone-branded apparel) | 514085060873 |
| _(others to discover)_ | |

## Security notes for the Astro rebuild

**Do NOT use the Admin API token in the public site.** Two safer options:

### Option A — Storefront API (recommended)
- Public-safe read-only token, designed for storefront use
- Endpoint: `https://shop.ninetone.com/api/2024-10/graphql.json`
- Header: `X-Shopify-Storefront-Access-Token`
- Create one in Shopify admin → Apps → Develop apps → custom app → Storefront API access
- Can be embedded in client JS or used at build time without risk

### Option B — Admin API at build-time only
- Token lives as Cloudflare Pages env var (never in client JS, never in repo)
- Astro fetches at build, bakes products into static HTML
- Rebuild on shop changes via Shopify webhook → Cloudflare deploy hook

## API version

`2023-01` is old. Latest stable when rebuilt is `2024-10` (or current). Bump on rebuild — old versions get sunset.

## Token rotation reminder

The token visible in the original screenshot must be revoked in Shopify before deployment. Generate a new one (Storefront API preferred) and store as `SHOPIFY_STOREFRONT_TOKEN` (or `SHOPIFY_ADMIN_TOKEN`) in Cloudflare Pages env, never in source.
