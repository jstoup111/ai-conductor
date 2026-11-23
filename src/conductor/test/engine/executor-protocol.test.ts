// Covers: task:1
import { describe, expect, it } from 'vitest';
import { EXECUTOR_PROTOCOL_VERSION, parseExecutorMessage } from '../../src/engine/executor-protocol.js';

describe('engine/executor-protocol', () => {
  it.each([
    ['hello', { kind: 'hello', protocolVersion: 1, engineVersionId: 'v1' }],
    [
      'work-order',
      {
        kind: 'work-order',
        order: {
          repository: 'jstoup/ai-conductor',
          slug: 'executor-protocol',
          baseSha: 'a'.repeat(40),
          manifest: [],
        },
      },
    ],
    [
      'event',
      {
        kind: 'event',
        scope: 'feature',
        payload: { type: 'future_executor_event', detail: 'preserve me' },
      },
    ],
    ['log', { kind: 'log', level: 'warn', message: 'child warning' }],
    ['request', { kind: 'request', requestId: 'request-1', method: 'rate-limit.enter', params: { deadline: 42 } }],
    ['response', { kind: 'response', requestId: 'request-1', result: { cleared: true } }],
    ['stop', { kind: 'stop', reason: 'supervisor-shutdown' }],
    ['outcome', { kind: 'outcome', outcome: { slug: 'executor-protocol', status: 'done' } }],
  ] as const)('parses a %s message to its discriminated kind', (kind, raw) => {
    const parsed = parseExecutorMessage(raw);

    expect(parsed).toMatchObject({ kind: 'ok', message: { kind } });
  });

  // Covers: task:2
  it('parses a yield without changing the compatible protocol version', () => {
    expect(parseExecutorMessage({ kind: 'yield' })).toEqual({
      kind: 'ok',
      message: { kind: 'yield' },
    });
    expect(EXECUTOR_PROTOCOL_VERSION).toBe(1);
  });

  it.each([
    ['a hello without protocolVersion', { kind: 'hello', engineVersionId: 'v1' }, /protocolVersion/i],
    [
      'a hello with a non-numeric protocolVersion',
      { kind: 'hello', protocolVersion: 'one', engineVersionId: 'v1' },
      /protocolVersion.*number/i,
    ],
    [
      'an event whose payload is not JSON',
      { kind: 'event', scope: 'root', payload: '{not json' },
      /event.*payload.*JSON/i,
    ],
  ])('returns malformed rather than throwing for %s', (_caseName, raw, reason) => {
    expect(() => parseExecutorMessage(raw)).not.toThrow();
    expect(parseExecutorMessage(raw)).toMatchObject({ kind: 'malformed', reason: expect.stringMatching(reason) });
  });

  it('preserves an unknown event type for a newer executor', () => {
    const payload = { type: 'future_executor_event', detail: 'preserve me' };

    expect(
      parseExecutorMessage({
        kind: 'event',
        scope: 'root',
        payload,
      }),
    ).toEqual({
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

  // Covers: task:1
  it('preserves the child OTel-projection capability in hello messages', () => {
    expect(
      parseExecutorMessage({
        kind: 'hello',
        protocolVersion: 1,
        engineVersionId: 'v1',
        otelProjection: true,
      }),
    ).toEqual({
      kind: 'ok',
      message: {
        kind: 'hello',
        protocolVersion: 1,
        engineVersionId: 'v1',
        otelProjection: true,
      },
    });
  });

  it('preserves the projection acceptance in work orders and the instrumentKind in meter creates', () => {
    const trace = {
      runId: 'run-1',
      project: 'jstoup/ai-conductor',
      branch: 'feat/child-projection',
      harnessVersion: '2026-11-07',
      sourceRef: 'abc123',
    };
    const order = {
      repository: 'jstoup/ai-conductor',
      slug: 'executor-protocol',
      baseSha: 'a'.repeat(40),
      manifest: [],
    };

    expect(
      parseExecutorMessage({
        kind: 'work-order',
        order,
        otelProjection: { trace },
      }),
    ).toEqual({
      kind: 'ok',
      message: {
        kind: 'work-order',
        order,
        otelProjection: { trace },
      },
    });
    expect(
      parseExecutorMessage({
        kind: 'meter',
        op: 'create',
        instrumentId: 'instrument-1',
        name: 'conductor.step.duration',
        instrumentKind: 'histogram',
        description: 'Step duration',
        unit: 'ms',
        advice: { explicitBucketBoundaries: [10, 100] },
      }),
    ).toEqual({
      kind: 'ok',
      message: {
        kind: 'meter',
        op: 'create',
        instrumentId: 'instrument-1',
        name: 'conductor.step.duration',
        instrumentKind: 'histogram',
        description: 'Step duration',
        unit: 'ms',
        advice: { explicitBucketBoundaries: [10, 100] },
      },
    });
  });

  it('keeps protocol version 1 and accepts legacy hello and work-order envelopes', () => {
    expect(EXECUTOR_PROTOCOL_VERSION).toBe(1);
    expect(parseExecutorMessage({ kind: 'hello', protocolVersion: 1, engineVersionId: 'v1' })).toMatchObject({
      kind: 'ok',
      message: { kind: 'hello', engineVersionId: 'v1' },
    });
    expect(
      parseExecutorMessage({
        kind: 'work-order',
        order: { repository: 'jstoup/ai-conductor', slug: 'legacy', baseSha: 'a'.repeat(40), manifest: [] },
      }),
    ).toMatchObject({ kind: 'ok', message: { kind: 'work-order' } });
  });

  it.each([
    ['an unknown meter operation', { kind: 'meter', op: 'observe', instrumentId: 'instrument-1' }],
    [
      'an unsupported meter instrumentKind',
      {
        kind: 'meter',
        op: 'create',
        instrumentId: 'instrument-1',
        name: 'conductor.test',
        instrumentKind: 'observableGauge',
      },
    ],
    [
      'a non-numeric meter record value',
      {
        kind: 'meter',
        op: 'record',
        instrumentId: 'instrument-1',
        value: '1',
        attributes: {},
      },
    ],
    [
      'non-object meter record attributes',
      {
        kind: 'meter',
        op: 'record',
        instrumentId: 'instrument-1',
        value: 1,
        attributes: [],
      },
    ],
  ])('returns malformed for %s', (_caseName, raw) => {
    expect(parseExecutorMessage(raw)).toMatchObject({ kind: 'malformed' });
  });
});
