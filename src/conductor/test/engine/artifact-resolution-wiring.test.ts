import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CUSTOM_COMPLETION_PREDICATES, findArtifactFiles } from '../../src/engine/artifacts.js';

const sourceRoot = join(import.meta.dirname, '../../src');
const configPath = join(import.meta.dirname, '../../tsconfig.test.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  join(import.meta.dirname, '../..'),
);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

const EXPECTED_CUSTOM_COMPLETION_PREDICATES = [
  'acceptance_specs',
  'architecture_review_as_built',
  'build',
  'build_review',
  'finish',
  'manual_test',
  'prd_audit',
  'retro',
  'test_suite',
  'wiring_check',
];

function source(relativePath: string): ts.SourceFile {
  const path = join(sourceRoot, relativePath);
  const result = program.getSourceFile(path);
  if (!result) throw new Error(`TypeScript Program did not load ${path}`);
  return result;
}

function namedBody(file: ts.SourceFile, name: string): ts.Node | undefined {
  let match: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      ((node.name && ts.isIdentifier(node.name) && node.name.text === name) ||
        (ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name) &&
          node.parent.name.text === name))
    ) {
      match = node;
      return;
    }
    if (!match) ts.forEachChild(node, visit);
  };
  visit(file);
  return match;
}

function resolvedSymbol(node: ts.Node): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function topLevelSymbol(file: ts.SourceFile, name: string): ts.Symbol | undefined {
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings) {
      const bindings = statement.importClause.namedBindings;
      if (ts.isNamedImports(bindings)) {
        const binding = bindings.elements.find((element) => element.name.text === name);
        if (binding) return resolvedSymbol(binding.name);
      }
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return resolvedSymbol(statement.name);
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
      );
      if (declaration && ts.isIdentifier(declaration.name)) return resolvedSymbol(declaration.name);
    }
  }
  return undefined;
}

function callsSymbol(file: ts.SourceFile, node: ts.Node | undefined, callee: string): boolean {
  const expected = topLevelSymbol(file, callee);
  if (!expected || !node) return false;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      resolvedSymbol(child.expression) === expected
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function directVariableDeclaration(
  statement: ts.Statement,
  name: string,
): ts.VariableDeclaration | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  return statement.declarationList.declarations.find((declaration) => {
    if (ts.isIdentifier(declaration.name)) return declaration.name.text === name;
    return (
      ts.isObjectBindingPattern(declaration.name) &&
      declaration.name.elements.some((element) => element.name.getText() === name)
    );
  });
}

function declaredIdentifier(
  declaration: ts.VariableDeclaration,
  name: string,
): ts.Identifier | undefined {
  if (ts.isIdentifier(declaration.name)) return declaration.name;
  if (!ts.isObjectBindingPattern(declaration.name)) return undefined;
  const element = declaration.name.elements.find((candidate) => candidate.name.getText() === name);
  return element && ts.isIdentifier(element.name) ? element.name : undefined;
}

function callInInitializer(
  declaration: ts.VariableDeclaration,
  file: ts.SourceFile,
  callee: string,
): ts.CallExpression | undefined {
  const expected = topLevelSymbol(file, callee);
  let match: ts.CallExpression | undefined;
  if (!declaration.initializer || !expected) return undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      resolvedSymbol(node.expression) === expected
    ) {
      match = node;
      return;
    }
    if (!match) ts.forEachChild(node, visit);
  };
  visit(declaration.initializer);
  return match;
}

function callUsesSymbol(call: ts.CallExpression, symbol: ts.Symbol): boolean {
  return call.arguments.some(
    (argument) => ts.isIdentifier(argument) && resolvedSymbol(argument) === symbol,
  );
}

