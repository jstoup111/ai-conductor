// `ai-conductor round-stamp <commit-message>` — add the active routed round
// to commits made by its current host. This is attribution only: every
// unavailable or non-routed shape deliberately leaves the message untouched.

import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { resolveActiveChildForCurrentFeature } from './child-cursor.js';
import { loadConfig } from './config.js';
import { parseFeatureBranch } from './feature-branch-identity.js';
import { hasExactRoundOwnerTrailers } from './round-trailers.js';
import { readRepairMarker } from './routing/route-record-store.js';
import { repairMarkerRefFor } from './routing/routing-refs.js';
import { routingEligible } from './routing/route-types.js';

export interface RoundStampCommand {
  readonly commitMessagePath: string;
  readonly verify: boolean;
}

/** Recognize the hook-only `ai-conductor round-stamp <commit-message>` command. */
export function detectRoundStampCommand(argv: string[]): RoundStampCommand | null {
  if (argv[2] !== 'round-stamp') return null;
  const verify = argv[3] === '--verify';
  const commitMessagePath = verify ? argv[4] : argv[3];
  if (!commitMessagePath) return null;
  return { commitMessagePath, verify };
}

export interface RoundStampDependencies {
  readonly projectRoot: string;
  readonly commitMessagePath: string;
  readonly verify?: boolean;
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
  execution?: 'leaf',
): boolean {
  if (identity.kind === 'child') return identity.child === host;
  // A leaf-execution marker is durable round state. Its leaf branch remains
  // the execution site even if current config disables route discovery.
  if (identity.kind === 'leaf' && execution === 'leaf') return true;
  return (
    identity.kind === 'leaf' &&
    (cursor.kind === 'active' || cursor.kind === 'repair-pending') &&
    cursor.isLeaf &&
    (execution === 'leaf' || cursor.child === host)
  );
}

/**
 * Stamps one Round trailer for a routed host only. A durable leaf-execution
 * marker remains authoritative after routing config changes.
 */
export async function runRoundStamp(deps: RoundStampDependencies): Promise<number> {
  const branch = await currentBranch(deps.projectRoot);
  const identity = branch === undefined ? undefined : parseFeatureBranch(branch);
  if (identity === undefined || (identity.kind !== 'child' && identity.kind !== 'leaf')) return 0;

  const marker = await readRepairMarker(deps.projectRoot, identity.slug);
  // No marker means an unrelated commit, which remains permitted. An
  // unreadable marker cannot prove the mandatory leaf attribution.
  if (marker.kind === 'unreadable') return deps.verify ? 1 : 0;
  const [loadedConfig, cursor] = await Promise.all([
    loadConfig(deps.projectRoot),
    resolveActiveChildForCurrentFeature(deps.projectRoot),
  ]);
  const config = loadedConfig.ok ? loadedConfig.config : undefined;
  // `resolveActiveChildForCurrentFeature` already distinguishes this exact
  // unreadable marker without probing routing refs on N=1 worktrees.
  if (cursor.kind === 'git-error' && cursor.unreadableRef === repairMarkerRefFor(identity.slug)) {
    return deps.verify ? 1 : 0;
  }
  const durableLeafExecution = marker.kind === 'marker' && marker.marker.execution === 'leaf';
  if (!durableLeafExecution && !routingEligible(cursor, config)) return 0;
  if (marker.kind !== 'marker' || !branchHostsMarker(identity, cursor, marker.marker.host, marker.marker.execution))
    return 0;

  let message: string;
  try {
    message = await readFile(deps.commitMessagePath, 'utf8');
  } catch {
    return deps.verify ? 1 : 0;
  }
  const leafExecution = marker.marker.execution === 'leaf' && identity.kind === 'leaf';
  const owner =
    identity.kind === 'leaf' &&
    (cursor.kind === 'active' || cursor.kind === 'repair-pending') &&
    cursor.isLeaf &&
    cursor.child === marker.marker.host
      ? 'leaf'
      : `c${marker.marker.host}`;
  if (deps.verify && !leafExecution) return 0;
  try {
    const parsed = await execa('git', ['interpret-trailers', '--parse'], {
      cwd: deps.projectRoot,
      input: message,
      reject: false,
    });
    if (parsed.exitCode !== 0) return deps.verify ? 1 : 0;
    if (deps.verify) {
      return hasExactRoundOwnerTrailers(parsed.stdout, { roundId: marker.marker.roundId, owner }) ? 0 : 1;
    }
    if (leafExecution) {
      const stamped = await execa(
        'git',
        [
          'interpret-trailers',
          '--in-place',
          '--if-exists',
          'replace',
          '--trailer',
          `Round: ${marker.marker.roundId}`,
          '--trailer',
          `Owner: ${owner}`,
          deps.commitMessagePath,
        ],
        { cwd: deps.projectRoot, reject: false },
      );
      return stamped.exitCode === 0 ? 0 : 1;
    }
    if (/^Round:/m.test(parsed.stdout)) return 0;
    const stamped = await execa(
      'git',
      [
        'interpret-trailers',
        '--in-place',
        '--if-exists',
        'addIfDifferent',
        '--trailer',
        `Round: ${marker.marker.roundId}`,
        deps.commitMessagePath,
      ],
      { cwd: deps.projectRoot, reject: false },
    );
    if (stamped.exitCode !== 0) return deps.verify ? 1 : 0;
  } catch {
    // Ordinary attribution remains advisory, but verification must fail closed.
    return deps.verify ? 1 : 0;
  }
  return 0;
}
