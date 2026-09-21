import type { GithubOperationRunner } from './github-operations.js';
import type { HaltPrReconciliationTarget } from './halt-pr-reconciliation.js';
import { parseIssueRef } from './pr-labels.js';
import type { GitRunner } from './rebase.js';
import {
  createGuardedGithubOperationRunner,
  type GhRunner,
} from './tracker-client.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { GithubOperationEventEmitter } from './github-operations.js';

const DAEMON_BRANCH_PREFIX = 'feat/daemon-';

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
 * Builds a per-PR guarded operation runner for the daemon's halt sweep.
 *
 * A branch name and body marker are only routing inputs: the returned runner
 * still reads the exact committed intake marker and resolves the machine owner
 * for every mutation.  Invalid URLs and non-daemon branches intentionally
 * receive no mutation runner, so the existing PR primitives refuse writes.
 */
export function createDaemonHaltPrOperations(
  options: DaemonHaltPrOperationsOptions,
): (pr: HaltPrReconciliationTarget) => GithubOperationRunner | undefined {
  return (pr) => {
    const target = parseIssueRef(pr.url);
    const branch = pr.headRefName;
    if (!target || !branch || !branch.startsWith(DAEMON_BRANCH_PREFIX)) return undefined;

    const slug = branch.slice(DAEMON_BRANCH_PREFIX.length).trim();
    if (!slug) return undefined;

    const featureMarker = `.docs/intake/${slug}.md`;
    return createGuardedGithubOperationRunner(options.gh, {
      cwd: options.projectRoot,
      mutation: {
        provenance: {
          repository: target.repo,
          defaultBranch: options.baseBranch,
          specBranch: branch,
          featureMarker,
          publication: 'merged',
          target: { repository: target.repo, kind: 'pull-request', number: Number(target.number) },
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
}
