import { parseIntakeSourceRef, planStem, resolveFeaturePlanPath, type FinishChoice } from './artifacts.js';
import type { GitRunner } from './rebase.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type PrDisposition = 'opened' | 'none' | 'unrecorded';

/** Classify the terminal PR state without conflating no PR with no record. */
export function resolvePrDisposition({
  prUrl,
  finishChoice,
}: {
  prUrl?: string;
  finishChoice?: FinishChoice;
}): PrDisposition {
  if (prUrl) return 'opened';
  if (finishChoice === 'keep') return 'none';
  return 'unrecorded';
}

/** Resolve the current worktree HEAD without allowing provenance failure to block a run. */
export async function resolveHeadSha(git: GitRunner): Promise<string | undefined> {
  try {
    const result = await git(['rev-parse', 'HEAD']);
    const headSha = result.stdout.trim();
    return result.exitCode === 0 && headSha ? headSha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the originating intake reference for a run without allowing absent
 * plans or markers to block visualizer startup.
 */
export async function resolveRunSourceRef(
  projectRoot: string,
  featureDesc: string | undefined,
): Promise<string | undefined> {
  if (!featureDesc) return undefined;
  try {
    const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
    if (!planPath) return undefined;
    const intakePath = join(projectRoot, '.docs', 'intake', `${planStem(planPath)}.md`);
    const intakeContent = await readFile(intakePath, 'utf-8').catch(() => null);
    // `parseIntakeSourceRef` validates and canonicalizes the marker value. Its
    // whitespace matcher also accepts a newline, so first reject a blank marker
    // line rather than accidentally reading the following line as its value.
    const sourceRefLine = intakeContent?.match(/^\s*Source-Ref:[^\S\r\n]*(\S+)?[^\r\n]*$/im);
    if (!sourceRefLine?.[1]) return undefined;
    return parseIntakeSourceRef(intakeContent);
  } catch {
    return undefined;
  }
}
