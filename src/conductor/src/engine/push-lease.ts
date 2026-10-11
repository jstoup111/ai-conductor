import { execa } from 'execa';
import type { ConductorEvent } from '../types/events.js';

/** A deliberately small local-Git seam for the durable push lease refs. */
export interface PushLeaseGitRunner {
  (args: readonly string[], input?: string): Promise<{ readonly stdout: string; readonly exitCode: number }>;
}

/**
 * The already-authorized remote-Git boundary.  Keeping this as a tiny
 * callback makes the lease decision own local Git only: a caller still owns
 * the provenance and credential context needed by executeRemoteGit.
 */
export interface ExpectedLeaseRemoteGit<Result extends ExpectedLeaseRemoteResult = ExpectedLeaseRemoteResult> {
  (args: readonly string[]): Promise<Result>;
}

export type ExpectedLeaseRemoteResult =
  | { readonly kind: 'executed' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'not-remote-write' };

/** The canonical event spine subset used by an expected-SHA refusal. */
export interface PushLeaseEventEmitter {
  emit(event: Extract<ConductorEvent, { type: 'push_lease_refused' }>): Promise<void>;
}

type ExpectedLeasePreflightResult = Exclude<ExpectedLeaseRemoteResult, { readonly kind: 'executed' }>;

/** The remote result is retained so callers can consume its successful-write metadata. */
export type ForcePushWithExpectedLeaseResult<RemoteResult extends ExpectedLeaseRemoteResult = ExpectedLeaseRemoteResult> =
  | ExpectedLeasePreflightResult
  | RemoteResult;

export interface PushLeaseIntent {
  readonly expected: string | undefined;
  readonly new: string;
}

export interface PreparedPushedTip {
  readonly slug: string;
  readonly branch: string;
  readonly expected: string | undefined;
  readonly new: string;
  readonly intentObject: string;
}

export function pushedTipRef(slug: string, branch: string): string {
  return `refs/conductor/${slug}/pushed/${branch}`;
}

export function pushedTipIntentRef(slug: string, branch: string): string {
  return `refs/conductor/${slug}/push-intent/${branch}`;
}

function defaultGit(cwd: string): PushLeaseGitRunner {
  return async (args, input) => {
    const result = await execa('git', [...args], { cwd, input, reject: false });
    return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
  };
}

async function currentRef(git: PushLeaseGitRunner, ref: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '--verify', '--quiet', ref]);
  const value = result.stdout.trim();
  return result.exitCode === 0 && value !== '' ? value : undefined;
}

