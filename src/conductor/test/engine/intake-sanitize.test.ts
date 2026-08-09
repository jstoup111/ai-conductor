// Unit tests for the intake pre-publication scrub (sanitize.ts) and its wiring
// into the single filing choke point (file-issue.ts).
//
// Seam choice: `sanitizeIntakeText` is a pure function, so every pattern is
// proven directly against it. Only the two facts that depend on the CALLER —
// that the sanitized text is what reaches `createIssue`, and that redaction
// cannot change the resolved labels — go through `fileIntakeIssue`, with an
// injected tracker/gh. No process, network, or GitHub boundary is touched.

import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeIntakeText,
  describeRedactions,
} from '../../src/engine/engineer/intake/sanitize.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import type { TrackerClient } from '../../src/engine/tracker-client.js';

/** Categories present in a sanitize result, for order-independent assertions. */
const categoriesOf = (text: string): string[] =>
  sanitizeIntakeText(text).redactions.map((r) => r.category);

describe('sanitizeIntakeText — credential shapes', () => {
  it('redacts a classic GitHub token but keeps the surrounding evidence', () => {
    const result = sanitizeIntakeText(
      'gh auth failed with ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 — see log',
    );
    expect(result.text).toBe('gh auth failed with [redacted:github-token] — see log');
    expect(result.redactions).toEqual([{ category: 'github-token', count: 1 }]);
  });

  it('redacts a fine-grained github_pat_ token', () => {
    expect(categoriesOf('token=github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789')).toContain(
      'github-token',
    );
  });

  it('labels an Anthropic key as anthropic-key, not the generic sk- rule', () => {
    const result = sanitizeIntakeText('ANTHROPIC key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx');
    expect(result.text).toContain('[redacted:anthropic-key]');
    expect(result.text).not.toContain('[redacted:openai-key]');
  });

  it('redacts an AWS access key id and a Slack token', () => {
    expect(categoriesOf('AKIAIOSFODNN7EXAMPLE')).toEqual(['aws-access-key-id']);
    // Deliberately not token-shaped beyond the prefix: a realistic-looking
    // fixture trips GitHub push protection, which blocks the whole branch.
    expect(categoriesOf('xoxb-NOT-A-REAL-TOKEN-FIXTURE')).toEqual(['slack-token']);
  });

  it('redacts an entire PEM private key block', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAxGiJ0mMfake+key+material+here',
      'aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSByZWFsIGtleQ==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const result = sanitizeIntakeText(`config had:\n${pem}\nend`);
    expect(result.text).toBe('config had:\n[redacted:private-key-block]\nend');
    expect(result.text).not.toContain('BEGIN RSA');
  });

  it('redacts a JWT', () => {
    expect(
      categoriesOf('Cookie: session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'),
    ).toContain('jwt');
  });

  it('keeps the auth scheme word when redacting a bearer token', () => {
    const result = sanitizeIntakeText('Authorization: Bearer abcdef0123456789ABCDEF');
    expect(result.text).toBe('Authorization: Bearer [redacted:bearer-token]');
  });

  it('redacts credentials embedded in a URL but keeps the scheme and host', () => {
    const result = sanitizeIntakeText('cloned https://alice:hunter2pass@git.internal/repo.git');
    expect(result.text).toBe('cloned https://[redacted:url-credentials]@git.internal/repo.git');
  });
});

