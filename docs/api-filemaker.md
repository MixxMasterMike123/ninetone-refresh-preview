# FileMaker Data API — Primary CMS source

Ninetone's internal FileMaker database (`Ninetone Group AB`) is the source of truth for artists, clients, news, team, releases, and previous artists. Exposed via FileMaker Server's Data API.

## Auth flow — two-step (15-min token)

FileMaker Data API uses session tokens that expire after **15 minutes of inactivity**.

### Step 1 — Get a session token

```bash
POST https://files.ninetone.com/fmi/data/vLatest/databases/Ninetone%20Group%20AB/sessions
Headers:
  Content-Type: application/json
  Authorization: Basic <base64(user:password)>
```

Response includes `response.token` — a Bearer token good for 15 min, refreshed on every use.

**Credentials** stored as Cloudflare Pages env vars:
- `FM_USER`
- `FM_PASS`
- `FM_HOST` = `files.ninetone.com`
- `FM_DB` = `Ninetone Group AB` (URL-encoded as `Ninetone%20Group%20AB`)

### Step 2 — Query a layout

```bash
POST https://files.ninetone.com/fmi/data/vLatest/databases/Ninetone%20Group%20AB/layouts/{LAYOUT}/_find
Headers:
  Content-Type: application/json
  Authorization: Bearer <token>
Body:
  {
    "query": [ { "field": "value", ... } ],
    "sort":  [ { "fieldName": "...", "sortOrder": "ascend|descend" } ],
    "offset": "1",
    "limit": 99
  }
```

Response shape: `response.data` is an array of records. Each record has:
- `fieldData` — the actual fields
- `portalData` — related records
- `recordId`, `modId` — FileMaker meta

## Known layouts (endpoints) — all confirmed

| Layout | Purpose | Wrapper |
|---|---|---|
| `API_ARTIST` | Records active artist roster | `getArtists()` |
| `API_ARTIST_DETAIL` | Single artist + portal data; also Previous Artists (filterActive=Not Active) | `getArtistBySlug()`, `getPreviousArtists()` |
| `API_Management` | Management clients roster | `getClients()` |
| `API_Booking` | Ninetone Nation entertainers (artists + förläsare) | `getBookingRoster()` |
| `API_USERS` | Team members | `getTeam()` |
| `API_NEWS` | News feed (sorted by Date desc) — used on `/news` | `getNews()` |
| `API_WEBPOSTS` | Web posts (categorized) — used on section landings | `getWebPosts()` |

### Query patterns by layout

**API_ARTIST** (active Records artists)
```json
{ "query": [{ "filterActive": "==Active", "filterType": "Music", "SLUG": "*", "letterSearch": "==**", "Head Artist": "*" }],
  "sort": [{ "fieldName": "highLight_music", "sortOrder": "descend" }, { "fieldName": "Head Artist", "sortOrder": "ascend" }] }
```

**API_ARTIST_DETAIL** (previous artists)
```json
{ "query": [{ "filterActive": "==Not Active", "filterType": "Music", "SLUG": "*", "artistPresentationShort": "*", "Head Artist": "==**" }],
  "sort": [{ "fieldName": "Head Artist", "sortOrder": "ascend" }],
  "offset": "1", "limit": 150 }
```

**API_Management**
```json
{ "query": [{ "filterActive": "==Active", "filterTypeCombine": "Management", "SLUG": "*", "Head Artist": "*" }],
  "sort": [{ "fieldName": "highLight_client", "sortOrder": "descend" }, { "fieldName": "Head Artist", "sortOrder": "ascend" }] }
```

**API_Booking**
```json
{ "query": [{ "filterActive": "==Active", "filterType": "Booking", "SLUG": "*", "filterTypeCombine": "==***", "tagBooking": "*" }] }
```

**API_USERS**
```json
{ "query": [{ "Active": "==Ja", "SLUG": "*" }],
  "sort": [{ "fieldName": "sortOrder", "sortOrder": "ascend" }] }
```

**API_NEWS**
```json
{ "query": [{ "Message": "*" }],
  "sort": [{ "fieldName": "Date", "sortOrder": "descend" }] }
```

