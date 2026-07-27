import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/structural$/, '');
const conductorRoot = dirname(testRoot);
const thisFile = fileURLToPath(import.meta.url);
const PROCESS_CALLS = new Set(['exec', 'execFile', 'execFileSync', 'execSync', 'spawn', 'spawnSync', 'execa', 'execaCommand']);
const GH_NETWORK_OPERATIONS = new Set(['api', 'auth', 'cache', 'gist', 'issue', 'label', 'pr', 'project', 'release', 'repo', 'run', 'search', 'secret', 'variable', 'workflow']);

async function testFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function staticText(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function isSetupPath(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  const text = staticText(node);
  if (text) return ['bin/setup', './bin/setup'].includes(text);
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'join' &&
    node.arguments.some((argument, index) => staticText(argument) === 'bin' && staticText(node.arguments[index + 1]) === 'setup');
}

function invokesForbiddenProcess(node: ts.CallExpression): boolean {
  const callee = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
  if (!callee || !PROCESS_CALLS.has(callee)) return false;

  if (isSetupPath(node.arguments[0])) return true;
  const command = staticText(node.arguments[0]);
  if (!command) return false;
  const argvNode = node.arguments[1];
  const argv = argvNode && ts.isArrayLiteralExpression(argvNode)
    ? argvNode.elements.map((arg) => ts.isExpression(arg) ? staticText(arg) : undefined).filter((arg): arg is string => arg !== undefined)
    : [];
  const shellTokens = command.split(/\s+/);
  const executable = shellTokens[0];
  const argumentsAfterCommand = [...shellTokens.slice(1), ...argv];

  if (['claude', 'codex', 'curl', 'wget'].includes(executable)) return true;
  if (executable === 'npm' && argumentsAfterCommand.some((arg) => arg === 'install' || arg === 'ci')) return true;
  if (executable === 'npx' && argumentsAfterCommand.some((arg) => arg === 'claude' || arg === 'codex')) return true;
  if (executable === 'npm' && argumentsAfterCommand.includes('exec') && argumentsAfterCommand.some((arg) => arg === 'claude' || arg === 'codex')) return true;
  if (executable === 'gh') return argumentsAfterCommand.some((arg) => GH_NETWORK_OPERATIONS.has(arg));
  return false;
}

function hasForbiddenCall(source: ts.SourceFile): boolean {
  let forbidden = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && invokesForbiddenProcess(node)) forbidden = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return forbidden;
}

describe('structural: test execution policy', () => {
  it('keeps real provider, network, and full-setup execution smoke-only', async () => {
    const violations = (await Promise.all((await testFiles(testRoot))
      .filter((path) => path !== thisFile && !relative(testRoot, path).startsWith('smoke/') && !path.endsWith('.smoke.test.ts'))
      .map(async (path) => {
        const text = await readFile(path, 'utf8');
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        return hasForbiddenCall(source) ? [relative(testRoot, path)] : [];
      }))).flat();

    const config = await readFile(join(conductorRoot, 'vitest.config.ts'), 'utf8');
    const excludeBlock = config.match(/exclude\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    if (!excludeBlock.includes('test/smoke/**') || !excludeBlock.includes('**/*.smoke.test.ts')) {
      violations.push('vitest.config.ts: default run includes smoke tests');
    }

    expect(violations).toEqual([]);
  });
});
