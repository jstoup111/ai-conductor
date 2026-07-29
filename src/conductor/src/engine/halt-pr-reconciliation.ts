/**
 * Halt-PR reconciliation sweep (Task 15: reconcileHaltPrs).
 *
 * Enumerate open PRs, filter by body-marker presence, and call
 * `ensureHaltPresentation` on any non-conforming PR. Skip PRs without
 * the marker and conforming marked PRs (no writes).
 *
 * All operations are best-effort / non-throwing (C3).
 */

import type { GhRunner, GitRunner } from './pr-labels.js';
import {
  makeProductionGh,
  makeProductionGit,
  NEEDS_REMEDIATION_BODY_MARKER,
  NEEDS_REMEDIATION_MARKER,
  ensureHaltPresentation,
  cleanupHaltPresentation,
  upsertComment,
} from './pr-labels.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GhPrListItem {
  number: number;
  url: string;
  body?: string;
  isDraft?: boolean;
  labels?: Array<{ name?: string }>;
  headRefName?: string;
}

export type PrSweepOutcome = 'conforming' | 'healed' | 'unconfirmed' | 'cleared' | 'clear-unconfirmed';

/** Branch prefix the daemon cuts for every feature it builds (`daemon-deps.ts`). */
const DAEMON_BRANCH_PREFIX = 'feat/daemon-';

/**
 * Recover the feature slug from a daemon-cut branch name. Returns null for any
 * branch the daemon did not cut — a halt PR only ever lives on `feat/daemon-<slug>`
 * (`escalateBuildFailure` pushes the daemon's own worktree branch), so refusing
 * to guess for other branches keeps the resolution check fail-closed.
 */
export function featureSlugFromDaemonBranch(branch: string | undefined | null): string | null {
  if (!branch || !branch.startsWith(DAEMON_BRANCH_PREFIX)) return null;
  const slug = branch.slice(DAEMON_BRANCH_PREFIX.length).trim();
  return slug.length > 0 ? slug : null;
}

/**
 * Durable, positive evidence that the halt which drafted+labeled this PR has
 * since been resolved: `/finish` committed `.docs/shipped/<slug>.md` onto the
 * feature branch (adr-2026-07-03-committed-shipped-record-dispatch-dedup,
 * Decision 1). Read from the committed branch tree — never the working tree —
 * so a torn-down worktree cannot hide it. Checks the local branch first, then
 * its remote-tracking ref, so the sweep works whether or not the local branch
 * still exists in the main checkout.
 */
export async function hasShippedRecordOnBranch(
  runGit: GitRunner,
  projectRoot: string,
  branch: string,
  slug: string,
): Promise<boolean> {
  const relPath = `.docs/shipped/${slug}.md`;
  for (const ref of [branch, `origin/${branch}`]) {
    try {
      await runGit(['cat-file', '-e', `${ref}:${relPath}`], { cwd: projectRoot });
      return true;
    } catch {
      /* ref or path absent — try the next ref */
    }
  }
  return false;
}

const summarySignatures = new WeakMap<Map<string, PrSweepOutcome>, string>();

