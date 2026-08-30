// Covers: S5.1, S5.2, S5.3, S5.4, task:8
import { describe, expect, it } from 'vitest';

import { resolveNamedFeatureWorktree } from '../../src/engine/feature-worktree-resolver.js';

const mainRoot = '/repo';
const worktree = '/repo/.worktrees/feature';
const feature = { version: 'v1' as const, repository: mainRoot, feature: 'feature' };

describe('named feature worktree resolver', () => {
  it.each(['/repo', '/repo/.worktrees/feature'])('resolves the exact named feature from %s', async (cwd) => {
    await expect(resolveNamedFeatureWorktree({ cwd, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async (path) => path,
      resolveFeatureIdentity: async () => feature,
    })).resolves.toEqual({ mainRoot, worktree, feature });
  });

  it('leaves missing and ambiguous worktrees unresolved', async () => {
    const missing = resolveNamedFeatureWorktree({ cwd: mainRoot, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async () => { throw new Error('ENOENT'); },
      resolveFeatureIdentity: async () => feature,
    });
    const ambiguous = resolveNamedFeatureWorktree({ cwd: mainRoot, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async (path) => path,
      resolveFeatureIdentity: async () => undefined,
    });

    await expect(missing).resolves.toBeUndefined();
    await expect(ambiguous).resolves.toBeUndefined();
  });

  it('rejects a worktree realpath that escapes the named feature directory', async () => {
    await expect(resolveNamedFeatureWorktree({ cwd: mainRoot, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async (path) => path === worktree ? '/outside/feature' : path,
      resolveFeatureIdentity: async () => ({ ...feature, repository: mainRoot }),
    })).resolves.toBeUndefined();
  });

  it('rejects a mismatched feature identity and a cross-repository identity', async () => {
    const mismatched = resolveNamedFeatureWorktree({ cwd: mainRoot, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async (path) => path,
      resolveFeatureIdentity: async () => ({ ...feature, feature: 'sibling' }),
    });
    const crossRepository = resolveNamedFeatureWorktree({ cwd: mainRoot, feature: 'feature' }, {
      resolveMainRoot: async () => mainRoot,
      realpath: async (path) => path,
      resolveFeatureIdentity: async () => ({ ...feature, repository: '/other-repo' }),
    });

    await expect(mismatched).resolves.toBeUndefined();
    await expect(crossRepository).resolves.toBeUndefined();
  });
});
