// Covers: task:1
import { describe, expect, it } from 'vitest';
import { parseExecutorMessage } from '../../src/engine/executor-protocol.js';

describe('engine/executor-protocol', () => {
  it.each([
    ['hello', { kind: 'hello', protocolVersion: 1, engineVersionId: 'v1' }],
    ['work-order', {
      kind: 'work-order',
      order: {
        repository: 'jstoup/ai-conductor',
        slug: 'executor-protocol',
        baseSha: 'a'.repeat(40),
        manifest: [],
      },
    }],
    ['event', {
      kind: 'event',
      scope: 'feature',
      payload: { type: 'future_executor_event', detail: 'preserve me' },
    }],
    ['log', { kind: 'log', level: 'warn', message: 'child warning' }],
    ['request', { kind: 'request', requestId: 'request-1', method: 'rate-limit.enter', params: { deadline: 42 } }],
    ['response', { kind: 'response', requestId: 'request-1', result: { cleared: true } }],
    ['stop', { kind: 'stop', reason: 'supervisor-shutdown' }],
    ['outcome', { kind: 'outcome', outcome: { slug: 'executor-protocol', status: 'done' } }],
  ] as const)('parses a %s message to its discriminated kind', (kind, raw) => {
    const parsed = parseExecutorMessage(raw);

    expect(parsed).toMatchObject({ kind: 'ok', message: { kind } });
  });

  it.each([
    ['a hello without protocolVersion', { kind: 'hello', engineVersionId: 'v1' }, /protocolVersion/i],
    ['a hello with a non-numeric protocolVersion', { kind: 'hello', protocolVersion: 'one', engineVersionId: 'v1' }, /protocolVersion.*number/i],
    ['an event whose payload is not JSON', { kind: 'event', scope: 'root', payload: '{not json' }, /event.*payload.*JSON/i],
  ])('returns malformed rather than throwing for %s', (_caseName, raw, reason) => {
    expect(() => parseExecutorMessage(raw)).not.toThrow();
    expect(parseExecutorMessage(raw)).toMatchObject({ kind: 'malformed', reason: expect.stringMatching(reason) });
  });

  it('preserves an unknown event type for a newer executor', () => {
    const payload = { type: 'future_executor_event', detail: 'preserve me' };

    expect(parseExecutorMessage({
      kind: 'event',
      scope: 'root',
      payload,
    })).toEqual({
      kind: 'ok',
      message: { kind: 'event', scope: 'root', payload },
    });
  });

  it('rejects an unknown top-level message kind', () => {
    expect(parseExecutorMessage({ kind: 'future-message', payload: {} })).toMatchObject({
      kind: 'malformed',
      reason: expect.stringMatching(/unknown.*message.*kind/i),
    });
  });
});
