// cli-operator-authority.ts — the shared authority primitives every operator
// CLI command uses to answer "which feature?", "which operator?", and "is this
// rationale acceptable?".
//
// adr-2026-08-29-operator-authorized-kickback-budget-recovery D3 requires
// machine-scoped operator identity through the approved user-config → GitHub
// chain, a non-empty BOUNDED rationale, and feature resolution that "reuses the
// named-worktree behavior already used by `build-review` operator commands,
// factored into a shared module rather than copied". Each command previously
// answered these on its own, which is how one of them ended up reading
// `process.env.GITHUB_ACTOR` — an environment variable any process in the
// pipeline can set — as its operator authority.

import { realpath as realpathDefault, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveMainRepoRoot } from './park-marker.js';
import { makeMachineOwnerResolver } from './owner-gate/machine-identity.js';
import { makeProductionGh } from './tracker-client.js';

/**
 * Longest operator rationale a durable authorization record accepts. The
 * rationale is operator prose that is persisted to the ledger, replayed into an
 * event, and rendered in the budget view; an unbounded one is a durable-state
 * and rendering hazard, not an expressiveness feature.
 */
export const MAX_OPERATOR_RATIONALE_BYTES = 2_000;

/** True when a rationale is present and within its durable bound. */
export function isAcceptableOperatorRationale(rationale: string | undefined): boolean {
  const trimmed = rationale?.trim();
  if (!trimmed) return false;
  return Buffer.byteLength(trimmed, 'utf8') <= MAX_OPERATOR_RATIONALE_BYTES;
}

export interface CliFeatureWorktreeDeps {
  cwd?: string;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  realpath?: (path: string) => Promise<string>;
  /**
   * Require the resolved path to be an existing directory. Callers whose own
   * next step already proves the worktree exists (build-review resolves the
   * feature identity from artifacts inside it) pass `false`.
   */
  verifyDirectory?: boolean;
}

/**
 * Resolve `<main repo root>/.worktrees/<feature>` to its real path, or
 * `undefined` when the feature does not name a live worktree directory. This is
 * the single named-worktree resolution operator commands share.
 */
export async function resolveCliFeatureWorktree(
  feature: string,
  deps: CliFeatureWorktreeDeps = {},
): Promise<string | undefined> {
  try {
    const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
    const worktree = await (deps.realpath ?? realpathDefault)(join(root, '.worktrees', feature));
    if (deps.verifyDirectory === false) return worktree;
    return (await stat(worktree)).isDirectory() ? worktree : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Machine-scoped operator identity (D3): the user config's `spec_owner`, else
 * the `gh`-authenticated login, else unresolved. Project config is never in the
 * path, and no environment variable is consulted — an unattended harness or
 * provider child cannot name itself the operator.
 */
export async function resolveMachineOperatorIdentity(cwd: string): Promise<string | undefined> {
  try {
    const resolution = await makeMachineOwnerResolver(makeProductionGh(), cwd)();
    return resolution.resolved ? resolution.id : undefined;
  } catch {
    return undefined;
  }
}
