import { dirname, join, normalize } from 'node:path';
import * as fsp from 'node:fs/promises';
import type { SelfHostProviderId } from './provider-home.js';

const OWNER_LEASE_FILE = 'owner.json';

export interface ResolveScratchHomeOptions {
  readonly worktreeRoot: string;
  readonly runId: string;
  readonly attempt: number;
  readonly provider: SelfHostProviderId;
}

/** Minimal filesystem boundary for acquiring and reading a scratch-home lease. */
export interface ScratchFs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options: { recursive: boolean; force: true }): Promise<void>;
  rmdir(path: string): Promise<void>;
}

export const realScratchFs: ScratchFs = {
  mkdir: (path, options) => fsp.mkdir(path, options).then(() => {}),
  writeFile: (path, content) => fsp.writeFile(path, content, 'utf8'),
  readFile: (path) => fsp.readFile(path, 'utf8').then((content) => content, () => null),
  readdir: (path) => fsp.readdir(path),
  rm: (path, options) => fsp.rm(path, options),
  rmdir: (path) => fsp.rmdir(path),
};

export interface ScratchLease {
  readonly repository: string;
  readonly featureSlug: string;
  readonly runId: string;
  readonly attempt: number;
  readonly ownerPid: number;
  readonly startedAt: string;
}

export type ScratchLeaseReadResult =
  | { readonly kind: 'present'; readonly lease: ScratchLease }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'incomplete' };

export interface AcquireScratchHomeOptions extends ResolveScratchHomeOptions {
  readonly repository: string;
  readonly featureSlug: string;
  readonly ownerPid?: number;
  readonly now?: () => Date;
  readonly fs?: ScratchFs;
}

export interface ReleaseScratchHomeOptions extends ResolveScratchHomeOptions {
  readonly fs?: ScratchFs;
}

export type ReleaseScratchHomeResult =
  | { readonly kind: 'released' }
  | { readonly kind: 'failed'; readonly error: string };

export type ScratchOwnerLiveness = 'dead' | 'live' | 'unknown';

export interface SweepScratchOptions {
  readonly worktreeRoot: string;
  readonly fs?: ScratchFs;
  readonly ownerLiveness?: (ownerPid: number) => ScratchOwnerLiveness;
}

export type ScratchSweepDecision =
  | { readonly kind: 'reclaimed'; readonly home: string }
  | {
    readonly kind: 'retained';
    readonly home: string;
    readonly reason: 'no-lease' | 'malformed-lease' | 'incomplete-lease' | 'live-owner' | 'unknown-owner' | 'concurrent-acquisition';
  };

