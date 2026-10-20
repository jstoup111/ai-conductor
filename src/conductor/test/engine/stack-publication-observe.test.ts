// Covers: task:4, task:rem-as-built-rem-v3-preassembly-verify, task:rem-prd-audit-rem-prd-audit-rem-v4-phase-aware-leaf-base
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import type { ActiveChildResolution } from '../../src/engine/child-cursor.js';
import { advanceFinishPublication, type PublicationSnapshot } from '../../src/engine/finish-publication.js';
import { observeStackDimension } from '../../src/engine/stack-publication.js';
import type { PublicationRecord } from '../../src/engine/stack-publication-record.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;
const repository = 'acme/demo';

const durableCursor: ActiveChildResolution = {
  kind: 'active', child: c5, position: c5, isLeaf: true, branch: 'feat/daemon-demo',
};

const members = [
  { position: c1, branch: 'feat/c1/demo', pr: 101 },
  { position: c3, branch: 'feat/c3/demo', pr: 103 },
  { position: c5, branch: 'feat/daemon-demo', pr: 500 },
] as const;
const tips: Record<string, string> = {
  'feat/c1/demo': '1'.repeat(40),
  'feat/c3/demo': '3'.repeat(40),
  'feat/daemon-demo': '5'.repeat(40),
};

interface Fixture {
  readonly gitArgs: string[][];
  readonly ghArgs: string[][];
  readonly dependencies: Parameters<typeof observeStackDimension>[3];
  setRecord(record: PublicationRecord): void;
}

function fixture(options: {
  readonly positions?: readonly number[];
  readonly record?: PublicationRecord;
  readonly memberStates?: Readonly<Record<number, 'OPEN' | 'CLOSED' | 'MERGED'>>;
  readonly memberDrafts?: Readonly<Record<number, boolean>>;
  readonly memberBases?: Readonly<Record<number, string>>;
  readonly memberHeads?: Readonly<Record<number, string>>;
  readonly stackRead?: 'ok' | 'timeout';
} = {}): Fixture {
  const gitArgs: string[][] = [];
  const ghArgs: string[][] = [];
  const positions = options.positions ?? [1, 3, 5];
  let record = options.record;
  const publicationBlob = 'a'.repeat(40);
  const git = async (args: string[]) => {
    gitArgs.push(args);
    if (args[0] === 'cat-file' && args[2] === 'refs/conductor/demo/positions') {
      return { exitCode: 0, stdout: JSON.stringify(positions) };
    }
    if (args[0] === 'rev-parse' && args.at(-1) === 'refs/conductor/demo/publication') {
      return record === undefined ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: `${publicationBlob}\n` };
    }
    if (args[0] === 'rev-parse' && args.at(-1)?.startsWith('refs/conductor/demo/pushed/')) {
      const branch = args.at(-1)!.replace('refs/conductor/demo/pushed/', '');
      return tips[branch] ? { exitCode: 0, stdout: `${tips[branch]}\n` } : { exitCode: 1, stdout: '' };
    }
    if (args[0] === 'cat-file' && args[2] === publicationBlob) {
      return { exitCode: 0, stdout: JSON.stringify(record) };
    }
    return { exitCode: 1, stdout: '' };
  };
  const gh = async (args: string[]) => {
    ghArgs.push(args);
    if (args[0] === 'pr') {
      const number = Number(args[2]);
      const state = options.memberStates?.[number] ?? 'OPEN';
      const isDraft = options.memberDrafts?.[number] ?? true;
      const member = members.find((candidate) => candidate.pr === number)!;
      const index = members.indexOf(member);
      const baseRefName = index === members.length - 1
        ? record?.retarget?.phase === 'observed'
          ? members[index - 1]!.branch
          : record?.retarget?.from ?? 'main'
        : index === 0
          ? record?.retarget?.from ?? 'main'
          : members[index - 1]!.branch;
      return { stdout: JSON.stringify({
        state,
        isDraft,
        headRefOid: options.memberHeads?.[number] ?? tips[member.branch],
        baseRefName: options.memberBases?.[number] ?? baseRefName,
      }) };
    }
    if (args[0] === 'api') {
      if (options.stackRead === 'timeout') throw new Error('timed out');
      return { stdout: JSON.stringify([{ number: record?.stack?.number, pull_requests: members.map((member) => ({
        number: member.pr, head: { sha: tips[member.branch] },
      })) }]) };
    }
    throw new Error(`unexpected gh argv: ${args.join(' ')}`);
  };
  return { gitArgs, ghArgs, dependencies: { git, gh, repository }, setRecord(next) { record = next; } };
}

