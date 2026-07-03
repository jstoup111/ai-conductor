// Test: deterministic dependency-edge parser (issue-dep-migration.ts)
//
// Task 22 scope ONLY: given an issue's source ref + body prose, deterministically
// parse "Gated on #N", "Depends on: #N[ / #M ...]", and "Blocked by #N" into
// blocked_by edges — the issue whose body is being parsed is always the one
// that is BLOCKED (it needs the referenced issue done first).
//
// Explicitly out of scope here (later tasks):
//   - manual-review classification for ambiguous/reverse/cross-repo prose (Task 23)
//   - writing the edges to the platform / confirm flow (Tasks 24-25)

import { describe, it, expect } from 'vitest';
import {
  parseDependencyEdges,
  parseDependencyProse,
  createDependencyLinks,
} from '../../../src/engine/engineer/issue-dep-migration.js';
import type { DependencyEdge, GhRunner } from '../../../src/engine/engineer/issue-dep-migration.js';

describe('parseDependencyEdges', () => {
  it('parses "Gated on #217" into a blocked_by edge', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#230',
      body: 'This work is Gated on #217 landing first.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#230', target: 'acme/app#217', kind: 'gated-on', blocked_by: true },
    ]);
  });

  it('parses "Depends on: #189 / #190" into two blocked_by edges', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#231',
      body: 'Depends on: #189 / #190 before we can start.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#231', target: 'acme/app#189', kind: 'depends-on', blocked_by: true },
      { source: 'acme/app#231', target: 'acme/app#190', kind: 'depends-on', blocked_by: true },
    ]);
  });

  it('parses "Blocked by #226" into a blocked_by edge', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#232',
      body: 'Blocked by #226 — do not start early.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#232', target: 'acme/app#226', kind: 'blocked-by', blocked_by: true },
    ]);
  });

  it('parses "Depends on #189" (no colon) the same as the colon form', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#240',
      body: 'Depends on #189 for the shared schema.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#240', target: 'acme/app#189', kind: 'depends-on', blocked_by: true },
    ]);
  });

  it('parses a real-shaped multi-line body with several patterns present', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#241',
      body: [
        'Summary: rollout of the new intake path.',
        '',
        'Gated on #217 landing first.',
        'Also Blocked by #226 — do not start early.',
      ].join('\n'),
    });
    expect(edges).toEqual([
      { source: 'acme/app#241', target: 'acme/app#217', kind: 'gated-on', blocked_by: true },
      { source: 'acme/app#241', target: 'acme/app#226', kind: 'blocked-by', blocked_by: true },
    ]);
  });

  it('yields no edges for unrecognized prose', () => {
    expect(
      parseDependencyEdges({ ref: 'acme/app#233', body: 'This issue is a Blocker for #226 (reverse direction).' }),
    ).toEqual([]);
  });

  it('yields no edges for cross-repo references', () => {
    expect(
      parseDependencyEdges({ ref: 'acme/app#234', body: 'Related work tracked at owner/other#5 (cross-repo).' }),
    ).toEqual([]);
  });

  it('yields no edges for a plain task-list mention of an issue number', () => {
    expect(
      parseDependencyEdges({
        ref: 'acme/app#228',
        body: 'Umbrella phase task list:\n- [ ] #217 wave A\n- [ ] #218 wave B\n',
      }),
    ).toEqual([]);
  });

  it('yields no edges for a body with no dependency prose at all', () => {
    expect(parseDependencyEdges({ ref: 'acme/app#299', body: 'Just a normal feature description.' })).toEqual([]);
  });
});

// Task 23 (FR-10 negatives): prose that CANNOT be auto-converted into an edge
// must be flagged for manual review instead of silently dropped.
describe('parseDependencyProse (manual-review classification)', () => {
  it('flags reverse-direction "Blocker for #N" as manual-review, not an edge', () => {
    const result = parseDependencyProse({
      ref: 'acme/app#233',
      body: 'This issue is a Blocker for #226 (reverse direction).',
    });
    expect(result.edges).toEqual([]);
    expect(result.manualReview).toEqual([
      {
        source: 'acme/app#233',
        target: 'acme/app#226',
        reason: 'reverse-direction',
        excerpt: expect.stringContaining('Blocker for #226'),
      },
    ]);
  });

  it('flags cross-repo references as manual-review', () => {
    const result = parseDependencyProse({
      ref: 'acme/app#234',
      body: 'Related work tracked at owner/other#5 (cross-repo).',
    });
    expect(result.edges).toEqual([]);
    expect(result.manualReview).toEqual([
      {
        source: 'acme/app#234',
        target: 'owner/other#5',
        reason: 'cross-repo',
        excerpt: expect.stringContaining('owner/other#5'),
      },
    ]);
  });

  it('flags task-list phase mentions as manual-review', () => {
    const result = parseDependencyProse({
      ref: 'acme/app#228',
      body: 'Umbrella phase task list:\n- [ ] Phase A wave rollout\n- [ ] Phase B follow-up\n',
    });
    expect(result.edges).toEqual([]);
    expect(result.manualReview).toEqual([
      {
        source: 'acme/app#228',
        target: null,
        reason: 'task-list-phase',
        excerpt: expect.stringContaining('Phase A wave rollout'),
      },
      {
        source: 'acme/app#228',
        target: null,
        reason: 'task-list-phase',
        excerpt: expect.stringContaining('Phase B follow-up'),
      },
    ]);
  });

  it('still yields an edge for prose referencing a closed issue (status does not block parsing)', () => {
    const result = parseDependencyProse({
      ref: 'acme/app#232',
      body: 'Blocked by #226 — do not start early.',
      sourceStatus: 'closed',
    });
    expect(result.edges).toEqual([
      { source: 'acme/app#232', target: 'acme/app#226', kind: 'blocked-by', blocked_by: true },
    ]);
    expect(result.manualReview).toEqual([]);
  });

  it('combines auto edges and manual-review items from the same body', () => {
    const result = parseDependencyProse({
      ref: 'acme/app#241',
      body: ['Gated on #217 landing first.', 'This is a Blocker for #226 too.'].join('\n'),
    });
    expect(result.edges).toEqual([
      { source: 'acme/app#241', target: 'acme/app#217', kind: 'gated-on', blocked_by: true },
    ]);
    expect(result.manualReview).toEqual([
      {
        source: 'acme/app#241',
        target: 'acme/app#226',
        reason: 'reverse-direction',
        excerpt: expect.stringContaining('Blocker for #226'),
      },
    ]);
  });
});

