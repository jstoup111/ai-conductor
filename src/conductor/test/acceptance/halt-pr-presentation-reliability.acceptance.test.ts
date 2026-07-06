/**
 * Acceptance specs for `.docs/stories/halt-pr-presentation-reliability.md`
 * (ai-conductor#274, ADR `adr-2026-07-05-halt-pr-presentation-reliability.md`).
 *
 * Per-call-site behavior of `ensureHaltPresentation` (retry/backoff, REST label
 * form, idempotent body write) is unit-level and belongs to
 * `test/engine/pr-labels.test.ts` written during `/pipeline`. This file only
 * covers the cross-module flows explicitly called out in the stories' Done
 * When sections — driving the REAL production entry points (escalation,
 * reconciliation, finish-clear) rather than the new primitives in isolation,
 * per §3b/§3d of writing-system-tests:
 *
 *   A. `escalateBuildFailure` (the real halt-escalation entry point) must
 *      itself route through `ensureHaltPresentation` — not the old bare
 *      `ensureLabel`+`addLabel` pair — so a fresh halt PR's draft/label/marker
 *      are CONFIRMED via a real re-read, not merely fire-and-forget.
 *   B. `reconcileHaltPrs` heals a PR whose label/draft attributes drifted
 *      after escalation (the #268/#269 root cause) without touching an
 *      already-conforming PR or an unmarked ready feature PR.
 *   C. Once a finish clear path removes the body marker, `reconcileHaltPrs`
 *      never re-flags that PR (the D4/D5 convergence guarantee).
 *
 * Pre-implementation: `ensureHaltPresentation` and `reconcileHaltPrs` do not
 * exist yet. Importing them fails with a clear "not yet implemented"
 * assertion (RED for the right reason) until the modules are authored.
 */

import { describe, it, expect } from 'vitest';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { escalateBuildFailure } from '../../src/engine/build-failure-escalation.js';

const PR_LABELS_MOD = '../../src/engine/pr-labels.js';
const RECONCILE_MOD = '../../src/engine/halt-pr-reconciliation.js';

const NEEDS_REMEDIATION_MARKER = '<!-- conductor:needs-remediation -->';
const PR_URL = 'https://github.com/owner/repo/pull/301';
const PR_URL_2 = 'https://github.com/owner/repo/pull/302';
const PR_URL_3 = 'https://github.com/owner/repo/pull/303';

async function loadEnsureHaltPresentation() {
  const mod = await import(PR_LABELS_MOD);
  if (typeof mod.ensureHaltPresentation !== 'function') {
    throw new Error(
      'expected export "ensureHaltPresentation" to be a function on pr-labels.ts (not yet implemented)',
    );
  }
  return mod.ensureHaltPresentation as (
    runGh: GhRunner,
    cwd: string,
    prUrl: string,
    log?: (msg: string) => void,
  ) => Promise<'confirmed' | 'unconfirmed'>;
}

async function loadReconcileHaltPrs() {
  const mod = await import(RECONCILE_MOD);
  if (typeof mod.reconcileHaltPrs !== 'function') {
    throw new Error(
      'expected export "reconcileHaltPrs" to exist in halt-pr-reconciliation.ts (not yet implemented)',
    );
  }
  return mod.reconcileHaltPrs as (opts: {
    projectRoot: string;
    log?: (msg: string) => void;
    runGh: GhRunner;
  }) => Promise<void>;
}

/**
 * In-memory fake GitHub PR store shared by escalation, reconciliation, and
 * finish-clear fakes below, so a single test can drive all three against the
 * SAME evolving PR state rather than re-describing it per call site.
 */
interface FakePr {
  number: number;
  url: string;
  isDraft: boolean;
  labels: string[];
  body: string;
}

