import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface ConductorShapeViolation {
  kind: string;
  name: string;
  line: number;
}

export interface ConductorImportViolation {
  file: string;
  specifier: string;
  names: string[];
}

interface ConductorInventory {
  moduleLevelAtBase: readonly string[];
}

const guardDirectory = dirname(fileURLToPath(import.meta.url));
const engineDirectory = join(guardDirectory, '../../src/engine');
const conductorInventory = JSON.parse(
  readFileSync(new URL('./conductor-exports.json', import.meta.url), 'utf8'),
) as ConductorInventory;

/**
 * The facade and every engine module that now owns a declaration moved out of
 * it. Source-level negative scans use this set so a move cannot hide a
 * forbidden pattern from a conductor-only check.
 */
export const CONDUCTOR_DECOMPOSED_MODULES = [
  'engine/conductor.ts',
  ...engineModulePaths().filter((path) => declaresInventoryName(path)),
];

/**
 * Check that conductor.ts remains a thin facade: imports, forwarded exports,
 * its facade class, and explicitly-listed tuning constants are its only
 * top-level declarations.
 */
export function checkConductorShape(
  source: string,
  allowedTunables: readonly string[],
): ConductorShapeViolation[] {
  const sourceFile = parseSource(source, 'conductor.ts');
  const allowed = new Set(allowedTunables);

  return sourceFile.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement)) return [];

    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined
        && statement.exportClause !== undefined
        && ts.isNamedExports(statement.exportClause)) return [];
      if (statement.exportClause === undefined) {
        return [violation(sourceFile, statement, 'export star', '*')];
      }
      return [violation(sourceFile, statement, 'local export', exportName(statement, sourceFile))];
    }

    if (ts.isVariableStatement(statement)) {
      if (hasDeclareModifier(statement)) {
        return [violation(sourceFile, statement, 'declare', declarationNames(statement.declarationList).join(', '))];
      }
      const kind = variableKind(statement.declarationList);
      const names = declarationNames(statement.declarationList);
      if (kind === 'const' && names.every((name) => allowed.has(name))) return [];
      return [violation(sourceFile, statement, kind, names.join(', '))];
    }

    if (ts.isClassDeclaration(statement)) {
      if (!hasDeclareModifier(statement) && statement.name?.text === 'Conductor') return [];
      return [violation(sourceFile, statement, hasDeclareModifier(statement) ? 'declare' : 'class', statement.name?.text ?? 'default')];
    }

    if (ts.isFunctionDeclaration(statement)) {
      return [violation(sourceFile, statement, hasDeclareModifier(statement) ? 'declare' : 'function', statement.name?.text ?? 'default')];
    }

    if (ts.isInterfaceDeclaration(statement)) {
      return [violation(sourceFile, statement, hasDeclareModifier(statement) ? 'declare' : 'interface', statement.name.text)];
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      return [violation(sourceFile, statement, 'type', statement.name.text)];
    }
    if (ts.isEnumDeclaration(statement)) {
      return [violation(sourceFile, statement, hasDeclareModifier(statement) ? 'declare' : 'enum', statement.name.text)];
    }
    if (ts.isModuleDeclaration(statement)) {
      return [violation(sourceFile, statement, hasDeclareModifier(statement) ? 'declare' : 'namespace', statement.name.getText(sourceFile))];
    }
    if (ts.isExportAssignment(statement)) {
      return [violation(
        sourceFile,
        statement,
        statement.isExportEquals ? 'export assignment' : 'export default',
        statement.isExportEquals ? statement.expression.getText(sourceFile) : 'default',
      )];
    }
    if (ts.isExpressionStatement(statement)) {
      return [violation(sourceFile, statement, 'expression statement', expressionName(statement.expression, sourceFile))];
    }

    return [violation(sourceFile, statement, 'other', statement.getText(sourceFile))];
  });
}

/**
 * Enforce that only designated facade consumers import the Conductor class
 * directly, and that they import no other binding from conductor.ts.
 */
