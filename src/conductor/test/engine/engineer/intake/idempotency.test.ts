import { describe, it, expect } from 'vitest';
import { createIntakeIdempotency } from '../../../../src/engine/engineer/intake/idempotency.js';

// ─────────────────────────────────────────────────────────────────────────────
// FR-15: intake idempotency keyed strictly on (source, sourceRef).
// ─────────────────────────────────────────────────────────────────────────────

describe('createIntakeIdempotency (FR-15)', () => {
  it('returns duplicate:false for a fresh (source, sourceRef) pair', async () => {
    const dedup = createIntakeIdempotency();
    const result = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    expect(result.duplicate ?? false).toBe(false);
  });

  it('returns duplicate:true for the same (source, sourceRef) on second call', async () => {
    const dedup = createIntakeIdempotency();
    await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    const second = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    expect(second.duplicate).toBe(true);
  });

  it('keying is on (source, sourceRef) — same source different sourceRef are both fresh', async () => {
    const dedup = createIntakeIdempotency();
    const a = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1', text: 'same idea' });
    const b = await dedup.check({ source: 'claude-session', sourceRef: 'turn-2', text: 'same idea' });
    expect(a.duplicate ?? false).toBe(false);
    expect(b.duplicate ?? false).toBe(false);
  });

  it('different source same sourceRef are both fresh (source participates in key)', async () => {
    const dedup = createIntakeIdempotency();
    const a = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    const b = await dedup.check({ source: 'github-issue', sourceRef: 'turn-1' });
    expect(a.duplicate ?? false).toBe(false);
    expect(b.duplicate ?? false).toBe(false);
  });

  it('duplicate result exposes a visible reason or notice containing "duplicate"', async () => {
    const dedup = createIntakeIdempotency();
    await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    const second = await dedup.check({ source: 'claude-session', sourceRef: 'turn-1' });
    expect(second.duplicate).toBe(true);
    expect(second.reason ?? second.notice ?? '').toMatch(/duplicate/i);
  });

  it('each createIntakeIdempotency() call starts with an empty seen-set', async () => {
    const dedup1 = createIntakeIdempotency();
    const dedup2 = createIntakeIdempotency();
    await dedup1.check({ source: 'claude-session', sourceRef: 'turn-1' });
    // dedup2 has its own fresh state — should NOT report duplicate
    const result = await dedup2.check({ source: 'claude-session', sourceRef: 'turn-1' });
    expect(result.duplicate ?? false).toBe(false);
  });
});
