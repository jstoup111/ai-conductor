import { formatRemediationCommand } from './remediation-commands.js';

export interface OrphanedWorktreeMissing {
  readonly featureDesc: string;
  readonly stateFilePath: string;
  readonly expectedLocations: readonly string[];
}

/** Formats the short orphaned-state recovery hint used by diagnose. */
export function formatOrphanedStateResetHint(stateFilePath: string): string {
  return `\nOrphaned conductor state in ${stateFilePath}.\n  Run ${formatRemediationCommand({ kind: 'inline-reset' })} to clear, or recreate the worktree.\n`;
}

/** Formats the refusal shown when recorded worktree state has no worktree. */
export function formatOrphanedWorktreeMissing({
  featureDesc,
  stateFilePath,
  expectedLocations,
}: OrphanedWorktreeMissing): string {
  return `\nOrphaned conductor state in ${stateFilePath}.\n` +
    `\n  Feature "${featureDesc}" was marked past the worktree step,\n` +
    `  but no worktree exists at any of:\n` +
    expectedLocations.map((path) => `    - ${path}`).join('\n') +
    `\n\n  Either:\n` +
    `    1) Recreate the missing worktree at one of those paths, OR\n` +
    `    2) Run ${formatRemediationCommand({ kind: 'inline-reset' })} from this directory to clear the stale state\n` +
    `       (you'll lose the recorded progress, but the actual code on the\n` +
    `       feature branch — if it exists — is untouched).\n` +
    `\n  Refusing to continue here so artifacts don't land on the wrong branch.\n`;
}

/** Formats instructions after complete-state verification finds a SHIP gap. */
export function formatShipEvidenceGapInstructions(featureDesc?: string): string {
  return '  To roll back feature_status and resume at the first failing step, run:\n' +
    `    ${formatRemediationCommand({ kind: 'inline-run', feature: featureDesc })}\n` +
    `  …and answer "y" at the recovery prompt. To inspect raw state: ${formatRemediationCommand({ kind: 'inline-status' })}\n`;
}

/** Formats the non-mutating exit after an operator declines SHIP-gap recovery. */
export function formatRecoveryDeclinedInstructions(featureDesc?: string): string {
  return `\nNo changes made. To inspect: ${formatRemediationCommand({ kind: 'inline-status' })}\n` +
    `  To start over: ${formatRemediationCommand({ kind: 'inline-fresh', feature: featureDesc })}\n`;
}
