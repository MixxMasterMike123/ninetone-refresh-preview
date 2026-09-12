/**
 * Discovery and job state — checkpoint 2 of
 * docs/translation-publication-implementation-handoff.md.
 *
 * Turns "what does FileMaker look like right now" into "what work is
 * outstanding", without doing any of that work and without knowing anything
 * about Cloudflare. Everything external is injected:
 *
 *   - `loadRecords`  supplies normalized SourceRecords (FM in production, a
 *                    fixture in tests)
 *   - `store`        a KvLike-shaped state store
 *   - `hash`         the digest function
 *
 * so the scan/dedupe/supersede/removal logic is testable locally with no
 * network, no bindings, and no translation spend. The Worker layer is a thin
 * adapter over this.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROMISE (design, "Do not promise to detect
 * future FM saves"): a scan sees the state of FM at one instant. If Patrik
 * saves an artist now and two related posts a minute later, those are two
 * candidates, not one editorial transaction — nothing in the Data API marks a
 * set of saves as "finished together". Grouping happens only via explicit
 * references on a record, and `pendingReferences()` is how a candidate waits
 * for referenced records that are not yet ready.
 */

import type { KvLike } from "../cache.ts";
import {
  type Candidate,
  type SourceRecord,
  type TranslationJob,
  isSuperseded,
  jobId,
  jobsForRecord,
} from "./contracts.ts";

/** Where discovery state lives. Prefixed so it is greppable alongside `tr:v1:`. */
export const STATE_PREFIX = "pub:v1:";

export const stateKeys = {
  /** Newest hash seen for an entity — the supersession reference point. */
  newestHash: (kind: string, id: string) => `${STATE_PREFIX}newest:${kind}:${id}`,
  /** A candidate being prepared for one source version. */
  candidate: (kind: string, id: string, hash: string) => `${STATE_PREFIX}cand:${kind}:${id}:${hash}`,
  /** A scan lock, so overlapping cron invocations cannot both scan. */
  scanLock: () => `${STATE_PREFIX}scan-lock`,
  /** Entities discovered as inactive, awaiting the priority removal path. */
  removal: (kind: string, id: string) => `${STATE_PREFIX}remove:${kind}:${id}`,
};

export interface DiscoveryResult {
  /** Records whose hash is new — these need candidates and jobs. */
  readonly changed: readonly SourceRecord[];
  /** Records that disappeared or went inactive — priority removal, no translation. */
  readonly removed: readonly SourceRecord[];
  /** Records whose hash was already known — no work. */
  readonly unchanged: number;
  /** Jobs to enqueue for the changed records. */
  readonly jobs: readonly TranslationJob[];
}

export interface DiscoveryDeps {
  readonly store: KvLike;
  readonly hash: (input: string) => Promise<string>;
  /** Already-normalized records with hashes computed. */
  readonly loadRecords: () => Promise<readonly SourceRecord[]>;
  /** Injected for tests; defaults to Date.now at the call site. */
  readonly now?: () => number;
}

/**
 * How long a scan lock is honoured.
 *
 * The cron interval is one minute, and a scan that takes longer than that
 * would otherwise overlap with the next invocation — two scanners writing
 * candidate state for the same entity is exactly the corruption the handoff's
 * "overlapping scans" acceptance test targets.
 *
 * Five minutes rather than one: a lock that expires WHILE its holder is still
 * running is worse than no lock, because the second scanner then believes it
 * has exclusive access. Long enough to cover a slow FM read, short enough that
 * a crashed scanner does not wedge discovery for long.
 */
export const SCAN_LOCK_TTL_SECONDS = 300;

/**
 * Try to take the scan lock.
 *
 * KV has no atomic compare-and-set, so this is advisory rather than a true
 * mutex — two scanners starting in the same instant can both see no lock. That
 * is tolerable HERE and nowhere else in this design: discovery is idempotent
 * (the same hashes produce the same candidates and the same job ids), so a
 * double scan wastes work rather than corrupting state. PROMOTION is the
 * operation that genuinely cannot tolerate a race, and the design puts that
 * behind a Durable Object for exactly this reason.
 */
export async function acquireScanLock(deps: DiscoveryDeps, holder: string): Promise<boolean> {
  const key = stateKeys.scanLock();
  const existing = await deps.store.get(key);
  if (existing) return false;
  await deps.store.put(key, holder, { expirationTtl: SCAN_LOCK_TTL_SECONDS });
  return true;
}

export async function releaseScanLock(deps: DiscoveryDeps, holder: string): Promise<void> {
  const key = stateKeys.scanLock();
  const existing = await deps.store.get(key);
  // Only the holder clears it — a scanner whose lock already expired must not
  // clear the lock a different scanner has since taken.
  if (existing === holder) await deps.store.put(key, "", { expirationTtl: 1 });
}

