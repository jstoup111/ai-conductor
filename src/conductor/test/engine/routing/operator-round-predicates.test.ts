// Covers: task:8
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { checkOpenOperatorRound } from '../../../src/engine/routing/operator-round.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import type { GitRunner } from '../../../src/engine/rebase.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const sha = 'a'.repeat(40);

type Result = Awaited<ReturnType<typeof checkOpenOperatorRound>>;

function sliced(storyOwnership: Readonly<Record<string, number>> = { S1: 1 }): object {
  return {
    kind: 'sliced',
    positions: [1, 2, 3],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['one', 'two', 'three'] },
    storyOwnership,
    stackEligibility: { kind: 'eligible' },
  };
}

function readOnlyGit(overrides: Partial<Record<string, { exitCode: number; stdout: string; stderr: string }>> = {}) {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (overrides[key]) return overrides[key]!;
    if (args[0] === 'rev-parse' && args.at(-1)?.startsWith('refs/conductor/demo/closed/c')) {
      return { exitCode: 0, stdout: `${sha}\n`, stderr: '' };
    }
    if (args[0] === 'show-ref') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

function deps(options: {
  readonly topology?: object;
  readonly published?: boolean;
  readonly open?: boolean;
  readonly marker?: object;
  readonly queue?: object;
  readonly journal?: object;
  readonly fence?: boolean;
  readonly routeOn?: boolean;
  readonly acceptanceContract?: boolean;
  readonly git?: GitRunner;
} = {}) {
  const defaultGit = options.git ?? readOnlyGit().git;
  const readMarker = vi.fn().mockResolvedValue(options.marker ?? { kind: 'absent' });
  const readQueue = vi.fn().mockResolvedValue(options.queue ?? { kind: 'absent' });
  const readJournal = vi.fn().mockResolvedValue(options.journal ?? { kind: 'missing' });
  return {
    git: defaultGit,
    loadSliceTopology: vi.fn().mockResolvedValue(options.topology ?? sliced()),
    publishedStackRefusal: vi.fn().mockResolvedValue(options.published ?? false),
    routedRoundOpen: vi.fn().mockResolvedValue(options.open ?? false),
    routingFenceOpen: vi.fn().mockReturnValue(options.fence ?? true),
    readRepairMarker: readMarker,
    readRevalidationQueue: readQueue,
    readRestackJournal: readJournal,
    loadConfig: vi.fn().mockResolvedValue({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: options.routeOn ?? true } } }),
    access: vi.fn().mockImplementation(async () => {
      if (!options.acceptanceContract) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
  };
}

async function check(child = c1, overrides: Parameters<typeof deps>[0] = {}, reason = 'reviewer request'): Promise<Result> {
  return checkOpenOperatorRound({ worktree: '/fixture', slug: 'demo', child, carry: [], reason }, deps(overrides));
}

function refused(result: Result, kind: string): void {
  expect(result).toMatchObject({ kind: 'refused', refusal: { kind } });
  if (result.kind === 'refused') expect(result.refusal.text).toContain('ai-conductor stack land');
}

describe('operator round open predicate', () => {
  it('returns the topology and stack admission refusal set with actionable text', async () => {
    refused(await check(c1, { published: true }), 'published-stack');
    refused(await check(c3), 'leaf-target');
    refused(await check(parseChildId(4)!), 'unknown-position');
    refused(await check(c1, { topology: { kind: 'unavailable', cause: 'plan-invalid' } }), 'topology-unavailable');
    refused(await check(c1, { topology: { kind: 'unsliced' } }), 'not-stacked');
    refused(await check(c1, { routeOn: false }), 'routing-off');

    const unknown = await check(parseChildId(4)!);
    if (unknown.kind === 'refused') expect(unknown.refusal.text).toContain('1, 2, 3');
    const leaf = await check(c3);
    if (leaf.kind === 'refused') expect(leaf.refusal.text).toContain('child 3');
    const unavailable = await check(c1, { topology: { kind: 'unavailable', cause: 'plan-invalid' } });
    if (unavailable.kind === 'refused') expect(unavailable.refusal.text).toContain('#3365');
    const published = await check(c1, { published: true });
    if (published.kind === 'refused') expect(published.refusal.text).toContain('#3268');
  });

  it('refuses an open child without a closure ref and does not mutate its inputs', async () => {
    const { git, calls } = readOnlyGit({
      ['rev-parse -q --verify refs/conductor/demo/closed/c1']: { exitCode: 1, stdout: '', stderr: '' },
    });
    refused(await check(c1, { git }), 'target-open');
    expect(calls.every((args) => !['update-ref', 'commit', 'checkout', 'reset'].includes(args[0]!))).toBe(true);
  });

  it('keeps durable routing inputs and dirty worktree state unchanged for state refusals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operator-round-predicate-'));
    const state = join(root, 'state.json');
    const park = join(root, 'park');
    try {
      await writeFile(state, '{"route":"unchanged"}\n');
      await writeFile(park, 'operator-park\n');
      const before = await Promise.all([readFile(state, 'utf8'), readFile(park, 'utf8')]);
      refused(await check(c1, { marker: { kind: 'marker', marker: { roundId: 'r1', host: c1 } }, open: true }), 'round-open');
      refused(await check(c1, { queue: { kind: 'queue', queue: { entries: [{ child: c2 }] } }, open: true }), 'queue-non-empty');
      refused(await check(c1, { journal: { kind: 'journal' }, fence: false }), 'journal-open');
      const { git } = readOnlyGit({ ['status --porcelain']: { exitCode: 0, stdout: ' M dirty.txt\n', stderr: '' } });
      refused(await check(c1, { git }), 'dirty-worktree');
      expect(await Promise.all([readFile(state, 'utf8'), readFile(park, 'utf8')])).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires a nonblank reason', async () => {
    for (const reason of ['', '  \n\t ']) {
      const result = await checkOpenOperatorRound({ worktree: '/fixture', slug: 'demo', child: c1, carry: [], reason }, deps());
      refused(result, 'reason-missing');
    }
  });

  it('requires a verify-green contract only when the child owns criteria', async () => {
    refused(await check(c1, { acceptanceContract: false }), 'verify-green-contract-missing');
    await expect(check(c1, { topology: sliced({ S2: 2 }), acceptanceContract: false })).resolves.toMatchObject({ kind: 'accepted' });
  });

  it('requires each post-closure child to be carried above the host', async () => {
    const postClosure = {
      ['rev-list aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..refs/heads/feat/c2/demo']: { exitCode: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' },
      [`diff-tree --no-commit-id --name-only -r ${'b'.repeat(40)}`]: { exitCode: 0, stdout: 'src/change.ts\n', stderr: '' },
    };
    const { git } = readOnlyGit(postClosure);
    const uncarried = await check(c1, { git });
    refused(uncarried, 'uncarried-commits');
    if (uncarried.kind === 'refused') {
      expect(uncarried.refusal.text).toContain('child 2');
      expect(uncarried.refusal.text).toContain('ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"');
    }

    const carriedBelow = await checkOpenOperatorRound({ worktree: '/fixture', slug: 'demo', child: c2, carry: [c1], reason: 'why' }, deps({ git }));
    refused(carriedBelow, 'carried-below-host');
    if (carriedBelow.kind === 'refused') expect(carriedBelow.refusal.text).toContain('stack land --child 1 --carry 2');
  });

  it('does not consult routing or lease state for a flat feature', async () => {
    const subject = deps({ topology: { kind: 'unsliced' } });
    refused(await checkOpenOperatorRound({ worktree: '/fixture', slug: 'demo', child: c1, carry: [], reason: 'why' }, subject), 'not-stacked');
    expect(subject.routedRoundOpen).not.toHaveBeenCalled();
    expect(subject.readRepairMarker).not.toHaveBeenCalled();
    expect(subject.readRevalidationQueue).not.toHaveBeenCalled();
    expect(subject.readRestackJournal).not.toHaveBeenCalled();
  });
});
