import { basename } from 'node:path';

/**
 * Derive a plan-stem key from a plan file path.
 *
 * This strips only the trailing `.md` extension from the basename, leaving
 * interior dots (for example `phase-9.3b-intake.md`) intact.
 */
export function planStem(planFilePath: string): string {
  return basename(planFilePath, '.md');
}
