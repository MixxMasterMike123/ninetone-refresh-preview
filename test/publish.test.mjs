import assert from "node:assert/strict";
import test from "node:test";

import { handlePublish } from "../src/pages/api/publish.ts";

function env({ allowed = true, limiterError = false, password = "correct", kvError = false } = {}) {
  const writes = [];
  return {
    writes,
    value: {
      PUBLISH_PASSWORD: password,
      PUBLISH_RATE_LIMITER: { limit: async () => {
        if (limiterError) throw new Error("down");
        return { success: allowed };
      } },
      CACHE_STATE: {
        get: async () => null,
        put: async (...args) => { if (kvError) throw new Error("down"); writes.push(args); },
      },
    },
  };
}

function request(body, headers = {}) {
  return new Request("https://ninetone.com/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1", ...headers },
    body,
  });
}

test("publish fails closed without its rate limiter", async () => {
  const configured = env();
  delete configured.value.PUBLISH_RATE_LIMITER;
  const res = await handlePublish(request('{"password":"correct"}'), configured.value);
  assert.equal(res.status, 503);
  assert.equal(configured.writes.length, 0);
});

test("publish rejects cross-site and rate-limited requests before KV writes", async () => {
  const configured = env();
  assert.equal((await handlePublish(request('{"password":"correct"}', { origin: "https://evil.example" }), configured.value)).status, 403);
  configured.value.PUBLISH_RATE_LIMITER.limit = async () => ({ success: false });
  assert.equal((await handlePublish(request('{"password":"correct"}'), configured.value)).status, 429);
  assert.equal(configured.writes.length, 0);
});

test("publish handles limiter failure and wrong or invalid bodies without writes", async () => {
  const broken = env({ limiterError: true });
  assert.equal((await handlePublish(request('{"password":"correct"}'), broken.value)).status, 503);
  const configured = env();
  assert.equal((await handlePublish(request('{"password":"wrong"}'), configured.value)).status, 401);
  assert.equal((await handlePublish(request("null"), configured.value)).status, 401);
  assert.equal((await handlePublish(request("{"), configured.value)).status, 400);
  assert.equal(configured.writes.length, 0);
});

test("publish enforces streamed body limit without Content-Length", async () => {
  const configured = env();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(4097))); controller.close(); } });
  const req = new Request("https://ninetone.com/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" });
  assert.equal((await handlePublish(req, configured.value)).status, 413);
  assert.equal(configured.writes.length, 0);
});

test("publish writes a new cache version only for a matching password", async () => {
  const configured = env();
  const res = await handlePublish(request('{"password":"correct"}'), configured.value);
  assert.equal(res.status, 200);
  assert.equal(configured.writes.length, 1);
  assert.equal(configured.writes[0][0], "cache-version");
  assert.match(configured.writes[0][1], /^[a-z0-9]+$/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