// Task 24 (FR-10 confirm-negative / FR-11 happy): the writer is a
// GET-before-POST, additive-only pattern — it never edits/closes/deletes,
// and re-running it against edges that already exist is a no-op write-wise.
describe('createDependencyLinks (writer)', () => {
  interface Call {
    args: string[];
    cwd: string;
  }

  /** A fake gh: GET returns `existing` (per source repo/number key), records every call. */
  function makeGh(existing: Record<string, { number: number; repository_url: string }[]>): {
    gh: GhRunner;
    calls: Call[];
  } {
    const calls: Call[] = [];
    const gh: GhRunner = async (args, opts) => {
      calls.push({ args: [...args], cwd: opts.cwd });
      const path = args.find((a) => a.includes('/dependencies/blocked_by'));
      if (args[1] !== '--method' && path) {
        // GET
        return { stdout: JSON.stringify(existing[path] ?? []) };
      }
      return { stdout: '' };
    };
    return { gh, calls };
  }

  const edge: DependencyEdge = {
    source: 'acme/app#230',
    target: 'acme/app#217',
    kind: 'gated-on',
    blocked_by: true,
  };

  it('dryRun=true (operator declines): GETs to check, but issues zero POST calls', async () => {
    const { gh, calls } = makeGh({});
    const results = await createDependencyLinks([edge], { gh, cwd: '/repo', dryRun: true });

    expect(results).toEqual([{ edge, status: 'dry-run' }]);
    expect(calls.every((c) => !c.args.includes('POST'))).toBe(true);
    expect(calls.length).toBe(1); // exactly the GET, no writes
  });

  it('confirmed (dryRun=false): POSTs only the missing edge; existing links are reported already-present, not re-POSTed', async () => {
    const already: DependencyEdge = {
      source: 'acme/app#230',
      target: 'acme/app#999',
      kind: 'depends-on',
      blocked_by: true,
    };
    const { gh, calls } = makeGh({
      'repos/acme/app/issues/230/dependencies/blocked_by': [
        { number: 999, repository_url: 'https://api.github.com/repos/acme/app' },
      ],
    });

    const results = await createDependencyLinks([edge, already], { gh, cwd: '/repo' });

    expect(results).toEqual([
      { edge, status: 'created' },
      { edge: already, status: 'already-present' },
    ]);

    const posts = calls.filter((c) => c.args.includes('POST'));
    expect(posts.length).toBe(1);
    expect(posts[0].args).toContain('repos/acme/app/issues/230/dependencies/blocked_by');
    expect(posts[0].args).toContain('issue_number=217');
  });

  it('never issues an edit/close/label/delete mutation — the only write is create-link POST', async () => {
    const { gh, calls } = makeGh({});
    await createDependencyLinks([edge], { gh, cwd: '/repo' });

    const mutating = calls.filter((c) => c.args.includes('--method'));
    expect(mutating.length).toBe(1);
    expect(mutating[0].args).toContain('POST');
    expect(mutating[0].args).not.toContain('PATCH');
    expect(mutating[0].args).not.toContain('DELETE');
    // No edit/close/label verbs anywhere in any call this module ever issues.
    for (const call of calls) {
      expect(call.args.join(' ')).not.toMatch(/\b(edit|close|label|delete)\b/i);
    }
  });

  it('re-running against a fully-existing graph performs zero POSTs (safe, idempotent)', async () => {
    const { gh, calls } = makeGh({
      'repos/acme/app/issues/230/dependencies/blocked_by': [
        { number: 217, repository_url: 'https://api.github.com/repos/acme/app' },
      ],
    });

    const results = await createDependencyLinks([edge], { gh, cwd: '/repo' });

    expect(results).toEqual([{ edge, status: 'already-present' }]);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });
});
