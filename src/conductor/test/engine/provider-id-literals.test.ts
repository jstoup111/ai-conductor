// Covers: task:8, task:11, task:rem-as-built-rem-pg1-1, task:rem-as-built-rem-pg3-1
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
const ADAPTER_MODULES_BY_PROVIDER_ID = {
  claude: ['execution/claude-provider.ts'],
  codex: ['execution/codex-provider.ts'],
  pi: ['execution/pi-provider.ts', 'execution/pi-harness-extension.ts'],
} as const satisfies Readonly<Record<(typeof BUILT_IN_PROVIDERS)[number]['id'], readonly string[]>>;

interface ProviderLiteralFinding {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

interface ProviderShapeBranchFinding {
  readonly file: string;
  readonly line: number;
  readonly property: 'homeVariable' | 'environmentPrefix';
}

interface ProviderConstantBranchFinding {
  readonly file: string;
  readonly line: number;
  readonly constant: 'CLAUDE_PROVIDER' | 'CODEX_PROVIDER';
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
  return new Set(Object.values(ADAPTER_MODULES_BY_PROVIDER_ID).flat());
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
  const adapterProviderId = adapterModules.has(module)
    ? Object.entries(ADAPTER_MODULES_BY_PROVIDER_ID).find(([, modules]) => {
      const providerModules: readonly string[] = modules;
      return providerModules.includes(module);
    })?.[0]
    : undefined;
  const adapter = adapterProviderId === undefined
    ? undefined
    : BUILT_IN_PROVIDERS.find(({ id }) => id === adapterProviderId);
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
          || BUILT_IN_PROVIDERS.some(({ displayName }) => hasDisplayName(node.text, displayName))) {
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

function findProviderShapeBranches(
  module: string,
  source: ts.SourceFile,
): readonly ProviderShapeBranchFinding[] {
  const findings: ProviderShapeBranchFinding[] = [];
  const report = (node: ts.Node, property: ProviderShapeBranchFinding['property']): void => {
    findings.push({
      file: module,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      property,
    });
  };
  const shapeProperty = (node: ts.Expression): ProviderShapeBranchFinding['property'] | undefined =>
    ts.isPropertyAccessExpression(node)
      && (node.name.text === 'homeVariable' || node.name.text === 'environmentPrefix')
      ? node.name.text
      : undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(node.operatorToken.kind)) {
      const leftProperty = shapeProperty(node.left);
      const rightProperty = shapeProperty(node.right);
      if (leftProperty && ts.isStringLiteral(node.right)) report(node, leftProperty);
      if (rightProperty && ts.isStringLiteral(node.left)) report(node, rightProperty);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return findings;
}

async function productionProviderShapeBranchFindings(): Promise<readonly ProviderShapeBranchFinding[]> {
  const excluded = new Set([catalogModule, ...declaredAdapterModules()]);
  const files = (await sourceFiles(sourceRoot)).filter((path) => !excluded.has(relative(sourceRoot, path)));
  const findings = await Promise.all(files.map(async (path) => {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    return findProviderShapeBranches(relative(sourceRoot, path), source);
  }));
  return findings.flat();
}

function findSelfHostProviderConstantBranches(
  module: string,
  source: ts.SourceFile,
): readonly ProviderConstantBranchFinding[] {
  const findings: ProviderConstantBranchFinding[] = [];
  const constant = (node: ts.Expression): ProviderConstantBranchFinding['constant'] | undefined =>
    ts.isIdentifier(node) && (node.text === 'CLAUDE_PROVIDER' || node.text === 'CODEX_PROVIDER')
      ? node.text
      : undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const found = constant(node.left) ?? constant(node.right);
      if (found) findings.push({
        file: module,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        constant: found,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return findings;
}

async function productionSelfHostProviderConstantBranchFindings(): Promise<readonly ProviderConstantBranchFinding[]> {
  const modules = [
    'engine/conductor.ts',
    'engine/self-host/provider-home.ts',
    'engine/self-host/live-boundary.ts',
  ];
  const findings = await Promise.all(modules.map(async (module) => {
    const path = join(sourceRoot, module);
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    return findSelfHostProviderConstantBranches(module, source);
  }));
  return findings.flat();
}

describe('structural: built-in provider literals', () => {
  it('declares existing provider-owned modules for each built-in provider', async () => {
    const catalogIds = BUILT_IN_PROVIDERS.map(({ id }) => id);
    const adapterEntries = Object.entries(ADAPTER_MODULES_BY_PROVIDER_ID);
    const adapterIds = adapterEntries.map(([id]) => id);
    const modules = new Set((await sourceFiles(sourceRoot)).map((path) => relative(sourceRoot, path)));

    expect(adapterIds).toHaveLength(catalogIds.length);
    expect(new Set(adapterIds)).toEqual(new Set(catalogIds));
    for (const [, adapterModules] of adapterEntries) {
      for (const adapterModule of adapterModules) {
        expect(modules).toContain(adapterModule);
      }
    }
  });

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

  it('keeps an adapter’s own provider id exempt but reports its display name', () => {
    const source = ts.createSourceFile(
      'fixtures/codex-adapter.ts',
      "const provider = 'codex';\nconst displayName = 'Codex';",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(findProviderLiterals('execution/codex-provider.ts', source)).toEqual([
      { file: 'execution/codex-provider.ts', line: 2, value: 'Codex' },
    ]);
  });

  it('has no built-in provider ids or display names outside the catalog and declared adapters', async () => {
    expect(await productionProviderLiteralFindings()).toEqual([]);
  });

  it('reports provider-home shape comparisons in fixtures and none in production consumers', async () => {
    const fixtures = [
      [
        'fixtures/provider-home-variable.ts',
        "provider.homeVariable === 'CODEX_HOME';\nprovider.homeVariable === 'CLAUDE_CONFIG_DIR';\n'CODEX_HOME' !== provider.homeVariable;",
      ],
      [
        'fixtures/provider-environment-prefix.ts',
        "provider?.environmentPrefix === 'CODEX_';\nprovider.environmentPrefix === 'CLAUDE_';",
      ],
    ] as const;

    expect({
      fixtures: fixtures.flatMap(([path, text]) => findProviderShapeBranches(
        path,
        ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
      )),
      production: await productionProviderShapeBranchFindings(),
    }).toEqual({
      fixtures: [
        { file: 'fixtures/provider-home-variable.ts', line: 1, property: 'homeVariable' },
        { file: 'fixtures/provider-home-variable.ts', line: 2, property: 'homeVariable' },
        { file: 'fixtures/provider-home-variable.ts', line: 3, property: 'homeVariable' },
        { file: 'fixtures/provider-environment-prefix.ts', line: 1, property: 'environmentPrefix' },
        { file: 'fixtures/provider-environment-prefix.ts', line: 2, property: 'environmentPrefix' },
      ],
      production: [],
    });
  });

  it('reports self-host branches selected by provider constants', async () => {
    const fixture = ts.createSourceFile(
      'fixtures/self-host-provider-constant.ts',
      'provider === CLAUDE_PROVIDER;\nCODEX_PROVIDER !== provider;',
      ts.ScriptTarget.Latest,
      true,
    );

    expect({
      fixture: findSelfHostProviderConstantBranches('fixtures/self-host-provider-constant.ts', fixture),
      production: await productionSelfHostProviderConstantBranchFindings(),
    }).toEqual({
      fixture: [
        { file: 'fixtures/self-host-provider-constant.ts', line: 1, constant: 'CLAUDE_PROVIDER' },
        { file: 'fixtures/self-host-provider-constant.ts', line: 2, constant: 'CODEX_PROVIDER' },
      ],
      production: [],
    });
  });
});
