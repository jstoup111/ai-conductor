// Covers: task:1
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allocateVitestTmpScope,
  installVitestTmpRoot,
  selectVitestTmpParent,
} from '../scripts/vitest-temp.mjs';

function fakeFilesystem() {
  let sequence = 0;
  return {
    mkdirSync: () => undefined,
    mkdtempSync: (prefix: string) => `${prefix}${++sequence}`,
    realpathSync: (path: string) => path.replace('/fixture/package/.vitest-tmp', '/canonical/storage'),
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
