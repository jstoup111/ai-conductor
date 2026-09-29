// Covers: task:8, task:rem-as-built-rem-pg1-1
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_PROVIDERS } from '../../src/execution/provider-catalog.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(testRoot, '../..');
const sourceRoot = join(conductorRoot, 'src');
const catalogModule = 'execution/provider-catalog.ts';

interface ProviderLiteralFinding {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function declaredAdapterModules(): ReadonlySet<string> {
  return new Set(BUILT_IN_PROVIDERS.map(({ adapterModule }) => adapterModule));
}

function findProviderLiterals(
  module: string,
  source: ts.SourceFile,
  adapterModules = declaredAdapterModules(),
): readonly ProviderLiteralFinding[] {
  if (module === catalogModule) return [];

  const forbiddenLiterals = new Set<string>(BUILT_IN_PROVIDERS.flatMap(
    ({ id, displayName }) => [id, displayName],
  ));
  const adapter = adapterModules.has(module)
    ? BUILT_IN_PROVIDERS.find(({ adapterModule }) => adapterModule === module)
    : undefined;
  const foreignProviders = adapter === undefined
    ? BUILT_IN_PROVIDERS
    : BUILT_IN_PROVIDERS.filter(({ id }) => id !== adapter.id);
  const forbiddenIds = new Set<string>(foreignProviders.map(({ id }) => id));
  const findings: ProviderLiteralFinding[] = [];
  const report = (node: ts.Node, value: string): void => {
    findings.push({
      file: module,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      value,
    });
  };
  const isDeclaredPropertyName = (node: ts.Node): node is ts.PropertyName => {
    const parent = node.parent;
    const parentOwnsName = (parent as ts.NamedDeclaration).name === node;
    return parentOwnsName && (
      ts.isPropertyAssignment(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent)
    );
  };
  const hasDisplayName = (text: string, displayName: string): boolean =>
    new RegExp(`\\b${displayName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`).test(text);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)) {
      if (adapter) {
        if (forbiddenIds.has(node.text)
          || foreignProviders.some(({ displayName }) => hasDisplayName(node.text, displayName))
          || (node.text !== adapter.displayName && hasDisplayName(node.text, adapter.displayName))) {
          report(node, node.text);
        }
      } else if (forbiddenLiterals.has(node.text)
        || BUILT_IN_PROVIDERS.some(({ displayName }) => hasDisplayName(node.text, displayName))) {
        report(node, node.text);
      }
    }
    if (isDeclaredPropertyName(node)
      && (ts.isIdentifier(node)
        || (ts.isComputedPropertyName(node) && ts.isIdentifier(node.expression)))) {
      const expression = ts.isComputedPropertyName(node) ? node.expression : undefined;
      const value = expression === undefined
        ? (ts.isIdentifier(node) ? node.text : undefined)
        : ts.isIdentifier(expression) ? expression.text : undefined;
      if (value && forbiddenIds.has(value)) report(node, value);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return findings;
}

async function productionProviderLiteralFindings(): Promise<readonly ProviderLiteralFinding[]> {
  const files = await sourceFiles(sourceRoot);
  const findings = await Promise.all(files.map(async (path) => {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    return findProviderLiterals(relative(sourceRoot, path), source);
  }));
  return findings.flat();
}

describe('structural: built-in provider literals', () => {
  it('reports a fixture provider id literal with its file and line', () => {
    const source = ts.createSourceFile('fixtures/provider-id-literal.ts', "const provider = 'codex';", ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('fixtures/provider-id-literal.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-id-literal.ts', line: 1, value: 'codex' },
    ]);
  });

  it('reports a fixture provider display literal with its file and line', () => {
    const source = ts.createSourceFile('fixtures/provider-display-literal.ts', "const displayName = 'Codex';", ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('fixtures/provider-display-literal.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-display-literal.ts', line: 1, value: 'Codex' },
    ]);
  });

  it('reports a provider display name embedded in a non-adapter template span', () => {
    const source = ts.createSourceFile(
      'fixtures/provider-display-template.ts',
      'const output = `Codex ${credentials} credentials`;',
      ts.ScriptTarget.Latest,
      true,
    );

    expect(findProviderLiterals('fixtures/provider-display-template.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-display-template.ts', line: 1, value: 'Codex ' },
    ]);
  });

  it('reports a fixture provider id used as a property name with its file and line', () => {
    const source = ts.createSourceFile('fixtures/provider-id-key.ts', 'const providers = { codex: true };', ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('fixtures/provider-id-key.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-id-key.ts', line: 1, value: 'codex' },
    ]);
  });

  it('reports a declared adapter display name embedded in user-facing text', () => {
    const source = ts.createSourceFile('fixtures/pi-adapter.ts', "const output = 'Pi invocation aborted.';", ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('execution/pi-provider.ts', source)).toEqual([
      { file: 'execution/pi-provider.ts', line: 1, value: 'Pi invocation aborted.' },
    ]);
  });

  it('reports foreign provider ids and display names inside a declared adapter', () => {
    const source = ts.createSourceFile(
      'fixtures/codex-adapter.ts',
      "const provider = 'claude';\nconst providers = { claude: true };\nconst output = 'Claude';",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(findProviderLiterals('execution/codex-provider.ts', source)).toEqual([
      { file: 'execution/codex-provider.ts', line: 1, value: 'claude' },
      { file: 'execution/codex-provider.ts', line: 2, value: 'claude' },
      { file: 'execution/codex-provider.ts', line: 3, value: 'Claude' },
    ]);
  });

  it('keeps an adapter’s own provider id and display name exempt', () => {
    const source = ts.createSourceFile(
      'fixtures/codex-adapter.ts',
      "const provider = 'codex';\nconst displayName = 'Codex';",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(findProviderLiterals('execution/codex-provider.ts', source)).toEqual([]);
  });

  it('has no built-in provider ids or display names outside the catalog and declared adapters', async () => {
    expect(await productionProviderLiteralFindings()).toEqual([]);
  });
});
