// `ai-conductor round-stamp <commit-message>` — add the active routed round
// to commits made by its current host. This is attribution only: every
// unavailable or non-routed shape deliberately leaves the message untouched.

import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { resolveActiveChildForCurrentFeature } from './child-cursor.js';
import { loadConfig } from './config.js';
import { parseFeatureBranch } from './feature-branch-identity.js';
import { readRepairMarker } from './routing/route-record-store.js';
import { routingEligible } from './routing/route-types.js';

export interface RoundStampCommand {
  readonly commitMessagePath: string;
}

/** Recognize the hook-only `ai-conductor round-stamp <commit-message>` command. */
export function detectRoundStampCommand(argv: string[]): RoundStampCommand | null {
  if (argv[2] !== 'round-stamp' || !argv[3]) return null;
  return { commitMessagePath: argv[3] };
}

export interface RoundStampDependencies {
  readonly projectRoot: string;
  readonly commitMessagePath: string;
}

async function currentBranch(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });
    return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function branchHostsMarker(
  identity: ReturnType<typeof parseFeatureBranch>,
  cursor: Awaited<ReturnType<typeof resolveActiveChildForCurrentFeature>>,
  host: number,
): boolean {
  if (identity.kind === 'child') return identity.child === host;
  return identity.kind === 'leaf' && (cursor.kind === 'active' || cursor.kind === 'repair-pending') &&
    cursor.isLeaf && cursor.child === host;
}

/**
 * Stamps one Round trailer for a routed host only. `routingEligible` is the
 * gate before the marker read: N=1 and routing-off worktrees therefore never
 * probe routing-only refs.
 */
export async function runRoundStamp(deps: RoundStampDependencies): Promise<number> {
  const branch = await currentBranch(deps.projectRoot);
  const identity = branch === undefined ? undefined : parseFeatureBranch(branch);
  if (identity === undefined || (identity.kind !== 'child' && identity.kind !== 'leaf')) return 0;

  const [loadedConfig, cursor] = await Promise.all([
    loadConfig(deps.projectRoot),
    resolveActiveChildForCurrentFeature(deps.projectRoot),
  ]);
  const config = loadedConfig.ok ? loadedConfig.config : undefined;
  if (!routingEligible(cursor, config)) return 0;

  const marker = await readRepairMarker(deps.projectRoot, identity.slug);
  if (marker.kind !== 'marker' || !branchHostsMarker(identity, cursor, marker.marker.host)) return 0;

  let message: string;
  try {
    message = await readFile(deps.commitMessagePath, 'utf8');
  } catch {
    return 0;
  }
  try {
    const parsed = await execa('git', ['interpret-trailers', '--parse'], {
      cwd: deps.projectRoot,
      input: message,
      reject: false,
    });
    if (parsed.exitCode !== 0 || /^Round:/m.test(parsed.stdout)) return 0;
    await execa('git', [
      'interpret-trailers', '--in-place', '--if-exists', 'addIfDifferent',
      '--trailer', `Round: ${marker.marker.roundId}`, deps.commitMessagePath,
    ], { cwd: deps.projectRoot, reject: false });
  } catch {
    // Attribution hooks fail open when their local Git plumbing is unavailable.
  }
  return 0;
}
