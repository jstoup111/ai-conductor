// Covers: task:1, task:10, task:12
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { checkConductorImports, checkConductorShape } from './conductor-shape-guard.js';
import { CONDUCTOR_DECOMPOSED_MODULES } from './conductor-shape-guard.js';

interface ConductorInventory {
  moduleLevelAtBase: string[];
}

const CONDUCTOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = join(CONDUCTOR_ROOT, 'src/engine');
const CONDUCTOR_PATH = join(ENGINE_ROOT, 'conductor.ts');
const inventory = JSON.parse(
  await readFile(new URL('./conductor-exports.json', import.meta.url), 'utf8'),
) as ConductorInventory;

const ALLOWED_TUNABLES = [
  'MAX_RECOVERY_RETRIES',
  'MAX_RATE_LIMIT_DEADLINE_MS',
  'PUBLICATION_REDISPATCH_BUDGET',
  'MAX_GATE_SELECTIONS',
  'DONE_MARKER',
  'LOOP_HALT_MARKER',
];

const ALLOWED_IMPORTERS = new Set(['index.ts', 'daemon-cli.ts']);
const SOURCE_ROOT = join(CONDUCTOR_ROOT, 'src');
const DIRECT_IMPORTERS = [
  'engine/step-runners.ts',
  'engine/group-core.ts',
  'engine/finish-publication-production.ts',
  'engine/self-host/build-auth-preflight.ts',
  'engine/daemon-deps.ts',
  'engine/daemon-runner.ts',
  'ui/types.ts',
  'ui/terminal/prompt-host.ts',
  'engine/kickback-budget-cli.ts',
  'engine/daemon-observe-cli.ts',
];

async function engineModules(directory = ENGINE_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return engineModules(path);
    return entry.isFile() && entry.name.endsWith('.ts') && path !== CONDUCTOR_PATH ? [path] : [];
  }));
  return nested.flat();
}

