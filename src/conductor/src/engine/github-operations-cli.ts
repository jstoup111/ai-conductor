import { readFile } from 'node:fs/promises';

import {
  decodeGithubOperationRequest,
  executeGithubOperation,
  type GithubOperationEventEmitter,
  type GithubOperationResult,
  type GithubOperationRefusalReason,
  type GithubOperationRunner,
  type GithubOperationRequest,
  type GithubOperationTarget,
} from './github-operations.js';
import {
  requestExplicitGithubOperationApproval,
  type InteractiveGithubOperationConfirmation,
} from './github-operation-approval.js';
import { executeSharedGithubOperation } from './github-shared-operations.js';
import { createGithubIntakeAuthorization } from './engineer/intake/github-issues.js';
import { executeRemoteGit, resolveFeatureRemoteMutation, type RemoteGitCommandRunner } from './remote-git-operations.js';
import { makeProductionGit, type GitRunner } from './pr-labels.js';
import { parseFeatureBranch, LEAF_PREFIX, SPEC_PREFIX } from './feature-branch-identity.js';
import { leafRefExists } from './daemon-halt-pr-operations.js';
import { readPublicationRecord } from './stack-publication-record.js';
import { guardPublishedStackWrite } from './stack-tip-guard.js';
import { pushedTipRef } from './push-lease.js';
import { validateStackPayload } from './stack-publication-payload-validation.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import {
  createGuardedGithubOperationRunner,
  makeProductionGh,
  runTrackerRead,
  type GithubMutationExecutionContext,
} from './tracker-client.js';

type FeatureMutationResolution =
  | {
    readonly kind: 'resolved';
    readonly mutation: GithubMutationExecutionContext;
    readonly stackPublication?: Parameters<typeof createGuardedGithubOperationRunner>[1]['stackPublication'];
  }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'refused'; readonly reason: GithubOperationRefusalReason | 'unrecorded-stack-child' };

export interface GithubOperationCliCommand {
  readonly requestFile: string;
}

export function detectGithubOperationCommand(argv: readonly string[]): GithubOperationCliCommand | null {
  if (argv.length !== 5 || argv[2] !== 'github-operation' || argv[3] !== '--request-file') return null;
  const requestFile = argv[4];
  return typeof requestFile === 'string' && requestFile.length > 0 ? { requestFile } : null;
}

export type GithubOperationCliResult =
  | { readonly kind: 'executed'; readonly operation: string; readonly target: GithubOperationTarget }
  | { readonly kind: 'refused'; readonly operation?: string; readonly target?: GithubOperationTarget; readonly reason: string }
  | { readonly kind: 'failed'; readonly operation?: string; readonly target?: GithubOperationTarget; readonly error: string }
  | {
    readonly kind: 'partial';
    readonly operation: string;
    readonly target: GithubOperationTarget;
    readonly created: GithubOperationTarget;
    readonly metadataFailures: readonly { readonly operation: string; readonly error: string }[];
  };

export interface GithubOperationCliInput {
  readonly cwd: string;
  readonly readRequest?: (path: string) => Promise<string>;
  readonly gh?: ReturnType<typeof makeProductionGh>;
  /** Guarded remote transport and Git discovery are injectable for CLI composition tests. */
  readonly git?: GitRunner;
  readonly remoteGit?: typeof executeRemoteGit;
  /** Test seam for the same fresh owner lookup used by production provenance. */
  readonly resolveMachineOwner?: () => Promise<OwnerResolution>;
  /** Test seam; production always builds the canonical guarded runner below. */
  readonly runner?: GithubOperationRunner;
  /** Only an interactive callback can mint approval for one exact shared request. */
  readonly confirmation?: InteractiveGithubOperationConfirmation;
  /** Existing event spine when this command runs inside a conductor process. */
  readonly events?: GithubOperationEventEmitter;
  readonly write?: (line: string) => void;
}

/** Remove request prose from a transport failure before it can enter a persisted event. */
export function boundGithubOperationFailureText(error: string, request: GithubOperationRequest): string {
  let text = error;
  for (const value of Object.values(request.payload ?? {})) {
    if (typeof value === 'string' && value.length > 0) {
      text = text.split(value).join('«payload»');
    }
  }
  if (text.startsWith('Command failed:')) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  }
  return text.trim().slice(0, 1000);
}

