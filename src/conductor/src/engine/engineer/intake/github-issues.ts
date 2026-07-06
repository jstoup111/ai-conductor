// engineer/intake/github-issues.ts — github-issues async intake adapter.
// Implements BOTH IntakeSource (poll/capture) and IntakePort (report/write-back).
// FR-26/27/28/34/35/36/37/38/39/40; ADR-011/012; Stories 2,3,4,9,10,11,12,14,15.
//
// All GitHub access goes through an injected `gh` runner (never the network in
// tests). The adapter talks ONLY to `gh` — it NEVER writes into any registered
// repo's working tree (C3). Capture is assignee-based (`--assignee @me`); the
// `engineer:handled` label is a write-back marker and a re-capture skip, NOT an
// intake filter.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseEnvelope } from './port.js';
import type { Envelope, EnvelopeStatus, IntakePort, ReportMeta, ReportOutcome } from './port.js';
import type { IntakeSource } from './source.js';
import type { Ledger } from './ledger.js';
import { parseSourceRef } from '../issue-ref.js';
import { restAddLabelArgs, restRemoveLabelArgs } from '../../pr-labels.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shell runner for the `gh` CLI. Mirrors the engineer loop's GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Minimal registry surface the adapter needs: the list of repos to poll. */
export interface IntakeRepoRegistry {
  list(): Promise<Array<{ name: string; path: string; ghRepo?: string }>>;
}

