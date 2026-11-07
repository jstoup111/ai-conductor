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

  it('rejects every listed malformed shape without throwing', () => {
    const malformedReferences: ReadonlyArray<readonly [unknown, RegExp]> = [
      [{ command: 'security' }, /command.*array/i],
      [{ command: [] }, /command.*non-empty/i],
      [{ command: ['security', 1] }, /command.*string/i],
      [{ command: ['security', ''] }, /command.*non-empty/i],
      [{ command: ['security'], prefix: 1 }, /prefix.*string/i],
      [{ command: ['security'], cache_seconds: 0 }, /cache_seconds.*positive integer/i],
      [{ command: ['security'], cache_seconds: -1 }, /cache_seconds.*positive integer/i],
      [{ command: ['security'], cache_seconds: 0.5 }, /cache_seconds.*positive integer/i],
      [{ command: ['security'], cache_seconds: '60' }, /cache_seconds.*positive integer/i],
    ];
    for (const [reference, expectedError] of malformedReferences) {
      expect(() => parseCredentialReference(reference)).not.toThrow();
      expect(parseCredentialReference(reference)).toEqual({
        ok: false,
        error: expect.stringMatching(expectedError),
      });
    }
  });

  it('lists supported forms for mixed, unknown, and literal references', () => {
    for (const reference of [
      { env: 'OTLP_TOKEN', command: ['security'] },
      { secret: 'literal' },
      'literal',
    ]) {
      expect(() => parseCredentialReference(reference)).not.toThrow();
      expect(parseCredentialReference(reference)).toEqual({
        ok: false,
        error: expect.stringMatching(/\{ env: <name> \}.*\{ command: \[\.\.\.\], prefix\?, cache_seconds\? \}/i),
      });
    }
  });
});
