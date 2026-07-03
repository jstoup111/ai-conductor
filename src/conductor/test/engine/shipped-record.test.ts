import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  specHash,
  renderShippedRecord,
  parseShippedRecord,
  writeShippedRecord,
  listShippedRecords,
  makeIsProcessed,
} from '../../src/engine/shipped-record.js';
import type { BacklogTreeSource } from '../../src/engine/daemon-backlog.js';

/** Minimal fake tree source for exercising listShippedRecords in isolation. */
function fakeTreeSource(files: Record<string, string>): BacklogTreeSource & {
  listShippedFilesCallCount: number;
} {
  const state = {
    listShippedFilesCallCount: 0,
  };
  return {
    get listShippedFilesCallCount() {
      return state.listShippedFilesCallCount;
    },
    async listPlanFiles() {
      return [];
    },
    async listShippedFiles() {
      state.listShippedFilesCallCount += 1;
      return Object.keys(files);
    },
    async readFile(relPath: string) {
      const basename = relPath.replace(/^\.docs\/shipped\//, '');
      return Object.prototype.hasOwnProperty.call(files, basename)
        ? files[basename]
        : null;
    },
  };
}

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

describe('listShippedRecords', () => {
  it('returns records from .docs/shipped/ via the injected tree source', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const result = await listShippedRecords(tree);

    expect(result).toEqual([
      { stem: 'billing-export', record: parseShippedRecord(rendered) },
    ]);
  });

  it('reports malformed records as {malformed: true} rather than skipping them', async () => {
    const tree = fakeTreeSource({ 'bad-record.md': '# not frontmatter\n' });

    const result = await listShippedRecords(tree);

    expect(result).toEqual([{ stem: 'bad-record', record: { malformed: true } }]);
  });

  it('calls listShippedFiles exactly once, not once per file', async () => {
    const rendered1 = renderShippedRecord({ slug: 'feat-a', specHash: 'hash-a' });
    const rendered2 = renderShippedRecord({ slug: 'feat-b', specHash: 'hash-b' });
    const tree = fakeTreeSource({
      'feat-a.md': rendered1,
      'feat-b.md': rendered2,
    });

    await listShippedRecords(tree);

    expect(tree.listShippedFilesCallCount).toBe(1);
  });

  it('silently skips a basename whose file is missing from the tree source (working-tree-only records stay invisible)', async () => {
    const tree = fakeTreeSource({});
    // Simulate a basename listed but whose content vanished (readFile -> null)
    // by overriding listShippedFiles to report a name readFile won't resolve.
    const trickyTree: BacklogTreeSource = {
      ...tree,
      async listShippedFiles() {
        return ['ghost.md'];
      },
    };

    const result = await listShippedRecords(trickyTree);

    expect(result).toEqual([]);
  });
});

describe('makeIsProcessed', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipped-record-is-processed-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true on a ledger hit (fast path), without needing a shipped record', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'billing-export'), '');
    const tree = fakeTreeSource({});

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('billing-export')).toBe(true);
  });

  it('returns true on a shipped-record hit when the ledger has no entry', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('billing-export')).toBe(true);
  });

  it('returns false when neither the ledger nor a shipped record has the slug', async () => {
    const tree = fakeTreeSource({});

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('never-shipped')).toBe(false);
  });

  it('falls back to the shipped-record check when the ledger read errors (no throw)', async () => {
    // `dir` does not exist, so a ledger existence check will error (ENOENT on
    // the containing directory) rather than simply resolving false.
    const missingDir = join(dir, 'does', 'not', 'exist');
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(missingDir, tree);

    await expect(isProcessed('billing-export')).resolves.toBe(true);
  });

  it('caches the shipped-record list: multiple calls make only one listShippedFiles() call', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(dir, tree);

    await isProcessed('billing-export');
    await isProcessed('never-shipped');
    await isProcessed('billing-export');

    expect(tree.listShippedFilesCallCount).toBe(1);
  });
});
