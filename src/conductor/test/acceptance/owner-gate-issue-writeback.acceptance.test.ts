import { describe, it, expect } from 'vitest';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { parseSourceRef } from '../../src/engine/engineer/issue-ref.js';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-9, FR-10, FR-12
//
// RED acceptance specs for Story "Intake-originated gated specs announce on
// the Source-Ref issue". The module `src/engine/gate-writeback.ts` does NOT
// exist yet (plan Task 20). This drives the REAL orchestrator end-to-end
// against the REAL `parseSourceRef` (the single parse source per
// `engine/engineer/issue-ref.ts` — never a new regex, per the story's Done
// When) and a scripted `GhRunner` fake, following the same pattern as
// `owner-gate-pr-writeback.acceptance.test.ts` and the park-marker dynamic-
// import template.
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
  announceGatedIssue: (
    entry: GatedSpecEntry,
    sourceRef: string | undefined,
    deps: GateWritebackDeps,
  ) => Promise<void>;
  announceGatedPr: (
    entry: GatedSpecEntry,
    prUrl: string,
    deps: GateWritebackDeps,
  ) => Promise<void>;
  OWNER_GATED_MARKER: string;
}

async function loadGateWriteback(): Promise<GateWritebackModule> {
  const mod = (await import(GATE_WRITEBACK_MOD)) as Record<string, unknown>;
  for (const name of ['announceGatedIssue', 'announceGatedPr'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from gate-writeback.ts to be a function (not yet implemented)`,
      );
    }
  }
  if (typeof mod.OWNER_GATED_MARKER !== 'string') {
    throw new Error('expected export "OWNER_GATED_MARKER" from gate-writeback.ts (not yet implemented)');
  }
  return mod as unknown as GateWritebackModule;
}

const INDETERMINATE_ENTRY: GatedSpecEntry = {
  kind: 'spec',
  slug: '2026-06-30-intake-thing',
  reason: 'unowned-indeterminate',
  remedy: 'set owner_gate_cutover to grandfather this spec',
};

describe('owner-gate Source-Ref issue write-back acceptance (Covers: FR-9, FR-10, FR-12)', () => {
  it('a gated spec whose committed marker carries Source-Ref: owner/repo#42 gets the same marker-comment upsert on issue #42', async () => {
    const mod = await loadGateWriteback();

    // Sanity-check we're using the REAL, single parse source (never a new regex).
    expect(parseSourceRef('acme/repo#42')).toEqual({ repo: 'acme/repo', number: '42' });

    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    };

    await mod.announceGatedIssue(INDETERMINATE_ENTRY, 'acme/repo#42', { runGh: gh, cwd: '/repo' });

    const touchedIssue42 = calls.some((c) => c.join(' ').includes('42'));
    expect(touchedIssue42).toBe(true);
    expect(calls.some((c) => c.join(' ').includes(mod.OWNER_GATED_MARKER))).toBe(true);
  });

  it('a gated spec with NO intake marker (chat-originated, sourceRef undefined) skips the issue step silently — no gh call, no error', async () => {
    const mod = await loadGateWriteback();
    let ghCalled = false;
    const gh: GhRunner = async () => {
      ghCalled = true;
      return { stdout: '' };
    };

    await expect(
      mod.announceGatedIssue(INDETERMINATE_ENTRY, undefined, { runGh: gh, cwd: '/repo' }),
    ).resolves.toBeUndefined();
    expect(ghCalled).toBe(false);
  });

  it('a malformed Source-Ref ("not-a-ref") skips the issue step with a logged notice — never a gh call with garbage arguments', async () => {
    const mod = await loadGateWriteback();
    expect(parseSourceRef('not-a-ref')).toBeNull(); // real parser confirms malformed

    let ghCalled = false;
    const gh: GhRunner = async () => {
      ghCalled = true;
      return { stdout: '' };
    };
    const logs: string[] = [];

    await mod.announceGatedIssue(INDETERMINATE_ENTRY, 'not-a-ref', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

    expect(ghCalled).toBe(false);
    expect(logs.some((l) => l.includes('nothing to announce on an issue') && l.includes('no usable Source-Ref'))).toBe(true);
  });

  it('the referenced issue is CLOSED: the comment still posts (commenting closed issues is valid)', async () => {
    const mod = await loadGateWriteback();
    let commentPosted = false;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ state: 'CLOSED', comments: [] }) };
      }
      if (args[0] === 'issue' && args[1] === 'comment') {
        commentPosted = true;
      }
      return { stdout: '' };
    };

    await mod.announceGatedIssue(INDETERMINATE_ENTRY, 'acme/repo#7', { runGh: gh, cwd: '/repo' });

    expect(commentPosted).toBe(true);
  });

  it('the issue comment fails but the PR comment succeeded: the PR announcement is not rolled back and the pass completes (per-surface independence)', async () => {
    const mod = await loadGateWriteback();

    const prGh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    };
    await expect(
      mod.announceGatedPr(INDETERMINATE_ENTRY, 'https://github.com/acme/repo/pull/1', { runGh: prGh, cwd: '/repo' }),
    ).resolves.toBeUndefined();

    const issueGh: GhRunner = async (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        throw new Error('issue gh failure');
      }
      return { stdout: '' };
    };
    // Completing normally (not throwing) is the assertion: a failed issue
    // announcement must never propagate as an unhandled rejection that would
    // abort the pass, and must never "undo" the PR announcement above.
    await expect(
      mod.announceGatedIssue(INDETERMINATE_ENTRY, 'acme/repo#9', { runGh: issueGh, cwd: '/repo' }),
    ).resolves.toBeUndefined();
  });

  it('the same gated issue still gated on 10 subsequent passes still carries exactly ONE marker comment (upsert edits in place, mirrors PR path)', async () => {
    const mod = await loadGateWriteback();
    const markedUrl = 'https://github.com/acme/repo/issues/42#issuecomment-8001';
    const markerBody = `${mod.OWNER_GATED_MARKER}\nold reason`;

    let commentCreateCount = 0;
    let patchCount = 0;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            comments: [{ body: markerBody, url: markedUrl }],
          }),
        };
      }
      if (args[0] === 'issue' && args[1] === 'comment') {
        commentCreateCount++;
        return { stdout: '' };
      }
      if (args[0] === 'api' && args.includes('--method') && args.includes('PATCH')) {
        patchCount++;
        return { stdout: '' };
      }
      return { stdout: '' };
    };

    for (let i = 0; i < 10; i++) {
      await mod.announceGatedIssue(INDETERMINATE_ENTRY, 'acme/repo#42', { runGh: gh, cwd: '/repo' });
    }

    expect(commentCreateCount).toBe(0);
    expect(patchCount).toBe(10);
  });

  it('a reason transition (unowned-indeterminate → other-owner) on the issue updates the SAME existing comment in place, no new create', async () => {
    const mod = await loadGateWriteback();
    const markedUrl = 'https://github.com/acme/repo/issues/9#issuecomment-8002';
    const patchBodies: string[] = [];
    let commentCreateCount = 0;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            comments: [{ body: `${mod.OWNER_GATED_MARKER}\nold reason`, url: markedUrl }],
          }),
        };
      }
      if (args[0] === 'api' && args.includes('--method') && args.includes('PATCH')) {
        const bodyArg = args.find((a) => a.startsWith('body='));
        if (bodyArg) patchBodies.push(bodyArg);
        return { stdout: '' };
      }
      if (args[0] === 'issue' && args[1] === 'comment') {
        commentCreateCount++;
      }
      return { stdout: '' };
    };

    const transitioned: GatedSpecEntry = {
      ...INDETERMINATE_ENTRY,
      reason: 'other-owner',
      otherOwner: 'bob',
    };
    await mod.announceGatedIssue(transitioned, 'acme/repo#9', { runGh: gh, cwd: '/repo' });

    expect(patchBodies.length).toBe(1);
    expect(patchBodies[0]).toContain('bob');
    expect(commentCreateCount).toBe(0);
  });

  it('the marker-comment lookup succeeds but the in-place PATCH fails on the issue: NO fallback create is attempted (terminal PATCH semantics)', async () => {
    const mod = await loadGateWriteback();
    const markedUrl = 'https://github.com/acme/repo/issues/11#issuecomment-8003';
    let createCommentCalls = 0;
    const gh: GhRunner = async (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            comments: [{ body: `${mod.OWNER_GATED_MARKER}\nold`, url: markedUrl }],
          }),
        };
      }
      if (args[0] === 'api' && args.includes('PATCH')) {
        throw new Error('PATCH failed');
      }
      if (args[0] === 'issue' && args[1] === 'comment') {
        createCommentCalls++;
      }
      return { stdout: '' };
    };

    await mod.announceGatedIssue(INDETERMINATE_ENTRY, 'acme/repo#11', { runGh: gh, cwd: '/repo' });

    expect(createCommentCalls).toBe(0);
  });

  it('repo-level warnings (identity unresolved / no cutover) never trigger a GitHub write for the issue step (dashboard/status-only)', async () => {
    const mod = await loadGateWriteback();
    let ghCalled = false;
    const gh: GhRunner = async () => {
      ghCalled = true;
      return { stdout: '' };
    };

    const repoWarningEntry = {
      kind: 'repo' as const,
      warning: 'identity-unresolved' as const,
      remedy: 'authenticate gh',
    };

    // A repo-kind entry has no slug/sourceRef to announce against — the
    // write-back orchestrator must recognize this and never call gh for it.
    await mod.announceGatedIssue(
      repoWarningEntry as unknown as GatedSpecEntry,
      undefined,
      { runGh: gh, cwd: '/repo' },
    );

    expect(ghCalled).toBe(false);
  });
});
