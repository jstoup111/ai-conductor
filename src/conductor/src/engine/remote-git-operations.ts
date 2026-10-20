import {
  emitGithubOperationRefusal,
  type GithubOperationEventEmitter,
  type GithubOperationRefusalReason,
  type GithubOperationTarget,
} from './github-operations.js';
import { authorizeGithubMutation } from './owner-gate/mutation-policy.js';
import { hasExplicitGithubOperationApproval, type GithubExplicitOperationApproval } from './github-operation-approval.js';
import { githubTargetsMatch } from './github-target.js';
import {
  resolveRemoteGitTargets,
  type RemoteGitConfigReader,
  type RemoteGitDestination,
} from './remote-git-targets.js';
import type { GhRunner, GithubMutationExecutionContext } from './tracker-client.js';
import type { GithubOperationRequest } from './github-operations.js';
import { readMachineOwnerConfig } from './owner-gate/machine-identity.js';
import { resolveDaemonOwner } from './owner-gate/identity.js';
import { GithubBotAuthRefusalError } from './github-bot-auth-refusal.js';
import { discardPushedTipIntent, preparePushedTip, recordPushedTip, resolvePushedTipSource, type PreparedPushedTip, type PushLeaseGitRunner } from './push-lease.js';
import { daemonOwnedSlugOfRef } from './feature-branch-identity.js';
import { guardPublishedStackWrite } from './stack-tip-guard.js';
import type { PublicationMember } from './stack-publication-record.js';
import { makeGitRunner } from './rebase.js';
import { hasDurableChildState, hasStackedChildEvidence } from './child-cursor.js';

/** The only injectable boundary permitted to perform an already-authorized Git write. */
export interface RemoteGitCommandRunner {
  (args: string[], options: { readonly cwd: string; readonly credential?: 'operator' | 'write'; readonly endpoint?: 'https' | 'ssh' }): Promise<{ readonly stdout: string }>;
}

export interface RemoteGitOperationDependencies {
  readonly cwd: string;
  /** Read-only remote configuration lookup, normally bound to the caller's Git runner. */
  readonly config: RemoteGitConfigReader;
  /** Injectable process boundary; it is never called until every target is authorized. */
  readonly runRemoteGit: RemoteGitCommandRunner;
  /** Missing provenance is a refusal, never permission to fall back to raw Git. */
  readonly mutation?: GithubMutationExecutionContext;
  /**
   * Exact interactive approval for a first publication with no feature record.
   * This is intentionally an alternative to feature provenance, never a
   * repository-wide capability.
   */
  readonly explicitApproval?: {
    readonly capability: GithubExplicitOperationApproval;
    readonly request: GithubOperationRequest;
  };
  /** Existing event spine; delivery remains best-effort after a refusal. */
  readonly events?: GithubOperationEventEmitter;
  /** Local-Git seam for the durable pushed-tip record. */
  readonly pushLeaseGit?: PushLeaseGitRunner;
}

