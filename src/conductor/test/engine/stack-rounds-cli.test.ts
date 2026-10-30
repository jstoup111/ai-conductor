// Covers: task:7, task:8
import { describe, expect, it, vi } from 'vitest';

import { dispatchStackRoundsCommand } from '../../src/engine/stack-rounds-cli.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const r4 = parseRoundId('r4')!;

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
      supersededBy: parseRoundId('r5')!, droppedHosts: [2], findingIds: ['f-2'],
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
});
