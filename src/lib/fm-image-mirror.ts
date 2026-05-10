/**
 * FileMaker image mirror.
 *
 * FM's `Streaming_SSL/RCFileProcessor` URLs rotate on every API call AND expire
 * with the session token (~15 min). A static site that embeds them goes broken
 * within minutes. We can't use them as-is.
 *
 * Strategy: while the build still has a fresh URL (the bytes ARE accessible,
 * just briefly), download them to public/images/fm/, hash by *content* so
 * unchanged images are skipped on rebuild, and rewrite the URL to a local
 * path. Local paths are stable forever and served by GH Pages.
 *
 * Build-time only — never imported by client code.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const FM_STREAMING_RE = /^https?:\/\/files\.ninetone\.com\/Streaming_SSL\//i;

const MIRROR_DIR = join(process.cwd(), "public", "images", "fm");
const PUBLIC_PREFIX = "/images/fm";

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) dirReady = mkdir(MIRROR_DIR, { recursive: true }).then(() => undefined);
  return dirReady;
}

// Per-process URL → local-path memo, so the same FM URL within one build only
// downloads once even if many records reference it.
const inFlight = new Map<string, Promise<string | undefined>>();

// FM Server resets connections under heavy parallel load AND temporarily
// refuses new auth requests if it sees the same client opening many sockets
// at once. Keep this low; build is slower but stable.
const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => queue.push(resolve)).then(() => {
    active++;
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      if (attempt === retries) return null;
      // Backoff: 200ms, 600ms
      await new Promise((r) => setTimeout(r, 200 * Math.pow(3, attempt)));
    }
  }
  return null;
}

function extOf(url: string): string {
  const m = url.match(/\.(webp|jpg|jpeg|png|gif)/i);
  return m ? `.${m[1].toLowerCase()}` : ".webp";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string): Promise<string | undefined> {
  await ensureDir();
  await acquire();
  try {
    const ext = extOf(url);
    // Stable URL→hash mapping for fast skip when same URL hits twice in a row.
    // Real dedup happens by content-hash below.
    const urlSha = createHash("sha1").update(url).digest("hex").slice(0, 16);
    const tmpPath = join(MIRROR_DIR, `__tmp_${urlSha}${ext}`);

    const res = await fetchWithRetry(url);
    if (!res || !res.ok) return undefined;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100) return undefined; // empty/error body, skip

    // Hash by content. Same image bytes → same filename across rebuilds.
    const contentHash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const finalName = `${contentHash}${ext}`;
    const finalPath = join(MIRROR_DIR, finalName);

    if (!(await fileExists(finalPath))) {
      await writeFile(tmpPath, buf);
      const { rename, unlink } = await import("node:fs/promises");
      try {
        await rename(tmpPath, finalPath);
      } catch {
        await unlink(tmpPath).catch(() => {});
      }
    }
    return `${PUBLIC_PREFIX}/${finalName}`;
  } finally {
    release();
  }
}

/**
 * Mirror a single FM streaming URL. Returns a stable local path on success,
 * the original URL on failure (so the page still tries to render, even if
 * the resulting <img> 401s — at least nothing crashes), undefined for
 * non-string / non-FM inputs.
 */
export async function mirrorImageUrl(url: unknown): Promise<string | undefined> {
  if (typeof url !== "string" || !url) return undefined;
  if (!FM_STREAMING_RE.test(url)) return url; // non-FM URL passes through unchanged
  const cached = inFlight.get(url);
  if (cached) return cached;
  const p = download(url).then((local) => local ?? url);
  inFlight.set(url, p);
  return p;
}

/**
 * Walk a record (or array of records) and replace every FM streaming URL with
 * a mirrored local path. Mutates in place for simplicity. Skips obvious non-
 * string fields. Walks into nested objects/arrays one level deep (enough for
 * portalData rows in our FM responses).
 */
export async function mirrorRecordImages<T>(records: T): Promise<T> {
  const tasks: Promise<void>[] = [];
  const walk = (obj: unknown) => {
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        const v = (obj as Record<string, unknown>)[k];
        if (typeof v === "string" && FM_STREAMING_RE.test(v)) {
          tasks.push(
            mirrorImageUrl(v).then((local) => {
              if (local) (obj as Record<string, unknown>)[k] = local;
            }),
          );
        } else if (v && typeof v === "object") {
          walk(v);
        }
      }
    }
  };
  walk(records);
  await Promise.all(tasks);
  return records;
}
