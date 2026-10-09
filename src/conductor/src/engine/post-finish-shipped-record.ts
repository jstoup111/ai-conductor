import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../ui/events.js';
import { type GitRunner } from './pr-labels.js';
import { type GhRunner } from './owner-gate/identity.js';
import { dispatchShippedRecord } from './shipped-record-cli.js';
import { executeRemoteGit, resolveFeatureRemoteMutation } from './remote-git-operations.js';
import type { GithubMutationExecutionContext } from './tracker-client.js';
import { resolveShipmentIdentity } from './shipment-identity.js';

export interface PostFinishShippedRecordRefreshOptions {
  runGit: GitRunner;
  cwd: string;
  requestedSlug: string;
  pr: string;
  log: (message: string) => void;
  gh: GhRunner;
  remoteGit?: typeof executeRemoteGit;
  remoteMutation?: GithubMutationExecutionContext;
  events: ConductorEventEmitter;
}

/** Refresh the final Cost block and make its push best-effort and non-blocking. */
export async function refreshPostFinishShippedRecord({
  runGit,
  cwd,
  requestedSlug,
  pr,
  log,
  gh,
  remoteGit,
  remoteMutation,
  events,
}: PostFinishShippedRecordRefreshOptions): Promise<void> {
  try {
    const planPaths = (await readdir(join(cwd, '.docs/plans')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('.docs/plans', name));
    const resolution = resolveShipmentIdentity(requestedSlug, planPaths);
    if (resolution.kind !== 'resolved') {
      throw new Error('unable to resolve canonical post-finish shipment identity');
    }

    // The refresh owns only its shipped marker. Refuse to enter the transaction
    // when any tracked worktree or index change could be lost by recovery;
    // untracked runtime state such as `.pipeline/` is deliberately irrelevant.
    await runGit(['diff', '--quiet'], { cwd });
    await runGit(['diff', '--cached', '--quiet'], { cwd });

    const { stdout: preRefreshOut } = await runGit(['rev-parse', 'HEAD'], { cwd });
    const preRefreshHead = preRefreshOut.trim();
    await dispatchShippedRecord({ kind: 'write', slug: requestedSlug, pr }, cwd);
    const { stdout: postRefreshOut } = await runGit(['rev-parse', 'HEAD'], { cwd });
    const postRefreshHead = postRefreshOut.trim();
    if (postRefreshHead === preRefreshHead) return;

    // Prove the immutable commit object once. The later update-ref supplies the
    // mutable-HEAD check atomically, so rollback cannot clobber another commit.
    const { stdout: parentOut } = await runGit(
      ['rev-parse', `${postRefreshHead}^`],
      { cwd },
    );
    const { stdout: subjectOut } = await runGit(
      ['show', '-s', '--format=%s', postRefreshHead],
      { cwd },
    );
    const { stdout: pathsOut } = await runGit(
      ['diff-tree', '--no-commit-id', '--name-only', '-r', postRefreshHead],
      { cwd },
    );
    const paths = pathsOut.split('\n').filter((path) => path !== '');
    const expected = resolution.identity;
    if (
      parentOut.trim() !== preRefreshHead ||
      subjectOut.trim() !== `shipped record: ${expected.slug}` ||
      paths.length !== 1 ||
      paths[0] !== expected.recordPath
    ) {
      throw new Error('refusing to push an unverified post-finish commit');
    }

    try {
      const { stdout: branchOut } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
      const resolvedMutation = remoteMutation ?? await resolveFeatureRemoteMutation({
        cwd,
        slug: requestedSlug,
        branch: branchOut.trim(),
        git: (args) => runGit(args, { cwd }),
        gh,
      });
      await pushPostFinishShippedRecord({
        runGit,
        cwd,
        branch: branchOut.trim(),
        remoteGit,
        remoteMutation: resolvedMutation,
        events,
      });
    } catch (pushError) {
      let recoveryHead = preRefreshHead;
      let upstreamHead: string | undefined;
      try {
        const { stdout } = await runGit(
          ['rev-parse', '--verify', '@{u}^{commit}'],
          { cwd },
        );
        upstreamHead = stdout.trim() || undefined;
      } catch {
        // Missing/indeterminate upstream recovers to the known pushed parent.
      }

      if (upstreamHead !== postRefreshHead) {
        if (upstreamHead) {
          try {
            await runGit(
              ['merge-base', '--is-ancestor', preRefreshHead, upstreamHead],
              { cwd },
            );
            const { stdout: postTreeOut } = await runGit(
              ['rev-parse', '--verify', `${postRefreshHead}^{tree}`],
              { cwd },
            );
            const { stdout: upstreamTreeOut } = await runGit(
              ['rev-parse', '--verify', `${upstreamHead}^{tree}`],
              { cwd },
            );
            if (upstreamTreeOut.trim() === postTreeOut.trim()) {
              recoveryHead = upstreamHead;
            }
          } catch {
            // An unrelated/indeterminate or tree-divergent upstream is unsafe;
            // use the known pushed parent.
          }
        }
        await runGit(['update-ref', 'HEAD', recoveryHead, postRefreshHead], { cwd });
        await runGit(['reset', '--hard', 'HEAD'], { cwd });
      }
      throw pushError;
    }
  } catch (err) {
    log(
      `post-finish shipped-record refresh failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function pushPostFinishShippedRecord(input: {
  runGit: GitRunner;
  cwd: string;
  branch: string;
  remoteGit?: typeof executeRemoteGit;
  remoteMutation?: GithubMutationExecutionContext;
  events?: ConductorEventEmitter;
}): Promise<void> {
  const pushed = await (input.remoteGit ?? executeRemoteGit)(
    ['push', 'origin', `HEAD:refs/heads/${input.branch}`],
    {
      cwd: input.cwd,
      config: (args) => input.runGit(args, { cwd: input.cwd }),
      runRemoteGit: input.runGit,
      mutation: input.remoteMutation,
      events: input.events,
    },
  );
  if (pushed.kind !== 'executed') throw new Error(remoteFailure(pushed));
}

export function remoteFailure(result: Awaited<ReturnType<typeof executeRemoteGit>>): string {
  if (result.kind === 'failed') return result.error;
  if (result.kind === 'refused') return result.reason;
  return 'remote Git operation did not execute';
}
