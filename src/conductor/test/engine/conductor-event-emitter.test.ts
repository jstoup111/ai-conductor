// Covers: task:1
import { describe, expect, it } from 'vitest';

import { ConductorEventEmitter as EngineConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { ConductorEventEmitter as UiConductorEventEmitter } from '../../src/ui/events.js';

function acceptsEngineEmitter(_emitter: EngineConductorEventEmitter): void {}

describe('conductor event emitter compatibility export', () => {
  it('preserves event-emitter identity and engine type compatibility through ui/events', () => {
    const uiEmitter = new UiConductorEventEmitter();
    const engineEmitter = new EngineConductorEventEmitter();

    expect(uiEmitter).toBeInstanceOf(EngineConductorEventEmitter);
    expect(engineEmitter).toBeInstanceOf(UiConductorEventEmitter);
    acceptsEngineEmitter(uiEmitter);
  });
});
