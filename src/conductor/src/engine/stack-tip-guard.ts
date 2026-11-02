import { daemonOwnedSlugOfRef } from './feature-branch-identity.js';
import {
  adoptPushedTipIntentAtRemoteTip,
  decodePushedTipIntent,
  pushedTipRef,
  type PushLeaseGitRunner,
} from './push-lease.js';
import { activePublicationRecord, type PublicationMember } from './stack-publication-record.js';
import { readRefreshLedger, type PublishedStackRefreshAuthorization } from './stack-refresh-ledger.js';
import type { GitRunner } from './rebase.js';

/** The result of checking one published stack write at the remote-Git choke point. */
export type PublishedStackWriteGuard =
  | { readonly kind: 'not-published-stack' }
  | { readonly kind: 'allow'; readonly expected: string }
  | { readonly kind: 'refuse'; readonly members: readonly PublicationMember[] };

function remoteRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function shaFor(stdout: string, ref: string): string | undefined {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.endsWith(`\t${ref}`));
  const sha = line?.slice(0, line.indexOf('\t')).trim();
  return sha === '' || sha === undefined ? undefined : sha;
}

async function readRef(git: PushLeaseGitRunner, ref: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '--verify', '--quiet', ref]);
  const value = result.stdout.trim();
  return result.exitCode === 0 && value !== '' ? value : undefined;
}

function asGitRunner(git: PushLeaseGitRunner): GitRunner {
  return async (args, options) => {
    const result = await git(args, options?.input);
    return { ...result, stderr: '' };
  };
}

/**
 * Proves that a write to a published stack member is a fast-forward from the
 * exact remote state recorded by the engine.  The sole remote read covers all
 * members, so a server-side rewrite anywhere freezes every member write.
 */
export async function guardPublishedStackWrite(input: {
  readonly cwd: string;
  readonly remote: string;
  readonly slug: string;
  readonly destination: string;
  readonly source: string;
  /** The remote-Git choke point established durable stacked-child state. */
  readonly durableChildState: true;
  /** Present only for the FINISH refresh of a durable routed-restack ledger. */
  readonly refreshAuthorization?: PublishedStackRefreshAuthorization;
  readonly git: PushLeaseGitRunner;
  readonly lsRemote: (args: readonly string[]) => Promise<{ readonly stdout: string }>;
}): Promise<PublishedStackWriteGuard> {
  const branch = input.destination.replace(/^refs\/heads\//, '');
  if (daemonOwnedSlugOfRef(input.destination) !== input.slug) return { kind: 'not-published-stack' };

  const stored = await activePublicationRecord(input.cwd, input.slug, { git: asGitRunner(input.git) });
  const member = stored?.record.members.find((candidate) => candidate.branch === branch);
  if (stored === undefined || member === undefined) return { kind: 'not-published-stack' };

  let remoteTips: { readonly stdout: string };
  try {
    remoteTips = await input.lsRemote([
      'ls-remote', '--heads', input.remote,
      ...stored.record.members.map((candidate) => remoteRef(candidate.branch)),
    ]);
  } catch {
    return { kind: 'refuse', members: stored.record.members };
  }

  const mismatched: PublicationMember[] = [];
  const recorded = new Map<string, string>();
  for (const candidate of stored.record.members) {
    const ref = remoteRef(candidate.branch);
    const remoteTip = shaFor(remoteTips.stdout, ref);
    const intent = await decodePushedTipIntent({ git: input.git, slug: input.slug, branch: candidate.branch });
    if (remoteTip !== undefined && intent.kind === 'decoded' && intent.prepared.new === remoteTip) {
      const adopted = await adoptPushedTipIntentAtRemoteTip({
        cwd: input.cwd, remoteTip, prepared: intent.prepared, git: input.git,
      });
      if (!adopted) {
        mismatched.push(candidate);
        continue;
      }
    }
    const pushed = await readRef(input.git, pushedTipRef(input.slug, candidate.branch));
    if (remoteTip === undefined || pushed === undefined || remoteTip !== pushed) {
      mismatched.push(candidate);
    } else {
      recorded.set(candidate.branch, pushed);
    }
  }
  if (mismatched.length > 0) return { kind: 'refuse', members: mismatched };

  const expected = recorded.get(branch);
  if (expected === undefined) return { kind: 'refuse', members: [member] };
  const fastForward = await input.git(['merge-base', '--is-ancestor', expected, input.source]);
  if (fastForward.exitCode === 0) return { kind: 'allow', expected };

  // Rewrites remain forbidden by default.  FINISH may refresh precisely the
  // recorded result of a routed restack, but not an arbitrary descendant and
  // not a ledger belonging to another feature.
  if (input.refreshAuthorization?.slug !== input.slug) return { kind: 'refuse', members: [member] };
  const refresh = await readRefreshLedger(input.cwd, input.slug, { git: asGitRunner(input.git) });
  if (refresh.kind !== 'ledger') return { kind: 'refuse', members: [member] };
  const ledgerMember = refresh.ledger.members[branch];
  if (ledgerMember === undefined) return { kind: 'refuse', members: [member] };
  const recordedAncestor = await input.git(['merge-base', '--is-ancestor', ledgerMember.recordedTip, input.source]);
  return recordedAncestor.exitCode === 0
    ? { kind: 'allow', expected }
    : { kind: 'refuse', members: [member] };
}
