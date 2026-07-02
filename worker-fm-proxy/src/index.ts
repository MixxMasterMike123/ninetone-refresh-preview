/**
 * Ninetone FM image proxy.
 *
 * GH Pages serves static HTML; this Worker serves the images. It holds a
 * cached FM session token, refreshes when stale, fetches a fresh streaming
 * URL on demand for a given (layout, slug, field) tuple, then streams the
 * bytes through to the browser. No FM URLs ever appear in the static HTML.
 *
 * Routes:
 *   GET /artist/:slug/big      → API_ARTIST_DETAIL.artistPicture_big
 *   GET /artist/:slug/small    → API_ARTIST_DETAIL.artistPicture_small
 *   GET /client/:slug/big      → API_CLIENT_DETAIL.artistPicture_big
 *   GET /booking/:slug/big     → API_BOOKING_DETAIL.artistPicture_big
 *   GET /news/:slug/cover      → API_WEBPOSTS.image_webp
 *   GET /healthz               → quick FM session check
 *
 * CORS: open to the GH Pages origin + production domain.
 */

interface Env {
  FM_HOST: string;
  FM_DB: string;
  FM_USER: string;
  FM_PASS: string;
}

const ALLOWED_ORIGINS = new Set([
  "https://mixxmastermike123.github.io",
  "https://www.ninetone.com",
  "https://ninetone.com",
]);

// Token cache lives in module scope for the lifetime of an isolate. Workers
// keep isolates warm for many requests, so most calls hit the cache. When the
// isolate is torn down or the token expires, next request grabs a fresh one.
let cachedToken: { value: string; expires: number } | null = null;
const TOKEN_TTL_MS = 12 * 60 * 1000; // refresh at 12 min, FM expires at 15

async function getToken(env: Env): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;
  const auth = btoa(`${env.FM_USER}:${env.FM_PASS}`);
  const res = await fetch(
    `https://${env.FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(env.FM_DB)}/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: "{}",
    },
  );
  if (!res.ok) {
    throw new Error(`FM session failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { response: { token: string } };
  cachedToken = { value: json.response.token, expires: Date.now() + TOKEN_TTL_MS };
  return cachedToken.value;
}

interface FmRecord {
  fieldData: Record<string, string>;
}

async function fmFind(
  env: Env,
  layout: string,
  query: Record<string, string>,
  retried = false,
): Promise<FmRecord | null> {
  const token = await getToken(env);
  const res = await fetch(
    `https://${env.FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(env.FM_DB)}/layouts/${layout}/_find`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: [query], limit: 1 }),
    },
  );
  // 401 = token expired between cache check and request — drop cache, retry once.
  // After one retry we bail out so a persistent auth failure can't recurse.
  if (res.status === 401) {
    cachedToken = null;
    if (retried) throw new Error("FM auth failed after token refresh");
    return fmFind(env, layout, query, true);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { response: { data: FmRecord[] }; messages: { code: string }[] };
  if (json.messages?.some((m) => m.code === "401")) return null; // FM "no records" code
  return json.response.data?.[0] ?? null;
}

interface RouteSpec {
  layout: string;
  query: (slug: string) => Record<string, string>;
  fields: Record<string, string>;
}

const ROUTES: Record<string, RouteSpec> = {
  artist: {
    layout: "API_ARTIST_DETAIL",
    query: (slug) => ({ SLUG: `==${slug}` }),
    fields: { big: "artistPicture_big", small: "artistPicture_small" },
  },
  client: {
    layout: "API_Management",
    query: (slug) => ({ SLUG: `==${slug}` }),
    fields: { big: "artistPicture_big", small: "artistPicture_small" },
  },
  booking: {
    layout: "API_Booking",
    query: (slug) => ({ SLUG: `==${slug}` }),
    fields: { big: "artistPicture_big", small: "artistPicture_small" },
  },
  news: {
    layout: "API_NEWS",
    query: (slug) => ({ slug: `==${slug}` }),
    fields: { cover: "image_webp" },
  },
  team: {
    layout: "API_USERS",
    query: (slug) => ({ SLUG: `==${slug}` }),
    fields: { big: "userPhoto", small: "userPhotoSmall" },
  },
};

