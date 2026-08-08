import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');
const sourceRoot = join(conductorRoot, 'src');
const PROCESS_INVOKING_CALLEES = new Set([
  'exec', 'execFile', 'execFileSync', 'execSync', 'spawn', 'spawnSync',
  'execa', 'execaCommand', 'git', 'runGit', 'removeWorktree',
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isParenthesizedExpression(expression)) return calleeName(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return calleeName(expression.right);
  }
  return undefined;
}

function commandTokens(expression: ts.Expression): { tokens: string[]; unresolved: boolean } {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { tokens: expression.text.split(/\s+/).filter(Boolean), unresolved: false };
  }
  if (!ts.isArrayLiteralExpression(expression)) return { tokens: [], unresolved: true };

  const tokens: string[] = [];
  for (const element of expression.elements) {
    if (!ts.isExpression(element)) return { tokens, unresolved: true };
    const resolved = commandTokens(element);
    tokens.push(...resolved.tokens);
    if (resolved.unresolved) return { tokens, unresolved: true };
  }
  return { tokens, unresolved: false };
}

function namesWorktreeRemoval(tokens: string[]): boolean {
  const worktree = tokens.indexOf('worktree');
  return worktree !== -1 && tokens.slice(worktree + 1).includes('remove');
}

function namesWorktreeRemovalOrHasUnresolvedCommandArgument(argumentsToInspect: readonly ts.Expression[]): boolean {
  const tokens: string[] = [];
  for (const argument of argumentsToInspect) {
    const resolved = commandTokens(argument);
    tokens.push(...resolved.tokens);
    if (resolved.unresolved) {
      const worktree = tokens.indexOf('worktree');
      if (worktree === -1) return false;
      return tokens[worktree + 1] === undefined || tokens[worktree + 1] === 'remove';
    }
  }
  return namesWorktreeRemoval(tokens);
}

function invokesWorktreeRemoval(node: ts.CallExpression): boolean {
  const callee = calleeName(node.expression);
  if (!callee || !PROCESS_INVOKING_CALLEES.has(callee)) return false;
  if (callee === 'removeWorktree') return true;
  if (callee === 'git') return namesWorktreeRemovalOrHasUnresolvedCommandArgument(node.arguments.slice(1));
  if (callee === 'runGit') return namesWorktreeRemovalOrHasUnresolvedCommandArgument(node.arguments.slice(0, 1));

  const executable = node.arguments[0] && commandTokens(node.arguments[0]);
  if (!executable || executable.unresolved) return false;
  if (namesWorktreeRemoval(executable.tokens)) return true;
  if (executable.tokens[0] !== 'git') return false;

  if (callee === 'execaCommand' || callee === 'exec' || callee === 'execSync') {
    return false;
  }
  return namesWorktreeRemovalOrHasUnresolvedCommandArgument(node.arguments.slice(1, 2));
}

function findsWorktreeRemoval(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && invokesWorktreeRemoval(node)) found = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

async function worktreeRemovalModules(root: string): Promise<string[]> {
  const modules = await Promise.all((await sourceFiles(root)).map(async (path) => {
    const text = await readFile(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    return findsWorktreeRemoval(source) ? relative(root, path) : undefined;
  }));
  return modules.filter((module): module is string => module !== undefined).sort();
}

describe('structural: worktree-removal coverage', () => {
  it('detects every known worktree-removal module in the production tree', async () => {
    await expect(worktreeRemovalModules(sourceRoot)).resolves.toEqual([
      'engine/autoresolve.ts',
      'engine/daemon-deps.ts',
      'engine/daemon-park-cli.ts',
      'engine/engineer/worktree-authoring.ts',
      'engine/park-reconciliation.ts',
      'engine/worktree-shared.ts',
      'engine/worktree.ts',
    ]);
  });

  it('ignores comments and log strings that only mention worktree removal', async () => {
    const fixtureRoot = join(structuralRoot, 'fixtures');
    const fixture = ts.createSourceFile(
      join(fixtureRoot, 'comment-only.ts'),
      "// git worktree remove --force\nconsole.log('git worktree remove --force');",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(findsWorktreeRemoval(fixture)).toBe(false);
  });

  it('recognizes literal commands, argv arrays, and unresolvable arguments', () => {
    const fixtures = [
      "execaCommand('git worktree remove --force');",
      "execa('git', ['worktree', 'remove', '--force']);",
      "execa('git', ['worktree', removalCommand]);",
    ].map((text, index) => ts.createSourceFile(`fixture-${index}.ts`, text, ts.ScriptTarget.Latest, true));

    expect(fixtures.map(findsWorktreeRemoval)).toEqual([true, true, true]);
  });
});
