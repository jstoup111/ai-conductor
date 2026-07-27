import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
      // Exercise the real daemon-mode sink composition (createDaemonModeLogger),
      // not a hand-rolled stand-in, so writePersisted genuinely reaches the
      // on-disk DaemonLogSink the same way runDaemonMode wires it in production.
      const baseLog = daemonLog.createDaemonModeLogger({
        writeLive: (line) => live.push(line),
        writePersisted: (line) => sink.write(daemonLog.formatDaemonLogLine(line, new Date(0))),
      });
      const alpha = featureLogger('alpha-feature', baseLog);
      const beta = featureLogger('beta-feature', baseLog);

      alpha('doing work');
      beta('doing other work');
      alpha('more work');
      await sink.close();

      expect(live).toEqual([
        '[daemon][alpha-feature] doing work',
        '[daemon][beta-feature] doing other work',
        '[daemon][alpha-feature] more work',
      ]);

      const persisted = await readFile(daemonLog.daemonLogPath(repo), 'utf8');
      const persistedLines = persisted.trimEnd().split('\n');
      expect(persistedLines).toEqual([
        '1970-01-01T00:00:00.000Z [daemon][alpha-feature] doing work',
        '1970-01-01T00:00:00.000Z [daemon][beta-feature] doing other work',
        '1970-01-01T00:00:00.000Z [daemon][alpha-feature] more work',
      ]);

      const alphaLines = persistedLines.filter((line) => line.includes('doing work') || line.includes('more work'));
      const betaLines = persistedLines.filter((line) => line.includes('doing other work'));
      expect(alphaLines).toHaveLength(2);
      expect(betaLines).toHaveLength(1);
      for (const line of alphaLines) {
        expect(line).toContain('[daemon][alpha-feature]');
        expect(line).not.toContain('[beta-feature]');
      }
      for (const line of betaLines) {
        expect(line).toContain('[daemon][beta-feature]');
        expect(line).not.toContain('[alpha-feature]');
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
