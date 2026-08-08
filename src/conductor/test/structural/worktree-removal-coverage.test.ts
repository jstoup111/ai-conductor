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
const ROUTED_MODULES = new Set([
  'engine/daemon-deps.ts',
  'engine/daemon-park-cli.ts',
  'engine/park-reconciliation.ts',
]);
const WORKTREE_REMOVAL_EXEMPTIONS = [
  {
    module: 'engine/autoresolve.ts',
    reason: 'Deferred by operator: prepares its worktree and therefore leaks it.',
  },
  {
    module: 'engine/engineer/worktree-authoring.ts',
    reason: 'Does not call prepareWorktree, so it provisions nothing.',
  },
  {
    module: 'engine/worktree.ts',
    reason: 'Does not call prepareWorktree, so it provisions nothing.',
  },
  {
    module: 'engine/worktree-shared.ts',
    reason: 'Pass-through primitive: provisions nothing; callers decide classification.',
  },
];
const GUARD_MODULE = 'test/structural/worktree-removal-coverage.test.ts';
const COVERAGE_GUARD_ADR = 'docs/decisions/adr-2026-08-07-worktree-removal-coverage-guard.md';

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

function callsProjectTeardown(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'runProjectTeardown') found = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

function projectTeardownCalls(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'runProjectTeardown') calls.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return calls;
}

function isWithinOnDiskGuard(call: ts.CallExpression): boolean {
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    if (
      ts.isIfStatement(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'worktreeOnDisk' &&
      call.pos >= node.thenStatement.pos &&
      call.end <= node.thenStatement.end
    ) {
      return true;
    }
  }
  return false;
}

function assertWorktreeRemovalCoverage(
  modules: readonly { module: string; source: ts.SourceFile }[],
  exemptions = WORKTREE_REMOVAL_EXEMPTIONS,
): void {
  const exemptModules = new Set(exemptions.map(({ module }) => module));
  for (const exemption of exemptions) {
    if (!exemption.reason.trim()) {
      throw new Error(`worktree-removal coverage: exemption ${exemption.module} needs a non-empty reason`);
    }
    const source = modules.find(({ module }) => module === exemption.module)?.source;
    if (!source || !findsWorktreeRemoval(source)) {
      throw new Error(`worktree-removal coverage: exemption ${exemption.module} is stale`);
    }
  }

  const autoresolveReason = exemptions.find(({ module }) => module === 'engine/autoresolve.ts')?.reason;
  if (autoresolveReason && exemptions.some(({ module, reason }) =>
    module !== 'engine/autoresolve.ts' && reason.includes('provisions nothing') && reason === autoresolveReason,
  )) {
    throw new Error('worktree-removal coverage: autoresolve exemption reason must differ from provisions-nothing reasons');
  }

  for (const { module, source } of modules) {
    if (module === GUARD_MODULE || !findsWorktreeRemoval(source)) continue;
    if (ROUTED_MODULES.has(module)) {
      if (!callsProjectTeardown(source)) {
        throw new Error(`worktree-removal coverage: ${module} is routed but does not call runProjectTeardown`);
      }
      continue;
    }
    if (exemptModules.has(module)) continue;
    throw new Error(
      `worktree-removal coverage: ${module} is unclassified; route it through runProjectTeardown ` +
        `or add it to the exemption registry (${COVERAGE_GUARD_ADR})`,
    );
  }
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

  it('rejects an unclassified removal module with its classification options and ADR', () => {
    const fixture = ts.createSourceFile(
      'engine/unclassified-removal.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'engine/unclassified-removal.ts', source: fixture },
    ], [])).toThrow(/engine\/unclassified-removal\.ts.*runProjectTeardown.*exemption registry.*adr-2026-08-07-worktree-removal-coverage-guard/s);
  });

  it('rejects a routed removal module whose teardown invitation was deleted', () => {
    const fixture = ts.createSourceFile(
      'engine/daemon-deps.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'engine/daemon-deps.ts', source: fixture },
    ], [])).toThrow(/engine\/daemon-deps\.ts.*runProjectTeardown/s);
  });

  it('skips teardown for a reconciliation worktree that is already absent', async () => {
    const path = join(sourceRoot, 'engine/park-reconciliation.ts');
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const calls = projectTeardownCalls(source);

    expect(calls).toHaveLength(1);
    expect(isWithinOnDiskGuard(calls[0]!)).toBe(true);
  });

  it('does not classify the guard source itself', () => {
    const fixture = ts.createSourceFile(
      'test/structural/worktree-removal-coverage.test.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'test/structural/worktree-removal-coverage.test.ts', source: fixture },
    ], [])).not.toThrow();
  });

  it('classifies every worktree-removal module in the real source tree', async () => {
    const modules = await Promise.all((await sourceFiles(sourceRoot)).map(async (path) => ({
      module: relative(sourceRoot, path),
      source: ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true),
    })));

    expect(() => assertWorktreeRemovalCoverage(modules)).not.toThrow();
  });

  it('ships the exact worktree-removal exemption registry', () => {
    expect(WORKTREE_REMOVAL_EXEMPTIONS).toEqual([
      {
        module: 'engine/autoresolve.ts',
        reason: 'Deferred by operator: prepares its worktree and therefore leaks it.',
      },
      {
        module: 'engine/engineer/worktree-authoring.ts',
        reason: 'Does not call prepareWorktree, so it provisions nothing.',
      },
      {
        module: 'engine/worktree.ts',
        reason: 'Does not call prepareWorktree, so it provisions nothing.',
      },
      {
        module: 'engine/worktree-shared.ts',
        reason: 'Pass-through primitive: provisions nothing; callers decide classification.',
      },
    ]);
  });

  it('rejects an exemption with an empty or whitespace-only reason', () => {
    const fixture = ts.createSourceFile(
      'engine/exempt-removal.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'engine/exempt-removal.ts', source: fixture },
    ], [{ module: 'engine/exempt-removal.ts', reason: '   ' }])).toThrow(/exempt-removal\.ts.*non-empty reason/);
  });

  it('rejects a stale exemption whose module no longer removes a worktree', () => {
    const fixture = ts.createSourceFile(
      'engine/stale-exemption.ts',
      'export const stale = true;',
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'engine/stale-exemption.ts', source: fixture },
    ], [{ module: 'engine/stale-exemption.ts', reason: 'Does not call prepareWorktree, so it provisions nothing.' }]))
      .toThrow(/stale-exemption\.ts.*stale/);
  });

  it('requires the autoresolve rationale to differ from provisions-nothing rationales', () => {
    const autoresolve = ts.createSourceFile(
      'engine/autoresolve.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );
    const provisionless = ts.createSourceFile(
      'engine/worktree.ts',
      "execa('git', ['worktree', 'remove', '--force']);",
      ts.ScriptTarget.Latest,
      true,
    );
    const flattenedReason = 'Does not call prepareWorktree, so it provisions nothing.';

    expect(() => assertWorktreeRemovalCoverage([
      { module: 'engine/autoresolve.ts', source: autoresolve },
      { module: 'engine/worktree.ts', source: provisionless },
    ], [
      { module: 'engine/autoresolve.ts', reason: flattenedReason },
      { module: 'engine/worktree.ts', reason: flattenedReason },
    ])).toThrow(/autoresolve.*differ.*provisions-nothing/);
  });
});
