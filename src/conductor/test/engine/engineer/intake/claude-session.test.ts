// Unit tests for engineer/intake/claude-session.ts
// Tasks 5-6: FR-14 — claude-session adapter builds a pending Envelope,
// empty sourceRef rejected, no github polling in-phase.

import { describe, it, expect } from 'vitest';
import {
  createClaudeSessionAdapter,
  buildChatEnvelope,
} from '../../../../src/engine/engineer/intake/claude-session.js';
import type { IntakePort } from '../../../../src/engine/engineer/intake/port.js';

// ─── Task 5: Happy path — adapter builds a pending Envelope ──────────────────

describe('buildChatEnvelope — Task 5: happy path (FR-14)', () => {
  it('returns an Envelope with source === "claude-session"', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.source).toBe('claude-session');
  });

  it('preserves the supplied sourceRef', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.sourceRef).toBe('turn-7');
  });

  it('preserves the supplied text', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.text).toBe('add a CSV export to alpha');
  });

  it('sets status to "pending"', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.status).toBe('pending');
  });

  it('sets id from the supplied id param', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.id).toBe('env-42');
  });

  it('sets receivedAt from the supplied receivedAt param', () => {
    const env = buildChatEnvelope({
      id: 'env-42',
      sourceRef: 'turn-7',
      text: 'add a CSV export to alpha',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.receivedAt).toBe('2026-06-26T00:00:00.000Z');
  });

  it('optional hintRepo is preserved when supplied', () => {
    const env = buildChatEnvelope({
      id: 'env-1',
      sourceRef: 'turn-1',
      text: 'some idea',
      receivedAt: '2026-06-26T00:00:00.000Z',
      hintRepo: 'alpha',
    });
    expect(env.hintRepo).toBe('alpha');
  });

  it('hintRepo is absent when not supplied', () => {
    const env = buildChatEnvelope({
      id: 'env-1',
      sourceRef: 'turn-1',
      text: 'some idea',
      receivedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(env.hintRepo).toBeUndefined();
  });

  it('is deterministic — same inputs produce same Envelope', () => {
    const params = {
      id: 'env-x',
      sourceRef: 'turn-99',
      text: 'determinism check',
      receivedAt: '2026-06-26T12:00:00.000Z',
    };
    const a = buildChatEnvelope(params);
    const b = buildChatEnvelope(params);
    expect(a).toEqual(b);
  });
});

// ─── Task 5: IntakePort interface — adapter implements report() ───────────────

describe('createClaudeSessionAdapter — Task 5: IntakePort contract (FR-14)', () => {
  it('createClaudeSessionAdapter returns an object with a report function', () => {
    const adapter = createClaudeSessionAdapter();
    expect(typeof adapter.report).toBe('function');
  });

  it('report() resolves (no-op) without throwing', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    await expect(adapter.report('turn-7', 'pending')).resolves.toEqual({ ok: true });
  });

  it('report() is a no-op — calling with any status resolves cleanly', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    for (const status of ['pending', 'routed', 'deciding', 'done'] as const) {
      await expect(adapter.report('turn-1', status)).resolves.toEqual({ ok: true });
    }
  });
});

// ─── Task 2 (#290): report() returns a ReportOutcome ─────────────────────────

describe('createClaudeSessionAdapter — Task 2 (#290): ReportOutcome contract', () => {
  it('report() resolves to { ok: true } for the claude-session no-op', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    await expect(adapter.report('turn-7', 'pending')).resolves.toEqual({ ok: true });
  });
});

// ─── Task 6: Negative path — empty/whitespace sourceRef is rejected ───────────

describe('buildChatEnvelope — Task 6: empty sourceRef rejected (FR-14)', () => {
  it('empty string sourceRef throws an error naming "sourceRef"', () => {
    expect(() =>
      buildChatEnvelope({
        id: 'env-1',
        sourceRef: '',
        text: 'some idea',
        receivedAt: '2026-06-26T00:00:00.000Z',
      }),
    ).toThrow(/sourceRef/i);
  });

  it('whitespace-only sourceRef throws an error naming "sourceRef"', () => {
    expect(() =>
      buildChatEnvelope({
        id: 'env-1',
        sourceRef: '   ',
        text: 'some idea',
        receivedAt: '2026-06-26T00:00:00.000Z',
      }),
    ).toThrow(/sourceRef/i);
  });

  it('tab-only sourceRef is also rejected', () => {
    expect(() =>
      buildChatEnvelope({
        id: 'env-1',
        sourceRef: '\t\t',
        text: 'some idea',
        receivedAt: '2026-06-26T00:00:00.000Z',
      }),
    ).toThrow(/sourceRef/i);
  });

  it('empty sourceRef does NOT produce an Envelope object (must throw, not return)', () => {
    let threw = false;
    try {
      buildChatEnvelope({
        id: 'env-1',
        sourceRef: '',
        text: 'some idea',
        receivedAt: '2026-06-26T00:00:00.000Z',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ─── T1 (FR-36): report() accepts optional meta argument ─────────────────────

describe('createClaudeSessionAdapter — T1 (FR-36): report with meta', () => {
  it('report() resolves when called with a full meta object', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    await expect(
      adapter.report('turn-7', 'routed', { repo: 'alpha', prUrl: 'https://github.com/org/alpha/pull/1' }),
    ).resolves.toEqual({ ok: true });
  });

  it('report() resolves when called with a partial meta object (repo only)', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    await expect(
      adapter.report('turn-7', 'done', { repo: 'beta' }),
    ).resolves.toEqual({ ok: true });
  });

  it('report() resolves when called without meta (backward-compatible)', async () => {
    const adapter: IntakePort = createClaudeSessionAdapter();
    await expect(adapter.report('turn-7', 'pending')).resolves.toEqual({ ok: true });
  });
});

// ─── Task 6: Static guard — no github polling / setInterval in intake/ ────────

describe('intake source tree — Task 6: no github polling this phase (FR-14)', () => {
  it('intake/claude-session.ts contains no setInterval call', async () => {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const here = dirname(fileURLToPath(import.meta.url));
    const adapterSrc = await readFile(
      join(here, '..', '..', '..', '..', 'src', 'engine', 'engineer', 'intake', 'claude-session.ts'),
      'utf8',
    );
    expect(adapterSrc).not.toMatch(/setInterval/);
  });

  it('intake/claude-session.ts contains no github reference', async () => {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const here = dirname(fileURLToPath(import.meta.url));
    const adapterSrc = await readFile(
      join(here, '..', '..', '..', '..', 'src', 'engine', 'engineer', 'intake', 'claude-session.ts'),
      'utf8',
    );
    expect(adapterSrc).not.toMatch(/github/i);
  });

  it('intake/port.ts contains no setInterval call', async () => {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const here = dirname(fileURLToPath(import.meta.url));
    const portSrc = await readFile(
      join(here, '..', '..', '..', '..', 'src', 'engine', 'engineer', 'intake', 'port.ts'),
      'utf8',
    );
    expect(portSrc).not.toMatch(/setInterval/);
  });
});
