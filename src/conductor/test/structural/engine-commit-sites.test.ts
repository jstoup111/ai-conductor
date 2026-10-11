// Covers: task:27
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'src');

// A commit in one of the stacked-feature sites is permitted only because that
// site selects commitEngineChangeWhenStacked first.  The other two entries are
// intentionally not feature-worktree commits: land-spec owns its isolated spec
// worktree and the journal code writes the word "commit" to update-ref stdin.
const COMMIT_CALL_ALLOWLIST: Record<string, string> = {
  'engine/conductor.ts': 'plan-amendment site selects the guarded helper for durable child state',
  'engine/finish-publication-production.ts': 'shipped-record findings site selects the guarded helper',
  'engine/halt-record.ts': 'halt-record site selects the guarded helper',
  'engine/setup-triage.ts': 'three setup-triage sites select the guarded helper',
  'engine/shipment-evidence-cli.ts': 'shipment-repair site selects the guarded helper',
  'engine/shipped-record-cli.ts': 'shipped-record site selects the guarded helper',
  'engine/engineer/land-spec.ts': 'spec worktree, never a feature worktree',
};

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }))).flat();
}

function isCommitInvocation(node: ts.CallExpression): boolean {
  return node.arguments.some((argument) => {
    if (!ts.isArrayLiteralExpression(argument)) return false;
    const first = argument.elements[0];
    return first !== undefined && ts.isStringLiteral(first) && first.text === 'commit';
  });
}

function commitCalls(file: string, text: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isCommitInvocation(node)) calls += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return calls;
}

async function unallowlistedCommitSites(root = SOURCE): Promise<string[]> {
  const sourceFiles = await files(root);
  const findings: string[] = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    if (commitCalls(file, source) === 0) continue;
    const site = relative(root, file).replaceAll('\\', '/');
    if (!(site in COMMIT_CALL_ALLOWLIST)) findings.push(site);
  }
  return findings.sort();
}

describe('engine commit-site fence', () => {
  it('allows only enumerated engine commit sites', async () => {
    await expect(unallowlistedCommitSites()).resolves.toEqual([]);
  });

  it('rejects an in-memory unlisted git commit invocation', async () => {
    const fixture = join(SOURCE, 'engine', '__fixture-unlisted-commit.ts');
    expect(commitCalls(fixture, "await git(['commit', '-m', 'oops']);")).toBe(1);
    expect(COMMIT_CALL_ALLOWLIST[relative(SOURCE, fixture)]).toBeUndefined();
  });

  it('documents the push-only build-failure escalation exception', async () => {
    const source = await readFile(join(SOURCE, 'engine', 'build-failure-escalation.ts'), 'utf8');
    expect(commitCalls('build-failure-escalation.ts', source)).toBe(0);
    expect(source).toContain('executeRemoteGit');
  });
});
