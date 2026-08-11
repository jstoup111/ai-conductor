import { join, normalize } from 'node:path';
import type { SelfHostProviderId } from './provider-home.js';

export interface ResolveScratchHomeOptions {
  readonly worktreeRoot: string;
  readonly runId: string;
  readonly attempt: number;
  readonly provider: SelfHostProviderId;
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
