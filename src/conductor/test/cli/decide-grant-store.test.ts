// Covers: task:3

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchDecideGrantCommand,
  type DecideGrantDispatch,
} from '../../src/cli.js';
import { grantStorePath } from '../../src/engine/decide-entry-policy.js';

type DecideGrantDeps = {
  readonly resolveMainRoot?: (cwd: string) => Promise<string | null>;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
};

type DispatchDecideGrant = (
  command: DecideGrantDispatch,
  cwd?: string,
  deps?: DecideGrantDeps,
) => Promise<number>;

const dispatch = dispatchDecideGrantCommand as DispatchDecideGrant;

describe('decide-grant store resolution (Task 3)', () => {
  const directories: string[] = [];

  async function directory(prefix: string): Promise<string> {
    const created = await mkdtemp(join(tmpdir(), prefix));
    directories.push(created);
    return created;
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('writes at the shared main-root store path and reports that absolute path', async () => {
    const invocationDirectory = await directory('decide-grant-invocation-');
    const mainRoot = await directory('decide-grant-main-root-');
    const stdout = vi.fn();
    const command: DecideGrantDispatch = {
      kind: 'decide-grant', slug: 'feature-one', step: 'stories', reason: 'operator approval',
    };

    const result = await dispatch(command, invocationDirectory, {
      resolveMainRoot: async () => mainRoot,
      stdout,
    });

    const storedPath = grantStorePath(mainRoot, command.slug);
    expect(result).toBe(0);
    await expect(readFile(storedPath, 'utf8')).resolves.toContain(command.step);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(storedPath));
  });

  it('refuses an unresolved repository without creating a local grant store', async () => {
    const invocationDirectory = await directory('decide-grant-unresolved-');
    const stderr = vi.fn();

    const result = await dispatch({
      kind: 'decide-grant', slug: 'feature-one', step: 'stories', reason: 'operator approval',
    }, invocationDirectory, {
      resolveMainRoot: async () => null,
      stderr,
    });

    expect(result).not.toBe(0);
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/repository.*unresolved|unresolved.*repository/i));
    await expect(readFile(join(invocationDirectory, '.daemon', 'grants', 'feature-one.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(invocationDirectory, '.daemon'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses plan before it resolves the repository', async () => {
    const resolveMainRoot = vi.fn(async () => await directory('decide-grant-unexpected-resolution-'));
    const stderr = vi.fn();

    const result = await dispatch({
      kind: 'decide-grant', slug: 'feature-one', step: 'plan', reason: 'operator approval',
    }, await directory('decide-grant-plan-'), { resolveMainRoot, stderr });

    expect(result).not.toBe(0);
    expect(resolveMainRoot).not.toHaveBeenCalled();
  });
});
