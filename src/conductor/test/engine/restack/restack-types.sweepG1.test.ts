import { describe, expect, it } from 'vitest';

import { parseCommitSha, parseRefName } from '../../../src/engine/restack/restack-types.js';

describe('restack typed value parsers (sweep G1)', () => {
  // Covers: task:1
  it('brands only full lowercase object names as commit SHAs and only refs/ names as ref names', () => {
    const sha1 = '0123456789abcdef0123456789abcdef01234567';
    const sha256 = `${sha1}${'89abcdef'.repeat(3)}`;

    expect(parseCommitSha(sha1)).toBe(sha1);
    expect(parseCommitSha(sha256)).toBe(sha256);
    expect(parseCommitSha(sha1.slice(0, 12))).toBeUndefined();
    expect(parseCommitSha(sha1.slice(0, 39))).toBeUndefined();
    expect(parseCommitSha(sha1.toUpperCase())).toBeUndefined();
    expect(parseCommitSha(`${sha1}\n`)).toBeUndefined();
    expect(parseCommitSha('refs/heads/feat/c1/demo')).toBeUndefined();
    expect(parseCommitSha('HEAD')).toBeUndefined();
    expect(parseCommitSha('')).toBeUndefined();

    expect(parseRefName('refs/heads/feat/c1/demo')).toBe('refs/heads/feat/c1/demo');
    expect(parseRefName('refs/conductor/demo/restack/journal')).toBe('refs/conductor/demo/restack/journal');
    for (const outside of ['feat/c1/demo', 'heads/main', 'HEAD', 'refs/', 'refsx/heads/main', '/refs/heads/main', '']) {
      expect(parseRefName(outside)).toBeUndefined();
    }
  });
});
