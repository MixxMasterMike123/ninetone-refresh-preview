import assert from "node:assert/strict";
import test from "node:test";

import { kvCached } from "../src/lib/cache.ts";

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const puts = [];
  return {
    store,
    puts,
    get: async (key) => (store.has(key) ? store.get(key) : null),
    put: async (key, value, opts) => {
      puts.push([key, value, opts]);
      store.set(key, value);
    },
  };
}

test("kvCached: cache miss calls fn and stores the value with the requested TTL", async () => {
  const kv = fakeKv();
  let calls = 0;
  const value = await kvCached(kv, "yt:channel:ninetone", 2_592_000, async () => {
    calls += 1;
    return "UCabc123";
  });

  assert.equal(value, "UCabc123");
  assert.equal(calls, 1);
  assert.equal(kv.puts.length, 1);
  const [key, stored, opts] = kv.puts[0];
  assert.equal(key, "yt:channel:ninetone");
  assert.equal(stored, JSON.stringify("UCabc123"));
  assert.deepEqual(opts, { expirationTtl: 2_592_000 });
});

test("kvCached: cache hit reads from KV and never calls fn", async () => {
  const kv = fakeKv({ "yt:top:UCabc123": JSON.stringify([{ id: "v1" }]) });
  let calls = 0;
  const value = await kvCached(kv, "yt:top:UCabc123", 43_200, async () => {
    calls += 1;
    return [{ id: "should-not-be-used" }];
  });

  assert.deepEqual(value, [{ id: "v1" }]);
  assert.equal(calls, 0);
  assert.equal(kv.puts.length, 0);
});

test("kvCached: null/empty result is stored with the short negative TTL, not the full TTL", async () => {
  const kv = fakeKv();

  const nullResult = await kvCached(kv, "yt:channel:missing-handle", 2_592_000, async () => null);
  assert.equal(nullResult, null);
  assert.equal(kv.puts.length, 1);
  assert.deepEqual(kv.puts[0][2], { expirationTtl: 600 });

  const kv2 = fakeKv();
  const emptyArray = await kvCached(kv2, "yt:top:UCempty", 43_200, async () => []);
  assert.deepEqual(emptyArray, []);
  assert.equal(kv2.puts.length, 1);
  assert.deepEqual(kv2.puts[0][2], { expirationTtl: 600 });
});

test("kvCached: a TTL already shorter than the negative TTL is left alone", async () => {
  const kv = fakeKv();
  await kvCached(kv, "short-lived", 60, async () => null);
  assert.deepEqual(kv.puts[0][2], { expirationTtl: 60 });
});

test("kvCached: no KV binding falls back to the in-process cache (fn still called, no KV writes)", async () => {
  let calls = 0;
  const value = await kvCached(null, "yt:channel:fallback-key", 2_592_000, async () => {
    calls += 1;
    return "UCfallback";
  });
  assert.equal(value, "UCfallback");
  assert.equal(calls, 1);

  // Second call within the in-process TTL window should hit the fallback
  // cache rather than re-invoking fn.
  const value2 = await kvCached(null, "yt:channel:fallback-key", 2_592_000, async () => {
    calls += 1;
    return "should-not-run";
  });
  assert.equal(value2, "UCfallback");
  assert.equal(calls, 1);
});

test("kvCached: a KV read failure recomputes rather than throwing", async () => {
  const kv = {
    get: async () => {
      throw new Error("kv down");
    },
    put: async () => {},
  };
  let calls = 0;
  const value = await kvCached(kv, "yt:channel:broken-read", 2_592_000, async () => {
    calls += 1;
    return "UCrecomputed";
  });
  assert.equal(value, "UCrecomputed");
  assert.equal(calls, 1);
});

test("kvCached: a KV write failure is swallowed and the fresh value is still returned", async () => {
  const kv = {
    get: async () => null,
    put: async () => {
      throw new Error("kv down");
    },
  };
  const value = await kvCached(kv, "yt:channel:broken-write", 2_592_000, async () => "UCok");
  assert.equal(value, "UCok");
});
