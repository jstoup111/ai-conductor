import { describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { providerExecutionEventCallbacks } from '../../src/engine/provider-execution.js';

describe('provider start isolation', () => {
  it('does not await a slow or throwing renderer before the caller continues', async () => {
    const events = new ConductorEventEmitter();
    let reached = false;
    events.on('provider_attempt_started', () => { throw new Error('render failed'); });
    events.on('provider_attempt_started', async () => new Promise<void>(() => {}));
    providerExecutionEventCallbacks(events).onCandidateStart?.('stories', {
      provider: { kind: 'known', id: 'claude' },
    });
    reached = true;
    expect(reached).toBe(true);
  });
});
