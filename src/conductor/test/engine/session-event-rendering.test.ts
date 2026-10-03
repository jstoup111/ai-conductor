import { describe, expect, it } from 'vitest';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { EVENT_SINKS } from '../../src/engine/event-sinks.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';

const featureScope = { kind: 'feature', featureSlug: 'render-feature' } as const;
const projectScope = { kind: 'project' } as const;
type SessionOccurrence = Extract<ConductorEvent,
  { type: 'session_command_refused' }
  | { type: 'github_bypass_attempt' }
  | { type: 'github_bypass_result' }
  | { type: 'github_possible_bypass' }
  | { type: 'session_event_delivery_diagnostic' }
>;

const occurrences: readonly SessionOccurrence[] = [
  { type: 'session_command_refused', eventId: 'refusal-1', sourceTime: '2026-10-02T12:00:00.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: featureScope, subcommand: 'finish-record' },
  { type: 'github_bypass_attempt', eventId: 'attempt-1', sourceTime: '2026-10-02T12:00:01.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: featureScope, operation: 'issue-create' },
  { type: 'github_bypass_result', eventId: 'result-1', sourceTime: '2026-10-02T12:00:02.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: featureScope, attemptId: 'attempt-1', outcome: 'cli-succeeded' },
  { type: 'github_possible_bypass', eventId: 'possible-1', sourceTime: '2026-10-02T12:00:03.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: projectScope, operation: 'graphql' },
  { type: 'session_event_delivery_diagnostic', eventId: 'delivery-1', sourceTime: '2026-10-02T12:00:04.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: projectScope, code: 'write-failed' },
];

describe('session event daemon rendering', () => {
  it('renders every declared session occurrence with scope, bounded status, and its occurrence id', () => {
    const output: string[] = [];
    for (const event of occurrences) renderDaemonEvent(event, (line) => output.push(line));
    const rendered = output.join('\n');

    expect(rendered).toContain('render-feature');
    expect(rendered).toContain('finish-record');
    expect(rendered).toContain('issue-create');
    expect(rendered).toContain('attempt-1');
    expect(rendered).toContain('cli-succeeded');
    expect(rendered).toContain('project');
    expect(rendered).toContain('possible bypass');
    expect(rendered).toContain('write-failed');
    expect(rendered).toContain('refusal-1');
    expect(rendered).toContain('result-1');
    expect(rendered).toContain('possible-1');
    expect(rendered).toContain('delivery-1');
    expect(rendered).not.toContain('verified remote mutation');
  });

  it('renders repeated ids and correlated attempt/result ids without collapsing distinct occurrences', () => {
    const output: string[] = [];
    const attempt = occurrences[1];
    const result = occurrences[2];
    renderDaemonEvent(attempt, (line) => output.push(line));
    renderDaemonEvent(attempt, (line) => output.push(line));
    renderDaemonEvent(result, (line) => output.push(line));

    expect(output.filter((line) => line.includes('attempt-1'))).toHaveLength(3);
    expect(output.some((line) => line.includes('result-1'))).toBe(true);
  });

  it('derives all session occurrence subscriptions from the render registry', () => {
    for (const event of occurrences) expect(EVENT_SINKS[event.type].render).toBe(true);
  });

  it('delivers every declared occurrence through the existing terminal subscriber', async () => {
    const events = new ConductorEventEmitter();
    const delivered: string[] = [];
    const subscriber = new TerminalSubscriber(events);
    subscriber.start([{ name: 'capture', handle: async (event) => {
      if ('eventId' in event) delivered.push(event.eventId);
    }, stop: async () => {} }]);

    for (const event of occurrences) await events.emit(event);
    await subscriber.stop();

    expect(delivered).toEqual(occurrences.map((event) => event.eventId));
  });

  it('never renders supplied raw arguments, payloads, credentials, or transport diagnostics', () => {
    const output: string[] = [];
    renderDaemonEvent({
      ...occurrences[1],
      operation: 'unknown',
      rawArguments: '--token=super-secret',
      payload: 'private payload',
      transportError: 'credential failure',
    } as unknown as SessionOccurrence, (line) => output.push(line));

    expect(output.join('\n')).not.toMatch(/super-secret|private payload|credential failure/);
  });
});
