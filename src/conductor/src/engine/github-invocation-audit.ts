/**
 * Small deterministic audit used by the integrity gate.  It intentionally
 * examines executable TypeScript only; historical docs and examples are not a
 * production invocation surface.
 */
export interface GithubInvocationAuditFinding {
  readonly file: string;
  readonly message: string;
}

const APPROVED_ADAPTERS = new Set([
  'tracker-client.ts',
  'remote-git-operations.ts',
]);

export function auditGithubInvocationSource(file: string, source: string): GithubInvocationAuditFinding[] {
  if (APPROVED_ADAPTERS.has(file.split('/').at(-1) ?? '')) return [];
  const findings: GithubInvocationAuditFinding[] = [];
  if (/from\s+['"]node:child_process['"]/.test(source) || /require\(['"]node:child_process['"]\)/.test(source)) {
    findings.push({ file, message: 'direct child_process import outside approved guarded adapters' });
  }
  if (/\[(?:'|")push(?:'|\")\s*,|\[(?:'|\")remote(?:'|\")\s*,\s*(?:'|\")remove/.test(source)) {
    findings.push({ file, message: 'direct remote Git mutation outside executeRemoteGit' });
  }
  if (/\[(?:'|")pr(?:'|\")\s*,\s*(?:'|\")(?:create|edit|ready)(?:'|\")/.test(source)) {
    findings.push({ file, message: 'direct PR mutation outside executeGithubOperation' });
  }
  return findings;
}
