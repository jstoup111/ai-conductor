import { describe, it, expect } from 'vitest';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { resolveSpecPrUrl } from '../../src/engine/pr-labels.js';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-8, FR-10, FR-12
//
// Acceptance specs for the owner-gated PR write-back boundary. The module
// `src/engine/gate-writeback.ts`
// (plan Tasks 17-19). This drives the REAL write-back orchestrator via a
// dynamic import (following the exact `park-marker.ts` pattern from
// `operator-park-dashboard-precedence.acceptance.test.ts`), exercising it
// end-to-end against the REAL `pr-labels.ts` seam contract (scripted GhRunner
// fakes recording call order — the same style as
// `test/engine/build-failure-escalation.test.ts` — never mocking
// gate-writeback's internals). No real `gh`/`git` binary is ever invoked.
// ─────────────────────────────────────────────────────────────────────────────

const GATE_WRITEBACK_MOD = '../../src/engine/gate-writeback.js';

interface GatedSpecEntry {
  kind: 'spec';
  slug: string;
  reason: 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';
  otherOwner?: string;
  remedy: string;
}

interface GateWritebackDeps {
  runGh?: GhRunner;
  cwd: string;
  log?: (msg: string) => void;
  verbose?: boolean;
}

interface GateWritebackModule {
  announceGatedPr: (
    entry: GatedSpecEntry,
    prUrl: string,
    deps: GateWritebackDeps,
  ) => Promise<void>;
  OWNER_GATED_MARKER: string;
  OWNER_GATED_LABEL: string;
}

async function loadGateWriteback(): Promise<GateWritebackModule> {
  const mod = (await import(GATE_WRITEBACK_MOD)) as Record<string, unknown>;
  if (typeof mod.announceGatedPr !== 'function') {
    throw new Error(
      'expected export "announceGatedPr" from gate-writeback.ts to be a function (not yet implemented)',
    );
  }
  if (typeof mod.OWNER_GATED_MARKER !== 'string' || typeof mod.OWNER_GATED_LABEL !== 'string') {
    throw new Error(
      'expected exports "OWNER_GATED_MARKER"/"OWNER_GATED_LABEL" from gate-writeback.ts (not yet implemented)',
    );
  }
  return mod as unknown as GateWritebackModule;
}

/** Scripted GhRunner: consumes responses in order; records every call's argv. */
function fakeGh(responses: Array<{ stdout: string } | Error>): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  let idx = 0;
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    const response = responses[idx++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { gh, calls };
}

const PR_URL = 'https://github.com/acme/repo/pull/42';

const OTHER_OWNER_ENTRY: GatedSpecEntry = {
  kind: 'spec',
  slug: '2026-07-01-foo',
  reason: 'other-owner',
  otherOwner: 'alice',
  remedy: "declare an Owner: for this spec, or grandfather it via owner_gate_cutover",
};

