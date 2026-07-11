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

  it('parses close-on-merge marker', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Kind: close-on-merge
Rationale: This fix resolves the underlying issue; closing on merge is safe.`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'close-on-merge',
      rationale: 'This fix resolves the underlying issue; closing on merge is safe.',
    });
  });

  it('rejects marker missing Signature in watched mode', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Surface: daemon-log
Window-days: 14`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'parse_error',
      message: expect.stringContaining('Signature'),
    });
  });

  it('rejects marker with invalid regex', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Signature: /[invalid/
Surface: daemon-log
Window-days: 14`;

    const result = await parseObservationMarker(content);

    expect(result.kind).toBe('parse_error');
    expect((result as any).message).toMatch(/regex|Invalid/i);
  });

  it('rejects close-on-merge missing rationale', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Kind: close-on-merge`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'parse_error',
      message: expect.stringContaining('Rationale'),
    });
  });

  it('rejects invalid Window-days value', async () => {
    const mod = await load();
    const parseObservationMarker = requireFn(mod, 'parseObservationMarker');

    const content = `Signature: test
Surface: daemon-log
Window-days: not-a-number`;

    const result = await parseObservationMarker(content);

    expect(result).toEqual({
      kind: 'parse_error',
      message: expect.stringContaining('Window-days'),
    });
  });
});