interface ReconcileOpts {
  projectRoot: string;
  log?: (msg: string) => void;
  runGh?: GhRunner;
  runGit?: GitRunner;
  cache?: Map<string, PrSweepOutcome>;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Enumerate open PRs and heal any with the body marker that are missing
 * draft status or the needs-remediation label.
 *
 * - Filters to PRs containing NEEDS_REMEDIATION_BODY_MARKER in body
 * - Clears the marking on any marked PR whose halt is durably RESOLVED (a
 *   shipped record for the feature is committed on the PR's head branch)
 * - For each still-halted marked PR, calls ensureHaltPresentation to fix draft + label
 * - Skips unmarked PRs (never drafted/labeled)
 * - Skips conforming marked PRs whose halt is still open (no writes)
 * - Best-effort / non-throwing (errors logged but never re-thrown)
 * - Returns void
 */
export async function reconcileHaltPrs({ projectRoot, log, runGh, runGit, cache }: ReconcileOpts): Promise<void> {
  const gh = runGh ?? makeProductionGh();
  const git = runGit ?? makeProductionGit();
  const outcomeCache = cache ?? new Map<string, PrSweepOutcome>();

  try {
    // ── Step 1: enumerate open PRs ─────────────────────────────────────────
    let prList: GhPrListItem[] = [];
    try {
      const { stdout } = await gh(
        [
          'pr',
          'list',
          '--json',
          'number,url,body,isDraft,labels,headRefName',
          '--state',
          'open',
          '--limit',
          '100',
        ],
        { cwd: projectRoot },
      );
      prList = JSON.parse(stdout || '[]') as GhPrListItem[];
    } catch (err) {
      log?.(`[halt-pr-reconciliation] failed to enumerate PRs: ${err}`);
      return; // best-effort: no-op on list failure
    }

    // ── Step 2: filter to marked PRs ───────────────────────────────────────
    const markedPrs = prList.filter((pr) => {
      const body = pr.body ?? '';
      return body.includes(NEEDS_REMEDIATION_BODY_MARKER);
    });

    const summaryLine = `[halt-pr-reconciliation] enumerated ${prList.length} open PRs, found ${markedPrs.length} marked`;

    let loggedPerPrLine = false;
    const emit = (msg: string) => {
      loggedPerPrLine = true;
      log?.(msg);
    };

    // ── Step 3: for each marked PR, ensure it's conform (draft + labeled) ──
    for (const pr of markedPrs) {
      try {
        const isDraft = pr.isDraft ?? false;
        const labels = (pr.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
        const hasLabel = labels.includes('needs-remediation');

        // ── Resolution beats shape ─────────────────────────────────────────
        // A marked PR whose feature has since SHIPPED is not "conforming" —
        // it is stale. Shape (draft+labeled) says only that the marking was
        // applied, never that the halt still stands, so checking shape alone
        // pins a resolved PR in draft+needs-remediation until a human clears
        // it by hand. The durable resolution signal is the committed
        // shipped-record on the PR's own head branch.
        const slug = featureSlugFromDaemonBranch(pr.headRefName);
        if (slug && (await hasShippedRecordOnBranch(git, projectRoot, pr.headRefName!, slug))) {
          if (outcomeCache.get(pr.url) !== 'cleared') {
            emit(
              `[halt-pr-reconciliation] ${pr.url} halt resolved (shipped record for ${slug} on ${pr.headRefName}) — clearing`,
            );
          }
          const clearResult = await cleanupHaltPresentation(gh, projectRoot, pr.url, log);
          // Supersede the halt comment in place (same marker → edited, never
          // duplicated) so the PR thread no longer reads as blocked.
          await upsertComment(
            gh,
            projectRoot,
            pr.url,
            NEEDS_REMEDIATION_MARKER,
            'Halt resolved — the feature shipped and recorded ' +
              `\`.docs/shipped/${slug}.md\` on \`${pr.headRefName}\`. ` +
              'The `needs-remediation` label and draft status were cleared automatically.',
            log,
          );
          if (clearResult === 'confirmed') {
            emit(`[halt-pr-reconciliation] ${pr.url} cleared (confirmed)`);
            outcomeCache.set(pr.url, 'cleared');
          } else {
            emit(`[halt-pr-reconciliation] ${pr.url} clear unconfirmed (will retry on next tick)`);
            outcomeCache.set(pr.url, 'clear-unconfirmed');
          }
          continue;
        }

        // If already conforming (draft + labeled), skip (idempotent no-op)
        if (isDraft && hasLabel) {
          if (outcomeCache.get(pr.url) !== 'conforming') {
            emit(`[halt-pr-reconciliation] ${pr.url} already conforming (draft+labeled), skipping`);
          }
          outcomeCache.set(pr.url, 'conforming');
          continue;
        }

        // Non-conforming: call ensureHaltPresentation to heal it
        emit(`[halt-pr-reconciliation] healing ${pr.url}: isDraft=${isDraft}, hasLabel=${hasLabel}`);
        const result = await ensureHaltPresentation(gh, projectRoot, pr.url, log);
        if (result === 'confirmed') {
          emit(`[halt-pr-reconciliation] ${pr.url} healed (confirmed)`);
          outcomeCache.set(pr.url, 'healed');
        } else {
          emit(`[halt-pr-reconciliation] ${pr.url} heal unconfirmed (will retry on next tick)`);
          outcomeCache.set(pr.url, 'unconfirmed');
        }
      } catch (err) {
        // Per-PR exception: log + skip, continue with other PRs
        emit(`[halt-pr-reconciliation] error healing ${pr.url}: ${err}`);
      }
    }

    const signature = `${prList.length}:${markedPrs.length}`;
    const shouldLogSummary =
      cache === undefined ||
      loggedPerPrLine ||
      summarySignatures.get(outcomeCache) !== signature;
    if (shouldLogSummary) {
      log?.(summaryLine);
    }
    if (cache !== undefined) {
      summarySignatures.set(outcomeCache, signature);
    }

    // Prune cache entries for PRs no longer in the marked set (merged/closed)
    const markedUrls = new Set(markedPrs.map((pr) => pr.url));
    for (const url of outcomeCache.keys()) {
      if (!markedUrls.has(url)) {
        outcomeCache.delete(url);
      }
    }
  } catch (err) {
    // Sweep-level exception: swallow so callers are never disrupted
    log?.(`[halt-pr-reconciliation] sweep error: ${err}`);
  }
}
