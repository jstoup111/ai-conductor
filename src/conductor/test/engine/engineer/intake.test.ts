import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NOT-YET-BUILT intake port (Phase 9.3 redesign,
// FR-13/15/16, ADR-009, condition C5).
//
// New modules (do not exist yet):
//   engineer/intake/port.ts        — Envelope type + parseEnvelope + IntakePort
//   engineer/intake/idempotency.ts — source+sourceRef dedup
//   engineer/intake/claude-session.ts — the (only) wired adapter this phase
//
// Each test dynamically imports the symbol it needs so a missing module/export
// surfaces as THAT test's own RED failure.
//
// Envelope contract (FR-13): { id, source, sourceRef, text, hintRepo?, status,
//   receivedAt }, status ∈ {pending|routed|deciding|done}. parse-don't-validate.
// ─────────────────────────────────────────────────────────────────────────────

const PORT_MOD = '../../../src/engine/engineer/intake/port.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

function validEnvelopeInput(over: Record<string, unknown> = {}): Record<string, unknown> {
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

// ═════════════════════════════════════════════════════════════════════════════
// FR-13 / FR-16: parseEnvelope validates at the boundary (named-field errors).
// ═════════════════════════════════════════════════════════════════════════════
describe('intake/port: parseEnvelope boundary validation (FR-13/FR-16, C5)', () => {
  it('a well-formed Envelope parses through the port', async () => {
    const parseEnvelope = requireFn(await load(PORT_MOD), 'parseEnvelope');
    const env = parseEnvelope(validEnvelopeInput());
    expect(env.source).toBe('claude-session');
    expect(env.sourceRef).toBe('turn-42');
    expect(env.text).toBe('add a CSV export to alpha');
    expect(env.status).toBe('pending');
  });

  it('empty/whitespace-only text → rejected with a specific named error (NOT a silent drop)', async () => {
    const parseEnvelope = requireFn(await load(PORT_MOD), 'parseEnvelope');
    // The rejection must name the `text` field — not return a valid blank Envelope.
    expect(() => parseEnvelope(validEnvelopeInput({ text: '   ' }))).toThrow(/text/i);
    expect(() => parseEnvelope(validEnvelopeInput({ text: '' }))).toThrow(/text/i);
  });

  it('missing text key entirely → rejected naming the missing field', async () => {
    const parseEnvelope = requireFn(await load(PORT_MOD), 'parseEnvelope');
    const input = validEnvelopeInput();
    delete (input as Record<string, unknown>).text;
    expect(() => parseEnvelope(input)).toThrow(/text/i);
  });

  it('status outside {pending|routed|deciding|done} → rejected naming the status field', async () => {
    const parseEnvelope = requireFn(await load(PORT_MOD), 'parseEnvelope');
    expect(() => parseEnvelope(validEnvelopeInput({ status: 'in-flight' }))).toThrow(/status/i);
  });

  it('each allowed status value parses', async () => {
    const parseEnvelope = requireFn(await load(PORT_MOD), 'parseEnvelope');
    for (const status of ['pending', 'routed', 'deciding', 'done']) {
      const env = parseEnvelope(validEnvelopeInput({ status }));
      expect(env.status).toBe(status);
    }
  });
});