describe('sanitizeIntakeText — assigned secrets', () => {
  it('keeps the key name and drops only the value', () => {
    const result = sanitizeIntakeText('GITHUB_TOKEN=ghs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
    expect(result.text).toBe('GITHUB_TOKEN=[redacted:github-token]');
  });

  it('redacts a secret-named YAML value', () => {
    const result = sanitizeIntakeText('api_key: s0mel0ngsecretvalue');
    expect(result.text).toBe('api_key: [redacted:assigned-secret]');
  });

  it('leaves a bare variable NAME alone — naming one in prose is not a leak', () => {
    const text = 'the provisioner deletes CLAUDE_CODE_OAUTH_TOKEN from the child environment';
    expect(sanitizeIntakeText(text)).toEqual({ text, redactions: [] });
  });

  it('leaves a short non-secret-shaped value alone', () => {
    const text = 'TOKEN=none';
    expect(sanitizeIntakeText(text)).toEqual({ text, redactions: [] });
  });
});

describe('sanitizeIntakeText — operator identity', () => {
  it('rewrites an absolute home path to ~ so the path stays readable', () => {
    const result = sanitizeIntakeText(
      'failed in /home/james-stoup/code/ai-conductor/.worktrees/foo/.pipeline/HALT',
    );
    expect(result.text).toBe('failed in ~/code/ai-conductor/.worktrees/foo/.pipeline/HALT');
    expect(result.redactions).toEqual([{ category: 'home-path', count: 1 }]);
  });

  it('rewrites a macOS /Users path too', () => {
    expect(sanitizeIntakeText('/Users/jdoe/src/app').text).toBe('~/src/app');
  });

  it('redacts a real email but keeps noreply and example.com placeholders', () => {
    expect(sanitizeIntakeText('contact person@company.io').text).toBe(
      'contact [redacted:email]',
    );
    const kept = 'noreply@anthropic.com and someone@example.com';
    expect(sanitizeIntakeText(kept)).toEqual({ text: kept, redactions: [] });
  });
});

describe('sanitizeIntakeText — properties', () => {
  it('leaves ordinary intake evidence completely untouched', () => {
    const body = [
      '## Observed',
      '',
      '    20:03:31.638 · ✋ build stall: halt_marker (14 → 14)',
      '',
      'See `src/conductor/src/engine/config.ts:1998` and PR #1412.',
    ].join('\n');
    expect(sanitizeIntakeText(body)).toEqual({ text: body, redactions: [] });
  });

  it('is idempotent — re-running on its own output changes nothing further', () => {
    const once = sanitizeIntakeText('key ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 in /home/bob/x');
    const twice = sanitizeIntakeText(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.redactions).toEqual([]);
  });

  it('does not relabel a placeholder a more specific rule already wrote', () => {
    // Regression: the generic assigned-secret rule used to match its own
    // output, turning `[redacted:github-token]` into `[redacted:assigned-secret]`
    // and destroying the precise category — and idempotency with it.
    const once = sanitizeIntakeText('GITHUB_TOKEN=ghs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
    expect(once.text).toBe('GITHUB_TOKEN=[redacted:github-token]');
    expect(sanitizeIntakeText(once.text)).toEqual({ text: once.text, redactions: [] });
  });

  it('counts repeated occurrences of one category', () => {
    const result = sanitizeIntakeText('/home/a/one and /home/b/two and /home/c/three');
    expect(result.redactions).toEqual([{ category: 'home-path', count: 3 }]);
  });

  it('summarizes redactions for the operator', () => {
    expect(
      describeRedactions([
        { category: 'github-token', count: 1 },
        { category: 'home-path', count: 4 },
      ]),
    ).toBe('github-token x1, home-path x4');
  });
});

describe('fileIntakeIssue — scrub runs before publication', () => {
  const makeDeps = (createIssue: ReturnType<typeof vi.fn>) => ({
    tracker: { createIssue } as unknown as TrackerClient,
    gh: vi.fn().mockResolvedValue({ stdout: '{"id": 1}' }),
    cwd: '.',
  });

  it('publishes the sanitized title and body, never the raw text', async () => {
    const createIssue = vi
      .fn()
      .mockResolvedValue('https://github.com/o/r/issues/7');
    const result = await fileIntakeIssue(
      {
        title: 'auth broke on /home/james-stoup/code/app',
        body: 'token ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 rejected',
        size: 'M',
        priority: 'medium',
      },
      makeDeps(createIssue),
    );

    const published = createIssue.mock.calls[0][0];
    expect(published.title).toBe('auth broke on ~/code/app');
    expect(published.body).toBe('token [redacted:github-token] rejected');
    expect(published.body).not.toContain('ghp_');
    expect(result.redactions).toEqual([
      { category: 'home-path', count: 1 },
      { category: 'github-token', count: 1 },
    ]);
  });

  it('reports no redactions for a clean filing', async () => {
    const createIssue = vi.fn().mockResolvedValue('https://github.com/o/r/issues/8');
    const result = await fileIntakeIssue(
      { title: 'clean title', body: 'clean body', size: 'S', priority: 'low' },
      makeDeps(createIssue),
    );
    expect(result.redactions).toEqual([]);
    expect(createIssue.mock.calls[0][0].body).toBe('clean body');
  });

  it('resolves size/priority from the ORIGINAL body so a redaction cannot change labels', async () => {
    const createIssue = vi.fn().mockResolvedValue('https://github.com/o/r/issues/9');
    // "critical" and "large" live in the same line as the secret being redacted.
    const result = await fileIntakeIssue(
      {
        title: 't',
        body: 'critical large outage: AWS key AKIAIOSFODNN7EXAMPLE leaked',
      },
      makeDeps(createIssue),
    );
    expect(result.priority).toBe('critical');
    expect(result.prioritySource).toBe('inferred');
    expect(result.size).toBe('L');
    expect(createIssue.mock.calls[0][0].body).toContain('[redacted:aws-access-key-id]');
  });
});
