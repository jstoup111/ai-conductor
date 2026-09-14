import type { GithubOperationRefusalReason } from './github-operations.js';
import { authorizeGithubMutation } from './owner-gate/mutation-policy.js';
import {
  resolveRemoteGitTargets,
  type RemoteGitConfigReader,
  type RemoteGitDestination,
} from './remote-git-targets.js';
import type { GithubMutationExecutionContext } from './tracker-client.js';

/** The only injectable boundary permitted to perform an already-authorized Git write. */
export interface RemoteGitCommandRunner {
  (args: string[], options: { readonly cwd: string }): Promise<{ readonly stdout: string }>;
}

export interface RemoteGitOperationDependencies {
  readonly cwd: string;
  /** Read-only remote configuration lookup, normally bound to the caller's Git runner. */
  readonly config: RemoteGitConfigReader;
  /** Injectable process boundary; it is never called until every target is authorized. */
  readonly runRemoteGit: RemoteGitCommandRunner;
  /** Missing provenance is a refusal, never permission to fall back to raw Git. */
  readonly mutation?: GithubMutationExecutionContext;
}

export type RemoteGitExecutionResult =
  | { readonly kind: 'executed'; readonly targets: readonly RemoteGitDestination[] }
  | { readonly kind: 'not-remote-write' }
  | {
    readonly kind: 'refused';
    readonly reason: GithubOperationRefusalReason;
    readonly target?: RemoteGitDestination;
  }
  | { readonly kind: 'failed'; readonly error: string; readonly targets: readonly RemoteGitDestination[] };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve and authorize a complete remote destination set before invoking one
 * transport command. A denial or failure has no fallback transport path.
 */
export async function executeRemoteGit(
  args: readonly string[],
  dependencies: RemoteGitOperationDependencies,
): Promise<RemoteGitExecutionResult> {
  const resolution = await resolveRemoteGitTargets(args, dependencies.config);
  if (resolution.kind === 'not-remote-write') return resolution;
  if (resolution.kind === 'refused') return resolution;

  if (!dependencies.mutation) {
    return { kind: 'refused', reason: 'missing-provenance', target: resolution.targets[0] };
  }

  // Deliberately authorize every exact ref before the single mutating command.
  // The policy resolves current identity and provenance afresh per target.
  for (const destination of resolution.targets) {
    const decision = await authorizeGithubMutation({
      operation: destination.operation,
      target: {
        repository: destination.repository,
        kind: 'remote-ref',
        ref: destination.ref,
      },
      provenance: dependencies.mutation.provenance,
    }, dependencies.mutation.dependencies);
    if (decision.kind === 'refused') {
      return { kind: 'refused', reason: decision.reason, target: destination };
    }
  }

  try {
    await dependencies.runRemoteGit([...args], { cwd: dependencies.cwd });
    return { kind: 'executed', targets: resolution.targets };
  } catch (error) {
    return { kind: 'failed', error: messageFor(error), targets: resolution.targets };
  }
}