function callsThisMethodWithSymbol(node: ts.Node, method: string, symbol: ts.Symbol): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      child.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
      child.expression.name.text === method &&
      callUsesSymbol(child, symbol)
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isStepCompletionGuard(file: ts.SourceFile, expression: ts.Expression): boolean {
  if (!ts.isBinaryExpression(expression)) return false;
  if (expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return false;

  const expected = topLevelSymbol(file, 'stepHasCompletionCheck');
  const left = expression.left;
  const right = expression.right;
  return (
    expected !== undefined &&
    ts.isCallExpression(left) &&
    ts.isIdentifier(left.expression) &&
    resolvedSymbol(left.expression) === expected &&
    left.arguments.length === 2 &&
    left.arguments[0].getText() === 'step.name' &&
    left.arguments[1].getText() === 'this.config' &&
    ts.isBinaryExpression(right) &&
    right.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    right.left.getText() === 'this.mode' &&
    ts.isStringLiteral(right.right) &&
    right.right.text === 'auto'
  );
}

function hasInteractiveArtifactReviewFlow(file: ts.SourceFile): boolean {
  const run = namedBody(file, 'run');
  if (!run) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (!ts.isIfStatement(node) || !isStepCompletionGuard(file, node.expression)) {
      if (!found) ts.forEachChild(node, visit);
      return;
    }

    const block = ts.isBlock(node.thenStatement) ? node.thenStatement : undefined;
    if (!block) return;
    const allFilesIndex = block.statements.findIndex((statement) =>
      directVariableDeclaration(statement, 'allFiles'),
    );
    const allFilesDeclaration =
      allFilesIndex >= 0
        ? directVariableDeclaration(block.statements[allFilesIndex], 'allFiles')
        : undefined;
    const allFilesIdentifier =
      allFilesDeclaration && declaredIdentifier(allFilesDeclaration, 'allFiles');
    const resolutionCall =
      allFilesDeclaration && callInInitializer(allFilesDeclaration, file, 'resolveArtifactFiles');
    if (!allFilesIdentifier || !resolutionCall) return;

    const allFilesSymbol = resolvedSymbol(allFilesIdentifier);
    const allFilesIf = block.statements
      .slice(allFilesIndex + 1)
      .find(
        (statement): statement is ts.IfStatement =>
          ts.isIfStatement(statement) &&
          statement.expression.getText().includes('allFiles.length') &&
          ts.isBlock(statement.thenStatement),
      );
    if (!allFilesSymbol || !allFilesIf || !ts.isBlock(allFilesIf.thenStatement)) return;

    const inner = allFilesIf.thenStatement;
    const unapprovedIndex = inner.statements.findIndex((statement) =>
      directVariableDeclaration(statement, 'unapproved'),
    );
    const unapprovedDeclaration =
      unapprovedIndex >= 0
        ? directVariableDeclaration(inner.statements[unapprovedIndex], 'unapproved')
        : undefined;
    const unapprovedIdentifier =
      unapprovedDeclaration && declaredIdentifier(unapprovedDeclaration, 'unapproved');
    const filterCall =
      unapprovedDeclaration &&
      callInInitializer(unapprovedDeclaration, file, 'filterUnapprovedArtifacts');
    if (!unapprovedIdentifier || !filterCall || !callUsesSymbol(filterCall, allFilesSymbol)) return;

    const unapprovedSymbol = resolvedSymbol(unapprovedIdentifier);
    const statementsAfterFilter = inner.statements.slice(unapprovedIndex + 1);
    if (
      unapprovedSymbol &&
      statementsAfterFilter.some((statement) =>
        callsThisMethodWithSymbol(statement, 'onReviewArtifacts', unapprovedSymbol),
      )
    ) {
      found = true;
    }
  };
  visit(run);
  return found;
}

function objectPropertyNames(file: ts.SourceFile, variableName: string): string[] {
  let names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      names = node.initializer.properties.flatMap((property) => {
        const name = property.name;
        return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? [name.text] : [];
      });
      return;
    }
    if (names.length === 0) ts.forEachChild(node, visit);
  };
  visit(file);
  return names.sort();
}

function hasExportedFunction(file: ts.SourceFile, name: string): boolean {
  return file.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

describe('artifact resolution production wiring', () => {
  it('routes every generic consumer through scoped resolution while retaining the raw corpus API', () => {
    const artifacts = source('engine/artifacts.ts');
    const conductor = source('engine/conductor.ts');
    const terminalRenderer = source('ui/terminal-renderer.ts');
    const createRenderer = source('ui/create-renderer.ts');
    const predicateInventory = objectPropertyNames(artifacts, 'CUSTOM_COMPLETION_PREDICATES');
    const runtimePredicateInventory = Object.keys(CUSTOM_COMPLETION_PREDICATES).sort();
    const violations: string[] = [];

    if (!callsSymbol(artifacts, namedBody(artifacts, 'checkStepCompletion'), 'resolveArtifactFiles')) {
      violations.push('checkStepCompletion does not call resolveArtifactFiles');
    }
    if (callsSymbol(artifacts, namedBody(artifacts, 'checkStepCompletion'), 'findArtifactFiles')) {
      violations.push('checkStepCompletion still bypasses policy through findArtifactFiles');
    }
    if (!hasInteractiveArtifactReviewFlow(conductor)) {
      violations.push(
        'Conductor.run interactive artifact-review guard does not pass allFiles through filterUnapprovedArtifacts to onReviewArtifacts in declaration order',
      );
    }
    if (!callsSymbol(artifacts, namedBody(artifacts, 'getArtifactStatus'), 'resolveArtifactFiles')) {
      violations.push('getArtifactStatus does not call resolveArtifactFiles');
    }
    if (callsSymbol(artifacts, namedBody(artifacts, 'getArtifactStatus'), 'findArtifactFiles')) {
      violations.push('getArtifactStatus still bypasses policy through findArtifactFiles');
    }
    if (
      !callsSymbol(
        terminalRenderer,
        namedBody(terminalRenderer, 'collectArtifacts'),
        'getArtifactStatus',
      )
    ) {
      violations.push('TerminalRenderer.collectArtifacts does not reach getArtifactStatus');
    }
    if (
      !callsSymbol(createRenderer, namedBody(createRenderer, 'collectArtifacts'), 'getArtifactStatus')
    ) {
      violations.push('createRenderer collectArtifacts does not reach getArtifactStatus');
    }
    if (!hasExportedFunction(artifacts, 'findArtifactFiles') || typeof findArtifactFiles !== 'function') {
      violations.push('findArtifactFiles is not retained as an exported raw corpus API');
    }

    expect({
      astPredicateInventory: predicateInventory,
      runtimePredicateInventory,
      violations,
    }).toEqual({
      astPredicateInventory: EXPECTED_CUSTOM_COMPLETION_PREDICATES,
      runtimePredicateInventory: EXPECTED_CUSTOM_COMPLETION_PREDICATES,
      violations: [],
    });
  });
});
