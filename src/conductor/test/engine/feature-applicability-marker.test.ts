// Covers: task:3
import { describe, expect, it } from 'vitest';
import { parseApplicability } from '../../src/engine/artifacts.js';

describe('parseApplicability', () => {
  it('parses a declaration with its step, reason, and line', () => {
    expect(parseApplicability('Inapplicable: acceptance_specs — no new behavior to specify')).toEqual({
      ok: true,
      declarations: [{ step: 'acceptance_specs', reason: 'no new behavior to specify', line: 1 }],
    });
  });

  it('rejects an ASCII-hyphen declaration', () => {
    expect(parseApplicability([
      '# Applicability',
      'This feature has no manual surface.',
      'Inapplicable: manual_test - no UI to exercise',
      'The implementation still has acceptance coverage.',
      'Inapplicable: acceptance_specs — no new behavior to specify',
    ].join('\n'))).toEqual({
      ok: false,
      error: { kind: 'malformed-line', line: 3 },
    });
  });

  it.each(['Inapplicable: manual_test — '])(
    'reports an empty reason',
    (content) => {
      expect(parseApplicability(content)).toEqual({
        ok: false,
        error: { kind: 'empty-reason', line: 1 },
      });
    },
  );

  it('reports a declaration without a separator as malformed', () => {
    expect(parseApplicability('Inapplicable: manual_test')).toEqual({
      ok: false,
      error: { kind: 'malformed-line', line: 1 },
    });
  });
});
