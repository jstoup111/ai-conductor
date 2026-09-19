import {
  emitGithubOperationRefusal,
  type GithubOperationEventEmitter,
  type GithubOperationRefusalReason,
  type GithubOperationTarget,
} from './github-operations.js';
import { authorizeGithubMutation } from './owner-gate/mutation-policy.js';
import {
  resolveRemoteGitTargets,
  type RemoteGitConfigReader,
  type RemoteGitDestination,
} from './remote-git-targets.js';
import type { GhRunner, GithubMutationExecutionContext } from './tracker-client.js';
import { readMachineOwnerConfig } from './owner-gate/machine-identity.js';
import { resolveDaemonOwner } from './owner-gate/identity.js';

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
  /** Existing event spine; delivery remains best-effort after a refusal. */
  readonly events?: GithubOperationEventEmitter;
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

/** Read-only Git seam used to build fresh committed ownership evidence. */
export interface FeatureMutationGitReader {
  (args: string[]): Promise<{ readonly stdout: string }>;
}

/**
 * Resolve context for an existing feature branch. This creates no permission:
 * executeRemoteGit still resolves identity and committed ownership per target.
 */
export async function resolveFeatureRemoteMutation(input: {
  readonly cwd: string;
  readonly slug: string;
  readonly branch: string;
  readonly git: FeatureMutationGitReader;
  readonly gh: GhRunner;
}): Promise<GithubMutationExecutionContext | undefined> {
  const featureMarker = `.docs/intake/${input.slug}.md`;
  const destination = input.branch.startsWith('refs/')
    ? input.branch
    : `refs/heads/${input.branch}`;
  const targets = await resolveRemoteGitTargets(
    ['push', 'origin', `HEAD:${destination}`],
    input.git,
  );
  if (targets.kind !== 'resolved' || targets.targets.length !== 1) return undefined;

  let defaultBranch: string;
  try {
    const { stdout } = await input.git(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const match = /^refs\/remotes\/origin\/(.+)$/.exec(stdout.trim());
    if (!match) return undefined;
    defaultBranch = `origin/${match[1]}`;
  } catch {
    return undefined;
  }

  return {
    provenance: {
      repository: targets.targets[0].repository,
      defaultBranch,
      specBranch: input.branch,
      featureMarker,
      publication: 'merged',
    },
    dependencies: {
      resolveMachineOwner: async () =>
        resolveDaemonOwner(await readMachineOwnerConfig(), input.gh, input.cwd),
      provenanceDiscovery: {
        readCommittedRecords: async ({ ref }) => {
          const { stdout } = await input.git(['show', `${ref}:${featureMarker}`]);
          return [{ path: featureMarker, content: stdout }];
        },
      },
    },
  };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refusalOperator(dependencies: RemoteGitOperationDependencies): Promise<string> {
  if (!dependencies.mutation) return 'unknown';
  try {
    const identity = await dependencies.mutation.dependencies.resolveMachineOwner();
    return identity.resolved ? identity.id : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function emitRemoteGitRefusal(
  destination: RemoteGitDestination,
  reason: GithubOperationRefusalReason,
  dependencies: RemoteGitOperationDependencies,
): Promise<void> {
  const target: GithubOperationTarget = {
    repository: destination.repository,
    kind: 'remote-ref',
    ref: destination.ref,
  };
  await emitGithubOperationRefusal({
    operator: await refusalOperator(dependencies),
    target,
    operation: destination.operation,
  }, reason, dependencies.events);
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
    const target = resolution.targets[0];
    await emitRemoteGitRefusal(target, 'missing-provenance', dependencies);
    return { kind: 'refused', reason: 'missing-provenance', target };
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
      await emitRemoteGitRefusal(destination, decision.reason, dependencies);
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