function makeGhStore(prs: FakePr[]) {
  const calls: string[][] = [];
  const byUrl = new Map(prs.map((p) => [p.url, p]));
  const find = (url: string): FakePr => {
    const pr = byUrl.get(url);
    if (!pr) throw new Error(`fake gh: unknown PR ${url}`);
    return pr;
  };

  const gh: GhRunner = (async (args: string[]) => {
    calls.push([...args]);

    // `gh pr list --json number,url,body,isDraft,labels --state open ...`
    if (args[0] === 'pr' && args[1] === 'list') {
      return {
        stdout: JSON.stringify(
          prs.map((p) => ({
            number: p.number,
            url: p.url,
            body: p.body,
            isDraft: p.isDraft,
            labels: p.labels.map((name) => ({ name })),
          })),
        ),
      };
    }

    // `gh pr view <url> --json isDraft,labels,body[,state,mergeable,statusCheckRollup]`
    if (args[0] === 'pr' && args[1] === 'view') {
      const url = args[2];
      const pr = find(url);
      return {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          isDraft: pr.isDraft,
          labels: pr.labels.map((name) => ({ name })),
          body: pr.body,
        }),
      };
    }

    // `gh pr create ...` — escalation's findOrCreatePr path; treat as a fresh PR.
    if (args[0] === 'pr' && args[1] === 'create') {
      return { stdout: PR_URL };
    }

    // `gh pr ready --undo <url>` (draft) / `gh pr ready <url>` (undraft).
    if (args[0] === 'pr' && args[1] === 'ready') {
      const url = args[args.length - 1];
      const pr = find(url);
      pr.isDraft = args.includes('--undo');
      return { stdout: '' };
    }

    // REST label add/remove: `gh api ... repos/OWNER/REPO/issues/N/labels [-f ...] / DELETE .../labels/needs-remediation`
    if (args[0] === 'api') {
      const match = args.find((a) => /issues\/\d+\/labels/.test(a));
      const number = match ? Number(match.match(/issues\/(\d+)\//)?.[1]) : undefined;
      const pr = prs.find((p) => p.number === number);
      if (pr) {
        if (args.includes('DELETE')) {
          pr.labels = pr.labels.filter((l) => l !== 'needs-remediation');
        } else if (args.includes('POST') && !pr.labels.includes('needs-remediation')) {
          pr.labels.push('needs-remediation');
        }
      }
      return { stdout: '' };
    }

    // `gh pr edit <url> --body <body>` — body marker add/strip.
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
      const url = args[2];
      const pr = find(url);
      pr.body = args[args.indexOf('--body') + 1];
      return { stdout: '' };
    }

    return { stdout: '' };
  }) as GhRunner;

  return { gh, calls, byUrl, get: (url: string) => find(url) };
}

