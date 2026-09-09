import type { APIRoute } from "astro";

/**
 * Disabled until Ninetone chooses and configures a newsletter provider.
 * Returns an honest unavailable response and never logs subscriber data.
 */
export const POST: APIRoute = async ({ request }) => {
  // Do not claim delivery or log personal data until a provider is wired.
  return json(503, { ok: false, error: "Newsletter delivery is not configured" });
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
