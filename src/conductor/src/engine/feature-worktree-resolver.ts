import { realpath as realpathDefault } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { resolveBuildReviewFeatureIdentity } from './build-review-effective.js';
import type { BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { resolveMainRepoRoot } from './park-marker.js';

export type ResolvedNamedFeatureWorktree = {
  readonly mainRoot: string;
  readonly worktree: string;
  readonly feature: BuildReviewFeatureIdentity;
};

export interface NamedFeatureWorktreeResolverDeps {
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly resolveFeatureIdentity?: (
    worktree: string,
    deps: { readonly resolveMainRoot: (cwd: string) => Promise<string>; readonly realpath: (path: string) => Promise<string> },
  ) => Promise<BuildReviewFeatureIdentity | undefined>;
}

/**
 * Resolves exactly one feature-owned worktree. The feature identity is checked
 * against both the canonical main root and the requested slug before callers
 * can read or mutate any feature state.
 */
export async function resolveNamedFeatureWorktree(
  input: { readonly cwd?: string; readonly feature: string },
  deps: NamedFeatureWorktreeResolverDeps = {},
): Promise<ResolvedNamedFeatureWorktree | undefined> {
  try {
    const resolveMainRoot = deps.resolveMainRoot ?? resolveMainRepoRoot;
    const realpath = deps.realpath ?? realpathDefault;
    const mainRoot = await realpath(await resolveMainRoot(input.cwd ?? process.cwd()));
    const worktree = await realpath(join(mainRoot, '.worktrees', input.feature));
    const worktreeFeature = relative(join(mainRoot, '.worktrees'), worktree);
    if (worktreeFeature !== input.feature || isAbsolute(worktreeFeature) || worktreeFeature === '..' || worktreeFeature.startsWith(`..${sep}`)) {
      return undefined;
    }
    const feature = await (deps.resolveFeatureIdentity ?? resolveBuildReviewFeatureIdentity)(worktree, { resolveMainRoot, realpath });
    return feature?.feature === input.feature && feature.repository === mainRoot
      ? { mainRoot, worktree, feature }
      : undefined;
  } catch {
    return undefined;
  }
}
