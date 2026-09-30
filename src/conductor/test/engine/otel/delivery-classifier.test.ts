// Covers: task:7
import { describe, expect, it } from 'vitest';
import {
  classifyNetworkError,
  classifyResponse,
} from '../../../src/engine/otel/delivery-classifier.js';

const PARTIAL_SUCCESS_REJECTING_THREE_ITEMS = new Uint8Array([0x0a, 0x02, 0x08, 0x03]);

describe('OTLP delivery response classification', () => {
  it.each([
    [200, undefined, undefined, { action: 'delete' }],
    [202, new Uint8Array(), undefined, { action: 'delete' }],
    [400, undefined, undefined, { action: 'drop', reason: 'rejected', status: 400, rejectedItems: 0 }],
    [413, undefined, undefined, { action: 'drop', reason: 'rejected', status: 413, rejectedItems: 0 }],
    [401, undefined, undefined, { action: 'keep', failureClass: 'auth' }],
    [403, undefined, undefined, { action: 'keep', failureClass: 'auth' }],
    [404, undefined, undefined, { action: 'keep', failureClass: 'endpoint' }],
    [408, undefined, { 'retry-after': '2' }, { action: 'keep', failureClass: 'throttled', retryAfterMs: 2_000 }],
    [429, undefined, { 'Retry-After': '3' }, { action: 'keep', failureClass: 'throttled', retryAfterMs: 3_000 }],
    [500, undefined, undefined, { action: 'keep', failureClass: 'server' }],
    [502, undefined, undefined, { action: 'keep', failureClass: 'server' }],
    [503, undefined, undefined, { action: 'keep', failureClass: 'server' }],
    [504, undefined, undefined, { action: 'keep', failureClass: 'server' }],
  ] as const)('classifies HTTP %i as its delivery action', (status, body, headers, expected) => {
    expect(classifyResponse(status, body, headers)).toEqual(expected);
  });

  it.each(['traces', 'metrics'] as const)('drops a %s partial-success response as a whole batch', (signal) => {
    expect(classifyResponse(200, PARTIAL_SUCCESS_REJECTING_THREE_ITEMS, undefined, signal)).toEqual({
      action: 'drop',
      reason: 'rejected',
      status: 200,
      rejectedItems: 3,
    });
  });

  it('keeps a connection failure for retry', () => {
    expect(classifyNetworkError()).toEqual({ action: 'keep', failureClass: 'network' });
  });
});
