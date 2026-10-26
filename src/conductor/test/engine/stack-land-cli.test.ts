// Covers: task:10, task:rem-as-built-rem-as-built-r10, task:rem-as-built-rem-as-built-r16
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectStackLandCommand, type StackLandDispatch } from '../../src/cli.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { dispatchCliEntry } from '../../src/index.js';

const command: StackLandDispatch = {
  kind: 'stack-land', slug: 'demo', child: '1', carry: [], reason: 'reviewer requested rename',
};

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

  it.each([
    ['flat', true, false, 'Feature demo is not a stacked feature'],
    ['routing disabled', false, true, 'Routing is disabled'],
  ])('refuses %s stacks before any command reads repair refs or creates a lease', async (_name, routingOn, durable, detail) => {
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
        loadConfig: vi.fn().mockResolvedValue({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: routingOn } } }),
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
      if (!routingOn) expect(deps.hasDurableChildState).not.toHaveBeenCalled();
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
