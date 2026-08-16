import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function importsLifecycleHelper(source: ts.SourceFile): boolean {
  return source.statements.some((statement) =>
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === './engine/visualizer-lifecycle.js'
    && statement.importClause?.namedBindings !== undefined
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(
      (element) => element.name.text === 'withRegisteredVisualizers',
    ));
}

type NamedFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

function namedFunction(
  source: ts.SourceFile,
  name: string,
): NamedFunction | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === name
          && declaration.initializer !== undefined
          && (
            ts.isArrowFunction(declaration.initializer)
            || ts.isFunctionExpression(declaration.initializer)
          )
        ) {
          return declaration.initializer;
        }
      }
    }
  }
  return undefined;
}

function awaitedLifecycleCall(
  owner: NamedFunction | undefined,
): ts.CallExpression | undefined {
  const ownerBody = owner?.body;
  if (ownerBody === undefined) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isAwaitExpression(node)
      && ts.isCallExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'withRegisteredVisualizers'
    ) {
      found = node.expression;
      return;
    }
    if (
      node !== ownerBody
      && (
        ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
      )
    ) return;
    ts.forEachChild(node, visit);
  };
  visit(ownerBody);
  return found;
}

function lifecycleCallback(
  call: ts.CallExpression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const callback = call?.arguments[2];
  return callback !== undefined
    && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ? callback
    : undefined;
}

function isNamedCall(
  expression: ts.Expression,
  objectName: string | undefined,
  methodName: string,
): boolean {
  if (!ts.isCallExpression(expression)) return false;
  if (objectName === undefined) {
    return ts.isIdentifier(expression.expression)
      && expression.expression.text === methodName;
  }
  return ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === objectName
    && expression.expression.name.text === methodName;
}

function directlyAwaitsConductorRun(
  callback: ts.ArrowFunction | ts.FunctionExpression | undefined,
): boolean {
  if (callback === undefined) return false;
  if (!ts.isBlock(callback.body)) {
    return ts.isAwaitExpression(callback.body)
      && isNamedCall(callback.body.expression, 'conductor', 'run');
  }
  return callback.body.statements.some((statement) =>
    ts.isExpressionStatement(statement)
    && ts.isAwaitExpression(statement.expression)
    && isNamedCall(statement.expression.expression, 'conductor', 'run'));
}

function directlyReturnsOrAwaitsRunDaemon(
  callback: ts.ArrowFunction | ts.FunctionExpression | undefined,
): boolean {
  if (callback === undefined) return false;
  const isRunDaemonOrAwait = (expression: ts.Expression): boolean =>
    isNamedCall(expression, undefined, 'runDaemon')
    || (
      ts.isAwaitExpression(expression)
      && isNamedCall(expression.expression, undefined, 'runDaemon')
    );

  if (!ts.isBlock(callback.body)) {
    return isRunDaemonOrAwait(callback.body);
  }
  return callback.body.statements.some((statement) =>
    (
      ts.isReturnStatement(statement)
      && statement.expression !== undefined
      && isRunDaemonOrAwait(statement.expression)
    ) || (
      ts.isExpressionStatement(statement)
      && ts.isAwaitExpression(statement.expression)
      && isNamedCall(statement.expression.expression, undefined, 'runDaemon')
    ));
}

describe('visualizer lifecycle composition roots', () => {
  it('wraps inline and daemon execution in the shared registered-visualizer lifecycle', async () => {
    const [inlineText, daemonText] = await Promise.all([
      readFile(join(CONDUCTOR_ROOT, 'src', 'index.ts'), 'utf8'),
      readFile(join(CONDUCTOR_ROOT, 'src', 'daemon-cli.ts'), 'utf8'),
    ]);
    const inlineSource = ts.createSourceFile(
      'index.ts',
      inlineText,
      ts.ScriptTarget.Latest,
      true,
    );
    const daemonSource = ts.createSourceFile(
      'daemon-cli.ts',
      daemonText,
      ts.ScriptTarget.Latest,
      true,
    );
    const inlineCall = awaitedLifecycleCall(namedFunction(inlineSource, 'main'));
    const daemonCall = awaitedLifecycleCall(
      namedFunction(daemonSource, 'runDaemonMode'),
    );
    const inlineCallback = lifecycleCallback(inlineCall);
    const daemonCallback = lifecycleCallback(daemonCall);

    expect({
      inlineImportsHelper: importsLifecycleHelper(inlineSource),
      inlineUsesRegistryAndEvents:
        inlineCall?.arguments[0]?.getText(inlineSource) === 'registry'
        && inlineCall.arguments[1]?.getText(inlineSource) === 'events',
      inlineAwaitsConductorRun: directlyAwaitsConductorRun(inlineCallback),
      inlinePassesBuiltIns:
        inlineCall?.arguments[3]?.getText(inlineSource) === 'builtInVisualizers',
      daemonImportsHelper: importsLifecycleHelper(daemonSource),
      daemonUsesRegistryAndEvents:
        daemonCall?.arguments[0]?.getText(daemonSource) === 'registry'
        && daemonCall.arguments[1]?.getText(daemonSource) === 'events',
      daemonReturnsOrAwaitsRunDaemon:
        directlyReturnsOrAwaitsRunDaemon(daemonCallback),
      daemonOmitsBuiltIns: daemonCall?.arguments.length === 3,
    }).toEqual({
      inlineImportsHelper: true,
      inlineUsesRegistryAndEvents: true,
      inlineAwaitsConductorRun: true,
      inlinePassesBuiltIns: true,
      daemonImportsHelper: true,
      daemonUsesRegistryAndEvents: true,
      daemonReturnsOrAwaitsRunDaemon: true,
      daemonOmitsBuiltIns: true,
    });
  });
});