describe('owner-gate PR write-back acceptance (Covers: FR-8, FR-10, FR-12)', () => {
  it('a newly gated spec with an existing foreign-owner PR leaves no remote label or marker comment', async () => {
    const mod = await loadGateWriteback();
    const { gh, calls } = fakeGh([
      { stdout: '' }, // ensureLabel
      { stdout: '' }, // addLabel (REST)
      { stdout: JSON.stringify({ comments: [] }) }, // upsertComment lookup — no existing marker
      { stdout: '' }, // create comment
    ]);

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' });

    const commentCall = calls.find((c) => c.includes('comment') || c.includes('POST'));
    expect(commentCall).toBeUndefined();
    expect(mod.OWNER_GATED_LABEL).toBe('owner-gated');
    expect(calls.some((c) => c.join(' ').includes(mod.OWNER_GATED_MARKER))).toBe(false);
    expect(calls.some((c) => c.join(' ').includes('alice'))).toBe(false);
  });

  it('the same foreign-owned spec stays free of marker comments across repeated passes', async () => {
    const mod = await loadGateWriteback();

    // First pass observes the foreign PR but does not mutate it.
    const first = fakeGh([
      { stdout: '' },
      { stdout: '' },
      { stdout: JSON.stringify({ comments: [] }) },
      { stdout: '' },
    ]);
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: first.gh, cwd: '/repo' });

    let commentCreateCount = 0;

    // 10 more passes likewise perform no comment creation.
    for (let i = 0; i < 10; i++) {
      const gh: GhRunner = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return {
            stdout: JSON.stringify({
              comments: [{ body: `${mod.OWNER_GATED_MARKER}\nold`, url: `${PR_URL}#issuecomment-9001` }],
            }),
          };
        }
        if (args[0] === 'pr' && args[1] === 'comment') {
          commentCreateCount++;
          return { stdout: '' };
        }
        return { stdout: '' }; // ensureLabel / addLabel / PATCH
      };
      await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' });
    }

    expect(commentCreateCount).toBe(0);
  });

  it('a reason transition leaves the foreign PR untouched', async () => {
    const mod = await loadGateWriteback();
    const patchBodies: string[] = [];
    const gh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return {
          stdout: JSON.stringify({
            comments: [{ body: `${mod.OWNER_GATED_MARKER}\nold reason`, url: `${PR_URL}#issuecomment-9002` }],
          }),
        };
      }
      if (args[0] === 'api' && args.includes('--method') && args.includes('PATCH')) {
        const bodyArg = args.find((a) => a.startsWith('body='));
        if (bodyArg) patchBodies.push(bodyArg);
      }
      return { stdout: '' };
    };

    const transitioned: GatedSpecEntry = { ...OTHER_OWNER_ENTRY, reason: 'other-owner' };
    await mod.announceGatedPr(transitioned, PR_URL, { runGh: gh, cwd: '/repo' });

    expect(patchBodies).toEqual([]);
  });

  it('the spec PR is already MERGED: foreign-owner label + comment still do not apply', async () => {
    const mod = await loadGateWriteback();
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view' && args.some((a) => a.startsWith('state,mergeable,statusCheckRollup,labels'))) {
        return {
          stdout: JSON.stringify({ state: 'MERGED', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }),
        };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    };

    await expect(
      mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' }),
    ).resolves.toBeUndefined();

    const labelAddCall = calls.find(
      (c) => c[0] === 'api' && c.some((a) => a.includes('/labels')) && c.includes('POST'),
    );
    expect(labelAddCall).toBeUndefined();

    const commentCreateCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCreateCall).toBeUndefined();
  });

  it('a foreign-owner PR does not reach the comment-upsert transport, even across scans', async () => {
    const mod = await loadGateWriteback();
    const logs: string[] = [];
    let ghCallCount = 0;
    const gh: GhRunner = async (args) => {
      ghCallCount++;
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        throw new Error('rate limited');
      }
      return { stdout: '' };
    };

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('prMergeState');
    const callsAfterFirstFailure = ghCallCount;
    // A second invocation (simulating the next scan pass) must not compound
    // into an unbounded retry storm within a single pass.
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });
    expect(ghCallCount).toBe(callsAfterFirstFailure * 2);
  });

  it('the marker-comment lookup succeeds but the in-place PATCH fails: NO fallback create is attempted (mirrors upsertComment terminal PATCH semantics)', async () => {
    const mod = await loadGateWriteback();
    let createCommentCalls = 0;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return {
          stdout: JSON.stringify({
            comments: [{ body: `${mod.OWNER_GATED_MARKER}\nold`, url: `${PR_URL}#issuecomment-9003` }],
          }),
        };
      }
      if (args[0] === 'api' && args.includes('PATCH')) {
        throw new Error('PATCH failed');
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        createCommentCalls++;
      }
      return { stdout: '' };
    };

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' });

    expect(createCommentCalls).toBe(0);
  });

  it('no PR exists for the spec branch (local-commit fallback): the PR step is skipped with a logged notice — no findOrCreatePr draft creation', async () => {
    const mod = await loadGateWriteback();
    const logs: string[] = [];
    let anyGhCalled = false;
    const gh: GhRunner = async () => {
      anyGhCalled = true;
      return { stdout: '' };
    };

    // No prUrl available for this gated spec (undefined). The write-back must
    // skip the PR announcement entirely rather than calling findOrCreatePr.
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, undefined as unknown as string, {
      runGh: gh,
      cwd: '/repo',
      log: (m) => logs.push(m),
      verbose: true,
    });

    expect(anyGhCalled).toBe(false);
    expect(logs.some((l) => l.toLowerCase().includes('no pr') || l.toLowerCase().includes('skip'))).toBe(true);
  });

  it('a foreign-owner PR does not attempt label creation or a comment after a hypothetical label race', async () => {
    const mod = await loadGateWriteback();
    let commentPosted = false;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'label' && args[1] === 'create') {
        throw new Error('label already exists (race)');
      }
      if (args[0] === 'api' && args.includes('POST')) {
        throw new Error('422 label already applied');
      }
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        commentPosted = true;
      }
      return { stdout: '' };
    };

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' });

    expect(commentPosted).toBe(false);
  });

  // ── daemon-cli resolution seam (Task 5, remediation for FR-8) ────────────
  //
  // Gated specs are discovered pre-dispatch, so per-slug worktree state is
  // normally absent (see daemon-cli.ts `announceGated`): the PR url is
  // resolved by falling back to `resolveSpecPrUrl(ownerGh, projectRoot,
  // 'spec/<slug>', log)` against origin. These two tests pin that exact
  // fallback seam end-to-end: (a) a resolvable foreign PR stays untouched,
  // (b) no PR on origin never triggers draft PR creation.

  it('a gated spec with NO worktree conduct-state resolves its PR via spec/<slug> from origin without writing its foreign PR', async () => {
    const mod = await loadGateWriteback();
    const slug = '2026-07-02-bar';
    const branch = `spec/${slug}`;
    const comments: Array<{ body: string; url: string }> = [];
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'list' && args.includes('--head') && args.includes(branch)) {
        return { stdout: JSON.stringify([{ url: PR_URL, state: 'MERGED' }]) };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return { stdout: JSON.stringify({ comments }) };
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        comments.push({ body: `${mod.OWNER_GATED_MARKER}\nowner-gated: other-owner (alice)`, url: `${PR_URL}#issuecomment-9101` });
        return { stdout: '' };
      }
      return { stdout: '' }; // ensureLabel / addLabel (POST) / PATCH
    };

    // No per-slug worktree state exists for this spec — the daemon falls
    // back to resolving the PR from origin by its spec/<slug> branch.
    const prUrl = await resolveSpecPrUrl(gh, '/repo', branch);
    expect(prUrl).toBe(PR_URL);

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, prUrl as string, { runGh: gh, cwd: '/repo' });

    const labelAddCall = calls.find(
      (c) => c[0] === 'api' && c.some((a) => a.includes('/labels')) && c.includes('POST'),
    );
    expect(labelAddCall).toBeUndefined();
    expect(calls.filter((c) => c[0] === 'pr' && c[1] === 'comment').length).toBe(0);

    // A second scan pass must not create any remote marker comment either.
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, prUrl as string, { runGh: gh, cwd: '/repo' });
    expect(calls.filter((c) => c[0] === 'pr' && c[1] === 'comment').length).toBe(0);
  });

  it('no PR exists on origin for spec/<slug> (local-commit fallback): resolveSpecPrUrl yields undefined and no draft PR is ever created', async () => {
    const slug = '2026-07-02-baz';
    const branch = `spec/${slug}`;
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'list' && args.includes('--head') && args.includes(branch)) {
        return { stdout: JSON.stringify([]) };
      }
      return { stdout: '' };
    };

    const prUrl = await resolveSpecPrUrl(gh, '/repo', branch);

    expect(prUrl).toBeUndefined();
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(false);
  });
});
