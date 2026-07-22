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
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

// ────────────────────────────────────────────────────────────────────────────
// Direct-execution entry point — invoked by `bin/generate-docs-guard-hook` via
// `tsx`. Resolves the repo-root hooks/claude/docs-guard.sh path relative to
// this source file's location (src/conductor/src/tools/ ->
// ../../../../hooks/claude/docs-guard.sh), runs the CLI against the real
// filesystem, and exits with the resulting code.
//
// Guarded so importing this module (e.g. from tests) never triggers process
// exit / stdio side effects — only running it directly does.
// ────────────────────────────────────────────────────────────────────────────

function defaultOutPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '../../../../hooks/claude/docs-guard.sh');
}

function parseArgs(argv: string[]): CliMode {
  return argv.includes('--check') ? 'check' : 'write';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outPath = process.env.GENERATE_DOCS_GUARD_HOOK_OUT ?? defaultOutPath();
  const mode = parseArgs(process.argv.slice(2));
  runGenerateDocsGuardHookCli({ outPath, mode })
    .then((result) => {
      if (result.message) {
        if (result.exitCode === EXIT_OK) {
          console.log(result.message);
        } else {
          console.error(result.message);
        }
      }
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error('generate-docs-guard-hook: fatal:', err instanceof Error ? err.message : err);
      process.exit(EXIT_ERROR);
    });
}
