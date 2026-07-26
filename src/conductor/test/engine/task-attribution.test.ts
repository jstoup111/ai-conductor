import { describe, expect, it } from 'vitest';
import { activateTaskTelemetry } from '../../src/engine/task-attribution.js';

describe('validateTaskAttribution', () => {
  it('preserves only exact task-local ids from the current seeded plan', async () => {
    const attribution = await import('../../src/engine/task-attribution.js').catch(() => null);
    expect(attribution).not.toBeNull();
    if (!attribution) return;

    const cases = [
      { label: 'exact', taskId: '2', seededTaskIds: ['1', '2'], expectedTaskId: '2', knownTaskIds: [], result: { taskId: '2' } },
      { label: 'empty', taskId: '', seededTaskIds: ['1', '2'], expectedTaskId: undefined, knownTaskIds: [], result: { diagnostic: { code: 'empty', value: '<empty>' } } },
      { label: 'malformed', taskId: 'not an id', seededTaskIds: ['1', '2'], expectedTaskId: undefined, knownTaskIds: [], result: { diagnostic: { code: 'malformed', value: 'not an id' } } },
      { label: 'unknown', taskId: '99', seededTaskIds: ['1', '2'], expectedTaskId: undefined, knownTaskIds: [], result: { diagnostic: { code: 'unknown', value: '99' } } },
      { label: 'stale', taskId: '2', seededTaskIds: ['1'], expectedTaskId: undefined, knownTaskIds: ['1', '2'], result: { diagnostic: { code: 'stale', value: '2' } } },
      { label: 'mismatched', taskId: '2', seededTaskIds: ['1', '2'], expectedTaskId: '1', knownTaskIds: [], result: { diagnostic: { code: 'mismatched', value: '2' } } },
    ] as const;

    for (const testCase of cases) {
      expect(attribution.validateTaskAttribution(testCase), testCase.label).toEqual(testCase.result);
    }
  });
});

describe('activateTaskTelemetry', () => {
  it('keeps sibling task contexts and an existing task context across repeat activation', () => {
    expect(
      activateTaskTelemetry(
        [
          { taskId: '1', context: { provider: 'claude' } },
          { taskId: '2', context: { provider: 'codex' } },
        ],
        { taskId: '1', context: { provider: 'replacement' } },
      ),
    ).toEqual([
      { taskId: '1', context: { provider: 'claude' } },
      { taskId: '2', context: { provider: 'codex' } },
    ]);
  });
});
