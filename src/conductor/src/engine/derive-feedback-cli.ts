// `conduct derive-feedback --sha <sha> [--plan <path>]` — fast-feedback,
// single-commit evidence check for the post-commit git hook (ADR
// post-landing amendment: hooks/claude/post-commit-derive-feedback.sh
// invokes THIS engine path instead of a bare bash `Task: [0-9]+` regex,
// which rejected valid H9 ids like `rem-fr10-1`).
//
// Runs NON-INTERACTIVELY and exits — mirrors the shipped-record/render
// dispatch pattern: detected and handled before the interactive pipeline
// boots. Read-only: never writes task-status.json or the evidence sidecar
// (that stays engine-owned via deriveCompletion/applyDerivedCompletion on
// the build gate). Advisory by contract — the hook wrapping this call
// always exits 0 regardless of what this CLI reports.

import { checkCommitEvidence } from './autoheal.js';

export type DeriveFeedbackDispatch =
  | { kind: 'check'; sha: string; planPath?: string }
  | { kind: 'guide' };

/**
 * Parse argv for the `derive-feedback` subcommand.
 *   conduct derive-feedback --sha <sha> [--plan <path>] → {kind:'check', ...}
 *   conduct derive-feedback [malformed]                 → {kind:'guide'}
 *   (any other sub)                                      → null
 */
export function detectDeriveFeedbackCommand(argv: string[]): DeriveFeedbackDispatch | null {
  if (argv[2] !== 'derive-feedback') return null;
  const rest = argv.slice(3);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const sha = flag('--sha');
  const planPath = flag('--plan');
  if (!sha) return { kind: 'guide' };
  return { kind: 'check', sha, planPath };
}

/**
 * Dispatch the `derive-feedback` subcommand. Prints a single JSON line to
 * stdout describing the check result; the calling hook script decides how
 * to render that as human-facing advisory text.
 *
 * Exit codes are informational only (0 = evidenced, 1 = not evidenced, 2 =
 * usage/guide) — the hook that shells out to this MUST NOT propagate them
 * as its own exit code, since the fast-feedback contract is advisory-only
 * and must never block a commit.
 */
export async function dispatchDeriveFeedback(
  cmd: DeriveFeedbackDispatch,
  cwd: string,
): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct derive-feedback --sha <sha> [--plan <path>]\n' +
        '  Read-only, advisory check: does commit <sha> carry Task: <id> evidence\n' +
        '  (H9 grammar [A-Za-z0-9._-]+), or — via --plan path-fallback — does it\n' +
        '  touch files declared under a task in the given plan? Never writes\n' +
        '  task-status.json or the evidence sidecar. Invoked by\n' +
        '  hooks/claude/post-commit-derive-feedback.sh.',
    );
    return 2;
  }

  try {
    const result = await checkCommitEvidence(cwd, cmd.sha, cmd.planPath);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.evidenced ? 0 : 1;
  } catch (err) {
    // Advisory contract: a thrown error here is reported, never fatal to
    // the caller — the hook is expected to treat any non-clean JSON /
    // non-zero exit as "couldn't determine, fall back or stay silent."
    console.error(
      `derive-feedback check failed (advisory, non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
}
