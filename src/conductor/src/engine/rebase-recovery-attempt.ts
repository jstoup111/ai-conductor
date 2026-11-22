import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReplayIdentitySeed } from './rebase-replay.js';

/** Durable, feature-local authority for one replay that may later be recovered. */
export interface RebaseRecoveryAttempt extends ReplayIdentitySeed {
  version: 1;
  generation: string;
  feature: string;
  /** Undefined is the normal flat-feature owner. */
  child?: number;
}

export const REBASE_RECOVERY_ATTEMPT_PATH = '.pipeline/rebase-recovery-attempt.json';
const OBJECT_ID = /^[0-9a-f]{40,64}$/i;

function validAttempt(value: unknown): value is RebaseRecoveryAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Record<string, unknown>;
  return attempt.version === 1 &&
    typeof attempt.generation === 'string' && attempt.generation.length > 0 &&
    typeof attempt.feature === 'string' && attempt.feature.trim().length > 0 &&
    typeof attempt.preRebaseHead === 'string' && OBJECT_ID.test(attempt.preRebaseHead) &&
    typeof attempt.mergeBase === 'string' && OBJECT_ID.test(attempt.mergeBase) &&
    typeof attempt.target === 'string' && OBJECT_ID.test(attempt.target) &&
    (attempt.child === undefined || (typeof attempt.child === 'number' && Number.isSafeInteger(attempt.child) && attempt.child >= 0));
}

/** Missing, partial, or malformed evidence is deliberately not recoverable. */
export async function readRebaseRecoveryAttempt(projectRoot: string): Promise<RebaseRecoveryAttempt | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(projectRoot, REBASE_RECOVERY_ATTEMPT_PATH), 'utf8'));
    return validAttempt(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Capture immutable replay inputs before Git changes HEAD. */
export async function persistRebaseRecoveryAttempt(
  projectRoot: string,
  seed: ReplayIdentitySeed,
  child?: number,
): Promise<{ kind: 'persisted'; attempt: RebaseRecoveryAttempt } | { kind: 'not-applicable' } | { kind: 'failed'; reason: string }> {
  let feature: unknown;
  try {
    feature = (JSON.parse(await readFile(join(projectRoot, '.pipeline', 'conduct-state.json'), 'utf8')) as { feature_desc?: unknown }).feature_desc;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'not-applicable' };
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  if (typeof feature !== 'string' || feature.trim() === '') return { kind: 'not-applicable' };

  const attempt: RebaseRecoveryAttempt = {
    version: 1,
    generation: randomUUID(),
    feature: feature.trim(),
    preRebaseHead: seed.preRebaseHead.trim(),
    mergeBase: seed.mergeBase.trim(),
    target: seed.target.trim(),
    ...(child === undefined ? {} : { child }),
  };
  if (!validAttempt(attempt)) return { kind: 'not-applicable' };

  const path = join(projectRoot, REBASE_RECOVERY_ATTEMPT_PATH);
  const temporary = `${path}.${attempt.generation}.tmp`;
  try {
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(attempt)}\n`, 'utf8');
    await rename(temporary, path);
    return { kind: 'persisted', attempt };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The halt writer must bind its class to exactly the captured replay tuple. */
export function matchesRebaseRecoveryAttempt(
  live: RebaseRecoveryAttempt | undefined,
  expected: RebaseRecoveryAttempt | undefined,
): boolean {
  return live !== undefined && expected !== undefined &&
    live.generation === expected.generation &&
    live.feature === expected.feature &&
    live.child === expected.child &&
    live.preRebaseHead === expected.preRebaseHead &&
    live.mergeBase === expected.mergeBase &&
    live.target === expected.target;
}
