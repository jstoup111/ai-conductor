// Covers: task:10, task:rem-as-built-rem-as-built-r10, task:rem-as-built-rem-as-built-r16, task:31
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectStackLandCommand, type StackLandOpenDispatch } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { openOperatorRound } from '../../src/engine/routing/operator-round.js';
import { readRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { dispatchCliEntry } from '../../src/index.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture, type SliceTopologyFixture } from './slice-topology-fixture.js';

const command: StackLandOpenDispatch = {
  kind: 'stack-land', slug: 'demo', child: '1', carry: [], reason: 'reviewer requested rename',
};

const execFile = promisify(execFileCallback);
const haltRoots: string[] = [];

afterEach(async () => {
  await Promise.all(haltRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function accepted(carry: readonly { child: number; tip: string }[] = []) {
  return {
    kind: 'accepted' as const,
    topology: { kind: 'sliced', positions: [1, 2, 3] },
    host: 1,
    closure: 'a'.repeat(40),
    carried: carry,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const release = vi.fn().mockResolvedValue({ ok: true });
  return {
    resolveMainRoot: vi.fn().mockResolvedValue('/main'),
    resolveWorktree: vi.fn().mockResolvedValue('/worktree'),
    loadConfig: vi.fn().mockResolvedValue({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } } }),
    hasDurableChildState: vi.fn().mockResolvedValue(true),
    loadTopology: vi.fn().mockResolvedValue({ kind: 'sliced', positions: [1, 2, 3] }),
    checkOpen: vi.fn().mockResolvedValue(accepted()),
    readRepairMarker: vi.fn(),
    readRouteRecord: vi.fn(),
    resolveOperator: vi.fn().mockResolvedValue('operator@example.test'),
    acquireLease: vi.fn().mockResolvedValue({ kind: 'acquired', lease: { release } }),
    createPark: vi.fn().mockResolvedValue({ created: false }),
    nextRound: vi.fn().mockResolvedValue('r1'),
    openRound: vi.fn().mockResolvedValue({ kind: 'opened', pinnedBase: 'a'.repeat(40) }),
    clearHalt: vi.fn().mockResolvedValue(undefined),
    print: vi.fn(),
    release,
    ...overrides,
  };
}

async function routingDisabledStackedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'stack-land-routing-disabled-'));
  haltRoots.push(root);
  const git = (args: string[]) => execFile('git', args, { cwd: root });
  const commit = async (message: string, path: string, contents: string) => {
    await writeFile(join(root, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack-land@example.invalid']);
  await git(['config', 'user.name', 'Stack land']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await commit('configure routing off', '.ai-conductor/config.yml', [
    'stacked_prs:',
    '  enabled: true',
    '  route_whole_feature_fixes: false',
    '',
  ].join('\n'));
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await commit('closed child', 'child.txt', 'child\n');
  const childTip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', 'refs/conductor/demo/closed/c1', childTip]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { one: 1, two: 2 }, titles: ['Child', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  });
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), '{"build":"done"}\n');
  await writeFile(join(root, '.pipeline', 'task-status.json'), '{"task":"done"}\n');
  await mkdir(join(root, '.daemon', 'parked'), { recursive: true });
  await writeFile(join(root, '.daemon', 'parked', 'demo'), 'park-token\n');
  await mkdir(join(root, '.daemon', 'leases', 'existing'), { recursive: true });
  await writeFile(join(root, '.daemon', 'leases', 'existing', 'owner.json'), JSON.stringify({
    host: 'other-host', pid: 123, processStartTime: '1', token: 'existing-token', purpose: 'existing command',
  }));
  const tip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await Promise.all([
    git(['update-ref', 'refs/conductor/demo/routes/r1', tip]),
    git(['update-ref', 'refs/conductor/demo/repairing/c1', tip]),
    git(['update-ref', 'refs/conductor/demo/revalidate/c2', tip]),
  ]);
  return { root, git };
}

async function stackLandStateSnapshot(root: string, git: (args: string[]) => ReturnType<typeof execFile>) {
  const tree = async (path: string): Promise<Record<string, string>> => {
    try {
      const base = join(root, path);
      const entries = await readdir(base, { recursive: true, withFileTypes: true });
      const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
        const relative = join(entry.parentPath.slice(base.length + 1), entry.name);
        return [relative, await readFile(join(base, relative), 'utf8')] as const;
      }));
      return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  };
  return {
    branch: (await git(['symbolic-ref', '--short', 'HEAD'])).stdout,
    status: (await git(['status', '--porcelain'])).stdout,
    refs: (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout,
    parks: await tree('.daemon/parked'),
    leases: await tree('.daemon/leases'),
    state: await tree('.pipeline'),
  };
}

type RealStackFixture = Awaited<ReturnType<typeof realStackFixture>>;

/** A real local-Git stack, deliberately entered from its daemon leaf. */
async function realStackFixture(options: {
  readonly existingHostCommit?: boolean;
  readonly noOwnedCriteria?: boolean;
  readonly positions?: 2 | 3;
  readonly existingSecondCommit?: boolean;
} = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'stack-land-cli-real-'));
  haltRoots.push(repo);
  const git = makeGitRunner(repo);
  const positions = options.positions ?? 2;
  const c1 = parseChildId(1)!;
  const c2 = parseChildId(2)!;
  const commit = async (message: string, path: string, contents: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '--no-verify', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack-land-cli@example.invalid']);
  await git(['config', 'user.name', 'Stack land CLI']);
  await commit('base', '.gitignore', '.pipeline/\n.daemon/\n');
  await commit('routing enabled', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  const topology: SliceTopologyFixture = {
    slug: 'demo', materializeTopologyCommit: true,
    sliceMembership: positions === 2
      ? { taskSlices: { one: 1, leaf: 2 }, titles: ['one', 'leaf'] }
      : { taskSlices: { one: 1, two: 2, leaf: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: options.noOwnedCriteria ? { S1: 2 } : { S1: 1 },
  };
  await writeSliceTopologyFixture(repo, topology);
  await sealSliceTopologyPositions(repo, topology);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closure1 = await commit('closed child one', 'one.txt', 'one\n');
  await git(['update-ref', closureRefFor('demo', c1), closure1]);
  if (options.existingHostCommit) await commit('reviewer commit', 'review.txt', 'review\n');
  let secondTip: string | undefined;
  if (positions === 3) {
    await git(['checkout', '-qb', 'feat/c2/demo', closure1]);
    const closure2 = await commit('closed child two', 'two.txt', 'two\n');
    await git(['update-ref', closureRefFor('demo', c2), closure2]);
    if (options.existingSecondCommit) secondTip = await commit('reviewer commit two', 'review-two.txt', 'review\n');
  }
  const leaf = positions === 2 ? 'feat/daemon-demo' : 'feat/c3/demo';
  await git(['checkout', '-qb', leaf, closure1]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  if (!options.noOwnedCriteria) await writeFile(join(repo, '.pipeline', 'children', '1', 'acceptance-specs-run.json'), '{}\n');
  return { repo, git, closure1, leaf, secondTip };
}

async function realSnapshot(subject: RealStackFixture) {
  const files = async (path: string): Promise<Record<string, string>> => {
    try {
      const base = join(subject.repo, path);
      const entries = await readdir(base, { recursive: true, withFileTypes: true });
      return Object.fromEntries(await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => [
        join(entry.parentPath.slice(base.length + 1), entry.name), await readFile(join(base, entry.parentPath.slice(base.length + 1), entry.name), 'utf8'),
      ] as const)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  };
  return {
    branch: (await subject.git(['symbolic-ref', '--short', 'HEAD'])).stdout,
    status: (await subject.git(['status', '--porcelain'])).stdout,
    refs: (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout,
    park: await files('.daemon/parked'), lease: await files('.daemon/leases'), state: await files('.pipeline'),
  };
}

async function land(subject: RealStackFixture, commandOverride: Partial<Omit<StackLandOpenDispatch, 'kind'>> = {}, deps: Record<string, unknown> = {}, output: string[] = []) {
  return dispatchStackLandCommand({ ...command, ...commandOverride }, {
    cwd: subject.repo,
    resolveMainRoot: async () => subject.repo,
    resolveWorktree: async () => subject.repo,
    resolveOperator: async () => 'operator@example.test',
    print: (line: string) => output.push(line),
    ...deps,
  } as never);
}

async function soleOperatorRecord(subject: RealStackFixture) {
  const routes = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/'])).stdout.split('\n').filter(Boolean);
  expect(routes).toHaveLength(1);
  const stored = await readRouteRecord(subject.repo, 'demo', 'r1' as never, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('missing operator route record');
  return stored.record;
}

describe('stack land CLI open path', () => {
  // Covers: task:10
  it('refuses stack land from a daemon session before the handler can mutate anything', async () => {
    const dispatch = vi.fn(async () => 0);

    await expect(dispatchCliEntry({
      argv: ['node', 'ai-conductor', 'stack', 'land', '--slug', 'demo', '--child', '1', '--reason', 'reviewer request'],
      environment: { [DAEMON_SESSION_MARKER]: '1' },
      dispatch,
      emitRefusal: vi.fn(),
      diagnostic: vi.fn(),
    })).resolves.toEqual({ exitCode: 1, refused: true });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('parses only the complete open grammar, including repeated --carry', () => {
    expect(detectStackLandCommand([
      'node', 'ai-conductor', 'stack', 'land', '--slug', 'demo', '--child', '1',
      '--carry', '2', '--carry', '3', '--reason', 'reviewer request',
    ])).toEqual({ kind: 'stack-land', slug: 'demo', child: '1', carry: ['2', '3'], reason: 'reviewer request' });
    expect(detectStackLandCommand(['node', 'ai-conductor', 'stack', 'land', '--slug', 'demo', '--child', '1', '--done'])).toBeNull();
    expect(detectStackLandCommand(['node', 'ai-conductor', 'stack', 'land', '--slug', '../demo', '--child', '1', '--reason', 'why'])).toBeNull();
  });

  it.each([
    ['a clean closed child', {}],
    ['a child with a pre-existing reviewer commit', { existingHostCommit: true }],
    ['a child with no owned criteria', { noOwnedCriteria: true }],
  ] as const)('opens %s under the real lease and leaves one operator round on child 1', async (_case, fixtureOptions) => {
    const subject = await realStackFixture(fixtureOptions);
    const ownerPids: number[] = [];
    const observeOwner = async () => {
      const owner = JSON.parse(await readFile(join(subject.repo, '.daemon', 'leases', 'demo', 'owner.json'), 'utf8')) as { pid: number; purpose: string };
      expect(owner).toMatchObject({ pid: process.pid, purpose: 'stack land' });
      ownerPids.push(owner.pid);
    };
    const output: string[] = [];

    expect(await land(subject, {}, {
      acquireLease: async (root: string, slug: string, purpose: string) => {
        const acquired = await acquireFeatureDispatchLease(root, slug, purpose);
        if (acquired.kind === 'acquired') await observeOwner();
        return acquired;
      },
    }, output), output.join('\n')).toBe(0);

    expect((await subject.git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim()).toBe('feat/c1/demo');
    expect(await soleOperatorRecord(subject)).toMatchObject({ kind: 'operator', phase: 'open', operator: { origin: 'land' } });
    expect(ownerPids).not.toEqual([]);
    await expect(readFile(join(subject.repo, '.daemon', 'leases', 'demo', 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8')).resolves.toContain('owned-park-token:');
  });

  it('re-runs a marker-transaction crash exactly once and retains its original park and operator round', async () => {
    const subject = await realStackFixture({ existingHostCommit: true });
    let transactions = 0;
    const crashingGit: GitRunner = async (args, options) => {
      const result = await subject.git(args, options);
      if (args[0] === 'update-ref' && args[1] === '--stdin' && ++transactions === 2) throw new Error('crash after marker transaction');
      return result;
    };
    await expect(land(subject, {}, {
      openRound: (input: Parameters<typeof openOperatorRound>[0]) => openOperatorRound({ ...input, git: crashingGit }),
    })).resolves.toBe(1);
    const crashedPark = await readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8');

    const recoveryOutput: string[] = [];
    expect(await land(subject, {}, {}, recoveryOutput), recoveryOutput.join('\n')).toBe(0);

    expect((await subject.git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim()).toBe('feat/c1/demo');
    expect(await soleOperatorRecord(subject)).toMatchObject({ kind: 'operator', phase: 'open' });
    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8')).resolves.toBe(crashedPark);
    await expect(readFile(join(subject.repo, '.daemon', 'leases', 'demo', 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a live lease owner without altering refs, parks, state, or its owner record', async () => {
    const subject = await realStackFixture();
    const held = await acquireFeatureDispatchLease(subject.repo, 'demo', 'other operator command');
    if (held.kind !== 'acquired') throw new Error('could not acquire live lease');
    const before = await realSnapshot(subject);
    const output: string[] = [];

    await expect(land(subject, {}, {}, output)).resolves.toBe(1);

    expect(output.join('\n')).toContain(`other operator command (pid ${process.pid})`);
    expect(await realSnapshot(subject)).toEqual(before);
    await held.lease.release();
  });

  it('carries child 2 only when requested and clears only the matching unlanded-closed-child HALT', async () => {
    const carried = await realStackFixture({ positions: 3, existingSecondCommit: true });
    const halt = join(carried.repo, '.pipeline', 'HALT');
    const haltClass = join(carried.repo, '.pipeline', 'HALT.class');
    await writeFile(halt, 'unlanded-closed-child-commits: children 1, 2\n');
    await writeFile(haltClass, 'needs-human\n');

    const carriedOutput: string[] = [];
    expect(await land(carried, { carry: ['2'] }, {}, carriedOutput), carriedOutput.join('\n')).toBe(0);
    expect((await soleOperatorRecord(carried)).operator?.carried.map((entry) => entry.child)).toEqual([2]);
    await expect(readFile(halt, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(haltClass, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const hostOnly = await realStackFixture();
    const hostHalt = join(hostOnly.repo, '.pipeline', 'HALT');
    await writeFile(hostHalt, 'unlanded-closed-child-commits: child 1\n');
    await writeFile(join(hostOnly.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    const hostOutput: string[] = [];
    expect(await land(hostOnly, {}, {}, hostOutput), hostOutput.join('\n')).toBe(0);
    await expect(readFile(hostHalt, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const refused = await realStackFixture({ positions: 3, existingSecondCommit: true });
    const refusedHalt = join(refused.repo, '.pipeline', 'HALT');
    const refusedBody = 'unlanded-closed-child-commits: children 1, 2\n';
    await writeFile(refusedHalt, refusedBody);
    const output: string[] = [];
    await expect(land(refused, {}, {}, output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('--carry 2');
    await expect(readFile(refusedHalt, 'utf8')).resolves.toBe(refusedBody);
  });

  it.each([
    ['published stack', 'published-stack #3268'],
    ['leaf host', 'child 3 is the leaf'],
    ['undeclared position', 'declared: 1, 2, 3'],
    ['open round', 'routing round r1 is already open'],
    ['queue', 'revalidation queue has child 2 open'],
    ['journal', 'restack journal is open'],
    ['dirty worktree', 'worktree has uncommitted changes'],
    ['missing verify-green contract', 'no verify-green contract'],
    ['uncarried child', 'carry it with ai-conductor stack land --slug demo --child 1 --carry 2'],
    ['carried child below host', 'ai-conductor stack land --child 1 --carry 2'],
  ] as const)('preserves the real feature byte-for-byte when the open predicate refuses %s', async (_case, detail) => {
    const subject = await realStackFixture({ positions: 3 });
    const before = await realSnapshot(subject);
    const output: string[] = [];

    await expect(land(subject, { child: detail.includes('below host') ? '2' : '1', carry: detail.includes('below host') ? ['1'] : [] }, {
      checkOpen: async () => ({ kind: 'refused' as const, refusal: { kind: 'not-stacked' as const, text: detail } }),
    }, output)).resolves.toBe(1);

    expect(output.join('\n')).toContain(detail);
    expect(await realSnapshot(subject)).toEqual(before);
    expect(before.branch.trim()).toBe('feat/c3/demo');
  });

  it('refuses empty and whitespace-only reasons before it can acquire a lease or alter a feature', async () => {
    for (const reason of ['', '   ']) {
      const subject = await realStackFixture();
      const before = await realSnapshot(subject);
      const output: string[] = [];
      await expect(land(subject, { reason }, {}, output)).resolves.toBe(1);
      expect(output.join('\n')).toContain('non-empty --reason');
      expect(await realSnapshot(subject)).toEqual(before);
    }
  });

  it('does not reclaim an unreadable lease owner', async () => {
    const subject = await realStackFixture();
    const owner = join(subject.repo, '.daemon', 'leases', 'demo', 'owner.json');
    await mkdir(dirname(owner), { recursive: true });
    await writeFile(owner, '{not-json}\n');
    const before = await realSnapshot(subject);
    const output: string[] = [];

    await expect(land(subject, {}, {}, output)).resolves.toBe(1);

    expect(output.join('\n')).toMatch(/lease owner is unreadable/i);
    expect(await realSnapshot(subject)).toEqual(before);
  });

  it('opens while leased, carries the predicate result, preserves an existing park, and releases the lease', async () => {
    const deps = dependencies({ checkOpen: vi.fn().mockResolvedValue(accepted([{ child: 2, tip: 'b'.repeat(40) }])) });

    await expect(dispatchStackLandCommand({ ...command, carry: ['2'] }, deps as never)).resolves.toBe(0);

    expect(deps.acquireLease).toHaveBeenCalledWith('/main', 'demo', 'stack land');
    expect(deps.checkOpen).toHaveBeenCalledTimes(1);
    expect(deps.openRound).toHaveBeenCalledWith(expect.objectContaining({
      roundId: 'r1', host: 1, carried: [{ child: 2, tip: 'b'.repeat(40) }], operator: 'operator@example.test',
    }));
    expect(deps.clearHalt).toHaveBeenCalledWith('/worktree');
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it('clears an unlanded HALT only when the landing admits every named child', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'stack-land-halt-'));
    haltRoots.push(worktree);
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    const halt = join(worktree, '.pipeline', 'HALT');
    const haltClass = join(worktree, '.pipeline', 'HALT.class');
    const body = [
      'unlanded-closed-child-commits: children 1, 2',
      'ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"',
      '',
    ].join('\n');
    await writeFile(halt, body);
    await writeFile(haltClass, 'needs-human\n');

    const childOnly = dependencies({
      resolveWorktree: vi.fn().mockResolvedValue(worktree),
      clearHalt: undefined,
    });
    await expect(dispatchStackLandCommand(command, childOnly as never)).resolves.toBe(0);
    await expect(readFile(halt, 'utf8')).resolves.toBe(body);
    await expect(readFile(haltClass, 'utf8')).resolves.toBe('needs-human\n');

    const carried = dependencies({
      resolveWorktree: vi.fn().mockResolvedValue(worktree),
      checkOpen: vi.fn().mockResolvedValue(accepted([{ child: 2, tip: 'b'.repeat(40) }])),
      clearHalt: undefined,
    });
    await expect(dispatchStackLandCommand({ ...command, carry: ['2'] }, carried as never)).resolves.toBe(0);
    await expect(readFile(halt, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(haltClass, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records an owned-park token only when this command created the park', async () => {
    const deps = dependencies({ createPark: vi.fn().mockResolvedValue({ created: true, token: 'token' }) });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(0);

    expect(deps.openRound).toHaveBeenCalledWith(expect.objectContaining({ park: { token: 'token' } }));
  });

  it('resumes only the same post-marker landing instead of opening another round', async () => {
    const deps = dependencies({
      checkOpen: vi.fn().mockResolvedValue({ kind: 'refused', refusal: { kind: 'round-open', text: 'round is open' } }),
      readRepairMarker: vi.fn().mockResolvedValue({ kind: 'marker', marker: { roundId: 'r1', host: 1 } }),
      readRouteRecord: vi.fn().mockResolvedValue({
        kind: 'record', record: {
          kind: 'operator', operator: { origin: 'land', reason: command.reason, carried: [{ child: 2, tip: 'b'.repeat(40) }] },
        },
      }),
    });

    await expect(dispatchStackLandCommand({ ...command, carry: ['2'] }, deps as never)).resolves.toBe(0);

    expect(deps.nextRound).not.toHaveBeenCalled();
    expect(deps.openRound).toHaveBeenCalledWith(expect.objectContaining({
      roundId: 'r1', host: 1, carried: [{ child: 2, tip: 'b'.repeat(40) }],
    }));
  });

  it.each([
    ['routing-off stack', 'Routing is disabled by stacked_prs.route_whole_feature_fixes'],
  ])('refuses a %s before identity, lease, or park mutation', async (_case, text) => {
    const deps = dependencies({ checkOpen: vi.fn().mockResolvedValue({ kind: 'refused', refusal: { kind: 'not-stacked', text } }) });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(1);

    expect(deps.resolveOperator).not.toHaveBeenCalled();
    expect(deps.acquireLease).not.toHaveBeenCalled();
    expect(deps.createPark).not.toHaveBeenCalled();
    expect(deps.print).toHaveBeenCalledWith(expect.stringContaining(text));
  });

  it('refuses a flat feature before the routing predicate, identity, lease, or park mutation', async () => {
    const deps = dependencies({ loadTopology: vi.fn().mockResolvedValue({ kind: 'unsliced' }) });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(1);

    expect(deps.checkOpen).not.toHaveBeenCalled();
    expect(deps.resolveOperator).not.toHaveBeenCalled();
    expect(deps.acquireLease).not.toHaveBeenCalled();
    expect(deps.createPark).not.toHaveBeenCalled();
    expect(deps.print).toHaveBeenCalledWith(expect.stringContaining('not stacked'));
  });

  it('refuses a routing-disabled stacked fixture through the production setting guard before reading routing refs or mutating durable state', async () => {
    const { root, git } = await routingDisabledStackedFixture();
    const checkOpen = vi.fn().mockRejectedValue(new Error('routes, repairing, and revalidate refs must not be read'));
    const readRepairMarker = vi.fn();
    const readRouteRecord = vi.fn();
    const before = await stackLandStateSnapshot(root, git);

    for (const stackLandCommand of [
      command,
      { kind: 'stack-land-done' as const, slug: 'demo' },
      { kind: 'stack-land-abandon' as const, slug: 'demo' },
    ]) {
      const output: string[] = [];
      await expect(dispatchStackLandCommand(stackLandCommand, {
        cwd: root,
        resolveMainRoot: async () => root,
        resolveWorktree: async () => root,
        checkOpen,
        readRepairMarker,
        readRouteRecord,
        print: (line) => output.push(line),
      })).resolves.toBe(1);

      expect(output.join('\n')).toContain('stacked_prs.route_whole_feature_fixes');
    }
    expect(checkOpen).not.toHaveBeenCalled();
    expect(readRepairMarker).not.toHaveBeenCalled();
    expect(readRouteRecord).not.toHaveBeenCalled();
    expect(await stackLandStateSnapshot(root, git)).toEqual(before);
    await expect(readdir(join(root, '.daemon', 'leases'))).resolves.toEqual(['existing']);
    await expect(readFile(join(root, '.daemon', 'leases', 'demo', 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['flat', false],
  ])('refuses %s stacks before any command reads repair refs or creates a lease', async (_name, durable) => {
    const root = await mkdtemp(join(tmpdir(), 'stack-land-ineligible-'));
    haltRoots.push(root);
    for (const stackLandCommand of [
      command,
      { kind: 'stack-land-done' as const, slug: 'demo' },
      { kind: 'stack-land-abandon' as const, slug: 'demo' },
    ]) {
      const readRepairMarker = vi.fn();
      const deps = dependencies({
        resolveMainRoot: vi.fn().mockResolvedValue(root),
        resolveWorktree: vi.fn().mockResolvedValue(root),
        loadConfig: vi.fn().mockResolvedValue({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } } }),
        hasDurableChildState: vi.fn().mockResolvedValue(durable),
        readRepairMarker,
      });

      await expect(dispatchStackLandCommand(stackLandCommand, deps as never)).resolves.toBe(1);

      expect(deps.checkOpen).not.toHaveBeenCalled();
      expect(readRepairMarker).not.toHaveBeenCalled();
      expect(deps.readRouteRecord).not.toHaveBeenCalled();
      expect(deps.nextRound).not.toHaveBeenCalled();
      expect(deps.acquireLease).not.toHaveBeenCalled();
      expect(deps.createPark).not.toHaveBeenCalled();
      await expect(readdir(join(root, '.daemon', 'leases'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('reports a live owner and does not park or open a round', async () => {
    const deps = dependencies({
      acquireLease: vi.fn().mockResolvedValue({
        kind: 'live-owner', owner: { purpose: 'daemon re-kick', pid: 42, host: 'host', processStartTime: '1', token: 'token' },
      }),
    });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(1);

    expect(deps.createPark).not.toHaveBeenCalled();
    expect(deps.openRound).not.toHaveBeenCalled();
    expect(deps.print).toHaveBeenCalledWith(expect.stringContaining('daemon re-kick (pid 42)'));
  });

  it('keeps a new park for recovery when opening refuses, then releases the lease', async () => {
    const deps = dependencies({
      createPark: vi.fn().mockResolvedValue({ created: true, token: 'token' }),
      openRound: vi.fn().mockResolvedValue({ kind: 'refused', detail: 'marker race' }),
    });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(1);

    expect(deps.release).toHaveBeenCalledTimes(1);
  });
});