describe('acceptance: halt-PR presentation reliability (ai-conductor#274)', () => {
  it('Flow A — escalateBuildFailure (real entry point) yields a confirmed draft+label+marker PR, not a fire-and-forget pair', async () => {
    await loadEnsureHaltPresentation();

    const created: FakePr = { number: 301, url: PR_URL, isDraft: true, labels: [], body: '' };
    const { gh, calls } = makeGhStore([created]);

    const runGit: import('../../src/engine/build-failure-escalation.js').EscalateBuildFailureOpts['runGit'] =
      (async (args: string[]) => {
        if (args[0] === 'rev-parse') return { stdout: 'feat/halt-flow\n' };
        if (args[0] === 'symbolic-ref') return { stdout: 'refs/remotes/origin/main\n' };
        if (args[0] === 'merge-base') return { stdout: 'deadbeef\n' };
        if (args[0] === 'rev-list') return { stdout: '3\n' };
        return { stdout: '' };
      }) as never;

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'retries exhausted',
      runGit,
      runGh: gh,
    });

    expect(result.prUrl).toBe(PR_URL);

    // The observable guarantee (§3b): a fresh read-back of the PR this
    // escalation actually touched shows all three attributes present —
    // proving escalation now routes through the verify-after-write helper
    // rather than the old bare ensureLabel+addLabel pair (which never
    // re-reads to confirm).
    const finalPr = created;
    expect(finalPr.isDraft).toBe(true);
    expect(finalPr.labels).toContain('needs-remediation');
    expect(finalPr.body).toContain(NEEDS_REMEDIATION_MARKER);

    // Confirmation requires at least one re-read after the writes, not just
    // the writes themselves.
    const viewCallsAfterWrites = calls.filter((c) => c[0] === 'pr' && c[1] === 'view');
    expect(viewCallsAfterWrites.length).toBeGreaterThan(0);
  });

  it('Flow B — reconcileHaltPrs heals a drifted marked PR, leaves a conforming marked PR untouched, and skips an unmarked ready PR', async () => {
    await loadEnsureHaltPresentation();
    const reconcileHaltPrs = await loadReconcileHaltPrs();

    const broken: FakePr = {
      number: 301,
      url: PR_URL,
      isDraft: false, // drifted: should be draft
      labels: [], // drifted: label lost
      body: `Halt body.\n\n${NEEDS_REMEDIATION_MARKER}`,
    };
    const conforming: FakePr = {
      number: 302,
      url: PR_URL_2,
      isDraft: true,
      labels: ['needs-remediation'],
      body: `Halt body.\n\n${NEEDS_REMEDIATION_MARKER}`,
    };
    const unmarkedReady: FakePr = {
      number: 303,
      url: PR_URL_3,
      isDraft: false,
      labels: [],
      body: 'A completely normal feature PR description.',
    };

    const { gh, calls } = makeGhStore([broken, conforming, unmarkedReady]);

    await reconcileHaltPrs({ projectRoot: '/repo', runGh: gh });

    // Broken PR healed.
    expect(broken.isDraft).toBe(true);
    expect(broken.labels).toContain('needs-remediation');

    // Conforming PR received no mutating calls at all (idempotent no-op).
    const mutatesPr302 = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit') && c.includes(PR_URL_2)) ||
        (c[0] === 'api' && c.some((a) => a.includes('/302/'))),
    );
    expect(mutatesPr302).toHaveLength(0);

    // Unmarked ready PR is never converted to draft or labeled — a normal
    // feature PR must never be caught by the sweep.
    expect(unmarkedReady.isDraft).toBe(false);
    expect(unmarkedReady.labels).not.toContain('needs-remediation');
    const mutatesPr303 = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit') && c.includes(PR_URL_3)) ||
        (c[0] === 'api' && c.some((a) => a.includes('/303/'))),
    );
    expect(mutatesPr303).toHaveLength(0);
  });

  it('Flow C — once a finish clear path strips the body marker, reconcileHaltPrs never re-flags that PR', async () => {
    await loadEnsureHaltPresentation();
    const reconcileHaltPrs = await loadReconcileHaltPrs();

    // A halted PR that has just been finished: label removed, ready, and (per
    // D5) the body marker stripped by the finish clear path.
    const finished: FakePr = {
      number: 301,
      url: PR_URL,
      isDraft: false,
      labels: [],
      body: 'Add retry ladder for model availability.',
    };

    const { gh, calls } = makeGhStore([finished]);

    // `gh pr list` only returns PRs the sweep would enumerate; since the
    // marker is gone, a real `gh pr list --search body:marker`-style filter
    // (or a full list filtered client-side) must exclude it. Model this by
    // asserting reconcileHaltPrs performs zero writes against it either way.
    await reconcileHaltPrs({ projectRoot: '/repo', runGh: gh });

    expect(finished.isDraft).toBe(false);
    expect(finished.labels).not.toContain('needs-remediation');
    expect(finished.body).not.toContain(NEEDS_REMEDIATION_MARKER);

    const mutatingCalls = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit')) ||
        c[0] === 'api',
    );
    expect(mutatingCalls).toHaveLength(0);
  });
});
