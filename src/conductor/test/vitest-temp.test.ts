// Covers: task:2
import type {
  mkdirSync as nodeMkdirSync,
  mkdtempSync as nodeMkdtempSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs';
import { join } from 'node:path';
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
      };

      expect(() => installVitestTmpRoot({ env, packageDir: '/fixture/package', fs })).toThrow(error);
      expect({ env, mkdirCalls, mkdtempCalls }, name).toEqual({
        env: input,
        mkdirCalls: 0,
        mkdtempCalls: 0,
      });
    }
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
});
