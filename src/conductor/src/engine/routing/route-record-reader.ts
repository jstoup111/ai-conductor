import type { GitRunner } from '../rebase.js';
import {
  readRouteRecord as readStoredRouteRecord,
  type ReadRouteRecordResult,
} from './route-record-store.js';
import type { RoundId } from './route-types.js';

/** The read-only Git boundary used by durable route-record consumers. */
export interface RouteRecordGitRunner {
  (args: string[]): Promise<{ readonly exitCode: number; readonly stdout: string }>;
}

/**
 * Reads a route record through the canonical store while preserving the
 * protected-artifact reader's narrow Git-runner seam.
 */
export async function readRouteRecord(
  git: RouteRecordGitRunner,
  slug: string,
  roundId: RoundId,
): Promise<ReadRouteRecordResult> {
  const storeGit: GitRunner = async (args) => {
    const result = await git(args);
    return { ...result, stderr: '' };
  };
  return readStoredRouteRecord('.', slug, roundId, { git: storeGit });
}
