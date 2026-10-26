// Covers: task:10
import { describe, expect, it, vi } from 'vitest';

import { detectStackLandCommand, type StackLandDispatch } from '../../src/cli.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';

const command: StackLandDispatch = {
  kind: 'stack-land', slug: 'demo', child: '1', carry: [], reason: 'reviewer requested rename',
};

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
    checkOpen: vi.fn().mockResolvedValue(accepted()),
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
