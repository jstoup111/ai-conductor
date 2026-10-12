// Covers: task:27
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'src');
const STRUCTURAL_TEST = join(ROOT, 'test', 'structural', 'engine-commit-sites.test.ts');

interface SourceFile { readonly site: string; readonly text: string }

async function sourceFiles(directory = SOURCE): Promise<SourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
    return [{ site: relative(SOURCE, path).replaceAll('\\', '/'), text: await readFile(path, 'utf8') }];
  }))).flat();
}

/** The structural test's allowlist, read from its source so this audit cannot drift from it. */
async function structuralAllowlist(): Promise<Set<string>> {
  const text = await readFile(STRUCTURAL_TEST, 'utf8');
  const block = /COMMIT_CALL_ALLOWLIST[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1];
  if (block === undefined) throw new Error('structural allowlist not found');
  return new Set(Array.from(block.matchAll(/^\s*'([^']+\.ts)':/gm), (match) => match[1]));
}

/** Same rule as the structural test: a call passing an argv array whose first element is `commit`. */
function commitCalls(site: string, text: string): number {
  const source = ts.createSourceFile(site, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.some((argument) => {
      if (!ts.isArrayLiteralExpression(argument)) return false;
      const first = argument.elements[0];
      return first !== undefined && ts.isStringLiteral(first) && first.text === 'commit';
    })) calls += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return calls;
}

function unlistedCommitSites(files: readonly SourceFile[], allowlist: ReadonlySet<string>): string[] {
  return files.filter((file) => commitCalls(file.site, file.text) > 0 && !allowlist.has(file.site))
    .map((file) => file.site).sort();
}

describe('engine commit-site fence sweep', () => {
  // Covers: task:27
  it('passes the real source tree with build-failure-escalation push-only and fails the same audit on an in-memory unlisted git commit', async () => {
    const allowlist = await structuralAllowlist();
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);

    // The real tree passes.
    expect(unlistedCommitSites(files, allowlist)).toEqual([]);

    // build-failure-escalation is recorded as push-only: no commit call, a push through executeRemoteGit.
    const escalation = files.find((file) => file.site === 'engine/build-failure-escalation.ts');
    expect(escalation).toBeDefined();
    expect(commitCalls(escalation!.site, escalation!.text)).toBe(0);
    expect(escalation!.text).toContain('executeRemoteGit');
    expect(allowlist.has('engine/build-failure-escalation.ts')).toBe(false);

    // Adding one unlisted `git commit` call to the in-memory tree fails the audit, naming it.
    const fixture: SourceFile = {
      site: 'engine/__fixture-unlisted-commit.ts',
      text: "export async function oops(git: (args: string[]) => Promise<void>) { await git(['commit', '-m', 'oops']); }\n",
    };
    expect(unlistedCommitSites([...files, fixture], allowlist)).toEqual(['engine/__fixture-unlisted-commit.ts']);
    // So does an unlisted commit hidden in an otherwise push-only file.
    const escalationWithCommit = { ...escalation!, text: `${escalation!.text}\nvoid execa('git', ['commit', '-m', 'x']);\n` };
    expect(unlistedCommitSites(files.map((file) => file.site === escalation!.site ? escalationWithCommit : file), allowlist))
      .toEqual(['engine/build-failure-escalation.ts']);
  });
});
