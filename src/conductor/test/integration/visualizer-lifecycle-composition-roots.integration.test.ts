import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as daemonEntrypoint from '../../src/daemon-cli.js';
import { discoverPlugins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import * as inlineEntrypoint from '../../src/index.js';
import type { VisualizerPlugin } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

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

function awaitedNamedCall(
  owner: NamedFunction | undefined,
  calleeName: string,
): ts.CallExpression | undefined {
  const ownerBody = owner?.body;
  if (ownerBody === undefined) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isAwaitExpression(node)
      && ts.isCallExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === calleeName
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

function namedCallWithin(
  owner: NamedFunction | undefined,
  calleeName: string,
): ts.CallExpression | undefined {
  const ownerBody = owner?.body;
  if (ownerBody === undefined) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === calleeName
    ) {
      found = node;
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

function exportsNamedFunction(source: ts.SourceFile, name: string): boolean {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === name
    ) {
      return statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ?? false;
    }
    if (
      ts.isVariableStatement(statement)
      && statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
      && statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === name,
      )
    ) return true;
  }
  return false;
}

function hasExactArguments(
  call: ts.CallExpression | undefined,
  source: ts.SourceFile,
  expected: string[],
): boolean {
  return call?.arguments.length === expected.length
    && call.arguments.every(
      (argument, index) => argument.getText(source) === expected[index],
    );
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

type InlineVisualizerLifecycle = <T>(
  registry: PluginRegistry,
  emitter: ConductorEventEmitter,
  run: () => Promise<T>,
  builtIns?: VisualizerPlugin[],
) => Promise<T>;

type DaemonVisualizerLifecycle = <T>(
  registry: PluginRegistry,
  emitter: ConductorEventEmitter,
  run: () => Promise<T>,
) => Promise<T>;

interface LifecycleProbeState {
  path: 'inline' | 'daemon';
  mode: 'success' | 'startup' | 'handler';
  records: string[];
  stopGate: Promise<void>;
  markStopStarted: () => void;
  startCalls: number;
  handlerCalls: number;
  stopCalls: number;
}

interface FailureContainmentOutcome {
  path: 'inline' | 'daemon';
  failure: 'startup' | 'handler';
  runCompleted: boolean;
  startCalls: number;
  handlerCalls: number;
  stopCalls: number;
}

describe('visualizer lifecycle composition roots', () => {
  it('runs discovered visualizers through successful and failure-isolated inline and daemon lifecycles', async () => {
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
    const inlineRootCall = awaitedNamedCall(
      namedFunction(inlineSource, 'main'),
      'runInlineVisualizerLifecycle',
    );
    const daemonRootCall = awaitedNamedCall(
      namedFunction(daemonSource, 'runDaemonMode'),
      'runDaemonVisualizerLifecycle',
    );
    const inlineSeamOwner = namedFunction(
      inlineSource,
      'runInlineVisualizerLifecycle',
    );
    const daemonSeamOwner = namedFunction(
      daemonSource,
      'runDaemonVisualizerLifecycle',
    );
    const inlineDelegation = namedCallWithin(
      inlineSeamOwner,
      'withRegisteredVisualizers',
    );
    const daemonDelegation = namedCallWithin(
      daemonSeamOwner,
      'withRegisteredVisualizers',
    );
    const inlineCallback = lifecycleCallback(inlineRootCall);
    const daemonCallback = lifecycleCallback(daemonRootCall);
    const tempDir = await mkdtemp(join(tmpdir(), 'visualizer-entrypoints-'));
    const globalPlugins = join(tempDir, 'global');
    const projectPlugins = join(tempDir, 'project');
    const pluginDir = join(globalPlugins, 'lifecycle-probe');
    const probeKey = `__visualizer_lifecycle_${process.pid}_${Date.now()}`;
    const probeHost = globalThis as unknown as Record<
      string,
      LifecycleProbeState | undefined
    >;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const records: string[] = [];
    const inlineLifecycle = (
      inlineEntrypoint as unknown as {
        runInlineVisualizerLifecycle?: InlineVisualizerLifecycle;
      }
    ).runInlineVisualizerLifecycle;
    const daemonLifecycle = (
      daemonEntrypoint as unknown as {
        runDaemonVisualizerLifecycle?: DaemonVisualizerLifecycle;
      }
    ).runDaemonVisualizerLifecycle;
    let inlineResult: string | undefined;
    let daemonResult: string | undefined;
    let inlineError: string | undefined;
    let daemonError: string | undefined;
    let inlineSettledBeforeStop = false;
    let daemonSettledBeforeStop = false;
    const failureOutcomes: FailureContainmentOutcome[] = [];

    try {
      await mkdir(pluginDir, { recursive: true });
      await mkdir(projectPlugins, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.yml'),
        `kind: visualizer
name: lifecycle-probe
entrypoint: index.mjs
harness_version: ">=0.99.0"
`,
      );
      await writeFile(
        join(pluginDir, 'index.mjs'),
        `const probe = () => globalThis[${JSON.stringify(probeKey)}];
export default {
  name: 'lifecycle-probe',
  start(emitter) {
    const state = probe();
    state.startCalls += 1;
    if (state.mode === 'success') {
      state.records.push(state.path + ':start');
      emitter.on('step_started', () => {
        const current = probe();
        current.records.push(current.path + ':event');
      });
      return;
    }
    emitter.on('step_started', () => {
      const current = probe();
      current.handlerCalls += 1;
      if (current.mode === 'handler') {
        throw new Error(current.path + ' handler failed');
      }
    });
    if (state.mode === 'startup') {
      throw new Error(state.path + ' startup failed');
    }
  },
  async stop() {
    const state = probe();
    state.stopCalls += 1;
    if (state.mode === 'success') {
      state.records.push(state.path + ':stop-start');
    }
    state.markStopStarted();
    await state.stopGate;
    if (state.mode === 'success') {
      state.records.push(state.path + ':stop');
    }
  },
};
`,
      );

      const registry = new PluginRegistry();
      await discoverPlugins(globalPlugins, projectPlugins, registry);
      registry.markInitialized();

      const runPath = async (
        path: 'inline' | 'daemon',
        lifecycle: InlineVisualizerLifecycle | DaemonVisualizerLifecycle,
      ): Promise<{
        result: string | undefined;
        error: string | undefined;
        settledBeforeStop: boolean;
      }> => {
        const emitter = new ConductorEventEmitter();
        let releaseStop = () => {};
        let markStopStarted = () => {};
        const stopGate = new Promise<void>((resolve) => {
          releaseStop = resolve;
        });
        const stopStarted = new Promise<void>((resolve) => {
          markStopStarted = resolve;
        });
        probeHost[probeKey] = {
          path,
          mode: 'success',
          records,
          stopGate,
          markStopStarted,
          startCalls: 0,
          handlerCalls: 0,
          stopCalls: 0,
        };
        const lifecycleOutcome = Promise.resolve().then(() => lifecycle(
          registry,
          emitter,
          async () => {
            await emitter.emit({
              type: 'step_started',
              step: 'explore',
              index: 0,
            });
            return `${path}-result`;
          },
        )).then(
          (result) => ({ kind: 'resolved' as const, result }),
          (error: unknown) => ({
            kind: 'rejected' as const,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        const firstOutcome = await (async () => {
          try {
            return await Promise.race([
              stopStarted.then(() => ({ kind: 'stop-started' as const })),
              lifecycleOutcome,
            ]);
          } finally {
            releaseStop();
          }
        })();
        const finalOutcome = await lifecycleOutcome;
        return {
          result:
            finalOutcome.kind === 'resolved' ? finalOutcome.result : undefined,
          error:
            finalOutcome.kind === 'rejected' ? finalOutcome.error : undefined,
          settledBeforeStop: firstOutcome.kind !== 'stop-started',
        };
      };

      const runFailurePath = async (
        path: 'inline' | 'daemon',
        failure: 'startup' | 'handler',
        lifecycle: InlineVisualizerLifecycle | DaemonVisualizerLifecycle,
      ): Promise<FailureContainmentOutcome> => {
        const emitter = new ConductorEventEmitter();
        const state: LifecycleProbeState = {
          path,
          mode: failure,
          records,
          stopGate: Promise.resolve(),
          markStopStarted: () => {},
          startCalls: 0,
          handlerCalls: 0,
          stopCalls: 0,
        };
        probeHost[probeKey] = state;
        const expectedResult = `${path}-${failure}-result`;
        const result = await lifecycle(registry, emitter, async () => {
          await emitter.emit({
            type: 'step_started',
            step: 'explore',
            index: 0,
          });
          if (failure === 'handler') {
            await emitter.emit({
              type: 'step_started',
              step: 'explore',
              index: 0,
            });
          }
          return expectedResult;
        }).catch(() => undefined);

        return {
          path,
          failure,
          runCompleted: result === expectedResult,
          startCalls: state.startCalls,
          handlerCalls: state.handlerCalls,
          stopCalls: state.stopCalls,
        };
      };

      if (inlineLifecycle !== undefined && daemonLifecycle !== undefined) {
        ({
          result: inlineResult,
          error: inlineError,
          settledBeforeStop: inlineSettledBeforeStop,
        } = await runPath('inline', inlineLifecycle));
        ({
          result: daemonResult,
          error: daemonError,
          settledBeforeStop: daemonSettledBeforeStop,
        } = await runPath('daemon', daemonLifecycle));
        failureOutcomes.push(
          await runFailurePath('inline', 'startup', inlineLifecycle),
          await runFailurePath('inline', 'handler', inlineLifecycle),
          await runFailurePath('daemon', 'startup', daemonLifecycle),
          await runFailurePath('daemon', 'handler', daemonLifecycle),
        );
      }

      expect({
        inlineImportsHelper: importsLifecycleHelper(inlineSource),
        inlineRootAwaitsSeam: inlineRootCall !== undefined,
        inlineRootArguments: hasExactArguments(
          inlineRootCall,
          inlineSource,
          ['registry', 'events', inlineCallback?.getText(inlineSource) ?? '', 'builtInVisualizers'],
        ),
        inlineRootAwaitsConductorRun:
          directlyAwaitsConductorRun(inlineCallback),
        inlineSeamExported: exportsNamedFunction(
          inlineSource,
          'runInlineVisualizerLifecycle',
        ),
        inlineSeamDelegatesShared: hasExactArguments(
          inlineDelegation,
          inlineSource,
          ['registry', 'emitter', 'run', 'builtIns'],
        ),
        daemonImportsHelper: importsLifecycleHelper(daemonSource),
        daemonRootAwaitsSeam: daemonRootCall !== undefined,
        daemonRootArguments: hasExactArguments(
          daemonRootCall,
          daemonSource,
          ['registry', 'events', daemonCallback?.getText(daemonSource) ?? ''],
        ),
        daemonRootReturnsOrAwaitsRunDaemon:
          directlyReturnsOrAwaitsRunDaemon(daemonCallback),
        daemonSeamExported: exportsNamedFunction(
          daemonSource,
          'runDaemonVisualizerLifecycle',
        ),
        daemonSeamDelegatesShared: hasExactArguments(
          daemonDelegation,
          daemonSource,
          ['pluginRegistry', 'emitter', 'run'],
        ),
        inlineSeamAvailable: inlineLifecycle !== undefined,
        daemonSeamAvailable: daemonLifecycle !== undefined,
        inlineResult,
        daemonResult,
        inlineError,
        daemonError,
        inlineSettledBeforeStop,
        daemonSettledBeforeStop,
        records,
        failureOutcomes,
      }).toEqual({
        inlineImportsHelper: true,
        inlineRootAwaitsSeam: true,
        inlineRootArguments: true,
        inlineRootAwaitsConductorRun: true,
        inlineSeamExported: true,
        inlineSeamDelegatesShared: true,
        daemonImportsHelper: true,
        daemonRootAwaitsSeam: true,
        daemonRootArguments: true,
        daemonRootReturnsOrAwaitsRunDaemon: true,
        daemonSeamExported: true,
        daemonSeamDelegatesShared: true,
        inlineSeamAvailable: true,
        daemonSeamAvailable: true,
        inlineResult: 'inline-result',
        daemonResult: 'daemon-result',
        inlineError: undefined,
        daemonError: undefined,
        inlineSettledBeforeStop: false,
        daemonSettledBeforeStop: false,
        records: [
          'inline:start',
          'inline:event',
          'inline:stop-start',
          'inline:stop',
          'daemon:start',
          'daemon:event',
          'daemon:stop-start',
          'daemon:stop',
        ],
        failureOutcomes: [
          {
            path: 'inline',
            failure: 'startup',
            runCompleted: true,
            startCalls: 1,
            handlerCalls: 0,
            stopCalls: 1,
          },
          {
            path: 'inline',
            failure: 'handler',
            runCompleted: true,
            startCalls: 1,
            handlerCalls: 1,
            stopCalls: 1,
          },
          {
            path: 'daemon',
            failure: 'startup',
            runCompleted: true,
            startCalls: 1,
            handlerCalls: 0,
            stopCalls: 1,
          },
          {
            path: 'daemon',
            failure: 'handler',
            runCompleted: true,
            startCalls: 1,
            handlerCalls: 1,
            stopCalls: 1,
          },
        ],
      });
    } finally {
      delete probeHost[probeKey];
      await rm(tempDir, { recursive: true, force: true });
      warnSpy.mockRestore();
    }
  });
});
