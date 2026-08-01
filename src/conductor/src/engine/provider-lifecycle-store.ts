import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderAttemptIdentity, ProviderLifecycleState } from './provider-lifecycle.js';

export interface ProviderLifecycleEpisodeStoreFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  writeFile(path: string, content: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
}

export interface ProviderLifecycleEpisodeStore {
  readProviderLifecycleEpisode(
    projectRoot: string,
    logicalStep: string,
  ): Promise<ProviderLifecycleEpisodeReadResult>;
  writeProviderLifecycleEpisode(projectRoot: string, lifecycle: ProviderLifecycleState): Promise<void>;
}

const PROVIDER_LIFECYCLE_EPISODE_VERSION = 1;

interface StoredProviderLifecycleEpisode {
  version: typeof PROVIDER_LIFECYCLE_EPISODE_VERSION;
  lifecycle: ProviderLifecycleState;
}

export type ProviderLifecycleEpisodeReadResult =
  | { recoveryAuthority: 'fresh' }
  | { recoveryAuthority: 'persisted'; lifecycle: ProviderLifecycleState }
  | { recoveryAuthority: 'denied'; reason: ProviderLifecycleEpisodeReadFailureReason };

export type ProviderLifecycleEpisodeReadFailureReason =
  | 'unreadable'
  | 'malformed-json'
  | 'unknown-version'
  | 'unknown-state'
  | 'impossible-recovery-count'
  | 'invalid-lifecycle';

const defaultFileOperations: ProviderLifecycleEpisodeStoreFileOperations = {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
};

function episodePath(projectRoot: string, logicalStep: string): string {
  return join(projectRoot, '.pipeline', `provider-lifecycle-${logicalStep}.json`);
}

export function createProviderLifecycleEpisodeStore(
  fileOperations: ProviderLifecycleEpisodeStoreFileOperations = defaultFileOperations,
): ProviderLifecycleEpisodeStore {
  return {
    readProviderLifecycleEpisode(projectRoot, logicalStep): Promise<ProviderLifecycleEpisodeReadResult> {
      return readProviderLifecycleEpisodeWithFileOperations(fileOperations, projectRoot, logicalStep);
    },
    async writeProviderLifecycleEpisode(projectRoot, lifecycle): Promise<void> {
      const path = episodePath(projectRoot, lifecycle.attempt.logicalStep);
      const directory = join(projectRoot, '.pipeline');
      const temporaryPath = join(
        directory,
        `.provider-lifecycle-${lifecycle.attempt.logicalStep}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
      );

      await fileOperations.mkdir(directory, { recursive: true });
      try {
        const episode: StoredProviderLifecycleEpisode = {
          version: PROVIDER_LIFECYCLE_EPISODE_VERSION,
          lifecycle,
        };
        await fileOperations.writeFile(temporaryPath, `${JSON.stringify(episode, null, 2)}\n`);
        await fileOperations.rename(temporaryPath, path);
      } catch (error) {
        await fileOperations.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}

const defaultStore = createProviderLifecycleEpisodeStore();

export async function writeProviderLifecycleEpisode(
  projectRoot: string,
  lifecycle: ProviderLifecycleState,
): Promise<void> {
  await defaultStore.writeProviderLifecycleEpisode(projectRoot, lifecycle);
}

export async function readProviderLifecycleEpisode(
  projectRoot: string,
  logicalStep: string,
): Promise<ProviderLifecycleEpisodeReadResult> {
  return defaultStore.readProviderLifecycleEpisode(projectRoot, logicalStep);
}

async function readProviderLifecycleEpisodeWithFileOperations(
  fileOperations: ProviderLifecycleEpisodeStoreFileOperations,
  projectRoot: string,
  logicalStep: string,
): Promise<ProviderLifecycleEpisodeReadResult> {
  let content: string;
  try {
    content = await fileOperations.readFile(episodePath(projectRoot, logicalStep), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { recoveryAuthority: 'fresh' };
    return { recoveryAuthority: 'denied', reason: 'unreadable' };
  }

  return parseProviderLifecycleEpisode(content, logicalStep);
}

export async function clearProviderLifecycleEpisode(projectRoot: string, logicalStep: string): Promise<void> {
  await rm(episodePath(projectRoot, logicalStep), { force: true });
}

function parseProviderLifecycleEpisode(
  content: string,
  logicalStep: string,
): ProviderLifecycleEpisodeReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return denied('malformed-json');
  }

  if (!isRecord(parsed) || parsed.version !== PROVIDER_LIFECYCLE_EPISODE_VERSION) {
    return denied('unknown-version');
  }

  const lifecycle = parseProviderLifecycleState(parsed.lifecycle, logicalStep);
  return lifecycle === undefined
    ? denied('invalid-lifecycle')
    : 'reason' in lifecycle
      ? denied(lifecycle.reason)
      : { recoveryAuthority: 'persisted', lifecycle: lifecycle.state };
}

function parseProviderLifecycleState(
  value: unknown,
  logicalStep: string,
): { state: ProviderLifecycleState } | { reason: ProviderLifecycleEpisodeReadFailureReason } | undefined {
  if (!isRecord(value)) return undefined;
  const attempt = parseAttemptIdentity(value.attempt, logicalStep);
  if (attempt === undefined) return undefined;
  if (!isRecoveryCount(value.recoveryCount)) return { reason: 'impossible-recovery-count' };

  switch (value.phase) {
    case 'preparing':
    case 'running':
      return { state: { phase: value.phase, attempt, recoveryCount: value.recoveryCount } };
    case 'recovering':
      if (value.recoveryCount !== 1 || value.reason !== 'preparation-timeout') return undefined;
      return {
        state: {
          phase: 'recovering',
          attempt,
          recoveryCount: value.recoveryCount,
          reason: 'preparation-timeout',
        },
      };
    case 'settled':
      if (value.outcome !== 'completed' && value.outcome !== 'failed') return undefined;
      return {
        state: {
          phase: 'settled',
          attempt,
          recoveryCount: value.recoveryCount,
          outcome: value.outcome,
        },
      };
    default:
      return { reason: 'unknown-state' };
  }
}

function parseAttemptIdentity(value: unknown, logicalStep: string): ProviderAttemptIdentity | undefined {
  if (!isRecord(value) || value.logicalStep !== logicalStep || !isNonEmptyString(value.id)) return undefined;
  return { logicalStep, id: value.id };
}

function denied(reason: ProviderLifecycleEpisodeReadFailureReason): ProviderLifecycleEpisodeReadResult {
  return { recoveryAuthority: 'denied', reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecoveryCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1;
}
