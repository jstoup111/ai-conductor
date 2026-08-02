import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { reconcileMergedPark } from '../../src/engine/park-reconciliation.js';
import { writeOperatorPark } from '../../src/engine/park-marker.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

type EvidenceCase = {
  name: string;
  branches?: string[];
  merged?: string[];
  shipped?: boolean;
  gitFailure?: boolean;
  prHead?: string | null;
  headRelation?: 'ahead' | 'behind';
  tip?: string;
  decision: 'delete' | 'refuse';
  steps: string[];
};

function gitFailure(message: string): Error {
  return Object.assign(new Error(message), { code: 128 });
}

function makeGit({
  branches = [],
  merged = [],
  shipped = false,
  gitFailure: shouldFail,
  headRelation,
  tip,
}: EvidenceCase): GitRunner {
  return vi.fn<GitRunner>(async (args) => {
    if (shouldFail) throw gitFailure('git unavailable');

    switch (args[0]) {
      case 'ls-tree':
        return { stdout: shipped ? 'partition.md\n' : '' };
      case 'for-each-ref':
        return { stdout: `${branches.join('\n')}\n` };
      case 'merge-base':
        // Tasks 3–4 will ask Git to establish this relation before assigning
        // observability detail. Preserve a real graph distinction now so this
        // partition remains a useful safety net for that implementation.
        if (args[3] === 'feat/partition') {
          if (headRelation === 'ahead') return { stdout: '' };
          throw Object.assign(new Error('not an ancestor'), { code: 1 });
        }
        if (merged.includes(args[2])) return { stdout: '' };
        throw Object.assign(new Error('not an ancestor'), { code: 1 });
      case 'rev-parse':
        return { stdout: `${tip ?? 'tip'}\n` };
      case 'worktree':
      case 'branch':
        return { stdout: '' };
      default:
        throw new Error(`unexpected git command: ${args.join(' ')}`);
    }
  });
}

function makeGh(prHead: string | null): GhRunner {
  return vi.fn<GhRunner>(async () => ({
    stdout: prHead === null ? '[]' : JSON.stringify([{ headRefOid: prHead }]),
  }));
}

describe('engine/park-reconciliation — delete/refuse partition', () => {
  it.each<EvidenceCase>([
    {
      name: 'ancestor',
      branches: ['feat/partition'],
      merged: ['feat/partition'],
      shipped: true,
      prHead: null,
      decision: 'delete',
      steps: ['worktree-removed', 'branch-deleted', 'unparked'],
    },
    {
      name: 'merged PR head identity match',
      branches: ['feat/partition'],
      shipped: true,
      tip: 'same-tip',
      prHead: 'same-tip',
      decision: 'delete',
      steps: ['worktree-removed', 'branch-deleted', 'unparked'],
    },
    {
      name: 'branch head ahead of merged PR tip',
      branches: ['feat/partition'],
      shipped: true,
      headRelation: 'ahead',
      tip: 'branch-ahead',
      prHead: 'merged-tip',
      decision: 'refuse',
      steps: [],
    },
    {
      name: 'branch head behind merged PR tip',
      branches: ['feat/partition'],
      shipped: true,
      headRelation: 'behind',
      tip: 'branch-behind',
      prHead: 'merged-tip',
      decision: 'refuse',
      steps: [],
    },
    {
      name: 'no merged PR',
      branches: ['feat/partition'],
      shipped: true,
      prHead: null,
      decision: 'refuse',
      steps: [],
    },
    {
      name: 'git failure',
      gitFailure: true,
      prHead: null,
      decision: 'refuse',
      steps: [],
    },
    {
      name: 'no branch after a shipped record',
      shipped: true,
      prHead: null,
      decision: 'delete',
      steps: ['worktree-removed', 'branch-absent', 'unparked'],
    },
    {
      name: 'record missing despite ancestor evidence',
      branches: ['feat/partition'],
      merged: ['feat/partition'],
      prHead: null,
      decision: 'refuse',
      steps: [],
    },
  ])('$name preserves the current decision', async (scenario) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-decision-partition-'));
    try {
      await writeOperatorPark(projectRoot, 'partition');

      const outcome = await reconcileMergedPark({
        projectRoot,
        slug: 'partition',
        runGit: makeGit(scenario),
        runGh: makeGh(scenario.prHead ?? null),
      });

      expect({
        decision: outcome.refusal === undefined ? 'delete' : 'refuse',
        steps: outcome.steps,
      }).toEqual({
        decision: scenario.decision,
        steps: scenario.steps,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
