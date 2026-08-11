import { join, normalize } from 'node:path';
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
}

export const realScratchFs: ScratchFs = {
  mkdir: (path, options) => fsp.mkdir(path, options).then(() => {}),
  writeFile: (path, content) => fsp.writeFile(path, content, 'utf8'),
  readFile: (path) => fsp.readFile(path, 'utf8').then((content) => content, () => null),
};

export interface ScratchLease {
  readonly repository: string;
  readonly featureSlug: string;
  readonly runId: string;
  readonly attempt: number;
  readonly ownerPid: number;
  readonly startedAt: string;
}

export interface AcquireScratchHomeOptions extends ResolveScratchHomeOptions {
  readonly repository: string;
  readonly featureSlug: string;
  readonly ownerPid?: number;
  readonly now?: () => Date;
  readonly fs?: ScratchFs;
}

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
  await fs.writeFile(join(home, OWNER_LEASE_FILE), JSON.stringify(lease));
  return home;
}

export async function readScratchLease(home: string, options: { fs?: ScratchFs } = {}): Promise<ScratchLease | null> {
  const content = await (options.fs ?? realScratchFs).readFile(join(home, OWNER_LEASE_FILE));
  return content === null ? null : JSON.parse(content) as ScratchLease;
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
