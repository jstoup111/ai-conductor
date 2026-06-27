// Unit tests for engineer/intake/port.ts
// Tasks 1-4: Envelope type, parseEnvelope, field-named validation, empty-text rejection, IntakePort
import { describe, it, expect } from 'vitest';
import { parseEnvelope } from '../../../../src/engine/engineer/intake/port.js';

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'env-1',
    source: 'claude-session',
    sourceRef: 'turn-42',
    text: 'add a CSV export to alpha',
    status: 'pending',
    receivedAt: '2026-06-26T00:00:00.000Z',
    ...over,
  };
}

// ─── Task 1: Happy-path parse ─────────────────────────────────────────────────

describe('parseEnvelope — Task 1: happy path', () => {
  it('parses a valid full Envelope', () => {
    const env = parseEnvelope(validInput());
    expect(env.id).toBe('env-1');
    expect(env.source).toBe('claude-session');
    expect(env.sourceRef).toBe('turn-42');
    expect(env.text).toBe('add a CSV export to alpha');
    expect(env.status).toBe('pending');
    expect(env.receivedAt).toBe('2026-06-26T00:00:00.000Z');
  });

  it('hintRepo is optional — absent is fine', () => {
    const env = parseEnvelope(validInput());
    expect(env.hintRepo).toBeUndefined();
  });

  it('hintRepo is preserved when supplied', () => {
    const env = parseEnvelope(validInput({ hintRepo: 'alpha' }));
    expect(env.hintRepo).toBe('alpha');
  });

  it('each allowed status value parses correctly', () => {
    for (const status of ['pending', 'routed', 'deciding', 'done']) {
      const env = parseEnvelope(validInput({ status }));
      expect(env.status).toBe(status);
    }
  });
});

// ─── Task 2: Field-named validation errors ────────────────────────────────────

describe('parseEnvelope — Task 2: field-named validation errors', () => {
  it('bad status value → error naming "status"', () => {
    expect(() => parseEnvelope(validInput({ status: 'in-flight' }))).toThrow(/status/i);
    expect(() => parseEnvelope(validInput({ status: 'foo' }))).toThrow(/status/i);
    expect(() => parseEnvelope(validInput({ status: '' }))).toThrow(/status/i);
  });

  it('missing text key → error naming "text"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).text;
    expect(() => parseEnvelope(input)).toThrow(/text/i);
  });

  it('missing id → error naming "id"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).id;
    expect(() => parseEnvelope(input)).toThrow(/id/i);
  });

  it('missing source → error naming "source"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).source;
    expect(() => parseEnvelope(input)).toThrow(/source/i);
  });

  it('missing sourceRef → error naming "sourceRef"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).sourceRef;
    expect(() => parseEnvelope(input)).toThrow(/sourceRef/i);
  });

  it('missing status → error naming "status"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).status;
    expect(() => parseEnvelope(input)).toThrow(/status/i);
  });

  it('missing receivedAt → error naming "receivedAt"', () => {
    const input = validInput();
    delete (input as Record<string, unknown>).receivedAt;
    expect(() => parseEnvelope(input)).toThrow(/receivedAt/i);
  });
});

// ─── Task 3: Empty/whitespace text → named error (C5) ────────────────────────

describe('parseEnvelope — Task 3: empty/whitespace text rejection (C5)', () => {
  it('whitespace-only text → throws EmptyEnvelopeTextError (names "text")', () => {
    expect(() => parseEnvelope(validInput({ text: '   ' }))).toThrow(/text/i);
  });

  it('empty string text → throws EmptyEnvelopeTextError (names "text")', () => {
    expect(() => parseEnvelope(validInput({ text: '' }))).toThrow(/text/i);
  });

  it('empty-text error is NOT returned as a valid blank Envelope', () => {
    // Must throw, not return an object with blank text
    let threw = false;
    try {
      parseEnvelope(validInput({ text: '   ' }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('tab-only whitespace also rejected', () => {
    expect(() => parseEnvelope(validInput({ text: '\t\t' }))).toThrow(/text/i);
  });

  it('valid non-blank text passes through unchanged', () => {
    const env = parseEnvelope(validInput({ text: 'hello world' }));
    expect(env.text).toBe('hello world');
  });
});