export function checkConductorImports(
  files: Record<string, string>,
  allowedImporters: ReadonlySet<string>,
): ConductorImportViolation[] {
  return Object.entries(files).flatMap(([file, source]) => {
    const sourceFile = parseSource(source, file);
    return sourceFile.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
      const specifier = statement.moduleSpecifier.text;
      if (specifier !== './conductor.js' && specifier !== './engine/conductor.js') return [];

      const names = importBindingNames(statement);
      if (!allowedImporters.has(file)) return [{ file, specifier, names }];
      if (isAllowedConductorImport(statement)) return [];

      return [{
        file,
        specifier,
        names: problematicBindingNames(statement, names),
      }];
    });
  });
}

function parseSource(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function engineModulePaths(directory = engineDirectory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return engineModulePaths(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [relative(join(engineDirectory, '..'), path)] : [];
    })
    .sort();
}

function declaresInventoryName(modulePath: string): boolean {
  const source = readFileSync(join(engineDirectory, '..', modulePath), 'utf8');
  const names = topLevelDeclarationNames(parseSource(source, modulePath));
  return conductorInventory.moduleLevelAtBase.some((name) => names.has(inventoryName(name)));
}

function topLevelDeclarationNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
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

function violation(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  kind: string,
  name: string,
): ConductorShapeViolation {
  return {
    kind,
    name,
    line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1,
  };
}

function hasDeclareModifier(node: ts.HasModifiers): boolean {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
}

function declarationNames(list: ts.VariableDeclarationList): string[] {
  return list.declarations.flatMap((declaration) => bindingNames(declaration.name));
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

function variableKind(list: ts.VariableDeclarationList): 'const' | 'let' | 'var' {
  if ((list.flags & ts.NodeFlags.Const) !== 0) return 'const';
  if ((list.flags & ts.NodeFlags.Let) !== 0) return 'let';
  return 'var';
}

function exportName(statement: ts.ExportDeclaration, sourceFile: ts.SourceFile): string {
  if (statement.exportClause === undefined) return '*';
  if (ts.isNamespaceExport(statement.exportClause)) return `* as ${statement.exportClause.name.text}`;
  if (ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length === 1) {
    return statement.exportClause.elements[0].name.text;
  }
  return statement.exportClause.getText(sourceFile);
}

function expressionName(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isCallExpression(expression)) return expression.expression.getText(sourceFile);
  return expression.getText(sourceFile);
}

function importBindingNames(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (clause === undefined) return [];

  const names: string[] = [];
  if (clause.name !== undefined) names.push(clause.name.text);
  if (clause.namedBindings === undefined) return names;
  if (ts.isNamespaceImport(clause.namedBindings)) return [...names, `* as ${clause.namedBindings.name.text}`];
  return [
    ...names,
    ...clause.namedBindings.elements.map((element) => element.propertyName === undefined
      ? element.name.text
      : `${element.propertyName.text} as ${element.name.text}`),
  ];
}

function isAllowedConductorImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined || clause.isTypeOnly || clause.name !== undefined) return false;
  if (clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) return false;
  if (clause.namedBindings.elements.length !== 1) return false;

  const [element] = clause.namedBindings.elements;
  return !element.isTypeOnly
    && element.propertyName === undefined
    && element.name.text === 'Conductor';
}

function problematicBindingNames(statement: ts.ImportDeclaration, names: string[]): string[] {
  if (!isAllowedConductorImport(statement)) {
    const clause = statement.importClause;
    if (clause?.isTypeOnly || clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
      return names;
    }

    const problematic = clause.namedBindings.elements
      .filter((element) => element.isTypeOnly || element.propertyName !== undefined || element.name.text !== 'Conductor')
      .map((element) => element.propertyName === undefined
        ? element.name.text
        : `${element.propertyName.text} as ${element.name.text}`);
    return problematic.length > 0 ? problematic : names;
  }
  return [];
}
