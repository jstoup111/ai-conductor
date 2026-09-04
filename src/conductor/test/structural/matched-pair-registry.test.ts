// Covers: S2.1, S2.2, S2.4, S2.5, S2.6, S3.1, S3.3, S3.5, task:2, task:4
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MATCHED_PAIR_REGISTRY } from '../engine/matched-pairs.js';

const conductorRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = join(conductorRoot, '../..');

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

interface CheckedSide {
  readonly name: string;
  readonly file: string;
  readonly enumeration: string;
  readonly markdownAnchor?: string;
}

function extractDocumentedIds(id: string, side: CheckedSide, contents: string): Set<string> {
  const line = contents.split('\n').find((candidate) =>
    side.markdownAnchor !== undefined && candidate.includes(side.markdownAnchor),
  );
  if (!line) {
    throw new Error(`matched-pair ${id}: empty extraction on ${side.name} side (${side.file})`);
  }
  const anchorIndex = line.indexOf(side.markdownAnchor ?? '');
  const members = [...line.slice(anchorIndex + (side.markdownAnchor?.length ?? 0)).matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]);
  if (members.length === 0) {
    throw new Error(`matched-pair ${id}: empty extraction on ${side.name} side (${side.file})`);
  }
  return new Set(members);
}

function assertMatchingMembers(
  id: string,
  authoritative: CheckedSide,
  authoritativeMembers: ReadonlySet<string>,
  compared: CheckedSide,
  comparedMembers: ReadonlySet<string>,
): void {
  if (authoritativeMembers.size === 0) {
    throw new Error(`matched-pair ${id}: empty extraction on ${authoritative.name} side (${authoritative.file})`);
  }
  if (comparedMembers.size === 0) {
    throw new Error(`matched-pair ${id}: empty extraction on ${compared.name} side (${compared.file})`);
  }
  const missingFromCompared = [...authoritativeMembers].filter((member) => !comparedMembers.has(member));
  const unexpectedInCompared = [...comparedMembers].filter((member) => !authoritativeMembers.has(member));
  if (missingFromCompared.length > 0 || unexpectedInCompared.length > 0) {
    throw new Error(
      `matched-pair ${id}: member mismatch between ${authoritative.name} (${authoritative.file}) and ${compared.name} (${compared.file}); missing from ${compared.name}: ${missingFromCompared.join(', ') || 'none'}; unexpected in ${compared.name}: ${unexpectedInCompared.join(', ') || 'none'}`,
    );
  }
}

async function readDeclaredFile(id: string, side: CheckedSide): Promise<string> {
  try {
    return await readFile(join(repositoryRoot, side.file), 'utf8');
  } catch {
    throw new Error(`matched-pair ${id}: unreadable declared file on ${side.name} side (${side.file})`);
  }
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

describe('matched-pair checked enumerations', () => {
  it('verifies every checked declaration against the executed engine export and documentation', async () => {
    const config = await import('../../src/engine/config.js');
    for (const [id, declaration] of Object.entries(MATCHED_PAIR_REGISTRY)) {
      if (declaration.mode !== 'checked') continue;
      const authoritativeMembers = config[declaration.authoritative.enumeration as keyof typeof config];
      if (!Array.isArray(authoritativeMembers) || !authoritativeMembers.every((member) => typeof member === 'string')) {
        throw new Error(`matched-pair ${id}: empty extraction on ${declaration.authoritative.name} side (${declaration.authoritative.file})`);
      }
      const contents = await readDeclaredFile(id, declaration.compared);
      assertMatchingMembers(
        id,
        declaration.authoritative,
        new Set(authoritativeMembers),
        declaration.compared,
        extractDocumentedIds(id, declaration.compared, contents),
      );
    }
  });

  const fixtureAuthoritative = {
    name: 'engine',
    file: 'src/conductor/src/engine/config.ts',
    enumeration: 'RETIRED_IDS',
  };
  const fixtureDocumentation = {
    name: 'configuration documentation',
    file: 'docs/reference/configuration.md',
    enumeration: 'retired ids',
    markdownAnchor: 'Retired ids:',
  };

  it('accepts matching documented members', () => {
    const documented = extractDocumentedIds(
      'fixture-matching-members', fixtureDocumentation, 'Retired ids: `scope`, `wiring`',
    );
    expect(() => assertMatchingMembers(
      'fixture-matching-members', fixtureAuthoritative, new Set(['scope', 'wiring']),
      fixtureDocumentation, documented,
    )).not.toThrow();
  });

  it('rejects a documented member omission with both locations and the missing member', () => {
    const documented = extractDocumentedIds(
      'fixture-member-mismatch', fixtureDocumentation, 'Retired ids: `scope`',
    );
    expect(() => assertMatchingMembers(
      'fixture-member-mismatch', fixtureAuthoritative, new Set(['scope', 'wiring']),
      fixtureDocumentation, documented,
    )).toThrow(/fixture-member-mismatch: member mismatch.*config\.ts.*configuration\.md.*missing from configuration documentation: wiring/);
  });

  it('rejects a docs excerpt with no extractable members', () => {
    expect(() => extractDocumentedIds(
      'fixture-empty-documentation', fixtureDocumentation, 'Retired ids: none',
    )).toThrow(/fixture-empty-documentation: empty extraction on configuration documentation side.*configuration\.md/);
  });
});
