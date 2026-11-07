// Covers: task:1, task:2
import { describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';
import {
  createDaemonModeLogger,
  createFeatureDaemonLogger,
  formatDaemonLogLine,
} from '../../src/engine/daemon-log.js';
import { DAEMON_EVENT_DEPTH } from '../../src/engine/daemon-line-shape.js';
import { attachFeatureEventRenderer, renderDaemonEvent, resetRenderedReclaimRetentions } from '../../src/daemon-cli.js';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { renderedEventTypes } from '../../src/engine/event-sinks.js';
import { RENDERED_DAEMON_EVENT_FIXTURES } from '../fixtures/rendered-daemon-events.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const at = new Date('2026-10-29T00:00:00.000Z');

function buildLoggers() {
  const live: string[] = [];
  const persisted: string[] = [];
  const baseLog = createDaemonModeLogger({
    writeLive: (line) => live.push(line),
    writePersisted: (line) => persisted.push(formatDaemonLogLine(line, at)),
  });
  return { live, persisted, baseLog };
}

describe('daemon logger line shape', () => {
  it('strips leading whitespace from a feature line in both sinks', () => {
    const { live, persisted, baseLog } = buildLoggers();

    createFeatureDaemonLogger('feature-a', baseLog)('   ! [rejected] x');

    expect(live).toEqual(['[daemon][feature-a] ! [rejected] x']);
    expect(persisted).toEqual(['2026-10-29T00:00:00.000Z [daemon][feature-a] ! [rejected] x']);
  });

  it('keeps a repository-wide message byte-identical without a marker', () => {
    const { persisted, baseLog } = buildLoggers();
    const message = 'progress re-kick: feature-a retained — halt disposition needs-human';

    baseLog(message);

    expect(persisted).toEqual([`2026-10-29T00:00:00.000Z [daemon] ${message}`]);
  });

  it('uses continuation bodies without changing later-line content', () => {
    const { persisted, baseLog } = buildLoggers();

    baseLog('first\n ! [rejected]        HEAD -> feat/x (non-fast-forward)');

    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon] first',
      '2026-10-29T00:00:00.000Z [daemon] │  ! [rejected]        HEAD -> feat/x (non-fast-forward)',
    ]);
  });

  it('renders blank middle lines and drops one trailing newline', () => {
    const { persisted, baseLog } = buildLoggers();

    baseLog('alpha\n\nbeta\n');

    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon] alpha',
      '2026-10-29T00:00:00.000Z [daemon] │',
      '2026-10-29T00:00:00.000Z [daemon] │ beta',
    ]);
  });

  it('still suppresses a repeated feature start message', () => {
    const { live, persisted, baseLog } = buildLoggers();
    const featureLog = createFeatureDaemonLogger('feature-a', baseLog);

    featureLog('▶ start feature-a');
    featureLog('▶ start feature-a');

    expect(live).toEqual(['[daemon][feature-a] ▶ start feature-a']);
    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon][feature-a] ▶ start feature-a',
    ]);
  });

  it('applies the declared depth through the real event emitter and both logger instances', async () => {
    chalk.level = 0;
    expect(new Set(Object.keys(DAEMON_EVENT_DEPTH))).toEqual(new Set(renderedEventTypes()));

    const event = {
      type: 'halt_record_push_failed' as const,
      path: '.pipeline/halt-record.md',
      reason: 'first rejection\n ! [rejected] HEAD -> feat/x\nthird diagnostic',
    };
    const one = buildLoggers();
    const two = buildLoggers();
    const events = new ConductorEventEmitter();
    const detach = attachFeatureEventRenderer(events, createFeatureDaemonLogger('feature-a', one.baseLog));
    await events.emit(event);
    detach();
    renderDaemonEvent(event, createFeatureDaemonLogger('feature-a', two.baseLog));

    const first = one.persisted.map((line) => line.replace(/^.*? \[daemon\]\[feature-a\] /, ''));
    const second = two.persisted.map((line) => line.replace(/^.*? \[daemon\]\[feature-a\] /, ''));
    expect(first).toEqual(second);
    expect(first).toEqual([
      '· ⚠ halt record push failed: .pipeline/halt-record.md — first rejection',
      '· │  ! [rejected] HEAD -> feat/x',
      '· │ third diagnostic',
    ]);
  });

  it('renders every declared event through the emitter and keeps both daemon loggers byte-identical', async () => {
    chalk.level = 0;
    const fixtureTypes = new Set(Object.keys(RENDERED_DAEMON_EVENT_FIXTURES));
    expect(fixtureTypes).toEqual(new Set(Object.keys(DAEMON_EVENT_DEPTH)));
    expect(fixtureTypes).toEqual(new Set(renderedEventTypes()));

    for (const event of Object.values(RENDERED_DAEMON_EVENT_FIXTURES)) {
      const one = buildLoggers();
      const two = buildLoggers();
      const events = new ConductorEventEmitter();
      resetRenderedReclaimRetentions();
      const detach = attachFeatureEventRenderer(events, createFeatureDaemonLogger('feature-a', one.baseLog));
      await events.emit(event);
      detach();
      resetRenderedReclaimRetentions();
      renderDaemonEvent(event, createFeatureDaemonLogger('feature-a', two.baseLog));

      const first = one.persisted.map((line) => line.replace(/^.*? \[daemon\]\[feature-a\] /, ''));
      const second = two.persisted.map((line) => line.replace(/^.*? \[daemon\]\[feature-a\] /, ''));
      expect(first, event.type).toEqual(second);
      expect(first, event.type).not.toEqual([]);
      const marker = DAEMON_EVENT_DEPTH[event.type];
      const shape = marker === 0 ? /^(?:│|[^\s·])/ : marker === 1 ? /^· (?:│|[^\s·])/ : /^·   (?:│|[^\s·])/;
      expect(first.every((line) => shape.test(line)), event.type).toBe(true);
    }
  });

  it('persists kickback as a prefix-free prominent line', async () => {
    chalk.level = 0;
    const { persisted, baseLog } = buildLoggers();
    const events = new ConductorEventEmitter();
    const detach = attachFeatureEventRenderer(events, createFeatureDaemonLogger('feature-a', baseLog));

    await events.emit({ type: 'kickback', from: 'build', to: 'plan', count: 1 });
    detach();

    expect(DAEMON_EVENT_DEPTH.kickback).toBe(0);
    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon][feature-a] ↩ KICKBACK: build re-opened plan (×1)',
    ]);
    expect(persisted[0]).not.toContain('· ');
  });

  it('uses one depth for provider lifecycle and every outer-review line', () => {
    chalk.level = 0;
    const output: string[] = [];
    renderDaemonEvent({ type: 'provider_attempt', step: 'build', provider: 'codex', outcome: 'success', invoked: false,
      lifecycle: { phase: 'preparing', attemptId: 'one', recoveryCount: 0 } }, (line) => output.push(line));
    renderDaemonEvent({ type: 'provider_attempt', step: 'build', provider: 'codex', outcome: 'success', invoked: false,
      lifecycle: { phase: 'exhausted', attemptId: 'two', recoveryCount: 1 } }, (line) => output.push(line));
    renderDaemonEvent({ type: 'build_review_outer_verdict', lapId: 'lap', rawVerdict: 'FAIL', effectiveVerdict: 'PASS',
      suppressedFindings: [{ rubric: 'testQuality', findingId: 'one', confidence: 1, floor: 2 }],
      advisoryFindings: [{ rubric: 'security', findingId: 'two', severity: 'minor', threshold: 'major' }] }, (line) => output.push(line));
    expect(output).toHaveLength(5);
    expect(output.every((line) => line.startsWith('·   '))).toBe(true);
  });
});
