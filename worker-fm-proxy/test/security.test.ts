import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const env = {
  FM_HOST: "files.ninetone.com",
  FM_DB: "Ninetone Group AB",
  FM_USER: "user",
  FM_PASS: "pass",
};

function request(path: string, method = "GET") {
  return new Request(`https://proxy.example${path}`, { method });
}

test("rejects methods, malformed paths, and prototype route names before FM access", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("unexpected"); };
  try {
    assert.equal((await worker.fetch(request("/artist/a/big", "POST"), env)).status, 405);
    assert.equal((await worker.fetch(request("/artist/%E0%A4%A/big"), env)).status, 400);
    assert.equal((await worker.fetch(request("/constructor/x"), env)).status, 404);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("does not fetch an FM image URL from an untrusted host", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/sessions")) return Response.json({ response: { token: "test-token" } });
    return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://evil.example/secret" } }] } });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), env);
    assert.equal(response.status, 502);
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.includes("evil.example")), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("blocks redirects to untrusted hosts and strips upstream headers", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/_find")) return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://files.ninetone.com/Streaming_SSL/image" } }] } });
    return new Response(null, { status: 302, headers: { Location: "https://evil.example/track", "Set-Cookie": "secret=1" } });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.has("Set-Cookie"), false);
    assert.equal(calls.some((url) => url.includes("evil.example")), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("streams only allowed raster images and strips upstream response headers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/_find")) {
      return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://files.ninetone.com/Streaming_SSL/image" } }] } });
    }
    if (url.includes("/Streaming_SSL/")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "image/webp; charset=binary",
          "Set-Cookie": "upstream=session",
          "X-Upstream-Debug": "secret",
        },
      });
    }
    return Response.json({ response: { token: "test-token" } });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.has("Set-Cookie"), false);
    assert.equal(response.headers.has("X-Upstream-Debug"), false);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  } finally {
    globalThis.fetch = original;
  }
});

test("rejects an upstream response whose Content-Length exceeds the size cap", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/_find")) {
      return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://files.ninetone.com/Streaming_SSL/huge" } }] } });
    }
    if (url.includes("/Streaming_SSL/")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(16 * 1024 * 1024),
        },
      });
    }
    return Response.json({ response: { token: "test-token" } });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), env);
    assert.equal(response.ok, false);
    assert.notEqual(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /\x01\x02\x03/);
  } finally {
    globalThis.fetch = original;
  }
});

test("returns 504 when the upstream fetch never resolves before the timeout", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/sessions")) return Response.json({ response: { token: "test-token" } });
    if (url.includes("/_find")) {
      return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://files.ninetone.com/Streaming_SSL/slow" } }] } });
    }
    // Simulate a hung upstream: only settle when the passed-in signal aborts.
    const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
    return new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), { ...env, UPSTREAM_TIMEOUT_MS: "20" });
    assert.equal(response.status, 504);
  } finally {
    globalThis.fetch = original;
  }
});

test("rejects non-image upstream content without streaming it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/_find")) {
      return Response.json({ response: { data: [{ fieldData: { artistPicture_big: "https://files.ninetone.com/Streaming_SSL/not-image" } }] } });
    }
    if (url.includes("/Streaming_SSL/")) return new Response("<script>alert(1)</script>", { headers: { "Content-Type": "text/html" } });
    return Response.json({ response: { token: "test-token" } });
  };
  try {
    const response = await worker.fetch(request("/artist/safe/big"), env);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), "Unsupported image type");
  } finally {
    globalThis.fetch = original;
  }
});
