import type { APIRoute } from "astro";

/**
 * Disabled until a delivery provider is configured. The public contact
 * surfaces use direct mailto links in the meantime.
 */
export const POST: APIRoute = async ({ request }) => {
  // Do not claim delivery or log personal data until a mail provider is wired.
  return json(503, { ok: false, error: "Contact delivery is not configured" });
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
