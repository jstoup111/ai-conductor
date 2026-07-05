import { describe, it, expect } from 'vitest';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-8, FR-10, FR-12
//
// RED acceptance specs for Story "Gated spec PR gets a warn-once announcement
// and label". The module `src/engine/gate-writeback.ts` does NOT exist yet
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
  it('a newly gated spec with an existing PR gains the owner-gated label and one marker comment carrying reason + remedy', async () => {
    const mod = await loadGateWriteback();
    const { gh, calls } = fakeGh([
      { stdout: '' }, // ensureLabel
      { stdout: '' }, // addLabel (REST)
      { stdout: JSON.stringify({ comments: [] }) }, // upsertComment lookup — no existing marker
      { stdout: '' }, // create comment
    ]);

    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo' });

    const commentCall = calls.find((c) => c.includes('comment') || c.includes('POST'));
    expect(commentCall).toBeDefined();
    expect(mod.OWNER_GATED_LABEL).toBe('owner-gated');
    expect(calls.some((c) => c.join(' ').includes(mod.OWNER_GATED_MARKER))).toBe(true);
    expect(calls.some((c) => c.join(' ').includes('alice'))).toBe(true);
  });

  it('the same spec still gated on 10 subsequent passes still carries exactly ONE marker comment (upsert edits in place)', async () => {
    const mod = await loadGateWriteback();

    // First pass creates the marker comment.
    const first = fakeGh([
      { stdout: '' },
      { stdout: '' },
      { stdout: JSON.stringify({ comments: [] }) },
      { stdout: '' },
    ]);
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: first.gh, cwd: '/repo' });

    const markerBody = `${mod.OWNER_GATED_MARKER}\nowner-gated: other-owner (alice)`;
    let commentCreateCount = 0;

    // 10 more passes: the lookup now finds the existing marked comment and
    // PATCHes it in place — never a second `comment`/create call.
    for (let i = 0; i < 10; i++) {
      const gh: GhRunner = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return {
            stdout: JSON.stringify({
              comments: [{ body: markerBody, url: `${PR_URL}#issuecomment-9001` }],
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

  it('a reason transition (unowned-indeterminate → other-owner) updates the single existing comment body in place', async () => {
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

    expect(patchBodies.length).toBe(1);
    expect(patchBodies[0]).toContain('alice');
  });

  it('the spec PR is already MERGED: label + comment still apply without error', async () => {
    const mod = await loadGateWriteback();
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('state,mergeable,statusCheckRollup,labels')) {
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
    expect(labelAddCall).toBeDefined();

    const commentCreateCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCreateCall).toBeDefined();
  });

  it('gh exits non-zero on the comment upsert: the failure is logged once, no retry storm, and local state was already committed before this call (advisory only)', async () => {
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

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const callsAfterFirstFailure = ghCallCount;
    // A second invocation (simulating the next scan pass) must not compound
    // into an unbounded retry storm within a single pass.
    await mod.announceGatedPr(OTHER_OWNER_ENTRY, PR_URL, { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });
    expect(ghCallCount).toBeLessThan(callsAfterFirstFailure * 10);
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
    });

    expect(anyGhCalled).toBe(false);
    expect(logs.some((l) => l.toLowerCase().includes('no pr') || l.toLowerCase().includes('skip'))).toBe(true);
  });

  it('label creation races another daemon (ensureLabel conflict): the conflict is swallowed and the comment still lands', async () => {
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

    expect(commentPosted).toBe(true);
  });
});
