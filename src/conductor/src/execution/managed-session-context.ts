import { lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSessionEventIdentity } from './session-event-identity.js';
import { isFeatureSlug } from '../engine/worktree.js';

/** The explicit owner of a managed session; cwd is deliberately not an input. */
export type ManagedSessionScope =
  | { readonly kind: 'feature'; readonly featureSlug: string }
  | { readonly kind: 'project' };

/**
 * Immutable attribution established by the engine before a provider child is
 * launched. It is serialized only after canonical path validation succeeds.
 */
export interface ManagedSessionContext {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
  readonly scope: ManagedSessionScope;
  readonly dispatchId: string;
  readonly provider: string;
  readonly producerRoot: string;
}

export interface ManagedSessionContextInput extends Omit<ManagedSessionContext, 'scope'> {
  readonly scope?: ManagedSessionScope;
  /** Daemon feature dispatches require a feature identity; preludes do not. */
  readonly daemonFeature?: boolean;
}

export type ManagedSessionContextPreparation =
  | { readonly ok: true; readonly context: ManagedSessionContext }
  | {
      readonly ok: false;
      readonly code:
        | 'missing-feature-scope'
        | 'invalid-context'
        | 'worktree-outside-project'
        | 'producer-root-outside-worktree';
      readonly missing?: 'feature scope';
    };

export type ManagedSessionProducerPath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: 'producer-path-outside-root' | 'producer-path-unresolvable' };

export type ManagedSessionProducerRoot =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: 'producer-root-outside-worktree' };

const CONTEXT_ENV = 'CONDUCT_MANAGED_SESSION_CONTEXT';
const PROJECT_ENV = 'CONDUCT_MANAGED_PROJECT';
const WORKTREE_ENV = 'CONDUCT_MANAGED_WORKTREE';
const FEATURE_ENV = 'CONDUCT_MANAGED_FEATURE';
const DISPATCH_ENV = 'CONDUCT_MANAGED_DISPATCH';
const PROVIDER_ENV = 'CONDUCT_MANAGED_PROVIDER';
const PRODUCER_ROOT_ENV = 'CONDUCT_MANAGED_PRODUCER_ROOT';

/** Validate engine-established identity before it can reach a child environment. */
export async function prepareManagedSessionContext(
  input: ManagedSessionContextInput,
): Promise<ManagedSessionContextPreparation> {
  if (input.daemonFeature && (input.scope?.kind !== 'feature' || !nonEmpty(input.scope.featureSlug))) {
    return { ok: false, code: 'missing-feature-scope', missing: 'feature scope' };
  }
  if (
    !isScope(input.scope) ||
    !isSessionEventIdentity(input.dispatchId) ||
    !nonEmpty(input.provider) ||
    !nonEmpty(input.projectRoot) ||
    !nonEmpty(input.worktreeRoot) ||
    !nonEmpty(input.producerRoot)
  ) return { ok: false, code: 'invalid-context' };

  let projectRoot: string;
  let worktreeRoot: string;
  let producerRoot: string;
  try {
    [projectRoot, worktreeRoot, producerRoot] = await Promise.all([
      realpath(input.projectRoot),
      realpath(input.worktreeRoot),
      realpath(input.producerRoot),
    ]);
  } catch {
    return { ok: false, code: 'invalid-context' };
  }
  if (!within(projectRoot, worktreeRoot)) return { ok: false, code: 'worktree-outside-project' };
  if (!within(worktreeRoot, producerRoot)) return { ok: false, code: 'producer-root-outside-worktree' };

  return {
    ok: true,
    context: { ...input, projectRoot, worktreeRoot, producerRoot, scope: input.scope },
  };
}

/**
 * Apply the engine-owned values after candidate overlays. Candidate settings
 * may add environment entries but cannot forge context ownership.
 */
export function composeManagedSessionEnvironment(
  context: ManagedSessionContext,
  candidateEnvironment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const ownership: NodeJS.ProcessEnv = {
    [CONTEXT_ENV]: JSON.stringify(context),
    [PROJECT_ENV]: context.projectRoot,
    [WORKTREE_ENV]: context.worktreeRoot,
    [DISPATCH_ENV]: context.dispatchId,
    [PROVIDER_ENV]: context.provider,
    [PRODUCER_ROOT_ENV]: context.producerRoot,
    [FEATURE_ENV]: context.scope.kind === 'feature' ? context.scope.featureSlug : undefined,
  };
  return { ...candidateEnvironment, ...ownership };
}

/**
 * Accept a producer file only when both lexical and realpath containment hold.
 * This is shared by output preparation and producer-file ingestion so neither
 * traversal nor a symlink can create an outside attribution target.
 */
export async function validateManagedSessionProducerPath(
  context: ManagedSessionContext,
  candidate: string,
): Promise<ManagedSessionProducerPath> {
  if (!nonEmpty(candidate)) return { ok: false, code: 'producer-path-unresolvable' };
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(context.producerRoot, candidate);
  if (!within(context.producerRoot, resolved)) return { ok: false, code: 'producer-path-outside-root' };

  try {
    const canonicalParent = await realpath(dirname(resolved));
    if (!within(context.producerRoot, canonicalParent)) {
      return { ok: false, code: 'producer-path-outside-root' };
    }
    try {
      if ((await lstat(resolved)).isSymbolicLink()) return { ok: false, code: 'producer-path-outside-root' };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, code: 'producer-path-unresolvable' };
    }
    return { ok: true, path: resolve(canonicalParent, basename(resolved)) };
  } catch {
    return { ok: false, code: 'producer-path-unresolvable' };
  }
}

/**
 * Safely provision a dispatch-local producer directory without following a
 * swapped pipeline segment outside the authoritative worktree.
 */
export async function provisionManagedSessionProducerRoot(
  worktreeRoot: string,
  dispatchId: string,
): Promise<ManagedSessionProducerRoot> {
  if (!isSessionEventIdentity(dispatchId)) return { ok: false, code: 'producer-root-outside-worktree' };

  let current: string;
  try {
    current = await realpath(worktreeRoot);
    if (!(await lstat(current)).isDirectory()) {
      return { ok: false, code: 'producer-root-outside-worktree' };
    }
  } catch {
    return { ok: false, code: 'producer-root-outside-worktree' };
  }

  for (const segment of ['.pipeline', 'session-events', dispatchId]) {
    current = join(current, segment);
    try {
      if (!isRealDirectory(await lstat(current))) {
        return { ok: false, code: 'producer-root-outside-worktree' };
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, code: 'producer-root-outside-worktree' };
      }
      try {
        await mkdir(current);
      } catch (mkdirError: unknown) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          return { ok: false, code: 'producer-root-outside-worktree' };
        }
      }
      try {
        if (!isRealDirectory(await lstat(current))) {
          return { ok: false, code: 'producer-root-outside-worktree' };
        }
      } catch {
        return { ok: false, code: 'producer-root-outside-worktree' };
      }
    }
  }

  return { ok: true, path: current };
}

function isRealDirectory(stat: Awaited<ReturnType<typeof lstat>>): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function within(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isScope(value: ManagedSessionScope | undefined): value is ManagedSessionScope {
  return value?.kind === 'project' || (value?.kind === 'feature' && isFeatureSlug(value.featureSlug));
}