export type RemoteGitExecutionResult =
  | { readonly kind: 'executed'; readonly targets: readonly RemoteGitDestination[] }
  | { readonly kind: 'not-remote-write' }
  | {
    readonly kind: 'refused';
    readonly reason: GithubOperationRefusalReason;
    readonly target?: RemoteGitDestination;
    /** Present for the published-stack refusal so FINISH can name positions. */
    readonly members?: readonly PublicationMember[];
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
      target: {
        repository: targets.targets[0].repository,
        kind: 'remote-ref',
        ref: targets.targets[0].ref,
      },
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

type PushRecording = { readonly prepared: PreparedPushedTip };

type PushRecordingPreparation =
  | { readonly kind: 'prepared'; readonly recordings: readonly PushRecording[] }
  | { readonly kind: 'refused'; readonly recordings: readonly PushRecording[]; readonly error: string };

function featurePushSources(args: readonly string[], destinations: readonly RemoteGitDestination[]): Array<{ slug: string; branch: string; source: string }> {
  const refspecs = args.filter((arg) => !arg.startsWith('-')).slice(2);
  return destinations.flatMap((destination, index) => {
    if (destination.operation !== 'remote-ref.push') return [];
    const slug = daemonOwnedSlugOfRef(destination.ref);
    if (slug === undefined) return [];
    const refspec = refspecs[index];
    const separator = refspec?.indexOf(':') ?? -1;
    if (separator <= 0) return [];
    return [{ slug, branch: destination.ref.slice('refs/heads/'.length), source: refspec!.slice(0, separator).replace(/^\+/, '') }];
  });
}

function withExpectedLease(args: readonly string[], destination: RemoteGitDestination, expected: string): string[] {
  return [...args, `--force-with-lease=${destination.ref}:${expected}`];
}

async function guardPublishedStackPushes(
  args: readonly string[],
  remote: string,
  destinations: readonly RemoteGitDestination[],
  dependencies: RemoteGitOperationDependencies,
): Promise<{ readonly kind: 'allow'; readonly args: readonly string[] } | { readonly kind: 'refuse'; readonly members: readonly PublicationMember[] }> {
  const candidates = featurePushSources(args, destinations);
  let guardedArgs = [...args];
  const localGit: PushLeaseGitRunner = dependencies.pushLeaseGit ?? (async (localArgs, input) => {
    const result = await makeGitRunner(dependencies.cwd)([...localArgs], input === undefined ? undefined : { input });
    return { stdout: result.stdout, exitCode: result.exitCode };
  });
  const childStateGit = async (localArgs: string[], options?: { readonly input?: string }) => {
    const result = await localGit(localArgs, options?.input);
    return { stdout: result.stdout, stderr: '', exitCode: result.exitCode };
  };
  for (const candidate of candidates) {
    const destination = destinations.find((value) => value.operation === 'remote-ref.push'
      && value.ref === `refs/heads/${candidate.branch}`);
    if (destination === undefined) continue;
    if (!(await hasStackedChildEvidence(dependencies.cwd))) continue;
    const durableChildState = await hasDurableChildState(dependencies.cwd, candidate.slug, { git: childStateGit });
    // N=1 takes the historical unguarded push path. An unreadable topology is
    // not evidence that a published stack may be written without its lease.
    if (durableChildState === false) continue;
    if (durableChildState === 'git-error') return { kind: 'refuse', members: [] };
    const guard = await guardPublishedStackWrite({
      cwd: dependencies.cwd,
      remote,
      slug: candidate.slug,
      destination: destination.ref,
      source: candidate.source,
      durableChildState,
      git: localGit,
      lsRemote: (lsArgs) => dependencies.runRemoteGit([...lsArgs], {
        cwd: dependencies.cwd,
        credential: 'write',
        endpoint: destination.endpoint,
      }),
    });
    if (guard.kind === 'refuse') return { kind: 'refuse', members: guard.members };
    if (guard.kind === 'allow') guardedArgs = withExpectedLease(guardedArgs, destination, guard.expected);
  }
  return { kind: 'allow', args: guardedArgs };
}

async function preparePushRecordings(
  args: readonly string[],
  destinations: readonly RemoteGitDestination[],
  dependencies: RemoteGitOperationDependencies,
): Promise<PushRecordingPreparation> {
  const recordings: PushRecording[] = [];
  for (const candidate of featurePushSources(args, destinations)) {
    const source = await resolvePushedTipSource({ cwd: dependencies.cwd, source: candidate.source, git: dependencies.pushLeaseGit });
    if (!source) {
      return {
        kind: 'refused',
        recordings,
        error: `could not resolve feature push source ${candidate.source}`,
      };
    }
    const prepared = await preparePushedTip({
      cwd: dependencies.cwd, slug: candidate.slug, branch: candidate.branch, new: source, git: dependencies.pushLeaseGit,
    });
    if (!prepared) {
      return {
        kind: 'refused',
        recordings,
        error: `could not prepare durable pushed-tip intent for ${candidate.branch}`,
      };
    }
    recordings.push({ prepared });
  }
  return { kind: 'prepared', recordings };
}

async function completePushRecordings(
  recordings: readonly PushRecording[],
  dependencies: RemoteGitOperationDependencies,
): Promise<void> {
  await Promise.all(recordings.map(({ prepared }) => recordPushedTip({ cwd: dependencies.cwd, prepared, git: dependencies.pushLeaseGit })));
}

async function discardPushRecordings(
  recordings: readonly PushRecording[],
  dependencies: RemoteGitOperationDependencies,
): Promise<void> {
  await Promise.all(recordings.map(({ prepared }) => discardPushedTipIntent({ cwd: dependencies.cwd, prepared, git: dependencies.pushLeaseGit })));
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

  const explicitlyApproved = (destination: RemoteGitDestination): boolean => {
    const approval = dependencies.explicitApproval;
    if (!approval || approval.request.operation !== destination.operation) return false;
    const target: GithubOperationTarget = {
      repository: destination.repository,
      kind: 'remote-ref',
      ref: destination.ref,
    };
    return githubTargetsMatch(approval.request.target, target)
      && hasExplicitGithubOperationApproval(approval.capability, approval.request);
  };

  if (!dependencies.mutation && !resolution.targets.every(explicitlyApproved)) {
    const target = resolution.targets[0];
    await emitRemoteGitRefusal(target, 'missing-provenance', dependencies);
    return { kind: 'refused', reason: 'missing-provenance', target };
  }

  // Deliberately authorize every exact ref before the single mutating command.
  // The policy resolves current identity and provenance afresh per target.
  for (const destination of resolution.targets) {
    if (explicitlyApproved(destination)) continue;
    const mutation = dependencies.mutation;
    // The earlier missing-provenance check proves this only for the
    // non-explicit path; keep the guard local so TypeScript and future edits
    // cannot accidentally dereference absent feature context.
    if (!mutation) {
      await emitRemoteGitRefusal(destination, 'missing-provenance', dependencies);
      return { kind: 'refused', reason: 'missing-provenance', target: destination };
    }
    const decision = await authorizeGithubMutation({
      operation: destination.operation,
      target: {
        repository: destination.repository,
        kind: 'remote-ref',
        ref: destination.ref,
      },
      provenance: mutation.provenance,
    }, mutation.dependencies);
    if (decision.kind === 'refused') {
      await emitRemoteGitRefusal(destination, decision.reason, dependencies);
      return { kind: 'refused', reason: decision.reason, target: destination };
    }
  }

  const guarded = await guardPublishedStackPushes(args, resolution.remote, resolution.targets, dependencies);
  if (guarded.kind === 'refuse') {
    // This low-level choke point has no authority to decide a feature's
    // terminal state. Return the typed refusal; FINISH records the halt while
    // halt-record and post-finish maintenance merely skip their write.
    return {
      kind: 'refused',
      reason: 'stack-tip-mismatch',
      target: resolution.targets[0],
      members: guarded.members,
    };
  }

  const preparation = await preparePushRecordings(guarded.args, resolution.targets, dependencies);
  if (preparation.kind === 'refused') {
    await discardPushRecordings(preparation.recordings, dependencies);
    return { kind: 'failed', error: preparation.error, targets: resolution.targets };
  }
  const recordings = preparation.recordings;
  try {
    await dependencies.runRemoteGit([...guarded.args], { cwd: dependencies.cwd, credential: 'write', endpoint: resolution.targets[0].endpoint });
    await completePushRecordings(recordings, dependencies);
    return { kind: 'executed', targets: resolution.targets };
  } catch (error) {
    if (error instanceof GithubBotAuthRefusalError) {
      const destination = resolution.targets[0];
      try {
        if (dependencies.events === undefined) throw error;
        await dependencies.events.emit({
          type: 'github_write_credential_fallback',
          operation: destination.operation,
          target: { repository: destination.repository, kind: 'remote-ref', ref: destination.ref },
          reason: error.reason,
        });
      } catch {
        // The warning could not be delivered: make no operator attempt and
        // surface the typed bot-auth refusal to the caller (Story 4, AB-3).
        throw error;
      }
      try {
        await dependencies.runRemoteGit([...guarded.args], { cwd: dependencies.cwd, credential: 'operator', endpoint: resolution.targets[0].endpoint });
        await completePushRecordings(recordings, dependencies);
        return { kind: 'executed', targets: resolution.targets };
      } catch (fallbackError) {
        await discardPushRecordings(recordings, dependencies);
        return { kind: 'failed', error: messageFor(fallbackError), targets: resolution.targets };
      }
    }
    await discardPushRecordings(recordings, dependencies);
    return { kind: 'failed', error: messageFor(error), targets: resolution.targets };
  }
}
