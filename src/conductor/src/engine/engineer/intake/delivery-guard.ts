// delivery-guard module — PR state verification probe (Task 1, TR-1),
// claim delivery guard decorator (Task 2, TR-2), auto-heal for delivered
// entries (Task 3, TR-3), and closed-unmerged reopen semantics (Task 5, FR-39/40).
//
// Provides PR state probing utilities for the claim delivery guard.
// Used to detect when a spec PR has been closed-unmerged (re-eligibility trigger)
// and to auto-heal delivered entries that have PRs open or merged.
// Implements FR-39/40 reopen semantics: closed-unmerged entries below the reopen
// cap are re-marked for processing; at-cap entries are parked as needs-manual.

import { REOPEN_ATTEMPTS_CAP } from './github-issues.js';
import type { IntakeQueue } from './queue.js';
import type { Envelope } from './port.js';
import { parseSourceRef } from './source-ref.js';
import { isStaleClaim } from './stale-claim.js';
import { resolveStaleClaimWindowMs } from '../../resolved-config.js';
import type { HarnessConfig } from '../../../types/index.js';
import { runTrackerRepositoryRead, runTrackerUrlRead } from '../../tracker-client.js';

/** Discriminated GitHub issue state from getIssueState probe. */
export type IssueState = 'open' | 'closed' | 'unknown';

/**
 * Probe GitHub issue state via gh runner.
 *
 * Calls `gh issue view <n> --json state -q .state` and maps the response to
 * a discriminated state. Handles errors gracefully — if gh throws or stdout
 * is unparseable, returns 'unknown' instead of crashing.
 */
