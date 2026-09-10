import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import * as esbuild from "esbuild";

const middlewareModule = await loadMiddleware();

async function loadMiddleware() {
  const result = await esbuild.build({
    entryPoints: ["src/middleware.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    plugins: [{
      name: "middleware-test-stubs",
      setup(build) {
        build.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: "astro", namespace: "stub" }));
        build.onResolve({ filter: /^\.\/lib\/cf$/ }, () => ({ path: "cf", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: args.path === "astro"
            ? "export const defineMiddleware = (fn) => fn;"
            : "export const getCfEnv = () => globalThis.__middlewareTestEnv;",
          loader: "js",
        }));
      },
    }],
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function createRuntime({ hit, env = { CACHE_STATE: { get: async () => "7" } } } = {}) {
  const matched = [];
  const stored = [];
  const waits = [];
  globalThis.__middlewareTestEnv = Promise.resolve(env);
  globalThis.caches = {
    default: {
      match: async (key) => {
        matched.push(key.url);
        return hit;
      },
      put: async (key, response) => { stored.push({ key: key.url, response }); },
    },
  };
  return { matched, stored, waits };
}

async function run(request, next, runtime) {
  const context = {
    request,
    url: new URL(request.url),
    locals: { cfContext: { waitUntil: (promise) => runtime.waits.push(promise) } },
  };
  const response = await middlewareModule.onRequest(context, next);
  await Promise.all(runtime.waits);
  return response;
}

