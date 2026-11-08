// Covers: task:16
// Covers: task:17
import { describe, expect, it, vi } from 'vitest';
import { resolveBoundaryProvider } from '../../../src/engine/engineer/launch-boundary.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';

describe('Composer launcher boundary', () => {
  it('Covers: Task 17 continues, switches only to an interactive provider, and refuses local-only handoff', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'claude', hasRemote: true })).toEqual({ action: 'resume', provider: 'claude' });
    expect(resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: 'codex', hasRemote: true })).toEqual({ action: 'resume', provider: 'codex' });
    expect(() => resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: false })).toThrow(/only locally/);
  });

  it('Covers: Task 17 refuses a switch without an interactive provider before it can mutate a run', () => {
    expect(() => resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: undefined, hasRemote: true })).toThrow(/interactiveLaunch capability/);
  });

  it('Covers: Task 17 treats handoff as a remote-only terminal choice while continue preserves the active provider', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'codex', hasRemote: true })).toEqual({ action: 'resume', provider: 'codex' });
    expect(resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: true })).toEqual({ action: 'handoff' });
  });

  it('Covers: Task 16 gives a launcher-started Composer host one stable launch id and provider identity', async () => {
    const spawn = vi.fn(async () => 0);
    const code = await dispatchEngineer({ kind: 'launch', provider: 'codex' }, {
      spawnHost: spawn,
      print: () => {}, printErr: () => {}, isAttachedTerminal: () => true,
      loadLaunchConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      prePoll: async () => 0, confirmAnother: async () => false, env: {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0][3]).toMatchObject({ AI_CONDUCTOR_AUTHORING_PROVIDER: 'codex', AI_CONDUCTOR_COMPOSE_LAUNCH_ID: expect.any(String) });
  });
});