// Releases are a portal on the artist record (not their own layout). Looked up
// by artist slug + either an album name (current scheme — stable across FM
// edits) or a positional index (legacy scheme kept alive for HTML built before
// the by-album route existed).
async function fetchReleasePortal(
  env: Env,
  artistSlug: string,
  retried = false,
): Promise<Array<Record<string, unknown>> | null> {
  const token = await getToken(env);
  const res = await fetch(
    `https://${env.FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(env.FM_DB)}/layouts/API_ARTIST_DETAIL/_find`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: [{ SLUG: `==${artistSlug}` }],
        limit: 1,
        // Match src/lib/ninetone.ts: explicit portal limit so big
        // discographies aren't capped at the layout's portal row count.
        portal: ["Green Web Category"],
        "limit.Green Web Category": "500",
      }),
    },
  );
  if (res.status === 401) {
    cachedToken = null;
    if (retried) throw new Error("FM auth failed after token refresh");
    return fetchReleasePortal(env, artistSlug, true);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    response: { data: Array<{ portalData?: Record<string, Array<Record<string, unknown>>> }> };
    messages: { code: string }[];
  };
  if (json.messages?.some((m) => m.code === "401")) return null;
  const portal = json.response.data?.[0]?.portalData?.["Green Web Category"];
  if (!portal) return null;
  // Drop rows without an album name — the build-side rewriter filters these
  // out before assigning covers, so the Worker must see the same set.
  return portal.filter((r) => String(r["Green Web Category::Album"] ?? "") !== "");
}

function releaseCoverField(row: Record<string, unknown>): string | null {
  const url =
    String(row["Green Web Category::coverPicture_webp"] ?? "") ||
    String(row["Green Web Category::Cover_Picture"] ?? "");
  return url || null;
}

async function fetchReleaseCoverByAlbum(
  env: Env,
  artistSlug: string,
  album: string,
): Promise<string | null> {
  const portal = await fetchReleasePortal(env, artistSlug);
  if (!portal) return null;
  // Same album released twice (e.g. single + remaster) → prefer the newest.
  const matches = portal
    .filter((r) => String(r["Green Web Category::Album"] ?? "") === album)
    .sort((a, b) => {
      const da = parseDate(String(a["Green Web Category::Releasedate First"] ?? ""));
      const db = parseDate(String(b["Green Web Category::Releasedate First"] ?? ""));
      return db - da;
    });
  const row = matches[0];
  return row ? releaseCoverField(row) : null;
}

// Legacy: HTML built before the by-album scheme addresses covers by
// newest-first index. Keep resolving those until the preview is rebuilt.
async function fetchReleaseCoverByIndex(
  env: Env,
  artistSlug: string,
  index: number,
): Promise<string | null> {
  const portal = await fetchReleasePortal(env, artistSlug);
  if (!portal) return null;
  const sorted = [...portal].sort((a, b) => {
    const da = parseDate(String(a["Green Web Category::Releasedate First"] ?? ""));
    const db = parseDate(String(b["Green Web Category::Releasedate First"] ?? ""));
    return db - da;
  });
  const row = sorted[index];
  return row ? releaseCoverField(row) : null;
}

