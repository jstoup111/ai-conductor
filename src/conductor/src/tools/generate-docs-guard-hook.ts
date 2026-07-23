// ─────────────────────────────────────────────────────────────────────────────
// generate-docs-guard-hook — emits `DOCS_GUARD_HOOK` (session-hook-assets.ts)
// verbatim to the committed `hooks/claude/docs-guard.sh` artifact.
//
// DOCS_GUARD_HOOK is the single source of truth for the hook's bash content
// (Tasks 5-8, #788). This tool does not author or modify that content — it
// only writes it to disk (write mode) or compares it against what's already
// on disk (check mode, for the drift check Task 11 wires into the integrity
// suite).
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, chmod } from 'node:fs/promises';
import { DOCS_GUARD_HOOK } from '../engine/session-hook-assets.js';

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_ERROR = 2;

const EXECUTABLE_MODE = 0o755;

function expectedContent(): string {
  return DOCS_GUARD_HOOK.endsWith('\n') ? DOCS_GUARD_HOOK : `${DOCS_GUARD_HOOK}\n`;
}

export type CliMode = 'write' | 'check';
export type CliOptions = { outPath: string; mode: CliMode };
export type CliResult = { exitCode: number; diff?: string; message?: string };

/**
 * Public in-process entry point — the same one `bin/generate-docs-guard-hook`
 * execs via tsx. Kept separate from the direct-execution block below so
 * tests can drive it with injected paths without touching the real repo
 * artifact or process.exit.
 */
export async function runGenerateDocsGuardHookCli(opts: CliOptions): Promise<CliResult> {
  const expected = expectedContent();

  if (opts.mode === 'check') {
    let existing: string | undefined;
    try {
      existing = await readFile(opts.outPath, 'utf8');
    } catch {
      existing = undefined;
    }

    if (existing === expected) {
      return { exitCode: EXIT_OK, message: 'generate-docs-guard-hook --check: OK' };
    }
    return {
      exitCode: EXIT_DRIFT,
      message: `generate-docs-guard-hook: drift detected in ${opts.outPath}\nRun `
        + '\`bin/generate-docs-guard-hook\` to regenerate the hook.',
    };
  }

  // write mode
  await writeFile(opts.outPath, expected, 'utf8');
  await chmod(opts.outPath, EXECUTABLE_MODE);
  return { exitCode: EXIT_OK };
}

// Direct-execution entry point lives in `generate-docs-guard-hook-main.ts` —
// `bin/generate-docs-guard-hook` execs that file via `tsx`, keeping this
// module free of process-exit/stdio side effects on import.