function record(overrides: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    version: 1,
    members,
    ...overrides,
  };
}

describe('observeStackDimension', () => {
  it('uses the already-resolved no-child cursor without running another command', async () => {
    const subject = fixture();

    await expect(observeStackDimension('/worktree', 'demo', { kind: 'no-child' }, subject.dependencies))
      .resolves.toBe('not-applicable');

    expect([subject.gitArgs, subject.ghArgs]).toEqual([[], []]);
  });

  it('does not read GitHub or write a publication ref for a one-position feature', async () => {
    const subject = fixture({ positions: [1] });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('not-applicable');

    expect(subject.ghArgs).toEqual([]);
    expect(subject.gitArgs.some((args) => args[0] === 'ls-remote' || args[0] === 'update-ref')).toBe(false);
  });

  it('uses sealed positions even after stacked_prs is disabled', async () => {
    const subject = fixture();

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('members-missing');
  });

  it('returns members-missing with no active publication record', async () => {
    const subject = fixture();

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('members-missing');
  });

  it('returns unassembled while all members exist but the stack is unverified', async () => {
    const subject = fixture({ record: record({ stack: { number: 42, verified: false } }) });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('unassembled');
  });

  it('accepts the retained leaf on its predecessor after the journal records an observed retarget', async () => {
    const subject = fixture({ record: record({
      retarget: { from: 'main', to: 'feat/c3/demo', phase: 'observed' },
      stack: { number: 42, verified: false },
    }) });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('unassembled');
  });

  it('dispatches child establishment then assembly for a valid three-member stack', async () => {
    const subject = fixture();
    const transitions: string[] = [];
    const observe = async (): Promise<PublicationSnapshot> => ({
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid', branchPushed: 'valid',
      pr: { identity: 'one', url: 'https://github.com/acme/demo/pull/500', prose: 'accepted', ready: false },
      shippedRecord: 'valid', outcomeRecord: 'missing',
      stack: await observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies),
    });
    const effects = {
      dispatchJudgment: async () => ({ kind: 'accepted' }),
      establishChildPrs: async () => {
        transitions.push('establish_child_prs');
        subject.setRecord(record({ stack: { number: 42, verified: false } }));
      },
      assembleStack: async () => {
        transitions.push('assemble_stack');
        subject.setRecord(record({ stack: { number: 42, verified: true } }));
      },
    };

    await advanceFinishPublication({ observe, effects: effects as never });
    await advanceFinishPublication({ observe, effects: effects as never });

    expect(transitions).toEqual(['establish_child_prs', 'assemble_stack']);
  });

  it('returns diverged for a retained leaf on an unexpected base before stack assembly', async () => {
    const subject = fixture({
      record: record({ stack: { number: 42, verified: false } }),
      memberBases: { 500: 'release' },
    });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('diverged');
  });

  it('returns diverged for a changed draft member before stack assembly', async () => {
    const subject = fixture({
      record: record({ stack: { number: 42, verified: false } }),
      memberHeads: { 103: 'd'.repeat(40) },
    });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('diverged');

    expect(subject.ghArgs.some((args) => args[0] === 'api')).toBe(false);
  });

  it('returns valid only after it observes a verified stack', async () => {
    const subject = fixture({ record: record({ stack: { number: 42, verified: true } }) });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('valid');
  });

  it('returns diverged when an observed member is closed', async () => {
    const subject = fixture({
      record: record({ stack: { number: 42, verified: true } }),
      memberStates: { 103: 'CLOSED' },
    });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('diverged');
  });

  it('returns diverged when an unverified member was made ready before stack verification', async () => {
    const subject = fixture({
      record: record({ stack: { number: 42, verified: false } }),
      memberDrafts: { 103: false },
    });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('diverged');
  });

  it('returns indeterminate when its stack read times out', async () => {
    const subject = fixture({
      record: record({ stack: { number: 42, verified: true } }),
      stackRead: 'timeout',
    });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('indeterminate');
  });

  it('ignores a torn-down record so a reused slug starts with missing members', async () => {
    const subject = fixture({ record: record({ tornDown: true }) });

    await expect(observeStackDimension('/worktree', 'demo', durableCursor, subject.dependencies))
      .resolves.toBe('members-missing');
    expect(subject.ghArgs).toEqual([]);
  });
});
