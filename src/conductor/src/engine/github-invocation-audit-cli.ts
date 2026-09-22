/**
 * `conduct github-boundary-audit [--root <conductor-root>]` — the production
 * entry point of the shipped GitHub/remote-Git invocation audit (Task 24).
 * It fails (exit 1) with one `file:line:column: message` diagnostic per
 * bypass, so the integrity suite, CI, and operators all run the same gate.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditShippedGithubInvocationBoundary,
  shippedRuntimeTypescriptFiles,
} from './github-invocation-audit.js';

export interface GithubBoundaryAuditCommand { readonly root?: string }

export interface GithubBoundaryAuditOutput {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/** Exact argv shapes only; anything else falls through to other dispatchers. */
export function detectGithubBoundaryAuditCommand(argv: readonly string[]): GithubBoundaryAuditCommand | null {
  if (argv[2] !== 'github-boundary-audit') return null;
  if (argv.length === 3) return {};
  if (argv.length === 5 && argv[3] === '--root' && argv[4]) return { root: argv[4] };
  return null;
}

/** The conductor package root that owns this module (`src/engine` or `dist/engine`). */
function defaultConductorRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Run the audit and return the process exit code. */
export function dispatchGithubBoundaryAudit(
  command: GithubBoundaryAuditCommand,
  output: GithubBoundaryAuditOutput = { stdout: (line) => console.log(line), stderr: (line) => console.error(line) },
): number {
  const root = command.root ? resolve(command.root) : defaultConductorRoot();
  let findings;
  let audited: number;
  try {
    audited = shippedRuntimeTypescriptFiles(root).length;
    findings = auditShippedGithubInvocationBoundary(root);
  } catch (error) {
    output.stderr(`github-boundary-audit: cannot audit ${root}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const finding of findings) {
    output.stderr(`${finding.file}:${finding.line}:${finding.column}: ${finding.message}`);
  }
  if (findings.length > 0) {
    output.stderr(`github-boundary-audit: ${findings.length} unguarded GitHub/remote-Git invocation site(s)`);
    return 1;
  }
  output.stdout(`github-boundary-audit: ${audited} runtime file${audited === 1 ? '' : 's'} audited, no unguarded invocation sites`);
  return 0;
}
