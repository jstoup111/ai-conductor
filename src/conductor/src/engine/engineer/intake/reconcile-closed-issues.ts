/**
 * reconcileClosedIssues — brain sweep for the intake ledger.
 *
 * Scans pending, github-issues-sourced ledger entries and, for each whose
 * backing GitHub issue is now closed, forgets the ledger entry and removes
 * the matching inbox envelope — so a closed issue can't be claimed again.
 *
 * Modeled on halt-issues/sweep.ts: per-entry try/catch, capability-style
 * gh abstraction, summary counts, dryRun support.
 *
 * This task covers only the core happy path (github-issues, pending status,
 * no resilience/idempotence hardening) — those are separate follow-on tasks.
 */

import type { Ledger } from './ledger.js';
import type { IntakeQueue } from './queue.js';
import { parseSourceRef } from './source-ref.js';

/**
 * Capability for querying a GitHub issue's open/closed state.
 * Modeled on GhAbstraction.getIssueState in halt-issues/sweep.ts.
 */
export type GetIssueState = (repo: string, issue: string) => Promise<'open' | 'closed' | null>;

export interface ReconcileClosedIssuesDeps {
  ledger: Ledger;
  queue: IntakeQueue;
  getIssueState: GetIssueState;
}

export interface ReconcileClosedIssuesOptions {
  dryRun?: boolean;
}

export interface ReconcileClosedIssuesSummary {
  scanned: number;
  forgotten: number;
}

/**
 * Sweep the intake ledger for pending github-issues entries whose backing
 * issue has closed, and reconcile: forget the ledger entry + remove the
 * matching inbox envelope.
 */
export async function reconcileClosedIssues(
  deps: ReconcileClosedIssuesDeps,
  options: ReconcileClosedIssuesOptions = {},
): Promise<ReconcileClosedIssuesSummary> {
  const { ledger, queue, getIssueState } = deps;
  const dryRun = options.dryRun ?? false;

  const summary: ReconcileClosedIssuesSummary = {
    scanned: 0,
    forgotten: 0,
  };

  const entries = await ledger.list();
  const candidates = entries.filter(
    (entry) => entry.status === 'pending' && entry.source === 'github-issues',
  );

  for (const entry of candidates) {
    summary.scanned++;

    try {
      const parsed = parseSourceRef(entry.sourceRef);
      if (!parsed) continue;

      const state = await getIssueState(parsed.repo, parsed.issue);
      if (state !== 'closed') continue;

      if (dryRun) {
        summary.forgotten++;
        continue;
      }

      await ledger.forget(entry.source, entry.sourceRef);

      const envelopes = await queue.list();
      const match = envelopes.find(
        (e) => e.source === entry.source && e.sourceRef === entry.sourceRef,
      );
      if (match) {
        await queue.remove(match);
      }

      summary.forgotten++;
    } catch {
      // Per-entry isolation: one failure doesn't block the rest of the sweep.
      continue;
    }
  }

  return summary;
}
