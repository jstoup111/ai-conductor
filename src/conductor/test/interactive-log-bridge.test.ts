// Covers: task:20
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installInteractiveDiagnosticBridge } from '../src/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const originalWarn = console.warn;
const originalError = console.error;

afterEach(() => {
  console.warn = originalWarn;
  console.error = originalError;
  vi.restoreAllMocks();
});

describe('interactive configured-run diagnostic bridge', () => {
  it('keeps warnings and errors visible while sending immutable feature-owned occurrences to the configured event spine', async () => {
    const events = new ConductorEventEmitter();
    const occurrences: unknown[] = [];
    events.on('operational_log', (event) => { occurrences.push(event); });
    const localWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const localError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const restore = installInteractiveDiagnosticBridge(events, 'interactive-feature');

    console.warn('provider retry', 2);
    console.error(new Error('provider failed'));
    await Promise.resolve();
    restore();
    console.warn('after configured run');

    expect({
      local: {
        warnings: localWarn.mock.calls.map((args) => args.join(' ')),
        errors: localError.mock.calls.map((args) => args.join(' ')),
      },
      occurrences,
    }).toEqual({
      local: {
        warnings: ['provider retry 2', 'after configured run'],
        errors: ['Error: provider failed'],
      },
      occurrences: [
        expect.objectContaining({
          type: 'operational_log', severity: 'warn', body: 'provider retry 2',
          ownership: { scope: 'feature', featureSlug: 'interactive-feature' },
        }),
        expect.objectContaining({
          type: 'operational_log', severity: 'error', body: 'Error: provider failed',
          ownership: { scope: 'feature', featureSlug: 'interactive-feature' },
        }),
      ],
    });
  });

  it('restores the process bridge between interactive runs without replaying or retaining feature ownership', async () => {
    const firstEvents = new ConductorEventEmitter();
    const secondEvents = new ConductorEventEmitter();
    const first: unknown[] = [];
    const second: unknown[] = [];
    firstEvents.on('operational_log', (event) => { first.push(event); });
    secondEvents.on('operational_log', (event) => { second.push(event); });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const stopFirst = installInteractiveDiagnosticBridge(firstEvents, 'first-feature');
    console.warn('first run');
    stopFirst();

    const stopSecond = installInteractiveDiagnosticBridge(secondEvents, 'second-feature');
    console.warn('second run');
    stopSecond();
    console.warn('after both runs');
    await Promise.resolve();

    expect({ first, second }).toEqual({
      first: [expect.objectContaining({
        body: 'first run', ownership: { scope: 'feature', featureSlug: 'first-feature' },
      })],
      second: [expect.objectContaining({
        body: 'second run', ownership: { scope: 'feature', featureSlug: 'second-feature' },
      })],
    });
  });
});
