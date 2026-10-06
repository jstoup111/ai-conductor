import type {
  GithubOperationEventEmitter,
  GithubOperationRequest,
  GithubOperationRunner,
} from './github-operations.js';
import type { HaltPrReconciliationTarget } from './halt-pr-reconciliation.js';
import { parseFeatureBranch, leafBranchFor } from './feature-branch-identity.js';
import { parseIssueRef } from './pr-labels.js';
import type { GitRunner } from './rebase.js';
import {
  createGuardedGithubOperationRunner,
  type GhRunner,
} from './tracker-client.js';
import type { OwnerResolution } from './owner-gate/identity.js';

export interface DaemonHaltPrOperationsOptions {
  readonly projectRoot: string;
  /** The locally maintained base ref used for durable, merged provenance. */
  readonly baseBranch: string;
  readonly gh: GhRunner;
  readonly git: GitRunner;
  /** Resolves afresh for every guarded mutation. */
  readonly resolveMachineOwner: () => Promise<OwnerResolution>;
  /** Feature or daemon event spine for best-effort ownership refusals. */
  readonly events?: GithubOperationEventEmitter;
}

/**
 * Whether the canonical parent leaf branch for `slug` resolves as a real ref —
 * first in the local repository, then its `origin` remote-tracking ref.
 *
 * Returns `error` only when the probe transport itself throws, so callers can
 * fail closed without ever attempting the guarded mutation.
 */
export async function leafRefExists(
  git: GitRunner,
  slug: string,
): Promise<'present' | 'absent' | 'error'> {
  const leaf = leafBranchFor(slug);
  for (const ref of [`refs/heads/${leaf}`, `refs/remotes/origin/${leaf}`]) {
    try {
      const result = await git(['show-ref', '--verify', '--quiet', ref]);
      if (result.exitCode === 0) return 'present';
    } catch {
      return 'error';
    }
  }
  return 'absent';
}

/**
 * Builds a per-PR guarded operation runner for the daemon's halt sweep.
 *
 * A branch name and body marker are only routing inputs: the returned runner
 * still reads the exact committed intake marker and resolves the machine owner
 * for every mutation.  Invalid URLs and non-daemon branches intentionally
 * receive no mutation runner, so the existing PR primitives refuse writes.
 *
 * A stacked child head gains the leaf-exists precondition on top of the
 * unchanged committed-owner check: the runner refuses every mutation unless the
 * canonical parent leaf ref still exists.
 */
export function createDaemonHaltPrOperations(
  options: DaemonHaltPrOperationsOptions,
): (pr: HaltPrReconciliationTarget) => GithubOperationRunner | undefined {
  const buildDaemonRunner = (
    repo: string,
    number: number,
    slug: string,
    specBranch: string,
  ): GithubOperationRunner => {
    const featureMarker = `.docs/intake/${slug}.md`;
    return createGuardedGithubOperationRunner(options.gh, {
      cwd: options.projectRoot,
      mutation: {
        provenance: {
          repository: repo,
          defaultBranch: options.baseBranch,
          specBranch,
          featureMarker,
          publication: 'merged',
          target: { repository: repo, kind: 'pull-request', number },
        },
        dependencies: {
          resolveMachineOwner: options.resolveMachineOwner,
          provenanceDiscovery: {
            readCommittedRecords: async ({ ref }) => {
              const result = await options.git(['show', `${ref}:${featureMarker}`]);
              if (result.exitCode !== 0) {
                throw new Error(`committed ownership record unavailable at ${ref}:${featureMarker}`);
              }
              return [{ path: featureMarker, content: result.stdout }];
            },
          },
        },
      },
      events: options.events,
    });
  };

  return (pr) => {
    const target = parseIssueRef(pr.url);
    const branch = pr.headRefName;
    if (!target || !branch) return undefined;

    const identity = parseFeatureBranch(branch);
    if (identity.kind === 'leaf') {
      return buildDaemonRunner(target.repo, Number(target.number), identity.slug, branch);
    }

    if (identity.kind === 'child') {
      const delegate = buildDaemonRunner(target.repo, Number(target.number), identity.slug, branch);
      return {
        ...delegate,
        run: async (request: GithubOperationRequest) => {
          const leaf = await leafRefExists(options.git, identity.slug);
          if (leaf !== 'present') {
            return { kind: 'refused', reason: 'invalid-target' };
          }
          return delegate.run(request);
        },
      };
    }

    return undefined;
  };
}