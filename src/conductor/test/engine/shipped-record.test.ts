import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  specHash,
  renderShippedRecord,
  parseShippedRecord,
  writeShippedRecord,
} from '../../src/engine/shipped-record.js';

describe('specHash', () => {
  it('is deterministic: same bytes produce identical digest', () => {
    const plan = Buffer.from('plan content here');
    const stories = Buffer.from('story content here');

    const first = specHash(plan, stories);
    const second = specHash(plan, stories);

    expect(first.digest).toBe(second.digest);
  });

  it('treats a trailing newline as equivalent (trims before hashing)', () => {
    const withNewline = specHash(Buffer.from('content\n'), null);
    const withoutNewline = specHash(Buffer.from('content'), null);

    expect(withNewline.digest).toBe(withoutNewline.digest);
  });

  it('is sensitive to a changed interior byte', () => {
    const original = specHash(Buffer.from('content-a-here'), null);
    const changed = specHash(Buffer.from('content-b-here'), null);

    expect(original.digest).not.toBe(changed.digest);
  });

  it('reports storiesIncluded: false when stories are null', () => {
    const result = specHash(Buffer.from('plan only'), null);

    expect(result.storiesIncluded).toBe(false);
  });

  it('does not treat CRLF as equivalent to LF (pinned behavior)', () => {
    const lf = specHash(Buffer.from('line1\nline2'), null);
    const crlf = specHash(Buffer.from('line1\r\nline2'), null);

    expect(lf.digest).not.toBe(crlf.digest);
  });
});

describe('renderShippedRecord', () => {
  it('emits correct frontmatter with all fields', () => {
    const body = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });

    expect(body).toBe(
      '---\n' +
        'slug: billing-export\n' +
        'spec_hash: abc123\n' +
        'pr: https://github.com/acme/repo/pull/42\n' +
        'shipped: 2026-07-01\n' +
        '---\n'
    );
  });

  it('uses defaults when pr/shipped are missing', () => {
    const body = renderShippedRecord({ slug: 'no-defaults-yet', specHash: 'deadbeef' });

    expect(body).toContain('slug: no-defaults-yet\n');
    expect(body).toContain('spec_hash: deadbeef\n');
    expect(body).toMatch(/pr: https:\/\/github\.com\/.*\n/);
    expect(body).toMatch(/shipped: \d{4}-\d{2}-\d{2}\n/);
  });
});

describe('parseShippedRecord', () => {
  it('round-trips a rendered record', () => {
    const rendered = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });

    const parsed = parseShippedRecord(rendered);

    expect(parsed).toEqual({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });
  });

  it('returns {malformed: true} for malformed/invalid content', () => {
    const parsed = parseShippedRecord('# Not a shipped record\n\njust prose.\n');

    expect(parsed).toMatchObject({ malformed: true });
  });
});

describe('writeShippedRecord', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipped-record-writer-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file at the correct path', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const content = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });

    await writeShippedRecord(target, content);

    const written = await readFile(target, 'utf8');
    expect(written).toBe(content);
  });

  it('is idempotent: writing identical content again does not error', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const content = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });

    await writeShippedRecord(target, content);
    await expect(writeShippedRecord(target, content)).resolves.toBeUndefined();

    const written = await readFile(target, 'utf8');
    expect(written).toBe(content);
  });

  it('overwrites the file when content differs', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const first = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });
    const second = renderShippedRecord({ slug: 'my-feat', specHash: 'hash2' });

    await writeShippedRecord(target, first);
    await writeShippedRecord(target, second);

    const written = await readFile(target, 'utf8');
    expect(written).toBe(second);
  });
});
