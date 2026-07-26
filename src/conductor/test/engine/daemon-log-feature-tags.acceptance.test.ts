import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import * as daemonLog from '../../src/engine/daemon-log.js';

/**
 * Acceptance coverage call sites:
 * - `daemon-cli.ts#beginFeatureRun` creates the feature-owned logger.
 * - `daemon-runner.ts#makeRunFeature` owns it from setup through teardown.
 * - `daemon-cli.ts#runConductorInWorktree` sends events and diagnostics through it.
 */

type FeatureLogger = (message: string, featureOwned?: boolean) => void;
type FeatureLoggerFactory = (featureSlug: string, baseLog: FeatureLogger) => FeatureLogger;

function featureLogger(featureSlug: string, baseLog: FeatureLogger): FeatureLogger {
  const factory = (
    daemonLog as typeof daemonLog & { createFeatureDaemonLogger?: FeatureLoggerFactory }
  ).createFeatureDaemonLogger;
  expect(
    factory,
    'a feature-owned daemon logging boundary must exist',
  ).toBeTypeOf('function');
  if (!factory) throw new Error('feature-owned daemon logging boundary is missing');
  return factory(featureSlug, baseLog);
}

function recordDaemonOutput() {
  const live: string[] = [];
  const persisted: string[] = [];
  const baseLog: FeatureLogger = (message, featureOwned) => {
    // Exercise the same daemon-line composition used by runDaemonMode before
    // observing either sink. A callback-only local prefix would let this
    // acceptance suite pass even if the live daemon tee remained incorrect.
    const line = daemonLog.formatDaemonActivityLine(message, featureOwned);
    live.push(line);
    persisted.push(daemonLog.formatDaemonLogLine(line, new Date(0)));
  };
  return { live, persisted, baseLog };
}

describe('acceptance: daemon log feature tags', () => {
  it('has a production daemon-entry call path for feature-log helpers', async () => {
    const source = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');
    const module = ts.createSourceFile('daemon-cli.ts', source, ts.ScriptTarget.Latest, true);
    let importsFeatureTagFormatter = false;
    let callsFeatureTagFormatter = false;
    let importsDaemonModeLogger = false;
    let callsDaemonModeLogger = false;

    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './engine/daemon-log.js'
      ) {
        const bindings = node.importClause?.namedBindings;
        importsFeatureTagFormatter =
          !!bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some((binding) => binding.name.text === 'formatDaemonFeatureTag');
        importsDaemonModeLogger =
          !!bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some((binding) => binding.name.text === 'createDaemonModeLogger');
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'formatDaemonFeatureTag'
      ) {
        callsFeatureTagFormatter = true;
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'createDaemonModeLogger'
      ) {
        callsDaemonModeLogger = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(module);

    expect(importsFeatureTagFormatter && callsFeatureTagFormatter).toBe(true);
    expect(importsDaemonModeLogger && callsDaemonModeLogger).toBe(true);
  });

  it('routes every daemon-created DefaultStepRunner warning sink through a feature logger', async () => {
    const source = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/new DefaultStepRunner\([\s\S]*?\n\s*\);/g)].every((match) => /\n\s*log: /.test(match[0]))).toBe(true);
  });

  it('tags setup, structured-event, warning, retry, and subprocess diagnostics in live and persisted output', () => {
    const output = recordDaemonOutput();
    const log = featureLogger('daemon-logs-tag-current', output.baseLog);
    const lifecycleLines = [
      'setup complete',
      '· ▶ build',
      'WARNING: provider unavailable',
      'retrying build (2/3)',
      'subprocess diagnostic: exit 1',
    ];

    for (const line of lifecycleLines) log(line);

    expect(output.live).toEqual(
      lifecycleLines.map((line) => `[daemon][daemon-logs-tag-current] ${line}`),
    );
    expect(output.persisted).toEqual(
      lifecycleLines.map(
        (line) => `1970-01-01T00:00:00.000Z [daemon][daemon-logs-tag-current] ${line}`,
      ),
    );
  });

  it('uses the full short slug and a deterministic 24-character long-slug display ending in an ellipsis', () => {
    const output = recordDaemonOutput();
    featureLogger('short-slug', output.baseLog)('short content');
    const longSlug = 'daemon-logs-tag-current-with-extra-context';
    featureLogger(longSlug, output.baseLog)('long content');

    expect(output.live).toEqual([
      '[daemon][short-slug] short content',
      `[daemon][${longSlug.slice(0, 23)}…] long content`,
    ]);
    expect(`${longSlug.slice(0, 23)}…`).toHaveLength(24);
  });

  it('leaves repository-global lines untagged and preserves prefix-like feature content as content', () => {
    const output = recordDaemonOutput();
    output.baseLog('global scan complete');
    const message = '[daemon-logs-tag-current] [daemon][other-feature] subprocess output';
    featureLogger('daemon-logs-tag-current', output.baseLog)(message);

    expect(output.live).toEqual([
      '[daemon] global scan complete',
      `[daemon][daemon-logs-tag-current] ${message}`,
    ]);
    expect(output.live[1]).toMatch(/^\[daemon\]\[daemon-logs-tag-current\] /);
    expect(output.live[1].slice('[daemon][daemon-logs-tag-current] '.length)).toBe(message);
  });

  it('keeps interleaved feature loggers attributable to their own feature in the durable daemon log', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'daemon-feature-tags-'));
    try {
      const sink = await daemonLog.openDaemonLog(repo);
      const live: string[] = [];
      const baseLog: FeatureLogger = (message, featureOwned) => {
        const line = daemonLog.formatDaemonActivityLine(message, featureOwned);
        live.push(line);
        sink.write(daemonLog.formatDaemonLogLine(line, new Date(0)));
      };
      const alpha = featureLogger('alpha-feature', baseLog);
      const beta = featureLogger('beta-feature', baseLog);

      alpha('setup');
      beta('retry');
      alpha('diagnostic');
      await sink.close();

      expect(live).toEqual([
        '[daemon][alpha-feature] setup',
        '[daemon][beta-feature] retry',
        '[daemon][alpha-feature] diagnostic',
      ]);
      await expect(readFile(daemonLog.daemonLogPath(repo), 'utf8')).resolves.toBe(
        '1970-01-01T00:00:00.000Z [daemon][alpha-feature] setup\n' +
          '1970-01-01T00:00:00.000Z [daemon][beta-feature] retry\n' +
          '1970-01-01T00:00:00.000Z [daemon][alpha-feature] diagnostic\n',
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