/**
 * Compare the current FM state with persisted hashes.
 *
 * Read-only with respect to candidate state: this classifies, and the caller
 * decides what to persist. That split keeps the interesting logic pure and
 * lets a dry run report what WOULD happen without writing anything.
 */
export async function discover(deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const records = await deps.loadRecords();
  const changed: SourceRecord[] = [];
  const removed: SourceRecord[] = [];
  const jobs: TranslationJob[] = [];
  let unchanged = 0;

  for (const record of records) {
    if (!record.active) {
      // Withdrawals never wait on translation (design: "Inactive or deleted
      // records are different"). An inactive record is a removal regardless of
      // whether its prose changed.
      removed.push(record);
      continue;
    }

    const previous = await deps.store.get(stateKeys.newestHash(record.kind, record.id));
    if (previous === record.hash) {
      unchanged += 1;
      continue;
    }

    changed.push(record);
    jobs.push(...jobsForRecord(record));
  }

  return { changed, removed, unchanged, jobs };
}

/**
 * Persist the outcome of a scan: record newest hashes, open candidates, and
 * mark removals.
 *
 * Writes the newest hash BEFORE the candidate, so a crash between the two
 * leaves a known hash with no candidate — which the next scan repairs by
 * treating the record as unchanged and re-opening nothing. The opposite order
 * would leave a candidate whose hash is not the newest, i.e. permanently
 * superseded and never cleaned up.
 */
export async function persistDiscovery(
  deps: DiscoveryDeps,
  result: DiscoveryResult,
  keyVersion: string,
): Promise<void> {
  for (const record of result.changed) {
    await deps.store.put(stateKeys.newestHash(record.kind, record.id), record.hash);

    const required = jobsForRecord(record).map((job) => jobId(job, keyVersion));
    const candidate: Candidate = {
      entityKind: record.kind,
      entityId: record.id,
      sourceHash: record.hash,
      state: "preparing",
      requiredJobIds: required,
      completed: {},
    };
    await deps.store.put(
      stateKeys.candidate(record.kind, record.id, record.hash),
      JSON.stringify(candidate),
    );
  }

  for (const record of result.removed) {
    await deps.store.put(
      stateKeys.removal(record.kind, record.id),
      JSON.stringify({ kind: record.kind, id: record.id, at: (deps.now ?? Date.now)() }),
    );
  }
}

/**
 * Record one completed job against its candidate.
 *
 * Idempotent by construction: marking an already-completed job changes
 * nothing, which is what makes at-least-once queue delivery safe.
 *
 * Returns the updated candidate, or null when the completion is stale — an
 * older queue message finishing after a newer edit was discovered. The design
 * is explicit that such a completion "must never overwrite state for the newer
 * edit", so this refuses rather than merging.
 */
export async function recordJobCompletion(
  deps: DiscoveryDeps,
  job: TranslationJob,
  keyVersion: string,
): Promise<Candidate | null> {
  const key = stateKeys.candidate(job.entityKind, job.entityId, job.sourceHash);
  const raw = await deps.store.get(key);
  if (!raw) return null;

  const candidate = JSON.parse(raw) as Candidate;

  const newest = await deps.store.get(stateKeys.newestHash(job.entityKind, job.entityId));
  if (isSuperseded(candidate, newest ?? undefined)) {
    const superseded: Candidate = { ...candidate, state: "superseded" };
    await deps.store.put(key, JSON.stringify(superseded));
    return null;
  }

  const id = jobId(job, keyVersion);
  if (candidate.completed[id]) return candidate;

  const updated: Candidate = {
    ...candidate,
    completed: { ...candidate.completed, [id]: true },
  };
  await deps.store.put(key, JSON.stringify(updated));
  return updated;
}

/**
 * Which of a record's references are not yet publishable?
 *
 * This is how the acceptance scenario's grouping works: an artist referencing
 * two news posts cannot publish until both are ready. Pure, so the rule is
 * testable without any store.
 */
export function pendingReferences(
  record: SourceRecord,
  readyIds: ReadonlySet<string>,
): string[] {
  return record.references.filter((ref) => !readyIds.has(ref));
}

/**
 * Records that can go into the next release.
 *
 * Composes, per the design, "validated new versions plus last-good versions of
 * pending edits, omitting pending new records" — so one record failing
 * translation does not block every unrelated ready record. A record is
 * included when it is ready AND every reference it declares is also included.
 *
 * Iterates to a fixed point because readiness is transitive: dropping a record
 * can strand another that referenced it.
 */
export function selectPublishable(
  records: readonly SourceRecord[],
  readyIds: ReadonlySet<string>,
): SourceRecord[] {
  let included = records.filter((r) => r.active && readyIds.has(r.id));

  for (;;) {
    const present = new Set(included.map((r) => r.id));
    const next = included.filter((r) => r.references.every((ref) => present.has(ref)));
    if (next.length === included.length) return next;
    included = next;
  }
}
