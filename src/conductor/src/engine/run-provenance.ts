import { parseIntakeSourceRef, planStem, resolveFeaturePlanPath, type FinishChoice } from './artifacts.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MalformedFeatureManifestError, resolveFeatureArtifact, worktreeManifestSource } from './feature-manifest-source.js';

export type PrDisposition = 'opened' | 'none' | 'unrecorded';

/** The read-only subset needed to resolve terminal HEAD provenance. */
type HeadGitRunner = (
  args: string[],
  opts: { cwd: string; credential?: 'operator' | 'write'; endpoint?: 'https' | 'ssh' },
) => Promise<{ exitCode?: number; stdout: string }>;

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
export async function resolveHeadSha(git: HeadGitRunner, cwd: string): Promise<string | undefined> {
  try {
    const result = await git(['rev-parse', 'HEAD'], { cwd });
    const headSha = result.stdout.trim();
    return (result.exitCode === undefined || result.exitCode === 0) && headSha ? headSha : undefined;
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
    const intake = await resolveFeatureArtifact(
      worktreeManifestSource(projectRoot),
      planStem(planPath),
      'intake',
      async () => [`.docs/intake/${planStem(planPath)}.md`],
    );
    const intakePath = intake.paths[0];
    if (intakePath === undefined || (intake.origin === 'manifest' && intake.missing.includes(intakePath))) return undefined;
    const intakeContent = await readFile(join(projectRoot, intakePath), 'utf-8').catch(() => null);
    // `parseIntakeSourceRef` validates and canonicalizes the marker value. Its
    // whitespace matcher also accepts a newline, so first reject a blank marker
    // line rather than accidentally reading the following line as its value.
    const sourceRefLine = intakeContent?.match(/^\s*Source-Ref:[^\S\r\n]*(\S+)?[^\r\n]*$/im);
    if (!sourceRefLine?.[1]) return undefined;
    return parseIntakeSourceRef(intakeContent);
  } catch (error) {
    if (error instanceof MalformedFeatureManifestError) throw error;
    return undefined;
  }
}
