// Covers: task:2, task:3, task:5
import type {
  mkdirSync as nodeMkdirSync,
  mkdtempSync as nodeMkdtempSync,
  realpathSync as nodeRealpathSync,
  rmSync as nodeRmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  allocateVitestTmpScope,
  installVitestTmpRoot,
  selectVitestTmpParent,
} from '../scripts/vitest-temp.mjs';

type VitestTempFilesystem = {
  mkdirSync: typeof nodeMkdirSync;
  mkdtempSync: typeof nodeMkdtempSync;
  realpathSync: typeof nodeRealpathSync;
  rmSync: typeof nodeRmSync;
};

function fakeFilesystem(): VitestTempFilesystem {
  let sequence = 0;
  return {
    mkdirSync: (() => undefined) as typeof nodeMkdirSync,
    mkdtempSync: ((prefix: string) => `${prefix}${++sequence}`) as typeof nodeMkdtempSync,
    realpathSync: Object.assign(
      ((path: string) => path.replace('/fixture/package/.vitest-tmp', '/canonical/storage')) as typeof nodeRealpathSync,
      { native: ((path: string) => path.replace('/fixture/package/.vitest-tmp', '/canonical/storage')) as typeof nodeRealpathSync.native },
    ),
    rmSync: (() => undefined) as typeof nodeRmSync,
  };
}

