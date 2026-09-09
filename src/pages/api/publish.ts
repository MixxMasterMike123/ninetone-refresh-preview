import type { APIRoute } from "astro";
import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { readLimitedBody, json, isCrossSite, sha256Hex } from "../../lib/http.ts";

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

import { getCfEnv, type CfEnv } from "../../lib/cf.ts";

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ab, bb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]).then((values) => values.map((value) => new Uint8Array(value)));
  return cryptoTimingSafeEqual(ab, bb);
}

export async function handlePublish(request: Request, env: CfEnv | null): Promise<Response> {
  if (isCrossSite(request)) {
    return json(403, { ok: false, error: "Cross-site request rejected" });
  }
  const kv = env?.CACHE_STATE;
  const expected = env?.PUBLISH_PASSWORD;
  const limiter = env?.PUBLISH_RATE_LIMITER;

  if (!kv || !expected || !limiter) {
    return json(503, {
      ok: false,
      error: "Publish is only available on the live (Cloudflare) deployment",
    });
  }

  const connectingIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateKey = await sha256Hex(connectingIp);
  try {
    if (!(await limiter.limit({ key: rateKey })).success) {
      return json(429, { ok: false, error: "Too many attempts" });
    }
  } catch {
    return json(503, { ok: false, error: "Publish protection is unavailable" });
  }

  let password = "";
  try {
    const raw = await readLimitedBody(request, 4_096);
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = JSON.parse(raw) as { password?: string } | null;
      password = String(body?.password ?? "");
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      password = new URLSearchParams(raw).get("password") ?? "";
    } else {
      return json(415, { ok: false, error: "Unsupported content type" });
    }
  } catch (err) {
    if (err instanceof RangeError) return json(413, { ok: false, error: "Request too large" });
    return json(400, { ok: false, error: "Invalid body" });
  }

  if (!password || !(await timingSafeEqual(password, expected))) {
    return json(401, { ok: false, error: "Wrong password" });
  }

  const version = `${Date.now().toString(36)}`;
  try {
    await kv.put("cache-version", version);
  } catch {
    return json(503, { ok: false, error: "Publish is temporarily unavailable" });
  }
  return json(200, { ok: true, version });
}

export const POST: APIRoute = async ({ request }) => handlePublish(request, await getCfEnv());
