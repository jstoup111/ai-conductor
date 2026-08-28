import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MATCHED_PAIR_REGISTRY } from '../../src/engine/matched-pairs.js';

const conductorRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface DerivationDeclaration {
  readonly derivingModule: string;
  readonly sourceModule: string;
  readonly importedExport: string;
}

function moduleSpecifierMatches(
  derivingModule: string,
  sourceModule: string,
  moduleSpecifier: string,
): boolean {
  const expected = relative(dirname(derivingModule), sourceModule)
    .replace(/\.ts$/, '')
    .replace(/^([^./])/, './$1');
  return moduleSpecifier.replace(/\.js$/, '') === expected;
}

function importedLocalName(
  source: ts.SourceFile,
  declaration: DerivationDeclaration,
): string | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      !moduleSpecifierMatches(declaration.derivingModule, declaration.sourceModule, statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === declaration.importedExport) return element.name.text;
    }
  }
  return undefined;
}

function referencesIdentifierOutsideImports(source: ts.SourceFile, identifier: string): boolean {
  let referenced = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === identifier) referenced = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return referenced;
}

function assertDerivationLink(
  id: string,
  declaration: DerivationDeclaration,
  source: ts.SourceFile,
): void {
  const localName = importedLocalName(source, declaration);
  if (!localName) {
    throw new Error(
      `matched-pair ${id}: missing import edge from ${declaration.derivingModule} to ${declaration.sourceModule} for ${declaration.importedExport}`,
    );
  }
  if (!referencesIdentifierOutsideImports(source, localName)) {
    throw new Error(
      `matched-pair ${id}: missing reference outside import in ${declaration.derivingModule} to ${declaration.importedExport} from ${declaration.sourceModule}`,
    );
  }
}

function sourceFile(path: string, contents: string): ts.SourceFile {
  return ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
}

describe('matched-pair derivation links', () => {
  it('verifies every derivation declaration against its real source module', async () => {
    for (const [id, declaration] of Object.entries(MATCHED_PAIR_REGISTRY)) {
      if (declaration.mode !== 'satisfied-by-derivation') continue;
      const contents = await readFile(join(conductorRoot, declaration.derivingModule.replace('src/conductor/', '')), 'utf8');
      assertDerivationLink(id, declaration, sourceFile(declaration.derivingModule, contents));
    }
  });

  it('accepts an import that is referenced outside its import statement', () => {
    const declaration = {
      derivingModule: 'src/conductor/src/engine/deriving.ts',
      sourceModule: 'src/conductor/src/engine/config.ts',
      importedExport: 'RETIRED_IDS',
    };

    expect(() => assertDerivationLink('fixture-accepted', declaration, sourceFile(
      declaration.derivingModule,
      "import { RETIRED_IDS } from './config.js';\nconst filter = RETIRED_IDS.join('|');",
    ))).not.toThrow();
  });

  it('rejects a missing import edge', () => {
    const declaration = {
      derivingModule: 'src/conductor/src/engine/deriving.ts',
      sourceModule: 'src/conductor/src/engine/config.ts',
      importedExport: 'RETIRED_IDS',
    };

    expect(() => assertDerivationLink('fixture-missing-import', declaration, sourceFile(
      declaration.derivingModule,
      'const filter = RETIRED_IDS.join(\'|\');',
    ))).toThrow(/fixture-missing-import: missing import edge.*deriving\.ts.*config\.ts/);
  });

  it('rejects an import that is never referenced', () => {
    const declaration = {
      derivingModule: 'src/conductor/src/engine/deriving.ts',
      sourceModule: 'src/conductor/src/engine/config.ts',
      importedExport: 'RETIRED_IDS',
    };

    expect(() => assertDerivationLink('fixture-missing-reference', declaration, sourceFile(
      declaration.derivingModule,
      "import { RETIRED_IDS } from './config.js';",
    ))).toThrow(/fixture-missing-reference: missing reference outside import.*deriving\.ts.*config\.ts/);
  });
});
