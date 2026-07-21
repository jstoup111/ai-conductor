// intake-backfill-cli.ts — production entry point for `bin/intake-backfill`
// (Task 6, FR-3).
//
// One-shot, non-interactive sweep: lists open issues assigned to the
// authenticated `gh` user in the given repo, backfills any missing
// `size:`/`priority:` labels (inferred from the issue body, or defaulted),
// and prints an operator report. Never HALTs, never prompts.
//
// Usage: intake-backfill-cli.ts --repo <owner/repo>

import { makeProductionGh } from './engine/pr-labels.js';
import { runIntakeBackfill, renderBackfillReport } from './engine/intake-backfill.js';

function parseRepoArg(argv: string[]): string | null {
  const i = argv.indexOf('--repo');
  if (i === -1 || !argv[i + 1]) return null;
  return argv[i + 1];
}

async function main(): Promise<void> {
  const repo = parseRepoArg(process.argv.slice(2));
  if (!repo) {
    console.error('Usage: intake-backfill --repo <owner/repo>');
    process.exitCode = 1;
    return;
  }

  const report = await runIntakeBackfill({
    gh: makeProductionGh(),
    repo,
    log: (msg) => console.error(msg),
  });

  console.log(renderBackfillReport(report));

  // Non-fatal: label-apply failures are reported, never raised as a process
  // failure — this is a best-effort sweep, not a gate.
}

main().catch((error) => {
  // Only a top-level failure (e.g. the initial issue-list call itself
  // failing) reaches here — per-issue failures are isolated inside
  // runIntakeBackfill and never throw.
  console.error(`intake-backfill: fatal error — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