describe('Vitest temporary storage selection', () => {
  it('selects the package-relative default instead of the original temporary directory', async () => {
    const packageDir = '/fixture/package';
    const originalTmpdir = '/fixture/original-tmpdir';

    const parent = selectVitestTmpParent({
      env: { TMPDIR: originalTmpdir },
      packageDir,
    });

    expect(parent).toBe(join(packageDir, '.vitest-tmp'));
  });

  it('uses an absolute override instead of the package-local parent', () => {
    const parent = selectVitestTmpParent({
      env: { AI_CONDUCTOR_TEST_TMP_BASE: '/fixture/override' },
      packageDir: '/fixture/package',
    });

    expect(parent).toBe('/fixture/override');
  });

  it('rejects invalid base settings and incomplete installed-root context before filesystem allocation', () => {
    const cases = [
      {
        name: 'a blank base setting',
        env: { AI_CONDUCTOR_TEST_TMP_BASE: '' },
        error: /AI_CONDUCTOR_TEST_TMP_BASE|blank/i,
      },
      {
        name: 'a relative base setting',
        env: { AI_CONDUCTOR_TEST_TMP_BASE: 'relative/storage' },
        error: /AI_CONDUCTOR_TEST_TMP_BASE|relative/i,
      },
      {
        name: 'a NUL-containing base setting',
        env: { AI_CONDUCTOR_TEST_TMP_BASE: '/fixture/invalid\0storage' },
        error: /AI_CONDUCTOR_TEST_TMP_BASE/i,
      },
      {
        name: 'an installed root without its original directory',
        env: { AI_CONDUCTOR_TEST_TMP_ROOT: '/fixture/installed-root' },
        error: /AI_CONDUCTOR_TEST_TMP_ROOT|AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR|original/i,
      },
    ];

    for (const { name, env, error } of cases) {
      const input = { ...env };
      let mkdirCalls = 0;
      let mkdtempCalls = 0;
      const fs: VitestTempFilesystem = {
        mkdirSync: (() => { mkdirCalls += 1; }) as typeof nodeMkdirSync,
        mkdtempSync: ((prefix: string) => { mkdtempCalls += 1; return `${prefix}unexpected-root`; }) as typeof nodeMkdtempSync,
        realpathSync: Object.assign(
          ((path: string) => path) as typeof nodeRealpathSync,
          { native: ((path: string) => path) as typeof nodeRealpathSync.native },
        ),
        rmSync: (() => undefined) as typeof nodeRmSync,
      };

      expect(() => installVitestTmpRoot({ env, packageDir: '/fixture/package', fs })).toThrow(error);
      expect({ env, mkdirCalls, mkdtempCalls }, name).toEqual({
        env: input,
        mkdirCalls: 0,
        mkdtempCalls: 0,
      });
    }
  });

  it.each([
    {
      name: 'a parent mkdir permission failure',
      failure: Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      fail: 'mkdir' as const,
    },
    {
      name: 'a full-device allocation failure',
      failure: Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }),
      fail: 'mkdtemp' as const,
    },
    {
      name: 'a quota-exhausted allocation failure',
      failure: Object.assign(new Error('disk quota exceeded'), { code: 'EDQUOT' }),
      fail: 'mkdtemp' as const,
    },
    {
      name: 'a non-directory parent',
      failure: Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }),
      fail: 'mkdir' as const,
    },
  ])('reports the selected storage and preserves caller state for $name', ({ failure, fail }) => {
    const env = {
      AI_CONDUCTOR_TEST_TMP_BASE: '/fixture/selected-storage',
      TMPDIR: '/fixture/original-tmpdir',
      GIT_CEILING_DIRECTORIES: '/fixture/existing-ceiling',
    };
    const originalEnvironment = { ...env };
    const calls: string[] = [];
    const fs: VitestTempFilesystem = {
      mkdirSync: ((path: string) => {
        calls.push(`mkdir:${path}`);
        if (fail === 'mkdir') throw failure;
      }) as typeof nodeMkdirSync,
      mkdtempSync: ((prefix: string) => {
        calls.push(`mkdtemp:${prefix}`);
        if (fail === 'mkdtemp') throw failure;
        return `${prefix}unexpected-root`;
      }) as typeof nodeMkdtempSync,
      realpathSync: Object.assign(
        ((path: string) => {
          calls.push(`realpath:${path}`);
          return path;
        }) as typeof nodeRealpathSync,
        { native: ((path: string) => path) as typeof nodeRealpathSync.native },
      ),
      rmSync: ((path: string) => { calls.push(`rm:${path}`); }) as typeof nodeRmSync,
    };

    let thrown: unknown;
    try {
      installVitestTmpRoot({ env, packageDir: '/fixture/package', fs });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/fixture\/selected-storage/);
    expect((thrown as Error).message).toContain(failure.message);
    expect(env).toEqual(originalEnvironment);
    expect(calls).toEqual(
      fail === 'mkdir'
        ? ['/fixture/selected-storage'].map(path => `mkdir:${path}`)
        : [
          'mkdir:/fixture/selected-storage',
          'realpath:/fixture/selected-storage',
          'mkdtemp:/fixture/selected-storage/ai-conductor-vitest-run-',
        ],
    );
  });

  it.each([
    { name: 'cleanup succeeds', cleanupFailure: undefined },
    { name: 'cleanup fails', cleanupFailure: Object.assign(new Error('cleanup also failed'), { code: 'EACCES' }) },
  ])('reports root canonicalization failure and removes only that partial root when $name', ({ cleanupFailure }) => {
    const env = {
      AI_CONDUCTOR_TEST_TMP_BASE: '/fixture/selected-storage',
      TMPDIR: '/fixture/original-tmpdir',
    };
    const originalEnvironment = { ...env };
    const root = '/fixture/selected-storage/ai-conductor-vitest-run-partial';
    const canonicalizationFailure = Object.assign(new Error('root cannot be resolved'), { code: 'EIO' });
    const calls: string[] = [];
    const fs: VitestTempFilesystem = {
      mkdirSync: ((path: string) => { calls.push(`mkdir:${path}`); }) as typeof nodeMkdirSync,
      mkdtempSync: ((prefix: string) => { calls.push(`mkdtemp:${prefix}`); return root; }) as typeof nodeMkdtempSync,
      realpathSync: Object.assign(
        ((path: string) => {
          calls.push(`realpath:${path}`);
          if (path === root) throw canonicalizationFailure;
          return path;
        }) as typeof nodeRealpathSync,
        { native: ((path: string) => path) as typeof nodeRealpathSync.native },
      ),
      rmSync: ((path: string) => {
        calls.push(`rm:${path}`);
        if (cleanupFailure) throw cleanupFailure;
      }) as typeof nodeRmSync,
    };

    let thrown: unknown;
    try {
      installVitestTmpRoot({ env, packageDir: '/fixture/package', fs });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('/fixture/selected-storage');
    expect((thrown as Error).message).toContain(canonicalizationFailure.message);
    expect((thrown as Error).cause).toBe(canonicalizationFailure);
    expect(env).toEqual(originalEnvironment);
    expect(calls).toEqual([
      'mkdir:/fixture/selected-storage',
      'realpath:/fixture/selected-storage',
      'mkdtemp:/fixture/selected-storage/ai-conductor-vitest-run-',
      `realpath:${root}`,
      `rm:${root}`,
    ]);
  });

  it('allocates distinct canonical roots and installs the owned context without duplicating Git ceilings', () => {
    const env = {
      TMPDIR: '/fixture/original-tmpdir',
      GIT_CEILING_DIRECTORIES: '/existing/ceiling',
    };
    const fs = fakeFilesystem();
    const first = allocateVitestTmpScope({ env, packageDir: '/fixture/package', fs });
    const second = allocateVitestTmpScope({ env, packageDir: '/fixture/package', fs });
    const installed = installVitestTmpRoot({ env, packageDir: '/fixture/package', fs, fresh: true });
    const reinstalled = installVitestTmpRoot({ env, packageDir: '/fixture/package', fs });

    expect({ first, second, installed, reinstalled, env }).toMatchObject({
      first: { parent: '/canonical/storage', root: '/canonical/storage/ai-conductor-vitest-run-1', scope: '/canonical/storage/ai-conductor-vitest-run-1', ownsRoot: true, ownsScope: true },
      second: { parent: '/canonical/storage', root: '/canonical/storage/ai-conductor-vitest-run-2', scope: '/canonical/storage/ai-conductor-vitest-run-2', ownsRoot: true, ownsScope: true },
      installed: {
        root: '/canonical/storage/ai-conductor-vitest-run-3',
        scope: '/canonical/storage/ai-conductor-vitest-run-3',
        originalTmpdir: '/fixture/original-tmpdir',
        ownsRoot: true,
        ownsScope: true,
        environment: {
          TMPDIR: '/fixture/original-tmpdir',
          GIT_CEILING_DIRECTORIES: '/existing/ceiling',
        },
      },
      reinstalled: { root: '/canonical/storage/ai-conductor-vitest-run-3', ownsRoot: false, ownsScope: false },
      env: {
        AI_CONDUCTOR_TEST_TMP_ROOT: '/canonical/storage/ai-conductor-vitest-run-3',
        AI_CONDUCTOR_TEST_TMP_SCOPE: '/canonical/storage/ai-conductor-vitest-run-3',
        AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR: '/fixture/original-tmpdir',
        TMPDIR: '/canonical/storage/ai-conductor-vitest-run-3',
        GIT_CEILING_DIRECTORIES: '/existing/ceiling:/canonical/storage/ai-conductor-vitest-run-3',
      },
    });
  });

  it('preserves the system temporary directory when the caller has no TMPDIR', () => {
    const env: NodeJS.ProcessEnv = {};
    const installed = installVitestTmpRoot({ env, packageDir: '/fixture/package', fs: fakeFilesystem(), fresh: true });

    expect(installed.originalTmpdir).toBe(tmpdir());
    expect(env.AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR).toBe(tmpdir());
  });

  it('allocates a cleared nested root beneath its declared enclosing scope', () => {
    const env = {
      AI_CONDUCTOR_TEST_TMP_BASE: '/fixture/top-level-storage',
      AI_CONDUCTOR_TEST_TMP_SCOPE: '/fixture/outer-scope',
      AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR: '/fixture/original-tmpdir',
      TMPDIR: '/fixture/outer-scope/discovery-child',
    };
    const installed = installVitestTmpRoot({ env, packageDir: '/fixture/package', fs: fakeFilesystem() });

    expect(installed).toMatchObject({
      parent: '/fixture/outer-scope/discovery-child',
      root: '/fixture/outer-scope/discovery-child/ai-conductor-vitest-run-1',
      scope: '/fixture/outer-scope',
      ownsRoot: true,
      ownsScope: false,
    });
  });

  it('keeps independent and nested scopes isolated when one owner cleans up', () => {
    const fs = fakeFilesystem();
    const first = installVitestTmpRoot({ env: { TMPDIR: '/fixture/original-one' }, packageDir: '/fixture/package', fs, fresh: true });
    const second = installVitestTmpRoot({ env: { TMPDIR: '/fixture/original-two' }, packageDir: '/fixture/package', fs, fresh: true });
    const nested = installVitestTmpRoot({
      env: {
        AI_CONDUCTOR_TEST_TMP_SCOPE: first.scope,
        AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR: '/fixture/original-one',
        TMPDIR: `${first.scope}/child`,
      },
      packageDir: '/fixture/package',
      fs,
    });

    expect(first.root).not.toBe(second.root);
    expect(nested.root).toMatch(new RegExp(`^${first.scope}/child/`));
    expect(nested.scope).toBe(first.scope);
    expect(second.scope).not.toBe(first.scope);
  });
});