export async function acquireScratchHome(options: AcquireScratchHomeOptions): Promise<string> {
  const home = resolveScratchHome(options);
  const fs = options.fs ?? realScratchFs;
  const lease: ScratchLease = {
    repository: options.repository,
    featureSlug: options.featureSlug,
    runId: options.runId,
    attempt: options.attempt,
    ownerPid: options.ownerPid ?? process.pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  await fs.mkdir(home, { recursive: true });
  try {
    await fs.writeFile(join(home, OWNER_LEASE_FILE), serializeScratchLease(lease));
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return home;
}

/** Removes an attempt's scratch home and its run directory once no attempts remain. */
export async function releaseScratchHome(options: ReleaseScratchHomeOptions): Promise<ReleaseScratchHomeResult> {
  const fs = options.fs ?? realScratchFs;
  const home = resolveScratchHome(options);
  try {
    await fs.rm(home, { recursive: true, force: true });
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  try {
    await fs.rmdir(dirname(home));
  } catch (error) {
    if (isNonEmptyOrMissingDirectory(error)) return { kind: 'released' };
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  return { kind: 'released' };
}

/** Reclaims only scratch homes whose owner lease names a process known to be dead. */
export async function sweepScratch(options: SweepScratchOptions): Promise<readonly ScratchSweepDecision[]> {
  const fs = options.fs ?? realScratchFs;
  const ownerLiveness = options.ownerLiveness ?? probeScratchOwnerLiveness;
  const scratchRoot = join(normalize(options.worktreeRoot), '.daemon', 'scratch');
  const decisions: ScratchSweepDecision[] = [];

  for (const runId of await readDirectory(scratchRoot, fs)) {
    const runDirectory = join(scratchRoot, runId);
    for (const attempt of await readDirectory(runDirectory, fs)) {
      const home = join(runDirectory, attempt);
      const lease = await readScratchLease(home, { fs });
      if (lease.kind !== 'present') {
        if (lease.kind === 'missing' && (await readScratchLease(home, { fs })).kind === 'present') {
          decisions.push({ kind: 'retained', home, reason: 'concurrent-acquisition' });
        } else {
          decisions.push({ kind: 'retained', home, reason: leaseReason(lease.kind) });
        }
        continue;
      }

      switch (ownerLiveness(lease.lease.ownerPid)) {
        case 'dead':
          await fs.rm(home, { recursive: true, force: true });
          decisions.push({ kind: 'reclaimed', home });
          break;
        case 'live':
          decisions.push({ kind: 'retained', home, reason: 'live-owner' });
          break;
        case 'unknown':
          decisions.push({ kind: 'retained', home, reason: 'unknown-owner' });
          break;
      }
    }
  }
  return decisions;
}

export function probeScratchOwnerLiveness(ownerPid: number): ScratchOwnerLiveness {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return 'unknown';
  try {
    process.kill(ownerPid, 0);
    return 'live';
  } catch (error) {
    return isNoSuchProcessError(error) ? 'dead' : 'unknown';
  }
}

function serializeScratchLease(lease: ScratchLease): string {
  return JSON.stringify({
    repository: lease.repository,
    featureSlug: lease.featureSlug,
    runId: lease.runId,
    attempt: lease.attempt,
    ownerPid: lease.ownerPid,
    startedAt: lease.startedAt,
  });
}

export async function readScratchLease(home: string, options: { fs?: ScratchFs } = {}): Promise<ScratchLeaseReadResult> {
  let content: string | null;
  try {
    content = await (options.fs ?? realScratchFs).readFile(join(home, OWNER_LEASE_FILE));
  } catch {
    return { kind: 'malformed' };
  }
  if (content === null) return { kind: 'missing' };

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { kind: 'malformed' };
  }
  if (!isScratchLease(value)) return { kind: 'incomplete' };
  return { kind: 'present', lease: value };
}

function isScratchLease(value: unknown): value is ScratchLease {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const lease = value as Record<string, unknown>;
  return typeof lease.repository === 'string' &&
    typeof lease.featureSlug === 'string' &&
    typeof lease.runId === 'string' &&
    typeof lease.attempt === 'number' &&
    typeof lease.ownerPid === 'number' &&
    typeof lease.startedAt === 'string';
}

function leaseReason(kind: Exclude<ScratchLeaseReadResult['kind'], 'present'>): 'no-lease' | 'malformed-lease' | 'incomplete-lease' {
  switch (kind) {
    case 'missing': return 'no-lease';
    case 'malformed': return 'malformed-lease';
    case 'incomplete': return 'incomplete-lease';
  }
}

function isNonEmptyOrMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'ENOTEMPTY' || (error as { code?: unknown }).code === 'ENOENT');
}

async function readDirectory(path: string, fs: ScratchFs): Promise<readonly string[]> {
  try {
    return await fs.readdir(path);
  } catch {
    return [];
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: unknown }).code === 'ESRCH';
}

export function resolveScratchHome(options: ResolveScratchHomeOptions): string {
  const { worktreeRoot, runId, attempt, provider } = options;

  if (worktreeRoot === undefined) {
    throw new Error('worktree root is required');
  }
  if (runId === undefined) {
    throw new Error('run id is required');
  }
  if (attempt === undefined) {
    throw new Error('attempt is required');
  }
  if (provider === undefined) {
    throw new Error('provider is required');
  }

  return join(normalize(worktreeRoot), '.daemon', 'scratch', runId, `${attempt}-${provider}`);
}