async function sourceModules(directory = SOURCE_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function programForSource(): ts.Program {
  const config = ts.readConfigFile(join(CONDUCTOR_ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CONDUCTOR_ROOT);
  return ts.createProgram({
    rootNames: ts.sys.readDirectory(SOURCE_ROOT, ['.ts'], undefined, ['**/*.ts']),
    options: parsed.options,
  });
}

function declaredNames(source: string, fileName: string): Set<string> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function inventoryName(name: string): string {
  return name === 'appendRemediationTasks' ? 'appendConductorRemediationTasks' : name;
}

describe('structural: conductor shape guard', () => {
  it('preserves the base declaration inventory in the real decomposed facade', async () => {
    const { stdout: base } = await execa('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: CONDUCTOR_ROOT });
    const { stdout: baseConductor } = await execa(
      'git',
      ['show', `${base}:src/conductor/src/engine/conductor.ts`],
      { cwd: CONDUCTOR_ROOT },
    );
    expect(inventory.moduleLevelAtBase).toEqual(
      checkConductorShape(baseConductor, ALLOWED_TUNABLES).map((violation) => violation.name),
    );

    const conductor = await readFile(CONDUCTOR_PATH, 'utf8');
    expect(checkConductorShape(conductor, ALLOWED_TUNABLES)).toEqual([]);

    const modules = await engineModules();
    const declarations = await Promise.all(modules.map(async (path) => ({
      path: relative(ENGINE_ROOT, path),
      names: declaredNames(await readFile(path, 'utf8'), path),
    })));
    const locations = Object.fromEntries(inventory.moduleLevelAtBase.map((name) => [
      name,
      declarations.filter((module) => module.names.has(inventoryName(name))).map((module) => module.path),
    ]));
    expect(locations).toEqual(expect.objectContaining(
      Object.fromEntries(inventory.moduleLevelAtBase.map((name) => [name, expect.any(Array)])),
    ));
    for (const name of inventory.moduleLevelAtBase) expect(locations[name]).toHaveLength(1);
  });

  it('keeps the six facade tunables declared in conductor.ts', async () => {
    const declarations = declaredNames(await readFile(CONDUCTOR_PATH, 'utf8'), CONDUCTOR_PATH);
    expect(ALLOWED_TUNABLES.every((name) => declarations.has(name))).toBe(true);
  });

  it.each([
    ['function', 'runNow', 'function runNow() {}'],
    ['const', 'NOT_A_TUNABLE', 'const NOT_A_TUNABLE = 1;'],
    ['export star', '*', "export * from './other.js';"],
    ['export default', 'default', 'export default 1;'],
    ['export assignment', 'x', 'export = x;'],
    ['local export', 'X', 'export { X };'],
    ['type', 'LocalType', 'type LocalType = string;'],
    ['interface', 'LocalInterface', 'interface LocalInterface {}'],
    ['enum', 'LocalEnum', 'enum LocalEnum { Value }'],
    ['namespace', 'LocalNamespace', 'namespace LocalNamespace {}'],
    ['declare', 'declaredValue', 'declare const declaredValue: string;'],
    ['let', 'mutableValue', 'let mutableValue = 1;'],
    ['var', 'legacyValue', 'var legacyValue = 1;'],
    ['class', 'NotConductor', 'class NotConductor {}'],
    ['expression statement', 'callMe', 'callMe();'],
  ])('rejects a top-level %s and reports its kind, name, and line', (kind, name, source) => {
    expect(checkConductorShape(source, ALLOWED_TUNABLES)).toContainEqual(expect.objectContaining({
      kind,
      name,
      line: 1,
    }));
  });

  it('accepts imports, named re-exports, the six tunables, and Conductor', () => {
    const source = [
      "import { dependency } from './dependency.js';",
      "export { value } from './value.js';",
      "export type { Value } from './value.js';",
      'export const MAX_RECOVERY_RETRIES = 1;',
      'const MAX_RATE_LIMIT_DEADLINE_MS = 2;',
      'const PUBLICATION_REDISPATCH_BUDGET = 3;',
      'const MAX_GATE_SELECTIONS = 4;',
      "const DONE_MARKER = 'done';",
      "const LOOP_HALT_MARKER = 'halt';",
      'class Conductor { dependency = dependency; }',
    ].join('\n');

    expect(checkConductorShape(source, ALLOWED_TUNABLES)).toEqual([]);
  });

  it.each([
    ['value import', "import { Conductor } from './conductor.js';"],
    ['type-only import', "import type { Conductor } from './conductor.js';"],
    ['double-quoted import', 'import { Conductor } from "./conductor.js";'],
  ])('rejects a non-destination module with a %s of conductor', (_label, statement) => {
    const violations = checkConductorImports({ 'engine/foo.ts': statement }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'engine/foo.ts',
      specifier: './conductor.js',
    }));
  });

  it.each([
    ['engine/self-host/x.ts', "import { Conductor } from '../conductor.js';"],
    ['ui/x.ts', "import { Conductor } from '../engine/conductor.js';"],
    ['ui/terminal/x.ts', "import { Conductor } from '../../engine/conductor.js';"],
  ])('rejects a nested module importing the conductor facade', (file, statement) => {
    const violations = checkConductorImports({ [file]: statement }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({ file }));
  });

  it.each([
    ['index.ts', 'buildRetryHint'],
    ['daemon-cli.ts', 'OperatorParkedTermination'],
  ])('rejects %s importing %s alongside Conductor', (file, extraName) => {
    const statement = `import { Conductor, ${extraName} } from './engine/conductor.js';`;
    const violations = checkConductorImports({ [file]: statement }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file,
      names: [extraName],
    }));
  });

  it('rejects an allowed importer that aliases Conductor', () => {
    const violations = checkConductorImports({
      'index.ts': "import { Conductor as Runner } from './engine/conductor.js';",
    }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'index.ts',
      names: ['Conductor as Runner'],
    }));
  });

  it('rejects a destination module that imports Conductor type-only', () => {
    const violations = checkConductorImports({
      'index.ts': "import type { Conductor } from './engine/conductor.js';",
    }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'index.ts',
      specifier: './engine/conductor.js',
    }));
  });

  it('accepts destination modules that import only Conductor by value', () => {
    expect(checkConductorImports({
      'index.ts': "import { Conductor } from './engine/conductor.js';",
      'daemon-cli.ts': "import { Conductor } from './engine/conductor.js';",
    }, ALLOWED_IMPORTERS)).toEqual([]);
  });

  it('ignores imports and re-exports whose source is not conductor', () => {
    expect(checkConductorImports({
      'engine/foo.ts': [
        "import { helper } from './helper.js';",
        "export { exportedHelper } from './exported-helper.js';",
      ].join('\n'),
    }, ALLOWED_IMPORTERS)).toEqual([]);
  });

  it('ignores a nested import whose normalized path is not the conductor facade', () => {
    expect(checkConductorImports({
      'ui/x.ts': "import { helper } from '../other/conductor.js';",
    }, ALLOWED_IMPORTERS)).toEqual([]);
  });

  it('allows only the two public entry points to import the conductor facade', async () => {
    const files = Object.fromEntries(await Promise.all((await sourceModules()).map(async (path) => [
      relative(SOURCE_ROOT, path),
      await readFile(path, 'utf8'),
    ])));

    expect(checkConductorImports(files, ALLOWED_IMPORTERS)).toEqual([]);
  });

  it('has each direct consumer import moved declarations from their defining module', () => {
    const program = programForSource();
    const checker = program.getTypeChecker();
    const decomposed = new Set(CONDUCTOR_DECOMPOSED_MODULES.map((path) => join(SOURCE_ROOT, path)));
    const inventoryNames = new Set(inventory.moduleLevelAtBase.map(inventoryName));

    for (const importer of DIRECT_IMPORTERS) {
      const source = program.getSourceFile(join(SOURCE_ROOT, importer));
      expect(source, `${importer} is in the TypeScript program`).toBeDefined();
      for (const statement of source!.statements) {
        if (!ts.isImportDeclaration(statement) || statement.importClause?.namedBindings === undefined) continue;
        if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
        for (const element of statement.importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (!inventoryNames.has(importedName)) continue;

          const symbol = checker.getSymbolAtLocation(element.name);
          const declaration = symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol).valueDeclaration ?? checker.getAliasedSymbol(symbol).declarations?.[0]
            : symbol?.valueDeclaration ?? symbol?.declarations?.[0];
          expect(declaration, `${importer} resolves ${importedName}`).toBeDefined();
          const declarationPath = declaration!.getSourceFile().fileName;
          expect(decomposed.has(declarationPath), `${importer} resolves ${importedName} to a decomposed module`).toBe(true);
          expect(declarationPath).not.toBe(CONDUCTOR_PATH);

          const specifier = statement.moduleSpecifier;
          expect(ts.isStringLiteral(specifier), `${importer} has a string import specifier`).toBe(true);
          const resolved = ts.resolveModuleName(specifier.getText(source!).slice(1, -1), source!.fileName, program.getCompilerOptions(), ts.sys)
            .resolvedModule?.resolvedFileName;
          expect(resolved, `${importer} directly names ${relative(SOURCE_ROOT, declarationPath)}`).toBe(declarationPath);
        }
      }
    }
  });
});
