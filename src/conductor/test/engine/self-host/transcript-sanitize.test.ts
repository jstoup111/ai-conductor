// Covers: task:3
import { describe, expect, it } from 'vitest';
import { redactSafetyText } from '../../../src/engine/safety-diagnostics.js';
import {
  collectKnownSecrets,
  sanitizeTranscriptLine,
} from '../../../src/engine/self-host/transcript-sanitize.js';

describe('sanitizeTranscriptLine', () => {
  it('sanitizes credential patterns inside JSON string leaves without making the line invalid JSON', () => {
    const inputs = [
      'Authorization: Bearer abc123def',
      'api_key=sk-live-9999',
      'authorization: Bearer xyz98765',
    ];

    expect(inputs.map((value) => {
      const output = sanitizeTranscriptLine(JSON.stringify({ value }), []);
      return JSON.parse(output).value === redactSafetyText(value);
    })).toStrictEqual([true, true, true]);
  });

  it('redacts credential-named keys at every nesting level regardless of key case', () => {
    const output = sanitizeTranscriptLine(JSON.stringify({
      Token: 'top-token',
      api_key: 'top-key',
      nested: {
        SECRET: 'nested-secret',
        Password: 'nested-password',
        credential: 'nested-credential',
        Authorization: 'nested-authorization',
      },
    }), []);

    expect(JSON.parse(output)).toStrictEqual({
      Token: '[REDACTED]',
      api_key: '[REDACTED]',
      nested: {
        SECRET: '[REDACTED]',
        Password: '[REDACTED]',
        credential: '[REDACTED]',
        Authorization: '[REDACTED]',
      },
    });
  });

  it('sanitizes a non-JSON credential line', () => {
    const output = sanitizeTranscriptLine('token=abc123', []);

    expect(output).toBe('token=[REDACTED]');
  });

  it('preserves JSON without sensitive values', () => {
    const input = JSON.stringify({ message: 'nothing sensitive', nested: ['still safe'] });

    expect(JSON.parse(sanitizeTranscriptLine(input, []))).toStrictEqual(JSON.parse(input));
  });

  it('masks known secrets collected from auth file text after sanitizing a JSON leaf', () => {
    const authFileText = '{"OPENAI_API_KEY":"sk-test-0123456789"}';
    const knownSecrets = collectKnownSecrets(authFileText, []);
    const output = sanitizeTranscriptLine(JSON.stringify({ toolResult: authFileText }), knownSecrets);

    expect(output).not.toContain('sk-test-0123456789');
  });

  it('masks known secrets in decoded JSON leaves before JSON escaping quote, slash, and newline characters', () => {
    for (const secret of ['quote"secret', 'slash\\secret', 'line\nsecret']) {
      const output = sanitizeTranscriptLine(JSON.stringify({ output: `prefix ${secret} suffix` }), [secret]);
      expect(JSON.parse(output).output).toBe('prefix [REDACTED] suffix');
    }
  });

  it('retains known-secret masking for raw fallback lines with quote, slash, and newline characters', () => {
    for (const secret of ['quote"secret', 'slash\\secret', 'line\nsecret']) {
      const output = sanitizeTranscriptLine(`unparsed ${secret} trailing`, [secret]);
      expect(output).toBe('unparsed [REDACTED] trailing');
    }
  });
});