/** Dependencies for the github-issues adapter. All injectable for testability. */
export interface GithubIssuesDeps {
  gh: GhRunner;
  registry: IntakeRepoRegistry;
  ledger: Ledger;
  /** Clock for receivedAt; defaults to wall-clock. Injected for deterministic tests. */
  now?: () => string;
  /** Envelope id generator; defaults to a UUID. Injected for deterministic tests. */
  newId?: () => string;
  /** Log sink; defaults to a no-op. */
  log?: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** The source identifier stamped on every Envelope and ledger key. */
export const GITHUB_ISSUES_SOURCE = 'github-issues';

/** Write-back marker label: applied on `done`, and a re-capture skip on poll. */
export const HANDLED_LABEL = 'engineer:handled';

/**
 * Maximum number of automatic reopens before an issue is parked as
 * `needs-manual`. attempts starts at 0; the (cap+1)-th detection parks it.
 * FR-40 churn guard: "third reopen (attempts==2) → needs-manual".
 * Exported for use by delivery-guard.ts (closed-unmerged reopen semantics).
 */
export const REOPEN_ATTEMPTS_CAP = 2;

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RawIssue {
  number: number;
  title?: string;
  body?: string;
  labels?: Array<{ name: string } | string>;
}

/** Normalise the labels array (gh returns `[{name}]`) to a string[]. */
function labelNames(issue: RawIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

/**
 * Build the Envelope text from an issue's title + body.
 * Returns null when BOTH are empty/whitespace (FR-28: empty issue is skipped,
 * never captured as a blank Envelope).
 */
function buildText(title: string | undefined, body: string | undefined): string | null {
  const t = (title ?? '').trim();
  const b = (body ?? '').trim();
  if (t === '' && b === '') return null;
  return [t, b].filter((s) => s !== '').join('\n\n');
}

// `parseSourceRef` is shared from ../issue-ref.js so the adapter and the
// PR-linking helpers agree on a single parse contract.

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the github-issues adapter (IntakeSource + IntakePort).
 *
 * poll():   per registered repo, list open issues assigned to the auth'd user,
 *           skip already-captured (ledger) and `engineer:handled`-labelled ones,
 *           re-emit a closed-unmerged done issue (re-eligibility), and capture
 *           the rest as pending Envelopes. A failing repo is isolated (FR-27).
 *
 * report(): post a `routed`/`done` comment back to the originating issue and,
 *           on `done`, apply the `engineer:handled` label (auto-creating it).
 *           Non-fatal (FR-37) and de-duplicated per (sourceRef,status) (FR-38).
 */
export function createGithubIssuesAdapter(deps: GithubIssuesDeps): IntakeSource & IntakePort {
  const { gh, registry, ledger } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());
  const log = deps.log ?? (() => {});

  // Per-instance write-back de-dup: a (sourceRef\0status) that has been posted
  // once in this process is not posted again. Cross-process duplicates cannot
  // occur because the `engineer:handled` label gates re-entry on the next poll.
  const postedMarkers = new Set<string>();

  // Map repo name to local path for use as working directory in report() gh calls.
  // Populated during poll(); keyed by the ghRepo or name used in sourceRef.
  const repoPaths = new Map<string, string>();

  /**
   * Resolve the working directory for a report() gh call. Never falls back to
   * process.cwd() — gh calls always target `-R <owner/repo>`, so any existing
   * directory suffices as cwd. Resolution order:
   *   1. poll-cache (repoPaths, populated by a prior poll())
   *   2. registry lookup (matched by ghRepo or name)
   *   3. os.homedir()
   * Every candidate is existsSync-checked before use.
   */
  async function resolveReportCwd(repo: string): Promise<string> {
    const cached = repoPaths.get(repo);
    if (cached && existsSync(cached)) return cached;

    const repos = await registry.list();
    const found = repos.find((r) => (r.ghRepo ?? r.name) === repo);
    if (found && existsSync(found.path)) return found.path;

    return homedir();
  }

  // ── Re-eligibility (FR-39/40) ────────────────────────────────────────────────
  // A `done` issue still carrying the handled label is re-emitted iff its spec PR
  // closed without merging. Merged → never reopen; open/lookup-failure → unchanged.
  async function maybeReopen(
    repo: { name: string; path: string; ghRepo?: string },
    issue: RawIssue,
    sourceRef: string,
  ): Promise<Envelope | null> {
    const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
    if (!entry || entry.status !== 'done' || !entry.prUrl) return null;

    let pr: { state?: string; mergedAt?: string | null };
    try {
      const { stdout } = await gh(['pr', 'view', entry.prUrl, '--json', 'state,mergedAt'], {
        cwd: repo.path,
      });
      pr = JSON.parse(stdout || '{}');
    } catch {
      return null; // PR lookup failed → leave the entry unchanged.
    }

    const merged = pr.state === 'MERGED' || Boolean(pr.mergedAt);
    if (merged) return null; // FR-39: a merged spec PR is never reopened.
    if (pr.state !== 'CLOSED') return null; // OPEN (or unknown) → unchanged.

    // CLOSED + not merged → reopen, subject to the churn cap.
    if ((entry.attempts ?? 0) >= REOPEN_ATTEMPTS_CAP) {
      await ledger.transition(GITHUB_ISSUES_SOURCE, sourceRef, 'needs-manual');
      log(`github-issues: ${sourceRef} exceeded reopen cap — parked as needs-manual`);
      return null;
    }

    const text = buildText(issue.title, issue.body);
    if (text === null) return null; // defensive: nothing to re-route.

    // Strip the handled label so a human sees it is back in flight; non-fatal.
    try {
      const ghRepo = repo.ghRepo ?? repo.name;
      await gh(restRemoveLabelArgs(ghRepo, String(issue.number), HANDLED_LABEL), {
        cwd: repo.path,
      });
    } catch {
      // best-effort — a stuck label must not block re-routing.
    }
    await ledger.reopen(GITHUB_ISSUES_SOURCE, sourceRef);

    return parseEnvelope({
      id: newId(),
      source: GITHUB_ISSUES_SOURCE,
      sourceRef,
      text,
      hintRepo: repo.name,
      status: 'pending',
      receivedAt: now(),
    });
  }

  return {
    // ── poll / capture ────────────────────────────────────────────────────────
    async poll(): Promise<Envelope[]> {
      const repos = await registry.list();
      const out: Envelope[] = [];

      for (const repo of repos) {
        // Resolve the GitHub API target and local path for this repo.
        const ghRepo = repo.ghRepo ?? repo.name;
        repoPaths.set(ghRepo, repo.path);

        let issues: RawIssue[];
        try {
          const { stdout } = await gh(
            ['issue', 'list', '--assignee', '@me', '--state', 'open', '--json', 'number,title,body,labels', '-R', ghRepo],
            { cwd: repo.path },
          );
          issues = JSON.parse(stdout || '[]') as RawIssue[];
        } catch (err: unknown) {
          // FR-27: a failing repo (auth/availability) is isolated — log and move on.
          const msg = err instanceof Error ? err.message : String(err);
          log(`github-issues: poll failed for ${ghRepo} — ${msg}`);
          continue;
        }

        for (const issue of issues) {
          const sourceRef = `${ghRepo}#${issue.number}`;

          if (labelNames(issue).includes(HANDLED_LABEL)) {
            // FR-35: handled-labelled issues are skipped at capture, except for
            // FR-39 re-eligibility (closed-unmerged spec PR).
            const reopened = await maybeReopen(repo, issue, sourceRef);
            if (reopened) out.push(reopened);
            continue;
          }

          // FR-34: an issue already in the ledger is never re-captured.
          if (await ledger.known(GITHUB_ISSUES_SOURCE, sourceRef)) continue;

          // FR-28: empty issue (no title and no body) is skipped, not captured.
          const text = buildText(issue.title, issue.body);
          if (text === null) {
            log(`github-issues: skipping empty issue ${sourceRef}`);
            continue;
          }

          const envelope = parseEnvelope({
            id: newId(),
            source: GITHUB_ISSUES_SOURCE,
            sourceRef,
            text,
            hintRepo: ghRepo,
            status: 'pending',
            receivedAt: now(),
          });
          await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef });
          out.push(envelope);
        }
      }

      return out;
    },

