import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { execFile as execFileSpy } from 'node:child_process';
import { makeProductionGh, assertRealExecAllowed, type GhRunner } from '../src/engine/tracker-client.js';

describe('tracker-client: canonical GhRunner + guarded makeProductionGh', () => {
  it('typechecks GhRunner, makeProductionGh, assertRealExecAllowed imports', () => {
    const runner: GhRunner = async () => ({ stdout: '' });
    expect(typeof runner).toBe('function');
    expect(typeof makeProductionGh).toBe('function');
    expect(typeof assertRealExecAllowed).toBe('function');
  });

  it('makeProductionGh() throws under AI_CONDUCTOR_NO_REAL_EXEC before spawning a process', async () => {
    vi.mocked(execFileSpy).mockClear();
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();

    const gh = makeProductionGh();

    await expect(gh(['pr', 'view'], { cwd: '/tmp' })).rejects.toThrow(
      /AI_CONDUCTOR_NO_REAL_EXEC|real .*(gh|exec).* blocked/i,
    );
    expect(execFileSpy).not.toHaveBeenCalled();
  });
});
