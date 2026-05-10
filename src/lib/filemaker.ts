/**
 * FileMaker Data API client.
 *
 * Token caching: FM tokens expire after ~15 min idle. We cache for 12 min to be safe.
 * Response caching: 10 min TTL via src/lib/cache.ts (in-memory + disk).
 * All calls happen at build time — token never reaches the browser.
 */

import { cached } from "./cache";
import { mirrorRecordImages } from "./fm-image-mirror";

const FM_HOST = import.meta.env.FM_HOST ?? "files.ninetone.com";
const FM_DB = import.meta.env.FM_DB ?? "Ninetone Group AB";
const FM_USER = import.meta.env.FM_USER;
const FM_PASS = import.meta.env.FM_PASS;

const TOKEN_TTL_MS = 12 * 60 * 1000;

let cachedToken: { value: string; expires: number } | null = null;

function dbPath(): string {
  return `https://${FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}`;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;
  if (!FM_USER || !FM_PASS) {
    throw new Error("FM_USER / FM_PASS env vars not set");
  }

  const auth = btoa(`${FM_USER}:${FM_PASS}`);
  const res = await fetch(`${dbPath()}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`FM session failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { response: { token: string } };
  cachedToken = { value: json.response.token, expires: Date.now() + TOKEN_TTL_MS };
  return cachedToken.value;
}

type FmFindResponse<T> = {
  response: {
    data: { fieldData: T; portalData?: Record<string, unknown[]>; recordId: string }[];
  };
  messages: { code: string; message: string }[];
};

export type FmFindBody = {
  query: Record<string, string>[];
  sort?: { fieldName: string; sortOrder: "ascend" | "descend" }[];
  offset?: string;
  limit?: number;
};

export function fmFind<T = Record<string, unknown>>(
  layout: string,
  body: FmFindBody,
): Promise<T[]> {
  return cached(`fm-${layout}`, body, () => fmFindUncached<T>(layout, body));
}

export type FmRecord<T> = { fieldData: T; portalData?: Record<string, unknown[]> };

/**
 * Same as fmFind, but also returns each record's portalData. Used by
 * layouts whose related-table content matters (e.g. API_WEBPOSTS, where
 * the SEO blocks live in `webPost` portal rows).
 */
export function fmFindWithPortals<T = Record<string, unknown>>(
  layout: string,
  body: FmFindBody,
): Promise<FmRecord<T>[]> {
  return cached(`fm-portals-${layout}`, body, () =>
    fmFindUncachedWithPortals<T>(layout, body),
  );
}

async function fmRequest<T>(
  layout: string,
  body: FmFindBody,
  isRetry = false,
): Promise<FmFindResponse<T> | null> {
  const token = await getToken();
  const res = await fetch(`${dbPath()}/layouts/${layout}/_find`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // FM returns 401 if the token expired between cache check and request.
  // Drop the cache and retry once. The flag prevents infinite recursion if
  // creds are actually wrong (will surface the 401 on the second try).
  if (res.status === 401 && !isRetry) {
    cachedToken = null;
    return fmRequest<T>(layout, body, true);
  }

  // FM returns 404 + message code 401 when query matches no records — that's not an error
  const json = (await res.json()) as FmFindResponse<T>;
  const noRecords = json.messages?.some((m) => m.code === "401");
  if (noRecords) return null;

  if (!res.ok) {
    throw new Error(`FM find ${layout} failed: ${res.status} ${JSON.stringify(json.messages)}`);
  }

  return json;
}

async function fmFindUncached<T = Record<string, unknown>>(
  layout: string,
  body: FmFindBody,
): Promise<T[]> {
  const json = await fmRequest<T>(layout, body);
  if (!json) return [];
  const rows = json.response.data.map((r) => r.fieldData);
  // FM Streaming URLs rotate per-call and expire with the session token, so
  // we must mirror to local paths immediately while the URL is still fresh.
  // No-op when bytes can't be downloaded — page still renders, image just 401s.
  await mirrorRecordImages(rows);
  return rows;
}

async function fmFindUncachedWithPortals<T = Record<string, unknown>>(
  layout: string,
  body: FmFindBody,
): Promise<FmRecord<T>[]> {
  const json = await fmRequest<T>(layout, body);
  if (!json) return [];
  const rows = json.response.data.map((r) => ({ fieldData: r.fieldData, portalData: r.portalData }));
  await mirrorRecordImages(rows);
  return rows;
}
