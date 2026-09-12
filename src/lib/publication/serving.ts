/**
 * Serving from a published generation — checkpoint 4 of
 * docs/translation-publication-implementation-handoff.md.
 *
 * One generation is resolved per request and every piece of content on that
 * page comes from it, so homepage, lists, detail pages, search and sitemap
 * cannot mix generations within a single render.
 *
 * SHADOW MODE IS THE DEFAULT, deliberately.
 *
 * The design's rollout step 2 says to generate and validate bundles in shadow
 * first, comparing their membership and fields against current output, before
 * anything serves from them. So `publicationMode()` returns "shadow" unless
 * PUBLICATION_SERVING is explicitly "on", and in shadow mode `lookup()` reports
 * what it WOULD have served without changing a single response. Switching a
 * live site's entire content source on the same deploy that first introduces
 * that source is not a risk worth taking, and the handoff is explicit that
 * current serving behaviour must be preserved until bootstrap and end-to-end
 * tests pass.
 *
 * NO LIVE FALLBACK. When a generation cannot be resolved, `lookup()` returns
 * `{ status: "unavailable" }` and the caller keeps doing exactly what it does
 * today. It never reaches into FileMaker for untranslated text — that is the
 * failure the whole design exists to prevent, and it would be the most
 * natural-looking mistake to make here.
 */

import type { Release, ReleaseEntity, Lang } from "./contracts.ts";
import { type ReleaseDeps, resolveGeneration, readRelease } from "./release.ts";

export type PublicationMode = "off" | "shadow" | "serving";

/**
 * Read the rollout mode from env.
 *
 * Defaults to "shadow" when the flag is absent rather than "serving": a missing
 * or misspelled variable must never silently switch the site's content source.
 */
export function publicationMode(env: Readonly<Record<string, unknown>> | null | undefined): PublicationMode {
  const raw = env?.PUBLICATION_SERVING;
  if (raw === "on" || raw === true) return "serving";
  if (raw === "off") return "off";
  return "shadow";
}

export interface LookupHit {
  readonly status: "hit";
  readonly generation: string;
  readonly entity: ReleaseEntity;
  readonly text: Readonly<Record<string, string>>;
}

export interface LookupMiss {
  readonly status: "miss";
  readonly generation: string;
}

export interface LookupUnavailable {
  readonly status: "unavailable";
}

export type LookupResult = LookupHit | LookupMiss | LookupUnavailable;

/**
 * A generation pinned for the lifetime of one request.
 *
 * Resolved once and reused, so two components on the same page cannot read
 * different generations — the "homepage, lists, detail pages, search and
 * sitemap cannot mix generations" requirement. Pinning also means a promotion
 * landing mid-render cannot split a single page across two versions.
 */
export interface RequestGeneration {
  readonly generation: string | null;
  readonly release: Release | null;
}

export async function pinGeneration(deps: ReleaseDeps): Promise<RequestGeneration> {
  const generation = await resolveGeneration(deps);
  if (!generation) return { generation: null, release: null };
  const release = await readRelease(deps, generation);
  // A generation that resolves but does not read back is treated as absent
  // rather than as an empty site.
  if (!release) return { generation: null, release: null };
  return { generation, release };
}

export function lookup(pinned: RequestGeneration, entityId: string, locale: Lang): LookupResult {
  if (!pinned.release || !pinned.generation) return { status: "unavailable" };

  const entity = pinned.release.entities.find((e) => e.id === entityId);
  if (!entity) return { status: "miss", generation: pinned.generation };

  return {
    status: "hit",
    generation: pinned.generation,
    entity,
    text: entity.text[locale] ?? {},
  };
}

/** Does this release serve the given route? Used to decide 404 vs render. */
export function hasRoute(pinned: RequestGeneration, path: string): boolean {
  return Boolean(pinned.release?.routes.includes(path));
}

export interface ShadowComparison {
  readonly generation: string | null;
  /** Entities the release has that live rendering did not produce. */
  readonly onlyInRelease: readonly string[];
  /** Entities live rendering produced that the release lacks. */
  readonly onlyInLive: readonly string[];
  /** Entity ids present in both but whose text differs for some field. */
  readonly differing: readonly string[];
}

/**
 * Compare a prepared release against what the site currently renders.
 *
 * This is the whole point of shadow mode: run it for a while, confirm the
 * membership and field sets agree, and only then flip PUBLICATION_SERVING.
 * Reporting a difference is not automatically a defect — a release
 * legitimately withholds an entity whose translations are still preparing —
 * which is why this returns the three sets rather than a boolean verdict.
 */
export function compareShadow(
  pinned: RequestGeneration,
  liveEntities: readonly { id: string; text: Readonly<Record<Lang, Readonly<Record<string, string>>>> }[],
): ShadowComparison {
  if (!pinned.release) {
    return {
      generation: null,
      onlyInRelease: [],
      onlyInLive: liveEntities.map((e) => e.id),
      differing: [],
    };
  }

  const releaseById = new Map(pinned.release.entities.map((e) => [e.id, e]));
  const liveById = new Map(liveEntities.map((e) => [e.id, e]));

  const onlyInRelease = [...releaseById.keys()].filter((id) => !liveById.has(id));
  const onlyInLive = [...liveById.keys()].filter((id) => !releaseById.has(id));

  const differing: string[] = [];
  for (const [id, live] of liveById) {
    const entity = releaseById.get(id);
    if (!entity) continue;
    for (const locale of ["sv", "en"] as const) {
      const a = entity.text[locale] ?? {};
      const b = live.text[locale] ?? {};
      const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
      if ([...fields].some((f) => (a[f] ?? "") !== (b[f] ?? ""))) {
        differing.push(id);
        break;
      }
    }
  }

  return { generation: pinned.generation, onlyInRelease, onlyInLive, differing };
}
