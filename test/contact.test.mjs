import assert from "node:assert/strict";
import test from "node:test";

import { handleContact } from "../src/pages/api/contact.ts";

function env({ allowed = true, limiterError = false, kvError = false, emailThrows = false, noEmail = false } = {}) {
  const kvWrites = [];
  const emailSends = [];
  const value = {
    CONTACT_RATE_LIMITER: {
      limit: async () => {
        if (limiterError) throw new Error("down");
        return { success: allowed };
      },
    },
    CONTACT_SUBMISSIONS: {
      put: async (...args) => {
        if (kvError) throw new Error("down");
        kvWrites.push(args);
      },
    },
    CONTACT_EMAIL: noEmail
      ? undefined
      : {
          send: async (message) => {
            if (emailThrows) throw new Error("send failed");
            emailSends.push(message);
            return { messageId: "test" };
          },
        },
  };
  return { kvWrites, emailSends, value };
}

function request(body, { headers = {}, method = "POST", contentType = "application/json" } = {}) {
  return new Request("https://ninetone.com/api/contact", {
    method,
    headers: { "content-type": contentType, "cf-connecting-ip": "192.0.2.1", ...headers },
    body: method === "GET" ? undefined : body,
  });
}

function validPayload(overrides = {}) {
  return JSON.stringify({
    division: "records",
    name: "Test Artist",
    email: "artist@example.com",
    links: "https://soundcloud.com/test",
    about: "A few lines.",
    ...overrides,
  });
}

test("contact rejects non-POST methods with 405 + Allow", async () => {
  const configured = env();
  const res = await handleContact(request(undefined, { method: "GET" }), configured.value);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test("contact rejects cross-site requests", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload(), { headers: { origin: "https://evil.example" } }), configured.value);
  assert.equal(res.status, 403);
});

test("contact fails closed without rate limiter or KV bindings", async () => {
  const configured = env();
  delete configured.value.CONTACT_RATE_LIMITER;
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 503);

  const configured2 = env();
  delete configured2.value.CONTACT_SUBMISSIONS;
  const res2 = await handleContact(request(validPayload()), configured2.value);
  assert.equal(res2.status, 503);
});

test("contact rejects invalid division with 400", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload({ division: "bogus" })), configured.value);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid");
  assert.ok(body.fields.includes("division"));
  assert.equal(configured.kvWrites.length, 0);
});

test("contact rejects missing name/email with 400", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload({ name: "", email: "" })), configured.value);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.fields.includes("name"));
  assert.ok(body.fields.includes("email"));
  assert.equal(configured.kvWrites.length, 0);
});

test("contact rejects malformed email with 400", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload({ email: "not-an-email" })), configured.value);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.fields.includes("email"));
});

test("contact enforces an 8 KiB streamed body cap with 413", async () => {
  const configured = env();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
      controller.close();
    },
  });
  const req = new Request("https://ninetone.com/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
    body: stream,
    duplex: "half",
  });
  const res = await handleContact(req, configured.value);
  assert.equal(res.status, 413);
  assert.equal(configured.kvWrites.length, 0);
});

test("contact honeypot returns 200 without KV or email calls", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload({ website: "http://spam.example" })), configured.value);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(configured.kvWrites.length, 0);
  assert.equal(configured.emailSends.length, 0);
});

test("contact rate-limited requests get 429 with no KV write", async () => {
  const configured = env({ allowed: false });
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 429);
  assert.equal(configured.kvWrites.length, 0);
});

test("contact returns 503 when the rate limiter throws", async () => {
  const configured = env({ limiterError: true });
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 503);
  assert.equal(configured.kvWrites.length, 0);
});

test("contact writes KV with expected key prefix and 90-day TTL, and emails the right recipient per division", async () => {
  const cases = [
    { division: "records", recipient: "office@ninetone.com" },
    { division: "management", recipient: "office@ninetone.com" },
    { division: "nation", recipient: "booking@ninetone.com" },
  ];
  for (const { division, recipient } of cases) {
    const configured = env();
    const res = await handleContact(request(validPayload({ division, email: "sender@example.com" })), configured.value);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.delivered, true);

    assert.equal(configured.kvWrites.length, 1);
    const [key, , opts] = configured.kvWrites[0];
    assert.match(key, new RegExp(`^${division}:`));
    assert.equal(opts.expirationTtl, 90 * 24 * 3600);

    assert.equal(configured.emailSends.length, 1);
    assert.equal(configured.emailSends[0].to, recipient);
    assert.equal(configured.emailSends[0].replyTo, "sender@example.com");
  }
});

test("contact still returns 200 with delivered:false when email send throws", async () => {
  const configured = env({ emailThrows: true });
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.delivered, false);
  assert.equal(configured.kvWrites.length, 1);
});

test("contact still returns 200 with delivered:false when email binding is absent", async () => {
  const configured = env({ noEmail: true });
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.delivered, false);
});

test("contact returns 503 and skips email when KV write throws", async () => {
  const configured = env({ kvError: true });
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(configured.emailSends.length, 0);
});

test("contact responses are never cached", async () => {
  const configured = env();
  const res = await handleContact(request(validPayload()), configured.value);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("newlines in single-line fields are collapsed before reaching the email subject", async () => {
  const e = env();
  const res = await handleContact(request(validPayload({ name: "Eve\r\nBcc: victim@example.com" })), e.value);
  assert.equal(res.status, 200);
  assert.equal(e.emailSends.length, 1);
  const subject = e.emailSends[0].subject;
  assert.equal(/[\r\n]/.test(subject), false);
  assert.match(subject, /Eve Bcc: victim@example\.com$/);
});
