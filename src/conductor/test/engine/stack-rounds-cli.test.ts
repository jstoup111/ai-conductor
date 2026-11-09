// Covers: task:7, task:8
import { describe, expect, it, vi } from 'vitest';

import { dispatchStackRoundsCommand } from '../../src/engine/stack-rounds-cli.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const r4 = parseRoundId('r4')!;
const r2 = parseRoundId('r2')!;

describe('stack rounds CLI', () => {
  it('refuses disabled routing before inspecting route state', async () => {
    const output: string[] = [];
    const readRouteRecord = vi.fn();
    await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-inspect', slug: 'demo' }, {
      cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
      loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: false } }, warnings: [] }),
      readRouteRecord, print: (line: string) => output.push(line),
    } as never)).resolves.toBe(1);
    expect(output.join('\n')).toContain('Routing is disabled');
    expect(readRouteRecord).not.toHaveBeenCalled();
  });

  it('checks, leases, writes, and releases a close in that order', async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const checked = {
      kind: 'supersedable' as const,
      stored: { kind: 'record' as const, slug: 'demo', blob: 'a'.repeat(40), record: { roundId: r4 } },
      supersededBy: parseRoundId('r5')!,
      survivor: { kind: 'record' as const, slug: 'demo', blob: 'b'.repeat(40), record: { roundId: parseRoundId('r5')! } },
      droppedHosts: [2], findingIds: ['f-2'],
    };
    const code = await dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug: 'demo', roundId: 'r4', reason: '  newer round  ' }, {
      cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
      loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
      hasDurableChildState: async () => true,
      resolveOperator: async () => 'operator',
      checkSupersession: async () => { calls.push('check'); return checked; },
      acquireLease: async () => ({ kind: 'acquired', lease: { release: async () => { calls.push('release'); return { ok: true }; } } }),
      supersede: async (input: { readonly reason: string }) => { calls.push(`write:${input.reason}`); return { kind: 'superseded', event: {} } as never; },
      print: (line: string) => output.push(line),
    } as never);
    expect(code).toBe(0);
    expect(calls).toEqual(['check', 'write:newer round', 'release']);
    expect(output.join('\n')).toContain('Clear any HALT with ai-conductor halt clear');
  });

  // Covers: task:12
  it('reports a leaf-return close with its closed host, reason, and HALT recovery', async () => {
    const output: string[] = [];
    const checked = {
      kind: 'leaf-return' as const,
      stored: { kind: 'record' as const, slug: 'demo', blob: 'a'.repeat(40), record: { roundId: r2 } },
      hosts: [1],
    };
    await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug: 'demo', roundId: 'r2', reason: 'fix lands on leaf' }, {
      cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
      loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
      hasDurableChildState: async () => true, resolveOperator: async () => 'operator',
      checkSupersession: async () => checked,
      acquireLease: async () => ({ kind: 'acquired', lease: { release: async () => ({ ok: true }) } }),
      supersede: async () => ({ kind: 'superseded', event: {} } as never),
      print: (line: string) => output.push(line),
    } as never)).resolves.toBe(0);

    expect(output.join('\n')).toContain('leaf return closed r2');
    expect(output.join('\n')).toContain('closed hosts 1');
    expect(output.join('\n')).toContain('reason fix lands on leaf');
    expect(output.join('\n')).toContain('ai-conductor halt clear');
  });

  // Covers: task:12
  it('refuses a blank close reason before acquiring a lease or checking the route', async () => {
    const acquireLease = vi.fn();
    const checkSupersession = vi.fn();
    await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug: 'demo', roundId: 'r2', reason: '  ' }, {
      cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
      loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
      hasDurableChildState: async () => true, resolveOperator: async () => 'operator',
      acquireLease, checkSupersession, print: () => undefined,
    } as never)).resolves.toBe(1);
    expect(acquireLease).not.toHaveBeenCalled();
    expect(checkSupersession).not.toHaveBeenCalled();
  });

  // Covers: task:12
  it('refuses a held lease after checks without writing the close', async () => {
    const output: string[] = [];
    const supersede = vi.fn();
    const checked = {
      kind: 'leaf-return' as const,
      stored: { kind: 'record' as const, slug: 'demo', blob: 'a'.repeat(40), record: { roundId: r2 } },
      hosts: [1],
    };
    await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug: 'demo', roundId: 'r2', reason: 'fix lands on leaf' }, {
      cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
      loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
      hasDurableChildState: async () => true, resolveOperator: async () => 'operator', checkSupersession: async () => checked,
      acquireLease: async () => ({ kind: 'live-owner', owner: { purpose: 'daemon dispatch', pid: 123, host: 'test', processStartTime: '1', token: 'token' } }),
      supersede, print: (line: string) => output.push(line),
    } as never)).resolves.toBe(1);
    expect(supersede).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('feature dispatch lease is held by daemon dispatch');
  });
});
