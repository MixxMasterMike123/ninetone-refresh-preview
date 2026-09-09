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