    // ── report / write-back ─────────────────────────────────────────────────────
    async report(
      sourceRef: string,
      status: EnvelopeStatus,
      meta?: ReportMeta,
    ): Promise<ReportOutcome> {
      const marker = `${sourceRef}\0${status}`;
      if (postedMarkers.has(marker)) return { ok: true }; // FR-38: post once per (sourceRef,status).

      const parsed = parseSourceRef(sourceRef);
      if (!parsed) {
        // Unparseable ref → log and make no gh call (cannot target an issue).
        log(`github-issues: report() ignoring unparseable sourceRef "${sourceRef}"`);
        return { ok: true };
      }
      const { repo, number } = parsed;
      const repoPath = await resolveReportCwd(repo);

      try {
        if (status === 'routed') {
          const body = `Routed to ${meta?.repo ?? '(unresolved)'}`;
          await gh(['issue', 'comment', number, '-R', repo, '--body', body], { cwd: repoPath });
        } else if (status === 'done') {
          const body = `Spec PR opened: ${meta?.prUrl ?? '(unknown)'}`;
          await gh(['issue', 'comment', number, '-R', repo, '--body', body], { cwd: repoPath });
          // Ensure the label exists before applying it (auto-create; ignore "already exists").
          try {
            await gh(['label', 'create', HANDLED_LABEL, '-R', repo], { cwd: repoPath });
          } catch {
            // label already present — not an error.
          }
          await gh(restAddLabelArgs(repo, number, HANDLED_LABEL), { cwd: repoPath });
        } else {
          // No write-back marker for intermediate statuses (pending/deciding).
          return { ok: true };
        }
        postedMarkers.add(marker);
        return { ok: true };
      } catch (err: unknown) {
        // FR-37: write-back is non-fatal. Log with the sourceRef and swallow so a
        // gh outage never rolls back a completed route/spec-PR. Marker is NOT set,
        // so a later poll/report can retry.
        const msg = err instanceof Error ? err.message : String(err);
        log(`github-issues: write-back failed for ${sourceRef} (${status}) — ${msg}`);
        return {
          ok: false,
          remediation: [
            `github-issues write-back failed for ${sourceRef} (${status}): ${msg}`,
          ],
        };
      }
    },
  };
}