test("caches a public miss with scoped cache key and security headers", async () => {
  const runtime = createRuntime();
  let nextCalls = 0;
  const response = await run(
    new Request("https://www.ninetone.com/news"),
    async () => { nextCalls++; return new Response("news"); },
    runtime,
  );

  assert.equal(nextCalls, 1);
  assert.equal(runtime.matched.length, 1);
  assert.match(runtime.matched[0], /ohttps%3A%2F%2Fwww\.ninetone\.com\/news$/);
  assert.equal(runtime.stored.length, 1);
  assert.equal(response.headers.get("x-cache"), "miss");
  assert.equal(response.headers.get("x-cache-ttl"), "900");
  assert.match(response.headers.get("cache-control"), /s-maxage=900/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("serves a host-scoped cache hit without invoking the route", async () => {
  const runtime = createRuntime({ hit: new Response("cached", { headers: { "content-type": "text/plain" } }) });
  const response = await run(
    new Request("https://preview.ninetone.com/news"),
    async () => { throw new Error("next must not run on a hit"); },
    runtime,
  );

  assert.equal(await response.text(), "cached");
  assert.equal(response.headers.get("x-cache"), "hit");
  assert.match(runtime.matched[0], /ohttps%3A%2F%2Fpreview\.ninetone\.com\/news$/);
  assert.equal(runtime.stored.length, 0);
});

test("bypasses shared cache for private and variant requests", async () => {
  for (const request of [
    new Request("https://ninetone.com/news", { headers: { authorization: "Bearer token" } }),
    new Request("https://ninetone.com/news?page=2"),
  ]) {
    const runtime = createRuntime();
    const response = await run(request, async () => new Response("private"), runtime);
    assert.equal(runtime.matched.length, 0);
    assert.equal(runtime.stored.length, 0);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
});

test("analytics cookies do not defeat the shared cache", async () => {
  const runtime = createRuntime();
  const response = await run(
    new Request("https://ninetone.com/news", { headers: { cookie: "_ga=GA1.1.1; _fbp=fb.1.1" } }),
    async () => new Response("news"),
    runtime,
  );
  assert.equal(runtime.matched.length, 1);
  assert.equal(runtime.stored.length, 1);
  assert.equal(response.headers.get("x-cache"), "miss");
});

test("tracking query params hit the same cache key as the bare path", async () => {
  const runtimeBare = createRuntime();
  await run(new Request("https://ninetone.com/news"), async () => new Response("news"), runtimeBare);

  const runtimeTracked = createRuntime();
  await run(
    new Request("https://ninetone.com/news?utm_source=x&fbclid=y"),
    async () => new Response("news"),
    runtimeTracked,
  );

  assert.equal(runtimeTracked.matched.length, 1);
  assert.equal(runtimeTracked.stored.length, 1);
  assert.equal(runtimeTracked.matched[0], runtimeBare.matched[0]);
});

test("/404 is never cached — avoids the nested-rewrite stream race (seo-phase-1b P0 item 1)", async () => {
  // Every detail route's `Astro.rewrite("/404")` re-enters this exact
  // middleware for the rewritten pathname before the outer request finishes.
  // If that inner pass ran the normal read/clone/store cycle, it would tee
  // the same response stream the outer pass then reads again — a stream can
  // only be consumed once, so the outer read intermittently came back empty
  // (the "0 bytes" failures in the brief). This must never call cacheApi.put.
  const runtime = createRuntime();
  const response = await run(
    new Request("https://ninetone.com/404"),
    async () => new Response("<html>not found</html>", { status: 404 }),
    runtime,
  );
  assert.equal(runtime.matched.length, 0);
  assert.equal(runtime.stored.length, 0);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "<html>not found</html>");
});

test("never stores private, no-store, cookie-setting, or redirect responses", async () => {
  for (const response of [
    new Response("private", { headers: { "cache-control": "private, max-age=60" } }),
    new Response("secret", { headers: { "cache-control": "no-store" } }),
    new Response("signed in", { headers: { "set-cookie": "session=1" } }),
    Response.redirect("https://ninetone.com/news", 302),
  ]) {
    const runtime = createRuntime();
    const result = await run(new Request("https://ninetone.com/news"), async () => response, runtime);
    assert.equal(runtime.stored.length, 0);
    assert.equal(result.headers.get("x-cache"), "bypass");
    assert.equal(result.headers.get("strict-transport-security"), "max-age=31536000");
  }
});

test("redirects a trailing-slash path to the bare path before any cache lookup (seo-phase-1b P0 item 5)", async () => {
  const runtime = createRuntime();
  const response = await run(
    new Request("https://ninetone.com/records/"),
    async () => { throw new Error("next must not run — redirect happens before rendering"); },
    runtime,
  );

  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "/records");
  assert.equal(runtime.matched.length, 0, "cacheApi.match must not be called for a redirect");
  assert.equal(runtime.stored.length, 0);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("preserves the query string on a trailing-slash redirect", async () => {
  const runtime = createRuntime();
  const response = await run(
    new Request("https://ninetone.com/records/?utm_source=x"),
    async () => { throw new Error("next must not run"); },
    runtime,
  );

  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "/records?utm_source=x");
});

test("never redirects the root path", async () => {
  const runtime = createRuntime();
  let nextCalls = 0;
  const response = await run(
    new Request("https://ninetone.com/"),
    async () => { nextCalls++; return new Response("home"); },
    runtime,
  );

  assert.equal(nextCalls, 1);
  assert.notEqual(response.status, 301);
});

test("never redirects /api/* even with a trailing slash", async () => {
  const runtime = createRuntime();
  let nextCalls = 0;
  const response = await run(
    new Request("https://ninetone.com/api/contact/"),
    async () => { nextCalls++; return new Response("ok"); },
    runtime,
  );

  assert.equal(nextCalls, 1);
  assert.notEqual(response.status, 301);
});

// NOT UNIT-TESTED, deliberately: the streaming-clone race behind the zero-byte
// pages and the intermittent 500s (seo-phase-1b P0 items 1 & 3) cannot be
// reproduced under node:test. undici's clone() buffers eagerly and both the
// clone() and the buffered branch expose a ReadableStream, so every assertion
// available here passes identically with and without the fix — verified by
// reverting src/middleware.ts and re-running. A test that cannot fail is worse
// than none: it would advertise coverage this defect does not have.
//
// The real evidence is the captured runtime exception, reproduced live via
// `wrangler tail` on a deployed Worker (3/3 requests to a heavy detail page):
//   ResponseSentError: The response has already been sent to the browser and
//   cannot be altered.
//     at Object.write (chunks/console_*.mjs)
//     at BufferedRenderer.flush
//     at iterate
// logged as "[edge-cache] put failed:" — i.e. cacheApi.put()'s branch of
// res.clone() was still being written while the visitor's branch had already
// completed, which aborts the render and yields a zero-byte 200.
//
// The regression guard is therefore the post-deploy staging check recorded in
// docs/seo-phase-1b-pr.md: N parallel requests across the affected detail
// pages with zero empty bodies and zero exceptions in `wrangler tail`.

test("legacy /previous-artists deep links 301 to the real detail path (seo-phase-1b P0 item 2)", async () => {
  // Both shapes existed on the live site and survive as inbound links. The
  // destination must be extensionless — the Cloudflare adapter's generated
  // _redirects rules append "/index.html", which 404s on the SSR Worker, which
  // is why this lives in middleware rather than astro.config.mjs's `redirects`.
  for (const [from, to] of [
    ["/previous-artists/kuokka", "/records/artists/previous/single/kuokka"],
    ["/previous-artists/single/kuokka", "/records/artists/previous/single/kuokka"],
    ["/previous-artists/yohio", "/records/artists/previous/single/yohio"],
  ]) {
    const runtime = createRuntime();
    const res = await run(new Request(`https://ninetone.com${from}`), async () => new Response("unused"), runtime);
    assert.equal(res.status, 301, `${from} should 301`);
    assert.equal(res.headers.get("location"), to);
    assert.equal(runtime.matched.length, 0, "redirect must precede the cache read");
    assert.ok(!res.headers.get("location").endsWith("/index.html"), "destination must be extensionless");
  }
});

test("legacy previous-artist redirect preserves the query string and ignores non-matching paths", async () => {
  const runtime = createRuntime();
  const res = await run(
    new Request("https://ninetone.com/previous-artists/kuokka?utm_source=discogs"),
    async () => new Response("unused"),
    runtime,
  );
  assert.equal(res.headers.get("location"), "/records/artists/previous/single/kuokka?utm_source=discogs");

  // "/previous-artists/single" is a LISTING shape, not a slug. Left ungained it
  // would become /records/artists/previous/single/single — a redirect into a
  // 404, which is worse for crawlers than a plain 404. It goes to the real
  // listing instead. (public/_redirects carries the same guard as its first
  // rule, since the asset layer is what actually serves these on cf.)
  const listing = createRuntime();
  const listingRes = await run(
    new Request("https://ninetone.com/previous-artists/single"),
    async () => new Response("unused"),
    listing,
  );
  assert.equal(listingRes.status, 301);
  assert.equal(listingRes.headers.get("location"), "/records/artists/previous");

  // A path that is already canonical must pass straight through.
  const rt = createRuntime();
  const passed = await run(
    new Request("https://ninetone.com/records/artists/previous"),
    async () => new Response("rendered"),
    rt,
  );
  assert.notEqual(passed.status, 301, "canonical path must not be redirected");
});
