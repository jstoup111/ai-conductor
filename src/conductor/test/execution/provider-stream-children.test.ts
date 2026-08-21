import { describe, expect, it } from 'vitest';

import { ProviderStreamChildTracker } from '../../src/execution/provider-stream.js';

function taskUse(id: string) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Task' }] },
  };
}

function agentUse(id: string) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Agent' }] },
  };
}

function toolResult(toolUseId: string) {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
  };
}

describe('ProviderStreamChildTracker', () => {
  it('tracks open Task calls, closes only their matching results, and ignores invalid child references', () => {
    const tracker = new ProviderStreamChildTracker();
    const states: Array<{ childObservability: 'observed'; activeChildren: number }> = [];
    const observe = (record: unknown) => {
      tracker.observe(record);
      states.push({ childObservability: tracker.childObservability, activeChildren: tracker.activeChildren });
    };

    observe(taskUse('child-1'));
    observe(taskUse('child-2'));
    observe(taskUse('child-3'));
    observe(toolResult('child-1'));
    observe(toolResult('unmatched'));
    observe(toolResult('child-1'));
    observe({ type: 'assistant', parent_tool_use_id: 'unopened-child' });
    observe(toolResult('child-2'));
    observe(toolResult('child-3'));

    expect(states).toEqual([
      { childObservability: 'observed', activeChildren: 1 },
      { childObservability: 'observed', activeChildren: 2 },
      { childObservability: 'observed', activeChildren: 3 },
      { childObservability: 'observed', activeChildren: 2 },
      { childObservability: 'observed', activeChildren: 2 },
      { childObservability: 'observed', activeChildren: 2 },
      { childObservability: 'observed', activeChildren: 2 },
      { childObservability: 'observed', activeChildren: 1 },
      { childObservability: 'observed', activeChildren: 0 },
    ]);
  });

  it('does not open or close Task-tracked children for Agent records', () => {
    const tracker = new ProviderStreamChildTracker();

    tracker.observe(agentUse('agent-child'));
    expect({ childObservability: tracker.childObservability, activeChildren: tracker.activeChildren }).toEqual({
      childObservability: 'observed',
      activeChildren: 0,
    });

    tracker.observe(taskUse('task-child'));
    tracker.observe(toolResult('agent-child'));
    expect(tracker.activeChildren).toBe(1);

    tracker.observe(toolResult('task-child'));
    expect({ childObservability: tracker.childObservability, activeChildren: tracker.activeChildren }).toEqual({
      childObservability: 'observed',
      activeChildren: 0,
    });
  });
});
