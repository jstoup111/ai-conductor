// Covers: task:10, task:rem-as-built-rem-as-built-r10, task:rem-as-built-rem-as-built-r16
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectStackLandCommand, type StackLandDispatch } from '../../src/cli.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { dispatchCliEntry } from '../../src/index.js';
import { writeSliceTopologyFixture } from './slice-topology-fixture.js';

const command: StackLandDispatch = {
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
    refs: (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout,
    parks: await tree('.daemon/parked'),
    leases: await tree('.daemon/leases'),
    state: await tree('.pipeline'),
  };
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

  it('refuses predicate failures before identity, lease, or park mutation', async () => {
    const deps = dependencies({ checkOpen: vi.fn().mockResolvedValue({ kind: 'refused', refusal: { kind: 'not-stacked', text: 'not stacked' } }) });

    await expect(dispatchStackLandCommand(command, deps as never)).resolves.toBe(1);

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
