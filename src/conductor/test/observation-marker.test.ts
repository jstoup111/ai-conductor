import { describe, it, expect } from 'vitest';

const MOD_PATH = '../src/engine/observation-marker.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('observation-marker', () => {
  it('parses watched marker with substring signature', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Signature: some-substring
Surface: daemon-log
Window-days: 14`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'watched',
      signature: 'some-substring',
      isRegex: false,
      windowDays: 14,
      surface: 'daemon-log',
    });
  });

  it('parses watched marker with regex signature', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Signature: /error.*timeout/
Surface: daemon-log
Window-days: 30`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'watched',
      signature: 'error.*timeout',
      isRegex: true,
      windowDays: 30,
      surface: 'daemon-log',
    });
  });
});