function parseDate(s: string): number {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Standard observability headers attached to every image response. Lets us
 * inspect what the Worker is doing from devtools without log access:
 *   x-fm-route   route kind that served the request, e.g. "artist/big"
 *   x-fm-status  hit | miss | error — kept simple now; expand if/when we
 *                add caches.default in front of FM
 */
function obsHeaders(route: string, status: "hit" | "miss" | "error" = "miss"): Record<string, string> {
  return {
    "x-fm-route": route,
    "x-fm-status": status,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "healthz") {
      // Beyond a token check, verify FM is actually answering for a route we
      // know exists. Catches the case where the token is valid but a layout
      // changed name or permission flipped.
      const checks: Record<string, unknown> = { tokenCached: !!cachedToken };
      try {
        await getToken(env);
        checks.token = "ok";
      } catch (err) {
        checks.token = `failed: ${err}`;
        return new Response(JSON.stringify({ ok: false, ...checks }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
      try {
        // Cheap representative read — just confirms the API_ARTIST_DETAIL
        // layout still responds. We don't care which record comes back.
        const probe = await fmFind(env, "API_ARTIST_DETAIL", { SLUG: "*" });
        checks.fmFind = probe ? "ok" : "no-records";
      } catch (err) {
        checks.fmFind = `failed: ${err}`;
        return new Response(JSON.stringify({ ok: false, ...checks }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
      return new Response(JSON.stringify({ ok: true, ...checks }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const [kind, slug, variant, extra] = parts;

    // /release/:artistSlug/by-album/:album — release cover art (current)
    // /release/:artistSlug/:index         — legacy positional lookup
    if (kind === "release" && slug && variant) {
      const byAlbum = variant === "by-album";
      const route = byAlbum ? "release/by-album" : `release/${variant}`;
      let idx = -1;
      let album = "";
      if (byAlbum) {
        if (!extra) {
          return new Response("Missing album", {
            status: 400,
            headers: { ...corsHeaders(origin), ...obsHeaders(route, "error") },
          });
        }
        album = decodeURIComponent(extra);
      } else {
        idx = parseInt(variant, 10);
        if (isNaN(idx)) {
          return new Response("Bad index", {
            status: 400,
            headers: { ...corsHeaders(origin), ...obsHeaders(route, "error") },
          });
        }
      }
      let imageUrl: string | null;
      try {
        imageUrl = byAlbum
          ? await fetchReleaseCoverByAlbum(env, slug, album)
          : await fetchReleaseCoverByIndex(env, slug, idx);
      } catch (err) {
        return new Response(`FM error: ${err}`, {
          status: 502,
          headers: { ...corsHeaders(origin), ...obsHeaders(route, "error") },
        });
      }
      if (!imageUrl) {
        return new Response("Release not found", {
          status: 404,
          headers: { ...corsHeaders(origin), ...obsHeaders(route, "error") },
        });
      }
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        return new Response(`Image fetch failed: ${imgRes.status}`, {
          status: 502,
          headers: { ...corsHeaders(origin), ...obsHeaders(route, "error") },
        });
      }
      const headers = new Headers(imgRes.headers);
      headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
      for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
      for (const [k, v] of Object.entries(obsHeaders(route, "miss"))) headers.set(k, v);
      return new Response(imgRes.body, { headers });
    }

    const route = ROUTES[kind];
    const routeTag = `${kind}/${variant ?? ""}`;
    if (!route) {
      return new Response("Not found", {
        status: 404,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }
    const fieldName = route.fields[variant];
    if (!fieldName || !slug) {
      return new Response("Not found", {
        status: 404,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }

    let record: FmRecord | null;
    try {
      record = await fmFind(env, route.layout, route.query(slug));
    } catch (err) {
      return new Response(`FM error: ${err}`, {
        status: 502,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }
    if (!record) {
      return new Response("Record not found", {
        status: 404,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }

    const imageUrl = record.fieldData[fieldName];
    if (!imageUrl) {
      return new Response("Image field empty", {
        status: 404,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }

    // Stream the image bytes through. FM URL is fresh — generated this same
    // request — so it works for the brief moment we need it.
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return new Response(`Image fetch failed: ${imgRes.status}`, {
        status: 502,
        headers: { ...corsHeaders(origin), ...obsHeaders(routeTag, "error") },
      });
    }
    const headers = new Headers(imgRes.headers);
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    for (const [k, v] of Object.entries(obsHeaders(routeTag, "miss"))) headers.set(k, v);
    return new Response(imgRes.body, { headers });
  },
};
