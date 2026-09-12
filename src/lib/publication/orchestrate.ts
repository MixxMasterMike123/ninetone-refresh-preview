/**
 * Orchestration — the sequence the Worker's `scheduled` and `queue` handlers
 * run, with every Cloudflare dependency injected.
 *
 * WHY NOT PUT THIS IN worker-entry.ts. Logic written directly inside a handler
 * can only be exercised by deploying, or by standing up miniflare. Everything
 * here is a function over injected dependencies, so the whole cron and consumer
 * sequence is unit-testable with `node --test` and fake bindings — the same
 * discipline the rest of this flow follows. `worker-entry.ts` stays a thin
 * adapter that resolves bindings and calls in here.
 *
 * SHADOW IS THE DEFAULT, AND PREPARATION IS NOT GATED ON IT. This is the
 * distinction that decides what the flag actually controls:
 *
 *   - discovery, snapshots, translation, release ASSEMBLY and storage all run
 *     in shadow. They change no response: a prepared release nothing serves
 *     from is inert.
 *   - only PROMOTION — making a generation the one serving answers come from —
 *     is gated on PUBLICATION_SERVING being exactly "on".
 *
 * Gating preparation on the flag would mean flipping serving on against a cold,
 * unprepared release, which is the opposite of what shadow mode is for.
 *
 * NOTHING HERE EVER READS LIVE FM FOR TEXT. Discovery reads FM to find what
 * changed and freezes it into a snapshot; from that point on, translation and
 * assembly read the snapshot. That is the invariant the whole design rests on.
 */

import { entityRef, persistDiscovery, recordJobCompletion, type DiscoveryDeps } from "./discovery.ts";
import { discover } from "./discovery.ts";
import type { SourceRecord } from "./contracts.ts";
import {
  jobsForSnapshot,
  resolveJobSource,
  writeSnapshot,
  type SnapshotBoundJob,
  type SnapshotDeps,
  type SourceSnapshot,
} from "./snapshot.ts";
import { processJob, type ConsumerDeps, type JobOutcome } from "./consumer.ts";
import { loadSourceRecords, PROMPT_VERSION, type LoadDeps, type LoadedRecords } from "./fm-source.ts";
import { readBackAll, publishableRecords, type ReadBackDeps } from "./readback.ts";
import { buildRelease, storeRelease, type ReleaseDeps } from "./release.ts";
import { validateRelease } from "./contracts.ts";
import { publicationMode, type PublicationMode } from "./serving.ts";

/** What one discovery run did. Returned for logging and for tests to assert on. */
export interface DiscoveryRunResult {
  readonly mode: PublicationMode;
  readonly scanned: number;
  readonly changed: number;
  readonly removed: number;
  readonly unchanged: number;
  /** Jobs enqueued. Zero when nothing changed — the "no work at all" property. */
  readonly enqueued: number;
  readonly snapshots: number;
  /** False when any FM layout failed; removals are NOT trusted in that case. */
  readonly inventoryComplete: boolean;
  readonly failures: readonly string[];
}

export interface QueueProducerLike {
  send(message: unknown): Promise<void>;
  sendBatch?(messages: readonly { body: unknown }[]): Promise<void>;
}

export interface DiscoveryRunDeps {
  readonly discovery: DiscoveryDeps;
  readonly snapshots: SnapshotDeps;
  readonly load: LoadDeps;
  readonly queue: QueueProducerLike | null;
  readonly env: Readonly<Record<string, unknown>>;
  readonly keyVersion: string;
  readonly promptVersion?: string;
  readonly log?: (message: string, detail?: unknown) => void;
}

/**
 * One cron tick: read FM, detect change, freeze snapshots, enqueue work.
 *
 * ORDER MATTERS AND IS DELIBERATE. The snapshot is written BEFORE the job is
 * enqueued, so a job can never reference a snapshot that does not exist yet.
 * The reverse order would make `resolveJobSource` return `retry` for a message
 * that is in fact valid, burning queue retries on a self-inflicted race. A
 * crash between the two leaves an orphan snapshot, which is harmless: it is
 * write-once, keyed by content, and the next scan re-enqueues the job.
 */
export async function runDiscovery(deps: DiscoveryRunDeps): Promise<DiscoveryRunResult> {
  const mode = publicationMode(deps.env);
  const promptVersion = deps.promptVersion ?? PROMPT_VERSION;

  const loaded: LoadedRecords = await loadSourceRecords(deps.load);
  if (loaded.failures.length) {
    deps.log?.("[publication] FM layers failed; removals will not be trusted", loaded.failures);
  }

  // `inventoryComplete` is passed truthfully: false whenever ANY layout failed,
  // so a partial read can never be read as mass deletion.
  const result = await discover(
    { ...deps.discovery, loadRecords: async () => loaded.records },
    { inventoryComplete: loaded.complete },
  );

  await persistDiscovery(
    { ...deps.discovery, loadRecords: async () => loaded.records },
    result,
    deps.keyVersion,
  );

  // Freeze every changed record, then enqueue from the SNAPSHOT.
  let enqueued = 0;
  const snapshots: SourceSnapshot[] = [];
  for (const record of result.changed) {
    const protect = loaded.protectedNames[entityRef(record.kind, record.id)] ?? [];
    const snapshot = await writeSnapshot(deps.snapshots, record, { promptVersion, protect });
    snapshots.push(snapshot);

    const jobs = jobsForSnapshot(snapshot);
    if (!jobs.length || !deps.queue) continue;

    if (deps.queue.sendBatch) {
      await deps.queue.sendBatch(jobs.map((body) => ({ body })));
    } else {
      for (const job of jobs) await deps.queue.send(job);
    }
    enqueued += jobs.length;
  }

  return {
    mode,
    scanned: loaded.records.length,
    changed: result.changed.length,
    removed: result.removed.length,
    unchanged: result.unchanged,
    enqueued,
    snapshots: snapshots.length,
    inventoryComplete: loaded.complete,
    failures: loaded.failures,
  };
}