export async function getIssueState(gh: GhRunner, repo: string, issue: string): Promise<IssueState> {
  try {
    const stdout = await runTrackerRepositoryRead(gh, process.cwd(), 'issue.read', repo, { kind: 'issue', number: Number(issue) }, ['issue', 'view', issue, '--repo', repo, '--json', 'state', '-q', '.state']);

    const trimmed = (stdout || '').trim();
    let state: string | undefined;
    try {
      const parsed = JSON.parse(trimmed);
      state = typeof parsed === 'string' ? parsed : parsed?.state;
    } catch {
      state = trimmed;
    }

    if (state === 'OPEN') {
      return 'open';
    }
    if (state === 'CLOSED') {
      return 'closed';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Shell runner for the `gh` CLI. Mirrors the engineer loop's GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Discriminated PR state from verifyPrState probe. */
export type PrState = 'open' | 'open-draft' | 'merged' | 'closed-unmerged' | 'unknown';

/**
 * Probe GitHub PR state via gh runner.
 *
 * Calls `gh pr view <url> --json state,mergedAt,isDraft` and maps the response to a
 * discriminated state. Handles errors gracefully — if gh throws or stdout
 * is unparseable JSON, returns 'unknown' instead of crashing.
 *
 * @param gh - The gh CLI runner (shells `gh <args>` with cwd context)
 * @param url - The GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)
 * @returns One of: 'open' | 'merged' | 'closed-unmerged' | 'unknown'
 */
export async function verifyPrState(gh: GhRunner, url: string): Promise<PrState> {
  try {
    // Shell out to gh pr view with JSON output for state and mergedAt.
    const stdout = await runTrackerUrlRead(gh, process.cwd(), 'pull-request', url, ['pr', 'view', url, '--json', 'state,mergedAt,isDraft']);

    // Parse the JSON response.
    const pr = JSON.parse(stdout || '{}') as { state?: string; mergedAt?: string | null; isDraft?: boolean };

    // Map state to PrState.
    if (pr.state === 'OPEN') {
      return pr.isDraft === true ? 'open-draft' : 'open';
    }

    if (pr.state === 'MERGED') {
      return 'merged';
    }

    if (pr.state === 'CLOSED' && pr.mergedAt === null) {
      return 'closed-unmerged';
    }

    // Unrecognized state → unknown.
    return 'unknown';
  } catch {
    // gh threw or any other error → unknown.
    return 'unknown';
  }
}

// ─── createDeliveryGuardedQueue ────────────────────────────────────────────────

/** The subset of IntakeQueue this decorator wraps. Returns Envelope (same as IntakeQueue). */
export interface GuardedQueue {
  claim(): Promise<Envelope | null>;
  ack(e: Envelope): Promise<void>;
  release(e: Envelope): Promise<void>;
}

/** Minimal ledger interface for guard. */
export interface GuardLedger {
  get(source: string, sourceRef: string): Promise<any>;
  record(input: { source: string; sourceRef: string }): Promise<void>;
  transition(...args: any[]): Promise<void>;
  reopen(source: string, sourceRef: string): Promise<void>;
  forget(source: string, sourceRef: string): Promise<void>;
  list?(): Promise<any[]>;
  requeueClaimed?(source: string, sourceRef: string): Promise<{ acted: boolean }>;
}

/** Simple logger interface. */
export interface Logger {
  info(msg: string): void;
}

/** Dependencies passed to the decorator. */
export interface DeliveryGuardDeps {
  gh: GhRunner;
  logger?: Logger;
  config?: HarnessConfig;
  /** Read-only lookup for an issue already being decided on another spec branch. */
  findCrossReferencedDraft?: (sourceRef: string) => Promise<{ branch: string; url: string } | undefined>;
}

/**
 * Decorator that wraps a queue with claim/release guard logic.
 *
 * For healthy candidates (no ledger entry or status 'pending'/'unseen'),
 * passes through unchanged without ledger writes or gh calls.
 *
 * For problematic candidates with a recorded prUrl and status >= 'pending'
 * (claimed, routed, deciding), checks PR state via gh runner:
 * - If PR is OPEN or MERGED → auto-heals entry to 'done' with metadata
 *   preserved, acks the envelope, and continues to next candidate
 * - Otherwise → holds rejected candidate for later release pattern
 *   (implemented in later tasks)
 *
 * @param queue - The underlying IntakeQueue to wrap
 * @param ledger - The ledger for duplicate detection
 * @param deps - Dependencies (gh runner, logger)
 * @returns A wrapped queue with { claim(), release() }
 */
export function createDeliveryGuardedQueue(
  queue: IntakeQueue,
  ledger: GuardLedger,
  deps: DeliveryGuardDeps,
): GuardedQueue {
  const held: Envelope[] = [];
  const logger = deps.logger ?? { info: () => {} };

  // Task 5 (stale-claimed reap): scan the ledger for entries stuck in
  // 'claimed' status past the stale-claim window (an engineer process died
  // or was killed before recording a prUrl or completing the claim) and
  // requeue them to 'pending' so they become claimable again. Entries with a
  // prUrl are excluded by isStaleClaim and belong exclusively to PR healing.
  async function reapStaleClaimed(): Promise<void> {
    if (typeof ledger.list !== 'function' || typeof ledger.requeueClaimed !== 'function') {
      return;
    }
    const entries = await ledger.list();
    const windowMs = resolveStaleClaimWindowMs(deps.config);
    const now = Date.now();
    for (const entry of entries) {
      if (isStaleClaim(entry, now, windowMs)) {
        const result = await ledger.requeueClaimed(entry.source, entry.sourceRef);
        if (result?.acted) {
          logger.info(`Reaped stale claimed entry ${entry.sourceRef}: claimed → pending`);

          // A stale-claimed entry may have no corresponding envelope left in
          // the underlying file queue (the original envelope was ack'd when
          // it was first claimed, long before the process died). The reap
          // above only heals the LEDGER — without a queue envelope, nothing
          // is ever handed back to the operator even though the ledger now
          // says 'pending'. Reconstruct a minimal synthetic envelope so it
          // re-enters the same claim path as any other candidate, ordered by
          // receivedAt (= capturedAt) so it wins FIFO against genuinely newer
          // pending envelopes, exactly like a real one would.
          if (typeof queue.list !== 'function' || typeof queue.enqueue !== 'function') {
            continue;
          }
          const alreadyQueued = (await queue.list()).some(
            (e) => e.source === entry.source && e.sourceRef === entry.sourceRef,
          );
          if (!alreadyQueued) {
            await queue.enqueue({
              id: `reaped:${entry.source}:${entry.sourceRef}`,
              source: entry.source,
              sourceRef: entry.sourceRef,
              text: `[reaped stale claim] ${entry.sourceRef}`,
              status: 'pending',
              receivedAt: entry.capturedAt ?? new Date(now).toISOString(),
            });
          }
        }
      }
    }
  }

  function isBenignEnoent(error: unknown): boolean {
    return error instanceof Error
      && (('code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') || error.message.includes('ENOENT'));
  }

  /** Acknowledge a discarded envelope, retaining it for release only on a real failure. */
  async function acknowledge(candidate: Envelope, sourceRef: string, failure: string): Promise<boolean> {
    try {
      await queue.ack(candidate);
      return true;
    } catch (error) {
      if (isBenignEnoent(error)) {
        logger.info(`Benign race: failed to ack ${sourceRef} (file already deleted)`);
        return true;
      }
      process.stderr.write(`[delivery-guard] ${failure}: ${error instanceof Error ? error.message : String(error)}\n`);
      held.push(candidate);
      return false;
    }
  }

  /** Reconcile either delivery PR URL through the shared terminal PR lifecycle. */
  async function reconcilePrLifecycle(
    candidate: Envelope,
    source: string,
    sourceRef: string,
    entry: any,
    url: string,
    isDraftUrl: boolean,
  ): Promise<void> {
    const prState = await verifyPrState(deps.gh, url);

    // This is the sole draft-specific disposition: an open draft remains an
    // in-flight DECIDE run, so only its duplicate envelope is discarded.
    if (isDraftUrl && prState === 'open-draft') {
      if (!await acknowledge(candidate, sourceRef, `Failed to drop in-flight draft duplicate ${sourceRef}`)) return;
      logger.info(`Duplicate envelope for in-flight draft ${sourceRef}, dropping (recovery: engineer forget ${sourceRef})`);
      return;
    }

    const delivered = prState === 'open' || prState === 'merged' || (!isDraftUrl && prState === 'open-draft');
    if (delivered) {
      try {
        await ledger.transition(source, sourceRef, 'done', { prUrl: url, branch: entry.branch });
      } catch (error) {
        process.stderr.write(`[delivery-guard] Failed to heal entry ${sourceRef}: ${error instanceof Error ? error.message : String(error)}\n`);
        held.push(candidate);
        return;
      }
      if (!await acknowledge(candidate, sourceRef, `Failed to ack delivered entry ${sourceRef}`)) return;
      logger.info(`Healed stale entry ${sourceRef}: ${entry.status} → done`);
      return;
    }

    if (prState === 'unknown') {
      logger.info(`PR state unknown for ${sourceRef}, holding`);
      held.push(candidate);
      return;
    }

    if ((entry.attempts ?? 0) < REOPEN_ATTEMPTS_CAP) {
      try {
        await ledger.reopen(source, sourceRef);
        logger.info(`Reopening ${sourceRef}`);
      } catch (error) {
        process.stderr.write(`[delivery-guard] Failed to reopen entry ${sourceRef}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      held.push(candidate);
      return;
    }

    try {
      await ledger.transition(source, sourceRef, 'needs-manual', { prUrl: url });
    } catch (error) {
      process.stderr.write(`[delivery-guard] Failed to park entry ${sourceRef} as needs-manual: ${error instanceof Error ? error.message : String(error)}\n`);
      held.push(candidate);
      return;
    }
    if (!await acknowledge(candidate, sourceRef, `Failed to ack parked entry ${sourceRef}`)) return;
    logger.info(`Parking ${sourceRef} as needs-manual (attempts cap reached)`);
  }

  async function innerClaim(): Promise<Envelope | null> {
    const candidate = await queue.claim();
      if (!candidate) {
        // Before returning null, release all held candidates
        for (const c of held) {
          await queue.release(c);
        }
        held.length = 0;
        return null;
      }

      const source = String(candidate.source ?? '');
      const sourceRef = String(candidate.sourceRef ?? '');

      // Check if ledger has an entry for this candidate
      const entry = await ledger.get(source, sourceRef);

      // An issue can be re-captured on a second machine while its first Composer
      // run is still a draft.  Claim must discover that durable remote fact before
      // it serves a brand-new candidate.  Failure is deliberately conservative:
      // leave the candidate pending rather than creating competing spec branches.
      // Pending is not a decision: it may be a locally recorded candidate from
      // a prior poll, so it must receive the same cross-reference lookup as an
      // absent entry before we serve it to create a competing branch.
      if ((!entry || entry.status === 'pending' || entry.status === 'unseen') && source === 'github-issues' && deps.findCrossReferencedDraft) {
        try {
          const inFlight = await deps.findCrossReferencedDraft(sourceRef);
          if (inFlight) {
            await ledger.record({ source, sourceRef });
            await ledger.transition(source, sourceRef, 'deciding', { branch: inFlight.branch, draftPrUrl: inFlight.url });
            if (!await acknowledge(candidate, sourceRef, `Failed to drop cross-referenced draft duplicate ${sourceRef}`)) return innerClaim();
            return innerClaim();
          }
        } catch {
          held.push(candidate);
          return innerClaim();
        }
      }

      // Healthy path: no ledger entry (non-recording source) or pending status
      if (!entry || entry.status === 'pending' || entry.status === 'unseen') {
        // Task 5: for github-issues envelopes with a parseable sourceRef,
        // probe issue state before delivering. Open (or unparseable/unknown)
        // falls through to normal delivery — only Task 6 will drop closed.
        if (source === 'github-issues') {
          const parsed = parseSourceRef(sourceRef);
          if (!parsed) {
            logger.info(`Unparseable sourceRef ${sourceRef}, skipping issue-state probe`);
          }
          if (parsed) {
            const issueState = await getIssueState(deps.gh, parsed.repo, parsed.issue);
            if (issueState === 'closed') {
              // Closed issue — forget the ledger entry and drop the candidate,
              // then continue scanning for the next one.
              await ledger.forget(source, sourceRef);

              if (!await acknowledge(candidate, sourceRef, `Failed to ack closed-issue candidate ${sourceRef}`)) return innerClaim();

              logger.info(`Dropped closed issue ${sourceRef}`);
              return innerClaim();
            }
          }
        }

        // Passthrough unchanged — no ledger writes, no gh calls
        return candidate;
      }

      // Task 7: In-flight duplicate envelope detection
      // If entry is claimed but has no prUrl yet, it means work is in progress
      // but hasn't been handed off to a PR. A duplicate envelope should be
      // dropped without mutating the ledger entry.
      if (entry.status === 'claimed' && !entry.prUrl) {
        // This is an in-flight duplicate — drop it
        if (!await acknowledge(candidate, sourceRef, `Failed to drop in-flight duplicate ${sourceRef}`)) return innerClaim();

        // Log the duplicate drop with recovery path
        logger.info(
          `Duplicate envelope for in-flight entry ${sourceRef}, dropping (recovery: engineer forget ${sourceRef})`,
        );

        // Continue scanning for the next candidate
        return innerClaim();
      }

      // A draft spec PR records an in-flight DECIDE run, not delivery evidence.
      // Unlike a regular prUrl, an open draft must remain deciding until it is
      // readied or merged. Its queue envelope is a duplicate claim and can be
      // dropped safely while the ledger remains untouched.
      if (entry.draftPrUrl && !entry.prUrl) {
        await reconcilePrLifecycle(candidate, source, sourceRef, entry, entry.draftPrUrl, true);
        return innerClaim();
      }

      // Task 3 & 4: Check if entry can be auto-healed (has prUrl and PR is open/merged)
      if (entry.prUrl) {
        await reconcilePrLifecycle(candidate, source, sourceRef, entry, entry.prUrl, false);
        return innerClaim();
      }

      // Not healable — hold it for later release pattern
      held.push(candidate);

      // Continue scanning for the next candidate
      return innerClaim();
  }

  return {
    async claim(): Promise<Envelope | null> {
      // Plan-Task 7: the reap MUST persist to the ledger before innerClaim
      // inspects any candidate's status — otherwise a stale claimed entry
      // whose envelope is still in the underlying queue gets misread as an
      // in-flight duplicate and dropped instead of being served this same
      // pull (FIFO by capturedAt, Story 2). Entries carrying a prUrl are
      // excluded from reaping, so their candidate reaches the PR-healing path
      // inside innerClaim unchanged.
      await reapStaleClaimed();
      return innerClaim();
    },

    async ack(e: Envelope): Promise<void> {
      await queue.ack(e);
    },

    async release(e: Envelope): Promise<void> {
      await queue.release(e);
    },
  };
}
