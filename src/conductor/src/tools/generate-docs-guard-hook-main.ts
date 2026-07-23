// ─────────────────────────────────────────────────────────────────────────────
// Direct-execution entry point — invoked by `bin/generate-docs-guard-hook` via
// `tsx`. Resolves the repo-root hooks/claude/docs-guard.sh path relative to
// this source file's location (src/conductor/src/tools/ ->
// ../../../../hooks/claude/docs-guard.sh), runs `runGenerateDocsGuardHookCli`
// against the real filesystem, and exits with the resulting code.
//
// Kept separate from generate-docs-guard-hook.ts so importing that module
// (e.g. from tests) never triggers process exit / stdio side effects — only
// running this entry file directly does.
// ─────────────────────────────────────────────────────────────────────────────

import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGenerateDocsGuardHookCli, EXIT_OK, EXIT_ERROR, type CliMode } from './generate-docs-guard-hook.js';

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
