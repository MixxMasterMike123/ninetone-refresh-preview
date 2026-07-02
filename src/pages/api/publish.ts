import type { APIRoute } from "astro";

/**
 * "Publish now" — instant cache flush for editors (docs/cms-architecture.md).
 *
 * Bumps the `cache-version` epoch in KV. Every edge-cache key embeds the
 * version (src/middleware.ts), so bumping it orphans all cached copies at
 * once — the next visitor renders fresh from FM. No Cloudflare purge-API
 * token needed, works on workers.dev and the production domain alike.
 *
 * Effect propagates within ~a minute (the version lookup is edge-cached 60s)
 * plus the 60s data-cache TTL. Editor mental model: "edits appear within the
 * hour on their own — hit Publish to make it a minute."
 *
 * Auth: single shared password (PUBLISH_PASSWORD secret). Deliberately
 * simple for v1 — one org, trusted editors, HTTPS.
 */

import { getCfEnv } from "../../lib/cf";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const env = await getCfEnv();
  const kv = env?.CACHE_STATE;
  const expected = env?.PUBLISH_PASSWORD;

  if (!kv || !expected) {
    return json(503, {
      ok: false,
      error: "Publish is only available on the live (Cloudflare) deployment",
    });
  }

  let password = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as { password?: string };
      password = String(body.password ?? "");
    } else {
      const form = await request.formData();
      password = String(form.get("password") ?? "");
    }
  } catch {
    return json(400, { ok: false, error: "Invalid body" });
  }

  if (!password || !timingSafeEqual(password, expected)) {
    return json(401, { ok: false, error: "Wrong password" });
  }

  const version = `${Date.now().toString(36)}`;
  await kv.put("cache-version", version);
  return json(200, { ok: true, version });
};