## Query DSL — DivHunt → real values

DivHunt builds queries with template properties. Mapping:

| DivHunt property | Real meaning | Example |
|---|---|---|
| `slug` | URL slug to match (`*` = any) | `chan-fuze` |
| `filteractive` | Match active flag (`==*` = active only, `*` = all) | `==*` |
| `endpoint` | The FM layout name | `API_ARTIST_DETAIL` |
| `artist` | Head Artist filter (`*` = any) | `*` |
| `filterType` | Hardcoded type filter | `Music` |

So an "all active artists" query is:
```json
{
  "query": [{
    "filterActive": "==*",
    "filterType": "Music",
    "SLUG": "*",
    "Head Artist": "*"
  }],
  "sort": [
    { "fieldName": "highLight_music", "sortOrder": "descend" },
    { "fieldName": "Head Artist",     "sortOrder": "ascend"  }
  ],
  "offset": "1",
  "limit": 99
}
```

A single artist by slug:
```json
{
  "query": [{ "filterActive": "==*", "SLUG": "chan-fuze" }],
  "limit": 1
}
```

## Implementation in Astro

Build-time fetch — token never reaches the browser.

```ts
// src/lib/filemaker.ts (sketch)
let cachedToken: { value: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;

  const auth = Buffer.from(`${process.env.FM_USER}:${process.env.FM_PASS}`).toString("base64");
  const res = await fetch(
    `https://${FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
    }
  );
  const json = await res.json();
  const token = json.response.token;
  // FM tokens expire after 15 min idle — cache for 12 to be safe
  cachedToken = { value: token, expires: Date.now() + 12 * 60 * 1000 };
  return token;
}

export async function fmFind<T>(layout: string, body: object): Promise<T[]> {
  const token = await getToken();
  const res = await fetch(
    `https://${FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}/layouts/${layout}/_find`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  return json.response.data.map((r: any) => r.fieldData);
}

// Typed wrappers
export const getArtists = () =>
  fmFind<Artist>("API_ARTIST_DETAIL", {
    query: [{ filterActive: "==*", filterType: "Music", SLUG: "*", "Head Artist": "*" }],
    sort: [
      { fieldName: "highLight_music", sortOrder: "descend" },
      { fieldName: "Head Artist", sortOrder: "ascend" },
    ],
    offset: "1",
    limit: 99,
  });

export const getArtistBySlug = (slug: string) =>
  fmFind<Artist>("API_ARTIST_DETAIL", {
    query: [{ filterActive: "==*", SLUG: slug }],
    limit: 1,
  }).then((rows) => rows[0]);
```

## Data freshness — rebuild trigger

FileMaker can't natively webhook on edit, so two options:

1. **Scheduled rebuild** — Cloudflare cron every 15-30 min hits the deploy hook. Simplest, slight lag.
2. **FileMaker script trigger** — a "Publish" button in FileMaker that calls `curl <cloudflare-deploy-hook>` via `Insert from URL`. Editor-controlled, instant.

Option 2 is what the user asked for ("within minutes of CMS edit"). Wire this up once we have the deploy hook URL.

## Security notes

- **Rotate the FileMaker `api_user` password** before the new site launches — current creds were shared in plaintext during planning.
- Never bundle `FM_USER` / `FM_PASS` into client JS. They live as Cloudflare Pages **build-time** env vars only.
- The site is purely static HTML by the time it hits the browser — no FileMaker calls happen at runtime.
- Consider scoping `api_user` to read-only access on only the layouts the site needs.

## Open questions for Ninetone IT

1. Full list of layouts the current site uses (artists, clients, news, team, etc. — endpoint names)
2. Field-level documentation for at least `API_ARTIST_DETAIL` — we'll need to type the `Artist` shape
3. Image hosting — does FileMaker return image URLs, or are images stored as base64 / container fields needing extraction?
4. Are there layouts for releases/discography linked to artists, or are they portalData on the artist record?
5. Rate limits / connection caps on the FM Data API — relevant for build-time bulk fetch
