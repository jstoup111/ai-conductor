/**
 * Halt-PR reconciliation sweep (Task 15: reconcileHaltPrs).
 *
 * Enumerate open PRs, filter by body-marker presence, and call
 * `ensureHaltPresentation` on any non-conforming PR. Skip PRs without
 * the marker and conforming marked PRs (no writes).
 *
 * All operations are best-effort / non-throwing (C3).
 */

import type { GhRunner } from './pr-labels.js';
import { makeProductionGh, NEEDS_REMEDIATION_BODY_MARKER, ensureHaltPresentation } from './pr-labels.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GhPrListItem {
  number: number;
  url: string;
  body?: string;
  isDraft?: boolean;
  labels?: Array<{ name?: string }>;
}

export type PrSweepOutcome = 'conforming' | 'healed' | 'unconfirmed';

interface ReconcileOpts {
  projectRoot: string;
  log?: (msg: string) => void;
  runGh?: GhRunner;
  cache?: Map<string, PrSweepOutcome>;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Enumerate open PRs and heal any with the body marker that are missing
 * draft status or the needs-remediation label.
 *
 * - Filters to PRs containing NEEDS_REMEDIATION_BODY_MARKER in body
 * - For each marked PR, calls ensureHaltPresentation to fix draft + label
 * - Skips unmarked PRs (never drafted/labeled)
 * - Skips conforming marked PRs (no writes)
 * - Best-effort / non-throwing (errors logged but never re-thrown)
 * - Returns void
 */
export async function reconcileHaltPrs({ projectRoot, log, runGh, cache }: ReconcileOpts): Promise<void> {
  const gh = runGh ?? makeProductionGh();
  const outcomeCache = cache ?? new Map<string, PrSweepOutcome>();

  try {
    // ── Step 1: enumerate open PRs ─────────────────────────────────────────
    let prList: GhPrListItem[] = [];
    try {
      const { stdout } = await gh(
        ['pr', 'list', '--json', 'number,url,body,isDraft,labels', '--state', 'open', '--limit', '100'],
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

    log?.(`[halt-pr-reconciliation] enumerated ${prList.length} open PRs, found ${markedPrs.length} marked`);

    // ── Step 3: for each marked PR, ensure it's conform (draft + labeled) ──
    for (const pr of markedPrs) {
      try {
        const isDraft = pr.isDraft ?? false;
        const labels = (pr.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
        const hasLabel = labels.includes('needs-remediation');

        // If already conforming (draft + labeled), skip (idempotent no-op)
        if (isDraft && hasLabel) {
          if (outcomeCache.get(pr.url) !== 'conforming') {
            log?.(`[halt-pr-reconciliation] ${pr.url} already conforming (draft+labeled), skipping`);
          }
          outcomeCache.set(pr.url, 'conforming');
          continue;
        }

        // Non-conforming: call ensureHaltPresentation to heal it
        log?.(`[halt-pr-reconciliation] healing ${pr.url}: isDraft=${isDraft}, hasLabel=${hasLabel}`);
        const result = await ensureHaltPresentation(gh, projectRoot, pr.url, log);
        if (result === 'confirmed') {
          log?.(`[halt-pr-reconciliation] ${pr.url} healed (confirmed)`);
        } else {
          log?.(`[halt-pr-reconciliation] ${pr.url} heal unconfirmed (will retry on next tick)`);
        }
      } catch (err) {
        // Per-PR exception: log + skip, continue with other PRs
        log?.(`[halt-pr-reconciliation] error healing ${pr.url}: ${err}`);
      }
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
