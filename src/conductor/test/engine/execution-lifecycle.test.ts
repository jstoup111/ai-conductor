// Covers: task:2
import { describe, expect, it } from 'vitest';
import { ExecutionLifecycle } from '../../src/engine/execution-lifecycle.js';
import type { ConductorEvent, ExecutionContext } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

class RecordingEvents extends ConductorEventEmitter {
  readonly emitted: ConductorEvent[] = [];

  override async emit(event: ConductorEvent): Promise<void> {
    this.emitted.push(event);
    await super.emit(event);
  }
}

function configuredContext(executionId: string): ExecutionContext {
  return {
    executionId,
    subject: { kind: 'configured-member', parentGroup: 'validation', member: 'reviewer' },
  };
}

describe('engine/execution-lifecycle', () => {
  it('keeps interleaved executions and their retries under their own admitted IDs', async () => {
    const events = new RecordingEvents();
    const lifecycle = new ExecutionLifecycle({ events });
    const first = configuredContext('execution-1');
    const second = configuredContext('execution-2');

    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0, executionContext: first });
    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0, executionContext: second });
    await lifecycle.retry({
      type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'retry', executionContext: first,
    });
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: first });
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: first });
    await lifecycle.close({
      type: 'step_failed', step: 'build', error: 'exhausted', retryCount: 2, executionContext: second,
    });

    expect(events.emitted.map((event) => `${event.type}:${'executionContext' in event ? event.executionContext?.executionId ?? 'legacy' : 'legacy'}`)).toEqual([
      'step_started:execution-1',
      'step_started:execution-2',
      'step_retry:execution-1',
      'step_completed:execution-1',
      'step_failed:execution-2',
    ]);
  });

  it('freezes an admitted member at settlement while its terminal can arrive later', async () => {
    const events = new RecordingEvents();
    const timestamps = [1_000, 1_025];
    const lifecycle = new ExecutionLifecycle({
      events,
      clock: { nowMs: () => timestamps.shift()! },
    });
    const context = configuredContext('execution-1');

    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0, executionContext: context });
    await lifecycle.settle({
      type: 'group_member_step', member: 'reviewer', skill: 'review', phase: 'result', outcome: 'completed', executionContext: context,
    });

    expect(lifecycle.boundaryFor(context)).toEqual({ startedAtMs: 1_000, finishedAtMs: 1_025 });

    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: context });
    expect(lifecycle.boundaryFor(context)).toEqual({ startedAtMs: 1_000, finishedAtMs: 1_025 });
    expect(events.emitted.map((event) => event.type)).toEqual([
      'step_started',
      'group_member_step',
      'step_completed',
    ]);
  });

  it('rejects an old terminal after the same member is redispatched under a fresh ID', async () => {
    const events = new RecordingEvents();
    const lifecycle = new ExecutionLifecycle({ events });
    const oldExecution = configuredContext('execution-1');
    const freshExecution = configuredContext('execution-2');

    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0, executionContext: oldExecution });
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: oldExecution });
    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0, executionContext: freshExecution });
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: oldExecution });
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done', executionContext: freshExecution });

    expect(events.emitted.map((event) => `${event.type}:${'executionContext' in event ? event.executionContext?.executionId : undefined}`)).toEqual([
      'step_started:execution-1',
      'step_completed:execution-1',
      'step_started:execution-2',
      'step_completed:execution-2',
    ]);
  });

  it('closes an admitted serial step at its own terminal when it has no settlement', async () => {
    const events = new RecordingEvents();
    let now = 1_000;
    const terminals: unknown[] = [];
    const lifecycle = new ExecutionLifecycle({
      events,
      clock: { nowMs: () => now },
      onTerminal: (observation) => {
        terminals.push(observation);
      },
    });
    events.on('step_completed', () => {
      now = 1_100;
    });

    await lifecycle.admit({ type: 'step_started', step: 'build', index: 0 });
    now = 1_025;
    await lifecycle.close({ type: 'step_completed', step: 'build', status: 'done' });

    expect(terminals).toEqual([{
      event: { type: 'step_completed', step: 'build', status: 'done' },
      boundary: { startedAtMs: 1_000, finishedAtMs: 1_025 },
    }]);
  });

  it('does not create terminal lifecycle observations without admission', async () => {
    const events = new RecordingEvents();
    const lifecycle = new ExecutionLifecycle({ events });

    await lifecycle.close({ type: 'step_failed', step: 'build', error: 'late', retryCount: 0 });
    await lifecycle.retry({
      type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'late', executionContext: configuredContext('never-admitted'),
    });
    await lifecycle.settle({
      type: 'group_member_step', member: 'reviewer', skill: 'review', phase: 'result', executionContext: configuredContext('never-admitted'),
    });

    expect(events.emitted).toEqual([]);
  });

  it('preserves an advisory parallel failure on the existing event spine', async () => {
    const events = new RecordingEvents();
    const lifecycle = new ExecutionLifecycle({ events });
    const advisory = {
      type: 'parallel_failure' as const,
      step: 'build' as const,
      branch: 'advisory',
      error: 'advisory failed',
      terminal: false as const,
    };

    await lifecycle.emit(advisory);

    expect(events.emitted).toEqual([advisory]);
  });
});
