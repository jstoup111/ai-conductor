import { acquireFeatureDispatchLease, type FeatureDispatchLease, type FeatureDispatchLeaseAcquireResult } from './feature-dispatch-lease.js';
import { resolveMainRepoRoot } from './daemon-park-cli.js';
import { hasDurableChildState } from './slice-topology.js';
import { slugify } from './worktree.js';

export interface InteractiveConductorRunLeaseDependencies {
  readonly slugify?: typeof slugify;
  readonly hasDurableChildState?: typeof hasDurableChildState;
  readonly resolveMainRepoRoot?: typeof resolveMainRepoRoot;
  readonly acquire?: typeof acquireFeatureDispatchLease;
}

export type InteractiveConductorRunLeaseAcquisition =
  | { readonly kind: 'unleased' }
  | { readonly kind: 'acquired'; readonly lease: FeatureDispatchLease }
  | { readonly kind: 'refused'; readonly message: string };

function interactiveLeaseRefusal(result: Exclude<FeatureDispatchLeaseAcquireResult, { kind: 'acquired' }>): string {
  switch (result.kind) {
    case 'live-owner':
      return `interactive conductor run refused: feature dispatch lease is held by ${result.owner.purpose} (pid ${result.owner.pid})`;
    case 'unreadable-owner':
      return `interactive conductor run refused: feature dispatch lease owner is unreadable at ${result.leasePath}`;
    case 'recovery-in-progress':
      return `interactive conductor run refused: feature dispatch lease recovery is in progress at ${result.leasePath}`;
    case 'unavailable':
      return `interactive conductor run refused: ${result.message}`;
  }
}

/** Acquire the foreground lease before its interactive composition creates state. */
export async function acquireInteractiveConductorRunLease(input: {
  readonly projectRoot: string;
  readonly featureDesc: string | undefined;
  readonly dependencies?: InteractiveConductorRunLeaseDependencies;
}): Promise<InteractiveConductorRunLeaseAcquisition> {
  const dependencies = input.dependencies ?? {};
  const toSlug = dependencies.slugify ?? slugify;
  const featureSlug = input.featureDesc ? toSlug(input.featureDesc) : '';
  if (!featureSlug) return { kind: 'unleased' };

  const durableChildState = await (dependencies.hasDurableChildState ?? hasDurableChildState)(
    input.projectRoot,
    featureSlug,
  );
  if (durableChildState === 'git-error') {
    return { kind: 'refused', message: 'interactive conductor run refused: cannot inspect durable stacked feature state' };
  }
  if (!durableChildState) return { kind: 'unleased' };

  const repository = await (dependencies.resolveMainRepoRoot ?? resolveMainRepoRoot)(input.projectRoot);
  if ('error' in repository) return { kind: 'refused', message: `interactive conductor run refused: ${repository.error}` };
  const acquired = await (dependencies.acquire ?? acquireFeatureDispatchLease)(
    repository.root,
    featureSlug,
    'interactive conductor run',
  );
  if (acquired.kind !== 'acquired') return { kind: 'refused', message: interactiveLeaseRefusal(acquired) };

  return { kind: 'acquired', lease: acquired.lease };
}

/**
 * Run the foreground's first stateful preparation while a stacked-feature
 * lease is already held. A failed preparation releases the just-acquired
 * lease; successful callers retain it until the interactive run terminates.
 */
export async function prepareInteractiveConductorRunWithLease(input: {
  readonly projectRoot: string;
  readonly featureDesc: string | undefined;
  readonly prepare: () => Promise<void>;
  readonly dependencies?: InteractiveConductorRunLeaseDependencies;
}): Promise<InteractiveConductorRunLeaseAcquisition> {
  const acquired = await acquireInteractiveConductorRunLease(input);
  if (acquired.kind === 'refused') return acquired;
  try {
    await input.prepare();
    return acquired;
  } catch (error) {
    if (acquired.kind === 'acquired') {
      const released = await acquired.lease.release();
      if (!released.ok) throw new Error(released.message);
    }
    throw error;
  }
}
