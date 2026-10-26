// `ai-conductor stack-commit-guard` is a pre-commit guard for active operator
// and audit rounds. Hook registration and command dispatch intentionally live
// in Task 13; this module owns only the decision.

import { execa } from 'execa';
import { childBranchFor, parseFeatureBranch } from './feature-branch-identity.js';
import { hasDurableChildState, loadSliceTopology, type SliceTopology } from './slice-topology.js';
import { readRepairMarker, readRouteRecord, type ReadRepairMarkerResult, type ReadRouteRecordResult } from './routing/route-record-store.js';
import type { RoundId } from './routing/route-types.js';

export interface StackCommitGuardDependencies {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly symbolicRef?: () => Promise<string | undefined>;
  readonly stagedPaths?: () => Promise<readonly string[] | undefined>;
  readonly hasDurableChildState?: (worktree: string, slug: string) => Promise<boolean | 'git-error'>;
  readonly loadSliceTopology?: (
    worktree: string,
    slug: string,
    dependencies: { readonly durableChildState: boolean | 'git-error' },
  ) => Promise<SliceTopology>;
  readonly readRepairMarker?: (worktree: string, slug: string) => Promise<ReadRepairMarkerResult>;
  readonly readRouteRecord?: (worktree: string, slug: string, roundId: RoundId) => Promise<ReadRouteRecordResult>;
  readonly print?: (message: string) => void;
}

/** Recognize the hook-only `ai-conductor stack-commit-guard` command. */
export function detectStackCommitGuardCommand(argv: readonly string[]): boolean {
  return argv[2] === 'stack-commit-guard';
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

async function stagedPaths(projectRoot: string): Promise<readonly string[] | undefined> {
  try {
    const result = await execa('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: projectRoot,
      reject: false,
    });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

function isHaltRecordOnly(paths: readonly string[], slug: string): boolean {
  return paths.length > 0 && paths.every((path) => path === `.docs/halted/${slug}.md`);
}

function refuse(print: (message: string) => void, detail: string): number {
  print(`stack-commit-guard: ${detail}`);
  return 1;
}

/**
 * Refuse commits that would put tracked work outside an active landing host.
 * The durable-state check deliberately precedes every routing-ref read: flat
 * features and pre-stack worktrees must retain the ordinary hook path.
 */
export async function runStackCommitGuard(deps: StackCommitGuardDependencies): Promise<number> {
  const branch = await (deps.symbolicRef ?? (() => currentBranch(deps.projectRoot)))();
  const identity = branch === undefined ? undefined : parseFeatureBranch(branch);
  if (identity === undefined || (identity.kind !== 'child' && identity.kind !== 'leaf')) return 0;

  const paths = await (deps.stagedPaths ?? (() => stagedPaths(deps.projectRoot)))();
  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  if (paths === undefined) return refuse(print, 'cannot read staged paths; refusing commit');
  if (paths.length === 0) return 0;
  if (identity.kind === 'leaf' && isHaltRecordOnly(paths, identity.slug)) return 0;

  const durable = await (deps.hasDurableChildState ?? hasDurableChildState)(deps.projectRoot, identity.slug);
  if (durable === false) return 0;
  if (durable === 'git-error') return refuse(print, 'cannot determine durable child state; refusing commit');

  const topology = await (deps.loadSliceTopology ?? loadSliceTopology)(deps.projectRoot, identity.slug, {
    durableChildState: durable,
  });
  if (topology.kind === 'unavailable') {
    return refuse(print, `slice topology is unavailable (${topology.cause}); refusing commit`);
  }
  if (topology.kind === 'unsliced' || topology.positions.length < 2) return 0;

  const marker = await (deps.readRepairMarker ?? readRepairMarker)(deps.projectRoot, identity.slug);
  if (marker.kind === 'absent') return 0;
  if (marker.kind !== 'marker') return refuse(print, 'routed repair marker is unreadable; refusing commit');

  const stored = await (deps.readRouteRecord ?? readRouteRecord)(deps.projectRoot, identity.slug, marker.marker.roundId);
  if (stored.kind !== 'record') {
    return refuse(print, `unreadable route record for active marker ${marker.marker.roundId}; refusing commit`);
  }
  if (stored.record.kind !== 'operator' && stored.record.kind !== 'audit') return 0;

  const host = childBranchFor(identity.slug, marker.marker.host);
  const hostBranch = host.ok ? host.branch : `child ${marker.marker.host}`;
  const isHost = identity.kind === 'child' && identity.child === marker.marker.host;
  if (!isHost) {
    return refuse(
      print,
      // ai-conductor:session-command-context=operator-only
      `refusing tracked-file commit on ${branch}; ${stored.record.kind} round ${marker.marker.roundId} is hosted on ${hostBranch}. Commit on ${hostBranch} or run ai-conductor stack land --abandon.`,
      // /ai-conductor:session-command-context
    );
  }

  const env = deps.env ?? process.env;
  if (stored.record.kind === 'operator' && stored.record.operator?.declaration !== undefined
    && env.CONDUCT_DAEMON_SESSION !== '1') {
    return refuse(
      print,
      `declared landing ${marker.marker.roundId} accepts host commits only from CONDUCT_DAEMON_SESSION=1; declaration is recorded at ${stored.record.operator.declaration.at}.`,
    );
  }
  return 0;
}
