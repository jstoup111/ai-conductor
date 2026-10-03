import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyRebaseVerdicts, type GitRunner, type RebaseOutcome } from '../../src/engine/rebase.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { parseRebaseRegradeJudgement } from '../../src/engine/rebase-regrade-judgement.js';
import type { ConductorEvent } from '../../src/types/events.js';

const replayKind = vi.hoisted(() => ({ value: 'changed' as 'changed' | 'unchanged' }));

vi.mock('../../src/engine/rebase-replay.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/rebase-replay.js')>();
  return {
    ...actual,
    compareReplayTree: async (_git: unknown, identity: import('../../src/engine/rebase-replay.js').ReplayIdentity) => ({
      kind: replayKind.value, identity, expectedTree: 'e'.repeat(40), completedTree: 'c'.repeat(40),
    }),
  };
});

// Bound original-judge authority is not under test here; grant it so a gate the
// decision preserves is observable as preserved rather than reopened as unproved.
vi.mock('../../src/engine/gate-code-validity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-code-validity.js')>();
  return {
    ...actual,
    isApplicableOriginalPass: () => true,
    gateVerdictStillValid: async () => 'preserve',
    currentPreservedJudgeIdentity: async () => ({ codeStamp: 'stamp' }),
  };
});

const sha = (c: string) => c.repeat(40);
const outcome: RebaseOutcome = {
  kind: 'changed',
  changedCodePaths: ['src/foreign.ts'],
  featureSurface: ['src/feature.ts'],
  replay: { preRebaseHead: sha('a'), mergeBase: sha('b'), target: sha('d'), completedHead: sha('f') },
} as RebaseOutcome;

const patch = (body: string) =>
  `diff --git a/src/feature.ts b/src/feature.ts\nindex 1..2 100644\n--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -1 +1 @@\n${body}\n`;

const git: GitRunner = async (args) => {
  if (args[0] === 'diff') {
    return { exitCode: 0, stdout: args[3] === sha('b') ? patch('+return 1;') : patch('+return 2;'), stderr: '' };
  }
  return { exitCode: 0, stdout: '', stderr: '' };
};

describe('engine/rebase — post-rebase regrade judgement', () => {
  let projectRoot: string;
  let events: Array<Extract<ConductorEvent, { type: 'rebase_regrade_judged' }>>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rebase-regrade-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    for (const gate of ['prd_audit', 'architecture_review_as_built'] as const) {
      await writeVerdict(projectRoot, gate, { satisfied: true, reason: 'prior PASS', checkedAt: 1 });
    }
    replayKind.value = 'changed';
    events = [];
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const run = (judge?: (prompt: string) => Promise<{ success: boolean; output?: string }>) =>
    applyRebaseVerdicts(projectRoot, outcome, false, undefined, git, {
      ...(judge ? { judge } : {}),
      emit: async (event) => { events.push(event); },
    });

  it('reopens both document-bound gates when the judgement says regrade', async () => {
    const judge = vi.fn(async (_prompt: string) => ({
      success: true,
      output: '{"regrade": true, "gates": ["prd_audit", "architecture_review_as_built"], "rationale": "resolution dropped a branch"}',
    }));

    const result = await run(judge);

    expect(judge).toHaveBeenCalledOnce();
    expect(judge.mock.calls[0]![0]).toContain('+return 2;');
    expect(result.kickedBack).toEqual(expect.arrayContaining(['prd_audit', 'architecture_review_as_built']));
    expect(result.preservedGates ?? []).not.toContain('prd_audit');
    expect(await readVerdict(projectRoot, 'prd_audit')).toMatchObject({ satisfied: false, kickback: { from: 'rebase' } });
    expect(events).toEqual([expect.objectContaining({
      type: 'rebase_regrade_judged', outcome: 'regrade',
      reopened: ['prd_audit', 'architecture_review_as_built'], changedFiles: ['src/feature.ts'],
    })]);
  });

  it('preserves both gates when the judgement says no regrade', async () => {
    const result = await run(async () => ({
      success: true, output: '{"regrade": false, "gates": [], "rationale": "whitespace-only merge"}',
    }));

    expect(result.kickedBack).not.toContain('prd_audit');
    expect(result.kickedBack).not.toContain('architecture_review_as_built');
    expect(result.preservedGates).toEqual(expect.arrayContaining(['prd_audit', 'architecture_review_as_built']));
    expect(await readVerdict(projectRoot, 'prd_audit')).toMatchObject({ satisfied: true });
    expect(events[0]).toMatchObject({ outcome: 'preserve', reopened: [] });
  });

  it.each([
    ['invalid output', async () => ({ success: true, output: '{"regrade": "yes"}' })],
    ['provider failure', async () => ({ success: false, output: 'provider exhausted' })],
    ['thrown dispatch', async () => { throw new Error('boom'); }],
  ])('fails closed and reopens both gates on %s', async (_label, judge) => {
    const result = await run(judge as () => Promise<{ success: boolean; output?: string }>);

    expect(result.kickedBack).toEqual(expect.arrayContaining(['prd_audit', 'architecture_review_as_built']));
    expect(events[0]).toMatchObject({ outcome: 'fail-closed', reopened: ['prd_audit', 'architecture_review_as_built'] });
  });

  it('fails closed when no judge is wired at the seam', async () => {
    const result = await run();
    expect(result.kickedBack).toEqual(expect.arrayContaining(['prd_audit', 'architecture_review_as_built']));
    expect(events[0]).toMatchObject({ outcome: 'fail-closed' });
  });

  it('dispatches no judgement when the replay left the feature contribution unchanged', async () => {
    replayKind.value = 'unchanged';
    const judge = vi.fn(async (_prompt: string) => ({ success: true, output: '{}' }));

    const result = await run(judge);

    expect(judge).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(result.kickedBack).not.toContain('prd_audit');
  });
});

describe('parseRebaseRegradeJudgement', () => {
  const candidates = ['prd_audit', 'architecture_review_as_built'] as const;

  it.each([
    ['regrade true with no gates', '{"regrade": true, "gates": [], "rationale": "x"}'],
    ['regrade false naming gates', '{"regrade": false, "gates": ["prd_audit"], "rationale": "x"}'],
    ['a non-candidate gate', '{"regrade": true, "gates": ["coverage_binding"], "rationale": "x"}'],
    ['an empty rationale', '{"regrade": false, "gates": [], "rationale": " "}'],
    ['an unknown key', '{"regrade": false, "gates": [], "rationale": "x", "extra": 1}'],
    ['no JSON', 'looks fine to me'],
  ])('rejects %s', (_label, output) => {
    expect(parseRebaseRegradeJudgement(output, [...candidates]).ok).toBe(false);
  });
});
