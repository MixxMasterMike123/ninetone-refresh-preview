import type { APIRoute } from "astro";

/**
 * Contact form endpoint — accepts multipart/form-data from any of the three
 * contact pages. Currently a stub that validates email + 200s. Wire to a
 * mail provider (Postmark, Resend, SendGrid) by replacing the body.
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, string> = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) payload[k] = String(v);
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const email = String(payload.email ?? "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // TODO: forward to mail provider with payload
  console.log("[contact]", payload);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
