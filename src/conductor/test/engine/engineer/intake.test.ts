import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const IDEMPOTENCY_MOD = '../../../src/engine/engineer/intake/idempotency.js';

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

// ═════════════════════════════════════════════════════════════════════════════
// FR-15: idempotency keyed on source+sourceRef (NOT text).
// ═════════════════════════════════════════════════════════════════════════════
describe('intake/idempotency: dedup on source+sourceRef (FR-15)', () => {
  it('same (source, sourceRef) second submission is a duplicate no-op', async () => {
    const mod = await load(IDEMPOTENCY_MOD);
    const createIntakeIdempotency = requireFn(mod, 'createIntakeIdempotency');
    const dedup = createIntakeIdempotency();

    const first = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    const second = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });

    // First is fresh; second is a recognized duplicate (no second processing).
    expect(first.duplicate ?? false).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it('same text but DIFFERENT sourceRef → BOTH process (no false-positive on a re-stated idea)', async () => {
    const mod = await load(IDEMPOTENCY_MOD);
    const createIntakeIdempotency = requireFn(mod, 'createIntakeIdempotency');
    const dedup = createIntakeIdempotency();

    // Dedup key is (source, sourceRef), NOT text — same idea text, distinct refs.
    const a = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1', text: 'same idea' });
    const b = await dedup.check({ source: 'claude-session', sourceRef: 'turn-2', text: 'same idea' });

    expect(a.duplicate ?? false).toBe(false);
    expect(b.duplicate ?? false).toBe(false); // both process — not blocked by matching text
  });

  it('a duplicate is reported (visible), not silently swallowed', async () => {
    const mod = await load(IDEMPOTENCY_MOD);
    const createIntakeIdempotency = requireFn(mod, 'createIntakeIdempotency');
    const dedup = createIntakeIdempotency();

    await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    const second = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });

    // The dedup decision is surfaced (e.g. a reason/notice), not a silent drop.
    expect(second.duplicate).toBe(true);
    expect(second.reason ?? second.notice ?? '').toMatch(/duplicate/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-13 / C5: the core depends on the PORT interface, not the concrete adapter.
// Static import-graph assertion: loop.ts must not import the claude-session
// adapter directly (it consumes the IntakePort interface only).
// ═════════════════════════════════════════════════════════════════════════════
describe('intake: core imports the port, not the concrete adapter (FR-13, C5)', () => {
  it('loop.ts does NOT import intake/claude-session (depends on the port only)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const loopSrc = await readFile(
      join(here, '..', '..', '..', 'src', 'engine', 'engineer', 'loop.ts'),
      'utf8',
    );
    // Loose-coupling guard: the core loop must not statically import the
    // concrete claude-session adapter. It may import the port interface.
    expect(loopSrc).not.toMatch(/from ['"][^'"]*intake\/claude-session(\.js)?['"]/);
    // And the port module must exist as the dependency seam.
    expect(loopSrc).toMatch(/intake\/port(\.js)?['"]/);
  });

  it('the intake port directory exists with a port + adapter module', async () => {
    // RED until the intake/ tree is created.
    const here = dirname(fileURLToPath(import.meta.url));
    const intakeDir = join(here, '..', '..', '..', 'src', 'engine', 'engineer', 'intake');
    const files = await readdir(intakeDir);
    expect(files).toContain('port.ts');
    expect(files).toContain('claude-session.ts');
  });
});
