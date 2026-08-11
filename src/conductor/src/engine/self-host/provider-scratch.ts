import { join, normalize } from 'node:path';
import type { SelfHostProviderId } from './provider-home.js';

export interface ResolveScratchHomeOptions {
  readonly worktreeRoot: string;
  readonly runId: string;
  readonly attempt: number;
  readonly provider: SelfHostProviderId;
}

export function resolveScratchHome(options: ResolveScratchHomeOptions): string {
  return join(normalize(options.worktreeRoot), '.daemon', 'scratch', options.runId, `${options.attempt}-${options.provider}`);
}