function branchName(branch: string): string {
  return branch.replace(/^refs\/heads\//, '');
}

function remoteRef(branch: string): string {
  return `refs/heads/${branchName(branch)}`;
}

function trackingRef(branch: string): string {
  return `refs/remotes/origin/${branchName(branch)}`;
}

async function readPushIntent(
  git: PushLeaseGitRunner,
  slug: string,
  branch: string,
): Promise<{ readonly intent: PushLeaseIntent; readonly object: string } | undefined> {
  const ref = pushedTipIntentRef(slug, branch);
  const object = await currentRef(git, ref);
  if (!object) return undefined;
  const content = await git(['cat-file', '-p', object]);
  if (content.exitCode !== 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(content.stdout);
    if (
      typeof parsed !== 'object' || parsed === null
      || typeof (parsed as { new?: unknown }).new !== 'string'
      || ((parsed as { expected?: unknown }).expected !== undefined
        && typeof (parsed as { expected?: unknown }).expected !== 'string')
    ) return undefined;
    return {
      object,
      intent: {
        expected: (parsed as { expected?: string }).expected,
        new: (parsed as { new: string }).new,
      },
    };
  } catch {
    return undefined;
  }
}

async function isAncestor(git: PushLeaseGitRunner, older: string, newer: string): Promise<boolean> {
  const result = await git(['merge-base', '--is-ancestor', older, newer]);
  return result.exitCode === 0;
}

async function emitLeaseRefusal(
  events: PushLeaseEventEmitter | undefined,
  branch: string,
  expected: string,
  actual: string,
): Promise<void> {
  await events?.emit({
    type: 'push_lease_refused',
    // Git supplied both values and the event union represents validated SHAs
    // nominally. The command values stay opaque to the lease decision.
    ref: remoteRef(branch) as Extract<ConductorEvent, { type: 'push_lease_refused' }>['ref'],
    expected: expected as Extract<ConductorEvent, { type: 'push_lease_refused' }>['expected'],
    actual: actual as Extract<ConductorEvent, { type: 'push_lease_refused' }>['actual'],
  });
}

/**
 * Make the decision for a destructive feature-branch publication before the
 * authorized transport boundary sees a push.  A single-branch fetch refreshes
 * the local tracking value used both for the decision and by the pre-push
 * hook; the actual write is always leased against that exact remote SHA.
 *
 * Successful pushes are recorded by executeRemoteGit (Task 35).  This helper
 * deliberately delegates the write to that chokepoint so every lease still
 * receives its ownership/credential checks and durable pushed-tip recording.
 */
export async function forcePushWithExpectedLease<RemoteResult extends ExpectedLeaseRemoteResult>(input: {
  readonly cwd: string;
  readonly slug: string;
  readonly branch: string;
  readonly remoteGit: ExpectedLeaseRemoteGit<RemoteResult>;
  readonly events?: PushLeaseEventEmitter;
  readonly git?: PushLeaseGitRunner;
}): Promise<ForcePushWithExpectedLeaseResult<RemoteResult>> {
  const git = input.git ?? defaultGit(input.cwd);
  const branch = branchName(input.branch);
  const tracking = trackingRef(branch);
  const initialTracking = await currentRef(git, tracking);
  const recorded = await currentRef(git, pushedTipRef(input.slug, branch));
  const outstanding = await readPushIntent(git, input.slug, branch);
  const discardOutstanding = async (): Promise<void> => {
    if (!outstanding) return;
    await git(['update-ref', '-d', pushedTipIntentRef(input.slug, branch), outstanding.object]);
  };

  const fetched = await git([
    'fetch', 'origin', `+${remoteRef(branch)}:${tracking}`,
  ]);
  if (fetched.exitCode !== 0) {
    await discardOutstanding();
    return { kind: 'failed', error: `could not fetch ${remoteRef(branch)} before force push` };
  }

  const actual = await currentRef(git, tracking);
  if (!actual) {
    await discardOutstanding();
    return { kind: 'failed', error: `could not read remote tip for ${remoteRef(branch)} after fetch` };
  }

  // A completed remote write whose local record failed is recoverable only
  // when the remote still names the intent's exact new SHA.  CAS-record it
  // before making a new decision, so the next lease has a durable anchor.
  let expected = recorded;
  if (expected !== actual && outstanding?.intent.new === actual) {
    const adopted = await recordPushedTip({
      cwd: input.cwd,
      prepared: {
        slug: input.slug,
        branch,
        expected: outstanding.intent.expected,
        new: outstanding.intent.new,
        intentObject: outstanding.object,
      },
      git,
    });
    if (!adopted) {
      await discardOutstanding();
      return { kind: 'failed', error: `could not record recovered push intent for ${remoteRef(branch)}` };
    }
    expected = actual;
  }

  // No prior tracking value means this process has no baseline for an
  // unrecorded feature. Even a fresh fetch is not a substitute for that
  // baseline: fail closed rather than treating the fetched ref as "seen".
  if (!expected && !initialTracking) {
    await discardOutstanding();
    return { kind: 'refused', reason: `missing tracking ref ${tracking} for unrecorded force push` };
  }

  const remoteIncludedInHead = await isAncestor(git, actual, 'HEAD');
  const allowed = expected === actual
    || remoteIncludedInHead
    || (!expected && initialTracking === actual);
  if (!allowed) {
    await emitLeaseRefusal(input.events, branch, expected ?? initialTracking!, actual);
    await discardOutstanding();
    return {
      kind: 'refused',
      reason: `remote tip for ${remoteRef(branch)} changed from ${expected ?? initialTracking} to ${actual}`,
    };
  }

  return input.remoteGit([
    'push', 'origin', `HEAD:${remoteRef(branch)}`,
    `--force-with-lease=${remoteRef(branch)}:${actual}`,
  ]);
}

/** Resolve the commit a push refspec's source names before the remote write. */
export async function resolvePushedTipSource(input: {
  readonly cwd: string;
  readonly source: string;
  readonly git?: PushLeaseGitRunner;
}): Promise<string | undefined> {
  const git = input.git ?? defaultGit(input.cwd);
  const result = await git(['rev-parse', '--verify', '--quiet', `${input.source}^{commit}`]);
  const value = result.stdout.trim();
  return result.exitCode === 0 && value !== '' ? value : undefined;
}

/**
 * Writes the intent before the transport can mutate the remote. The object is
 * a blob rather than a commit so the ref is durable metadata, not history.
 */
export async function preparePushedTip(input: {
  readonly cwd: string;
  readonly slug: string;
  readonly branch: string;
  readonly new: string;
  readonly git?: PushLeaseGitRunner;
}): Promise<PreparedPushedTip | undefined> {
  const git = input.git ?? defaultGit(input.cwd);
  const expected = await currentRef(git, pushedTipRef(input.slug, input.branch));
  const intent: PushLeaseIntent = { expected, new: input.new };
  const blob = await git(['hash-object', '-w', '--stdin'], `${JSON.stringify(intent)}\n`);
  const intentObject = blob.stdout.trim();
  if (blob.exitCode !== 0 || intentObject === '') return undefined;

  const written = await git(['update-ref', pushedTipIntentRef(input.slug, input.branch), intentObject, '']);
  if (written.exitCode !== 0) return undefined;
  return { slug: input.slug, branch: input.branch, expected, new: input.new, intentObject };
}

/**
 * CAS-record a successful remote write. The intent is intentionally retained
 * when this fails: the later expected-SHA lease path can recover it.
 */
export async function recordPushedTip(input: {
  readonly cwd: string;
  readonly prepared: PreparedPushedTip;
  readonly git?: PushLeaseGitRunner;
}): Promise<boolean> {
  const git = input.git ?? defaultGit(input.cwd);
  const { prepared } = input;
  const recorded = await git([
    'update-ref',
    pushedTipRef(prepared.slug, prepared.branch),
    prepared.new,
    prepared.expected ?? '',
  ]);
  if (recorded.exitCode !== 0) return false;

  const removed = await git([
    'update-ref', '-d',
    pushedTipIntentRef(prepared.slug, prepared.branch),
    prepared.intentObject,
  ]);
  return removed.exitCode === 0;
}

/** A failed or refused remote push never leaves a stale intent behind. */
export async function discardPushedTipIntent(input: {
  readonly cwd: string;
  readonly prepared: PreparedPushedTip;
  readonly git?: PushLeaseGitRunner;
}): Promise<void> {
  const git = input.git ?? defaultGit(input.cwd);
  await git([
    'update-ref', '-d',
    pushedTipIntentRef(input.prepared.slug, input.prepared.branch),
    input.prepared.intentObject,
  ]);
}