/** What one queue message did, and what the handler should do with it. */
export type MessageDisposition =
  | { readonly action: "ack"; readonly outcome: JobOutcome | { status: "stale" | "absent" } }
  /** Snapshot not readable yet — genuinely transient. */
  | { readonly action: "retry"; readonly reason: "snapshot-missing" };

export interface ConsumeDeps {
  readonly consumer: Omit<ConsumerDeps, "sourceFor" | "protectFor">;
  readonly snapshots: Pick<SnapshotDeps, "store">;
  readonly discovery: DiscoveryDeps;
  readonly keyVersion: string;
  readonly log?: (message: string, detail?: unknown) => void;
}

/**
 * Process one queued translation job.
 *
 * RETRY IS RESERVED FOR THE TRANSIENT CASE. `processJob` already exhausts its
 * own bounded retry schedule internally, so telling the queue to retry a
 * `failed` job multiplies those attempts by the queue's own retry count — four
 * internal attempts times five deliveries is twenty model calls for one field.
 * A failed job is therefore ACKed and left for the next scan to rediscover;
 * only an unreadable snapshot retries.
 *
 * A stale completion is ACKed too. `recordJobCompletion` returning false means
 * the candidate is gone or superseded — that message will never become valid,
 * so retrying it is pure waste.
 */
export async function consumeJob(
  deps: ConsumeDeps,
  job: SnapshotBoundJob,
): Promise<MessageDisposition> {
  const resolution = await resolveJobSource(deps.snapshots, job);

  if (resolution.status === "retry") {
    return { action: "retry", reason: "snapshot-missing" };
  }
  if (resolution.status === "absent") {
    // The snapshot is readable and the field genuinely is not in it. Retrying
    // would loop until the queue dead-lettered it for the wrong reason.
    return { action: "ack", outcome: { status: "absent" } };
  }

  const outcome = await processJob(
    {
      ...deps.consumer,
      sourceFor: async () => resolution.text,
      protectFor: async () => resolution.protect,
    },
    job,
  );

  if (outcome.status === "translated" || outcome.status === "reused") {
    const recorded = await recordJobCompletion(deps.discovery, job, deps.keyVersion);
    if (!recorded) {
      deps.log?.("[publication] completion refused (superseded or unknown candidate)", {
        entity: `${job.entityKind}:${job.entityId}`,
        field: job.field,
      });
      return { action: "ack", outcome: { status: "stale" } };
    }
  }

  return { action: "ack", outcome };
}

export interface AssembleDeps {
  readonly readback: ReadBackDeps;
  readonly release: ReleaseDeps;
  readonly promptVersion?: string;
  readonly buildId: string;
  readonly generation: string;
  readonly createdAt: string;
  readonly routesFor: (record: SourceRecord) => readonly string[];
  readonly log?: (message: string, detail?: unknown) => void;
}

export interface AssembleResult {
  readonly generation: string;
  readonly stored: boolean;
  readonly digest: string | null;
  readonly published: number;
  readonly withheld: readonly string[];
  readonly issues: readonly unknown[];
}

/**
 * Assemble and STORE a release. Never promotes it — see the file comment.
 *
 * Storing without promoting is exactly what shadow mode needs: the bundle
 * exists and can be compared against live output, while nothing serves from it.
 */
export async function assembleRelease(
  deps: AssembleDeps,
  records: readonly SourceRecord[],
  snapshots: readonly SourceSnapshot[],
): Promise<AssembleResult> {
  const readBack = await readBackAll(deps.readback, snapshots);
  const publishable = publishableRecords(records, readBack.ready);

  if (!publishable.length) {
    return {
      generation: deps.generation,
      stored: false,
      digest: null,
      published: 0,
      withheld: readBack.incomplete,
      issues: [],
    };
  }

  const release = buildRelease({
    generation: deps.generation,
    records: publishable,
    translations: readBack.translations,
    routesFor: deps.routesFor,
    buildId: deps.buildId,
    promptVersion: deps.promptVersion ?? PROMPT_VERSION,
    createdAt: deps.createdAt,
  });

  const issues = validateRelease(release);
  if (issues.length) {
    // A bundle that does not validate is never stored. Storing it would put a
    // readable-but-broken generation within reach of the fallback chain.
    deps.log?.("[publication] release failed validation; not stored", issues.slice(0, 5));
    return {
      generation: deps.generation,
      stored: false,
      digest: null,
      published: 0,
      withheld: readBack.incomplete,
      issues,
    };
  }

  const digest = await storeRelease(deps.release, release);
  return {
    generation: deps.generation,
    stored: true,
    digest,
    published: publishable.length,
    withheld: readBack.incomplete,
    issues: [],
  };
}

/**
 * Should a stored generation be promoted?
 *
 * The ONE decision the rollout flag controls. Everything else runs in shadow.
 */
export function shouldPromote(env: Readonly<Record<string, unknown>>): boolean {
  return publicationMode(env) === "serving";
}
