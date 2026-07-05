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

/** Shell runner for the `gh` CLI. Mirrors the engineer loop's GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Discriminated PR state from verifyPrState probe. */
export type PrState = 'open' | 'merged' | 'closed-unmerged' | 'unknown';

/**
 * Probe GitHub PR state via gh runner.
 *
 * Calls `gh pr view <url> --json state,mergedAt` and maps the response to a
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
    const { stdout } = await gh(['pr', 'view', url, '--json', 'state,mergedAt'], {
      cwd: process.cwd(),
    });

    // Parse the JSON response.
    const pr = JSON.parse(stdout || '{}') as { state?: string; mergedAt?: string | null };

    // Map state to PrState.
    if (pr.state === 'OPEN') {
      return 'open';
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

/** Minimal envelope shape this module cares about. */
export interface GuardedEnvelope {
  source?: string;
  sourceRef?: string;
  [key: string]: unknown;
}

/** The subset of IntakeQueue this decorator wraps. */
export interface GuardedQueue {
  claim(): Promise<GuardedEnvelope | null>;
  release(e: GuardedEnvelope): Promise<void>;
}

/** Minimal ledger interface for guard. */
export interface GuardLedger {
  get(source: string, sourceRef: string): Promise<any>;
  record(input: { source: string; sourceRef: string }): Promise<void>;
  transition(...args: any[]): Promise<void>;
  reopen(source: string, sourceRef: string): Promise<void>;
}

/** Simple logger interface. */
export interface Logger {
  info(msg: string): void;
}

/** Dependencies passed to the decorator. */
export interface DeliveryGuardDeps {
  gh: GhRunner;
  logger?: Logger;
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
  queue: GuardedQueue,
  ledger: GuardLedger,
  deps: DeliveryGuardDeps,
): GuardedQueue {
  const held: GuardedEnvelope[] = [];
  const logger = deps.logger ?? { info: () => {} };

  return {
    async claim(): Promise<GuardedEnvelope | null> {
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

      // Healthy path: no ledger entry (non-recording source) or pending status
      if (!entry || entry.status === 'pending' || entry.status === 'unseen') {
        // Passthrough unchanged — no ledger writes, no gh calls
        return candidate;
      }

      // Task 3 & 4: Check if entry can be auto-healed (has prUrl and PR is open/merged)
      if (entry.prUrl) {
        const prState = await verifyPrState(deps.gh, entry.prUrl);

        if (prState === 'open' || prState === 'merged') {
          // PR is delivered — heal the entry to 'done' with metadata preserved
          const priorStatus = entry.status;

          // Task 4: Wrap ledger.transition in try/catch
          try {
            await ledger.transition(source, sourceRef, 'done', {
              prUrl: entry.prUrl,
              branch: entry.branch,
            });
          } catch (err) {
            // Ledger write failed — candidate cannot be served
            // Log error to stderr for operator visibility
            process.stderr.write(
              `[delivery-guard] Failed to heal entry ${sourceRef}: ${err instanceof Error ? err.message : String(err)}\n`,
            );
            // Add candidate to held list (not yet served)
            held.push(candidate);
            // Continue scanning for the next candidate
            return this.claim();
          }

          // Task 4: Wrap queue.release in try/catch for ENOENT handling
          try {
            // Ack the intake envelope (remove it from queue)
            await queue.release(candidate);
          } catch (err) {
            // Check if error is ENOENT (benign race — file was already deleted)
            const isEnoent =
              err instanceof Error &&
              (('code' in err && (err as any).code === 'ENOENT') ||
                err.message.includes('ENOENT'));

            if (!isEnoent) {
              // Non-ENOENT error — treat as a real failure, hold the candidate
              process.stderr.write(
                `[delivery-guard] Failed to release ack for ${sourceRef}: ${err instanceof Error ? err.message : String(err)}\n`,
              );
              held.push(candidate);
              // Continue scanning for the next candidate
              return this.claim();
            }
            // ENOENT is benign — file was already deleted by concurrent process
            // Log at debug level and continue
            logger.info(`Benign race: failed to ack ${sourceRef} (file already deleted)`);
          }

          // Log audit trail
          logger.info(`Healed stale entry ${sourceRef}: ${priorStatus} → done`);

          // Continue scanning for the next candidate
          return this.claim();
        }

        // Task 5: closed-unmerged reopen semantics (FR-39/40)
        if (prState === 'closed-unmerged') {
          const attempts = entry.attempts ?? 0;

          if (attempts < REOPEN_ATTEMPTS_CAP) {
            // Below cap — reopen for another attempt
            try {
              await ledger.reopen(source, sourceRef);
              logger.info(`Reopening ${sourceRef}`);
              // Hold the candidate (will be released when queue is exhausted)
              held.push(candidate);
            } catch (err) {
              // Reopen failed — log error, hold, and continue
              process.stderr.write(
                `[delivery-guard] Failed to reopen entry ${sourceRef}: ${err instanceof Error ? err.message : String(err)}\n`,
              );
              held.push(candidate);
            }
            // Continue scanning for the next candidate
            return this.claim();
          } else {
            // At or past cap — park as needs-manual
            try {
              await ledger.transition(source, sourceRef, 'needs-manual', {
                prUrl: entry.prUrl,
              });
            } catch (err) {
              // Transition failed — log error and hold
              process.stderr.write(
                `[delivery-guard] Failed to park entry ${sourceRef} as needs-manual: ${err instanceof Error ? err.message : String(err)}\n`,
              );
              held.push(candidate);
              // Continue scanning for the next candidate
              return this.claim();
            }

            // Ack the envelope
            try {
              await queue.release(candidate);
            } catch (err) {
              // Check if error is ENOENT (benign race)
              const isEnoent =
                err instanceof Error &&
                (('code' in err && (err as any).code === 'ENOENT') ||
                  err.message.includes('ENOENT'));

              if (!isEnoent) {
                // Non-ENOENT error — treat as a real failure, hold the candidate
                process.stderr.write(
                  `[delivery-guard] Failed to release ack for ${sourceRef}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
                held.push(candidate);
                // Continue scanning for the next candidate
                return this.claim();
              }
              // ENOENT is benign
              logger.info(`Benign race: failed to ack ${sourceRef} (file already deleted)`);
            }

            logger.info(`Parking ${sourceRef} as needs-manual (attempts cap reached)`);
            // Continue scanning for the next candidate
            return this.claim();
          }
        }
      }

      // Not healable — hold it for later release pattern
      held.push(candidate);

      // Continue scanning for the next candidate
      return this.claim();
    },

    async release(e: GuardedEnvelope): Promise<void> {
      await queue.release(e);
    },
  };
}
