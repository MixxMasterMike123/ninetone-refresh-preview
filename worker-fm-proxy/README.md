# Ninetone FM image proxy

Tiny Cloudflare Worker that holds an FM session token in memory, refreshes
when stale, and serves image bytes for a given artist/client/booking/news slug
+ field. Sits in front of GH Pages so static HTML never embeds FM URLs.

## Deploy

```bash
cd worker-fm-proxy
npx wrangler login                       # one time
npx wrangler secret put FM_USER          # paste username when prompted
npx wrangler secret put FM_PASS          # paste password when prompted
npx wrangler deploy
```

After deploy, you'll get a URL like `https://ninetone-fm-image-proxy.<your-subdomain>.workers.dev`. Update `src/lib/fm-image-mirror.ts` (or wherever consumes it) to rewrite FM streaming URLs to point at it.

## Routes

- `GET /healthz` → JSON, sanity check the FM token works
- `GET /artist/:slug/big` → big artist photo from `API_ARTIST_DETAIL`
- `GET /artist/:slug/small` → small artist photo
- `GET /client/:slug/big` → from `API_CLIENT_DETAIL`
- `GET /booking/:slug/big` → from `API_BOOKING_DETAIL`
- `GET /news/:slug/cover` → news cover image from `API_WEBPOSTS`

## Why this exists

FM `Streaming_SSL/RCFileProcessor` URLs rotate per API call AND expire with
the session token (~15 min). Embedding them in static HTML means images break
within minutes of deploy.

A static site can't refresh tokens at request time. This Worker can — that's
the whole point. The Worker IS the runtime layer that the static site lacks.
