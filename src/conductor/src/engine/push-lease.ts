import { execa } from 'execa';

/** A deliberately small local-Git seam for the durable push lease refs. */
export interface PushLeaseGitRunner {
  (args: readonly string[], input?: string): Promise<{ readonly stdout: string; readonly exitCode: number }>;
}

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
