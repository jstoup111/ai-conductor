import { describe, expect, it } from 'vitest';
import { renderedEventTypes } from '../../src/engine/event-sinks.js';
import {
  DAEMON_EVENT_PRESENTATION,
  createDaemonEventPresenter,
} from '../../src/engine/daemon-event-presenter.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';

// Covers: task:4
describe('daemon event presenter', () => {
  it('declares presentation for exactly every rendered event type', () => {
    expect(Object.keys(DAEMON_EVENT_PRESENTATION).sort()).toEqual(renderedEventTypes().sort());
  });

  it('applies table depth and keeps once/changed memory per instance', () => {
    const first: unknown[] = [];
    const presenter = createDaemonEventPresenter({ log: (line) => first.push(line), verbose: false });
    const output = presenter.outputFor('session_policy');
    output.info('one');
    output.warning('two', { kind: 'none', why: 'testing' });
    output.once('policy').info('once');
    output.once('policy').info('not rendered');
    output.whenChanged('verdict', 'a').info('a');
    output.whenChanged('verdict', 'a').info('not rendered');
    output.whenChanged('verdict', 'b').info('b');
    output.whenChanged('verdict', 'a').info('a again');
    expect(first).toEqual([
      { depth: 2, text: 'one' },
      { depth: 2, text: '⚠ two — no action needed: testing' },
      { depth: 2, text: 'once' },
      { depth: 2, text: 'a' },
      { depth: 2, text: 'b' },
      { depth: 2, text: 'a again' },
    ]);

    const second: unknown[] = [];
    createDaemonEventPresenter({ log: (line) => second.push(line), verbose: false })
      .outputFor('session_policy').once('policy').info('once again');
    expect(second).toEqual([{ depth: 2, text: 'once again' }]);
  });

  it('suppresses verbose output unless enabled and requires next actions for warnings and halts', () => {
    const quiet: unknown[] = [];
    const quietOutput = createDaemonEventPresenter({ log: (line) => quiet.push(line), verbose: false })
      .outputFor('build_review_rubric_started');
    quietOutput.info('hidden');
    quietOutput.detail('also hidden');
    expect(quiet).toEqual([]);

    const verbose: unknown[] = [];
    const verboseOutput = createDaemonEventPresenter({ log: (line) => verbose.push(line), verbose: true })
      .outputFor('build_review_rubric_started');
    if (false) {
      // @ts-expect-error warning output always names the next action.
      verboseOutput.warning('missing next action');
      // @ts-expect-error halt output always names the next action.
      verboseOutput.halt('missing next action');
    }
    verboseOutput.info('shown');
    verboseOutput.detail('detail');
    verboseOutput.halt('stop', { kind: 'operator', action: 'ai-conductor monitor all' });
    expect(verbose).toEqual([
      { depth: 2, text: 'shown' },
      { depth: 2, text: 'detail' },
      { depth: 2, text: '✋ stop — next: ai-conductor monitor all' },
    ]);
  });

  it('keeps the legacy renderer callable through a lazily created presenter', () => {
    const lines: string[] = [];
    const log = (line: string): void => { lines.push(line); };
    renderDaemonEvent({ type: 'step_started', step: 'build', index: 0 }, log);
    renderDaemonEvent({ type: 'step_started', step: 'build', index: 0 }, log);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes('build'))).toBe(true);
  });
});
