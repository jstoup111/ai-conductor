// Covers: task:1
import { describe, expect, it } from 'vitest';
import { parseCredentialReference } from '../../../src/engine/credentials/credential-reference.js';

describe('parseCredentialReference', () => {
  it('parses an environment variable reference', () => {
    expect(parseCredentialReference({ env: 'OTLP_TOKEN' })).toEqual({
      ok: true,
      reference: { kind: 'env', variable: 'OTLP_TOKEN' },
    });
  });

  it('parses a command reference with its optional settings', () => {
    expect(parseCredentialReference({ command: ['security', 'find-generic-password'], prefix: 'Bearer ', cache_seconds: 60 })).toEqual({
      ok: true,
      reference: {
        kind: 'command',
        argv: ['security', 'find-generic-password'],
        prefix: 'Bearer ',
        cacheSeconds: 60,
      },
    });
  });

  it.each([
    ['a string command', { command: 'security' }, /command.*array/i],
    ['an empty command array', { command: [] }, /command.*non-empty/i],
    ['a non-string command argument', { command: ['security', 1] }, /command.*string/i],
    ['an empty command argument', { command: ['security', ''] }, /command.*non-empty/i],
    ['a non-string prefix', { command: ['security'], prefix: 1 }, /prefix.*string/i],
    ['zero cache seconds', { command: ['security'], cache_seconds: 0 }, /cache_seconds.*positive integer/i],
    ['negative cache seconds', { command: ['security'], cache_seconds: -1 }, /cache_seconds.*positive integer/i],
    ['fractional cache seconds', { command: ['security'], cache_seconds: 0.5 }, /cache_seconds.*positive integer/i],
    ['string cache seconds', { command: ['security'], cache_seconds: '60' }, /cache_seconds.*positive integer/i],
  ])('rejects %s without throwing', (_caseName, reference, expectedError) => {
    expect(() => parseCredentialReference(reference)).not.toThrow();
    expect(parseCredentialReference(reference)).toEqual({
      ok: false,
      error: expect.stringMatching(expectedError),
    });
  });

  it.each([
    ['both forms', { env: 'OTLP_TOKEN', command: ['security'] }],
    ['an unknown key', { secret: 'literal' }],
    ['a literal string', 'literal'],
  ])('rejects %s by listing the supported forms', (_caseName, reference) => {
    expect(() => parseCredentialReference(reference)).not.toThrow();
    expect(parseCredentialReference(reference)).toEqual({
      ok: false,
      error: expect.stringMatching(/\{ env: <name> \}.*\{ command: \[\.\.\.\], prefix\?, cache_seconds\? \}/i),
    });
  });
});
