import type { APIRoute } from "astro";

/**
 * Newsletter subscription endpoint — POST { email }.
 *
 * Currently a stub that validates and 200s. Wire to Mailchimp/Buttondown/
 * a managed queue by replacing the body of this handler with the provider call.
 *
 * The Footer form posts here with `Content-Type: application/x-www-form-urlencoded`.
 */
export const POST: APIRoute = async ({ request }) => {
  let email = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json();
      email = String(body.email ?? "").trim();
    } else {
      const form = await request.formData();
      email = String(form.get("email") ?? "").trim();
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // TODO: forward to mailing provider. For now log + accept so the form's
  // optimistic UX (Thanks ✓) is honest about being delivered to the server.
  console.log("[subscribe]", email);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