async function featureMutationForRequest(
  request: GithubOperationRequest,
  input: GithubOperationCliInput,
  gh: ReturnType<typeof makeProductionGh>,
  git: GitRunner,
): Promise<FeatureMutationResolution> {
  if (request.access === 'read' || request.access === 'intake-write' || request.access === 'shared-write') {
    return { kind: 'unavailable' };
  }
  const { stdout } = await git(['branch', '--show-current'], { cwd: input.cwd });
  const branch = stdout.trim();
  if (!branch) return { kind: 'unavailable' };
  const identity = parseFeatureBranch(branch);
  let slug: string;
  let publication: Awaited<ReturnType<typeof readPublicationRecord>> | undefined;
  const isStackPublicationOperation = request.operation === 'stack.read'
    || request.operation === 'stack.create'
    || request.operation === 'stack.add'
    || request.operation === 'pull-request.retarget';
  const readPublication = async (featureSlug: string) => {
    publication ??= await readPublicationRecord(input.cwd, featureSlug, {
      git: async (args) => {
        try {
          const result = await git(args, { cwd: input.cwd });
          return { exitCode: 0, stdout: result.stdout, stderr: '' };
        } catch (error) {
          return {
            exitCode: typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 1 ? 1 : 128,
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
    return publication;
  };
  if (identity.kind === 'child') {
    // `leafRefExists` reads the probe's exit code, which the CLI's pr-labels
    // `GitRunner` does not surface (it returns only `stdout` and throws on a
    // non-zero exit). Bind a narrow adapter so a child branch's parent leaf
    // existence is decided at the boundary the caller already holds.
    const gitForCwd = async (args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      try {
        const { stdout: probeStdout } = await git(args, { cwd: input.cwd });
        return { exitCode: 0, stdout: probeStdout, stderr: '' };
      } catch (error) {
        if (args[0] === 'show-ref' && (error as { code?: unknown }).code === 1) {
          return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
        }
        throw error;
      }
    };
    const leaf = await leafRefExists(gitForCwd, identity.slug);
    if (leaf !== 'present') {
      return { kind: 'refused', reason: 'invalid-target' };
    }
    slug = identity.slug;
    if (request.context.feature !== undefined && request.context.feature !== slug) {
      return { kind: 'refused', reason: 'invalid-target' };
    }
    const published = await readPublication(identity.slug);
    if (published.kind !== 'record' || published.record.tornDown === true || !published.record.members.some(
      (member) => member.position === identity.child && member.branch === branch,
    )) {
      return { kind: 'refused', reason: 'unrecorded-stack-child' };
    }
  } else {
    slug = branch.startsWith(LEAF_PREFIX) ? branch.slice(LEAF_PREFIX.length) : branch.startsWith(SPEC_PREFIX) ? branch.slice(SPEC_PREFIX.length) : branch;
  }
  if (request.context.feature !== undefined && request.context.feature !== slug) {
    return { kind: 'refused', reason: 'invalid-target' };
  }
  if (isStackPublicationOperation) {
    const published = await readPublication(slug);
    if (published.kind !== 'record' || published.record.tornDown === true) {
      return { kind: 'refused', reason: identity.kind === 'child' ? 'unrecorded-stack-child' : 'invalid-target' };
    }
    const payload = validateStackPayload(published.record, request);
    if (payload.kind === 'refused') return payload;
    if (request.operation === 'stack.read' && request.target.kind === 'stack'
      && (published.record.stack === undefined || request.target.number !== published.record.stack.number)) {
      return { kind: 'refused', reason: 'invalid-target' };
    }
  }
  const resolved = await resolveFeatureRemoteMutation({
    cwd: input.cwd,
    slug,
    branch,
    git: async (args) => git(args, { cwd: input.cwd }),
    gh,
  });
  if (!resolved) return { kind: 'unavailable' };
  if (request.target.kind === 'pull-request' && !isStackPublicationOperation) {
    try {
      const stdout = await runTrackerRead(
        gh,
        input.cwd,
        'pull-request.read',
        resolved.provenance.repository,
        { kind: 'pull-request', number: request.target.number },
        ['pr', 'view', branch, '-R', resolved.provenance.repository, '--json', 'number'],
      );
      if ((JSON.parse(stdout) as { number?: unknown }).number !== request.target.number) {
        return { kind: 'unavailable' };
      }
    } catch {
      return { kind: 'unavailable' };
    }
  }
  return {
    kind: 'resolved',
    mutation: {
      // The resolved feature branch is the only remote-ref capability this CLI
      // composition can supply. The mutation policy compares it to the
      // requested destination before the remote transport is invoked.
      provenance: request.target.kind === 'pull-request' || request.target.kind === 'repository' || request.target.kind === 'stack'
        // The branch-to-PR lookup above independently resolved this exact PR.
        // Preserve that binding for the policy instead of letting a ref grant
        // repository-wide PR authority.
        ? { ...resolved.provenance, target: request.target }
        : resolved.provenance,
      dependencies: {
        ...resolved.dependencies,
        ...(input.resolveMachineOwner === undefined ? {} : { resolveMachineOwner: input.resolveMachineOwner }),
      },
    },
    ...(isStackPublicationOperation && publication?.kind === 'record' && publication.record.tornDown !== true
      ? {
        stackPublication: {
          record: publication.record,
          guardTips: async () => {
            // Native-stack operations and a retarget change the retained leaf's
            // publication shape even when an agent invokes the CLI from a
            // child checkout.  Fence them against that one daemon-owned ref.
            const leafBranch = `${LEAF_PREFIX}${slug}`;
            let source: string;
            try {
              const tip = await git(['rev-parse', '--verify', '--quiet', pushedTipRef(slug, leafBranch)], { cwd: input.cwd });
              source = tip.stdout.trim();
            } catch {
              return { kind: 'refused' as const, reason: 'stack-tip-mismatch' as const };
            }
            if (source === '') return { kind: 'refused' as const, reason: 'stack-tip-mismatch' as const };
            const guard = await guardPublishedStackWrite({
              cwd: input.cwd,
              remote: 'origin',
              slug,
              destination: `refs/heads/${leafBranch}`,
              source,
              durableChildState: true,
              git: async (args, inputText) => {
                try {
                  const result = await git([...args], inputText === undefined ? { cwd: input.cwd } : { cwd: input.cwd, input: inputText });
                  return { stdout: result.stdout, exitCode: 0 };
                } catch (error) {
                  return { stdout: '', exitCode: typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 1 ? 1 : 128 };
                }
              },
              lsRemote: async (args) => {
                const result = await git([...args], { cwd: input.cwd });
                return { stdout: result.stdout };
              },
            });
            return guard.kind === 'refuse'
              ? { kind: 'refused' as const, reason: 'stack-tip-mismatch' as const }
              : undefined;
          },
        },
      }
      : {}),
  };
}

function canonicalCliResult(result: GithubOperationResult, target: GithubOperationTarget): GithubOperationCliResult {
  switch (result.kind) {
    case 'executed': return result;
    case 'refused': return { ...result, target };
    case 'failed': return { ...result, target };
    case 'partial': return { ...result, target: result.created };
  }
}

/** Execute the closed request schema. Raw gh/git argv are deliberately never accepted. */
export async function dispatchGithubOperationCommand(
  command: GithubOperationCliCommand,
  input: GithubOperationCliInput = { cwd: process.cwd() },
): Promise<number> {
  const write = input.write ?? ((line: string) => process.stdout.write(line));
  let request: unknown;
  try {
    request = JSON.parse(await (input.readRequest ?? (async (path) => readFile(path, 'utf8')))(command.requestFile));
  } catch (error) {
    write(`${JSON.stringify({ kind: 'failed', error: `invalid request file: ${error instanceof Error ? error.message : String(error)}` })}\n`);
    return 1;
  }

  const decoded = decodeGithubOperationRequest(request);
  if (decoded.kind === 'refused') {
    write(`${JSON.stringify(decoded)}\n`);
    return 1;
  }

  if (decoded.request.access === 'shared-write') {
    const result = await executeSharedGithubOperation(
      request,
      input.gh ?? makeProductionGh(),
      { cwd: input.cwd, confirmation: input.confirmation, events: input.events },
    );
    const output = canonicalCliResult(result as GithubOperationResult, decoded.request.target);
    write(`${JSON.stringify(output)}\n`);
    return result.kind === 'executed' ? 0 : 1;
  }

  const gh = input.gh ?? makeProductionGh();
  const git = input.git ?? makeProductionGit();
  if (decoded.request.access === 'remote-ref-write') {
    const featureMutation = await featureMutationForRequest(decoded.request, input, gh, git);
    if (featureMutation.kind === 'refused') {
      write(`${JSON.stringify({ kind: 'refused', operation: decoded.request.operation, target: decoded.request.target, reason: featureMutation.reason })}\n`);
      return 1;
    }
    const mutation = featureMutation.kind === 'resolved' ? featureMutation.mutation : undefined;
    const approval = mutation === undefined && decoded.request.operation === 'remote-ref.push'
      ? await requestExplicitGithubOperationApproval(decoded.request, input.confirmation)
      : undefined;
    if (approval?.kind === 'refused') {
      const output: GithubOperationCliResult = {
        kind: 'refused',
        operation: decoded.request.operation,
        target: decoded.request.target,
        reason: approval.reason,
      };
      write(`${JSON.stringify(output)}\n`);
      return 1;
    }
    const result = await (input.remoteGit ?? executeRemoteGit)(
      decoded.request.operation === 'remote-ref.push'
        ? ['push', 'origin', `HEAD:${decoded.request.target.kind === 'remote-ref' ? decoded.request.target.ref : ''}`]
        : ['push', 'origin', '--delete', decoded.request.target.kind === 'remote-ref' ? decoded.request.target.ref.replace(/^refs\/heads\//, '') : ''],
      {
        cwd: input.cwd,
        config: (args) => git(args, { cwd: input.cwd }),
        runRemoteGit: git as RemoteGitCommandRunner,
        mutation,
        ...(approval?.kind === 'approved'
          ? { explicitApproval: { capability: approval.capability, request: decoded.request } }
          : {}),
        events: input.events,
      },
    );
    const output: GithubOperationCliResult = result.kind === 'executed'
      ? { kind: 'executed', operation: decoded.request.operation, target: decoded.request.target }
      : result.kind === 'failed' && result.error === 'published stack tip mismatch'
        ? { kind: 'refused', operation: decoded.request.operation, target: decoded.request.target, reason: 'stack-tip-mismatch' }
      : result.kind === 'refused'
        ? { kind: 'refused', operation: decoded.request.operation, target: decoded.request.target, reason: result.reason }
        : { kind: 'failed', operation: decoded.request.operation, target: decoded.request.target, error: result.kind === 'failed' ? result.error : 'not a remote write' };
    write(`${JSON.stringify(output)}\n`);
    return result.kind === 'executed' ? 0 : 1;
  }

  const featureMutation = await featureMutationForRequest(decoded.request, input, gh, git);
  if (featureMutation.kind === 'refused') {
    write(`${JSON.stringify({ kind: 'refused', operation: decoded.request.operation, target: decoded.request.target, reason: featureMutation.reason })}\n`);
    return 1;
  }
  const runner = input.runner ?? createGuardedGithubOperationRunner(gh, {
    cwd: input.cwd,
    ...(featureMutation.kind === 'resolved' ? { mutation: featureMutation.mutation } : {}),
    ...(featureMutation.kind === 'resolved' && featureMutation.stackPublication !== undefined
      ? { stackPublication: featureMutation.stackPublication }
      : {}),
    intake: createGithubIntakeAuthorization({
      gh,
      cwd: input.cwd,
      confirmation: input.confirmation,
      ...(input.resolveMachineOwner === undefined ? {} : { resolveActor: input.resolveMachineOwner }),
    }),
    events: input.events,
  });
  const result = await executeGithubOperation(
    request,
    runner,
    { events: input.events },
  );
  const output = canonicalCliResult(result as GithubOperationResult, decoded.request.target);
  write(`${JSON.stringify(output)}\n`);
  return result.kind === 'executed' ? 0 : 1;
}
