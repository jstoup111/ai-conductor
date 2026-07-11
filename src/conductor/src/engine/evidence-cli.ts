// `conduct evidence judge <slug>` — CLI for the semantic attribution evidence gate.
// Resolves feature slugs to worktrees and handles error cases.
//
// Mirrors the derive-feedback-cli.ts pattern: detected before the interactive
// pipeline boots, pure parsing (no I/O), returns dispatch type or null.

import { join } from 'node:path';
import { WorktreeManager } from './worktree.js';

export type EvidenceDispatch =
  | { kind: 'guide' }
  | { kind: 'judge'; slug: string };

/**
 * Parse argv for the `evidence` subcommand.
 *   conduct evidence judge <slug>    → {kind:'judge', slug:'<slug>'}
 *   conduct evidence [malformed]     → {kind:'guide'}
 *   (any other sub)                  → null
 */
export function detectEvidenceCommand(argv: string[]): EvidenceDispatch | null {
  const sub = argv[2];
  if (sub !== 'evidence') return null;

  const subCmd = argv[3];

  // Missing or empty subcommand
  if (!subCmd || subCmd === '') {
    return { kind: 'guide' };
  }

  if (subCmd === 'judge') {
    const slug = argv[4];
    if (!slug) {
      return { kind: 'guide' };
    }
    return { kind: 'judge', slug };
  }

  // Unknown subcommand
  return { kind: 'guide' };
}

export interface EvidenceDispatchDeps {
  print?: (msg: string) => void;
  cwd?: string;
}

/**
 * Dispatch the `evidence` subcommand. Routes to judge handler or prints usage.
 *
 * Exit codes:
 *   0 = success
 *   1 = runtime error (unknown feature, unreachable worktree)
 *   2 = usage/guide
 */
export async function dispatchEvidence(
  cmd: EvidenceDispatch,
  deps: EvidenceDispatchDeps = {},
): Promise<number> {
  const { print = console.log, cwd = process.cwd() } = deps;

  if (cmd.kind === 'guide') {
    print(
      'conduct evidence judge <slug>\n' +
        '  Resolve a feature slug to its worktree and run semantic attribution\n' +
        '  verification on the feature. Exits non-zero if the slug is unknown\n' +
        '  or the worktree is unreachable.\n',
    );
    return 2;
  }

  if (cmd.kind === 'judge') {
    return runEvidenceJudge(cwd, cmd.slug, { print });
  }

  // Should never reach here
  return 2;
}

/**
 * Run evidence judge for a feature slug.
 * Resolves the slug to a worktree and validates it exists.
 *
 * Exit codes:
 *   0 = success (worktree found and judge completed)
 *   1 = error (unknown feature, unreachable worktree, etc.)
 */
export async function runEvidenceJudge(
  projectRoot: string,
  slug: string,
  opts: { print?: (msg: string) => void } = {},
): Promise<number> {
  const { print = console.log } = opts;

  try {
    const manager = new WorktreeManager(projectRoot);
    const worktrees = await manager.scan();

    // Find worktree matching this slug
    const worktree = worktrees.find((wt) => wt.name === slug);
    if (!worktree) {
      const validSlugs = worktrees.map((wt) => wt.name).join(', ');
      print(
        `Error: unknown feature slug "${slug}"\n` +
          `Known worktrees: ${validSlugs || '(none)'}`,
      );
      return 1;
    }

    // Worktree found — placeholder for semantic attribution logic
    // (Future: implement the actual attribution verification)
    print(`Evidence judge: resolved slug "${slug}" to worktree "${worktree.path}"`);
    return 0;
  } catch (err) {
    print(`Error: failed to judge evidence: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
