import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderKpi } from '../../src/engine/kpi-report.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kpi-report-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function record(slug: string, costLines: string): string {
  return (
    `---\n` +
    `slug: ${slug}\n` +
    `spec_hash: deadbeef\n` +
    `pr: https://github.com/acme/repo/pull/1\n` +
    `shipped: 2026-07-01\n` +
    `---\n` +
    `\n## Cost\n${costLines}`
  );
}

describe('renderKpi', () => {
  it('aggregates token totals across multiple features', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/feat-a.md'),
      record(
        'feat-a',
        'input: 1000\noutput: 200\ncache_read: 0\ncache_creation: 0\ncost_usd: 0.1\n' +
          'dispatches: 3\nretries: 0\nhalts: 0\nunmetered: count: 0, duration_ms: 0\n',
      ),
    );
    await writeFile(
      join(root, '.docs/shipped/feat-b.md'),
      record(
        'feat-b',
        'input: 2000\noutput: 400\ncache_read: 0\ncache_creation: 0\ncost_usd: 0.2\n' +
          'dispatches: 5\nretries: 1\nhalts: 0\nunmetered: count: 0, duration_ms: 0\n',
      ),
    );

    const report = await renderKpi(root);

    expect(report).toMatch(/feat-a/);
    expect(report).toMatch(/feat-b/);
    expect(report).toMatch(/3600/);
  });

  it('skips a feature with no Cost block without crashing the report', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/feat-legacy.md'),
      `---\nslug: feat-legacy\nspec_hash: deadbeef\npr: https://github.com/acme/repo/pull/1\nshipped: 2026-07-01\n---\n`,
    );
    await writeFile(
      join(root, '.docs/shipped/feat-a.md'),
      record(
        'feat-a',
        'input: 100\noutput: 50\ncache_read: 0\ncache_creation: 0\ncost_usd: 0.01\n' +
          'dispatches: 1\nretries: 0\nhalts: 0\nunmetered: count: 0, duration_ms: 0\n',
      ),
    );

    const report = await renderKpi(root);

    expect(report).toMatch(/feat-legacy/);
    expect(report).toMatch(/feat-a/);
    expect(report).toMatch(/150/);
  });

  it('prints a friendly message when .docs/shipped is empty or missing', async () => {
    const report = await renderKpi(root);
    expect(report).toMatch(/no shipped features/i);
  });
});
