import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCostBlock, renderKpi } from '../../src/engine/kpi-report.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kpi-report-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function record(slug: string, costLines: string, engineVersion?: string): string {
  return (
    `---\n` +
    `slug: ${slug}\n` +
    `spec_hash: deadbeef\n` +
    `pr: https://github.com/acme/repo/pull/1\n` +
    `shipped: 2026-07-01\n` +
    (engineVersion ? `engine_version: ${engineVersion}\n` : '') +
    `---\n` +
    `\n## Cost\n${costLines}`
  );
}

const COST_LINES =
  'input: 1000\noutput: 200\ncache_read: 0\ncache_creation: 0\ncost_usd: 0.1\n' +
  'dispatches: 3\nretries: 0\nhalts: 0\nunmetered: count: 0, duration_ms: 0\n';

describe('parseCostBlock', () => {
  it('parses top-level and per-provider cost-unmetered fields', () => {
    const parsed = parseCostBlock([
      '## Cost',
      'input: 700',
      'output: 80',
      'cache_read: 15',
      'cache_creation: 9',
      'cost_usd: 0.05',
      'dispatches: 2',
      'retries: 0',
      'halts: 0',
      'unmetered: count: 0, duration_ms: 0',
      'cost_unmetered: count: 1',
      'providers:',
      '  claude: input: 100, output: 20, cache_read: 10, cache_creation: 2, cost_usd: 0.05, dispatches: 1, cost_unmetered: 0',
      '  codex: input: 600, output: 60, cache_read: 5, cache_creation: 7, cost_usd: 0, dispatches: 1, cost_unmetered: 1',
      '',
    ].join('\n'));

    expect(parsed).toMatchObject({
      costUnmetered: 1,
      providers: {
        claude: {
          input: 100, output: 20, cacheRead: 10, cacheCreation: 2,
          costUsd: 0.05, dispatches: 1, costUnmetered: 0,
        },
        codex: {
          input: 600, output: 60, cacheRead: 5, cacheCreation: 7,
          costUsd: 0, dispatches: 1, costUnmetered: 1,
        },
      },
    });
  });

  it('defaults cost-unmetered to zero for a historic Cost block', () => {
    expect(parseCostBlock(`## Cost\n${COST_LINES}`)).toMatchObject({
      costUnmetered: 0,
      providers: {},
    });
  });

  it('keeps an indented provider cost-unmetered field from shadowing the top-level value', () => {
    const parsed = parseCostBlock([
      '## Cost',
      'input: 10',
      'output: 2',
      'cost_usd: 0.5',
      'cost_unmetered: count: 0',
      'unmetered: count: 0, duration_ms: 0',
      'providers:',
      '  codex: input: 5, output: 1, cache_read: 0, cache_creation: 0, cost_usd: 0, dispatches: 4, cost_unmetered: 9',
      '',
    ].join('\n'));

    expect(parsed).toMatchObject({
      costUnmetered: 0,
      providers: { codex: { costUnmetered: 9 } },
    });
  });

  it('preserves provider names that collide with inherited object properties', () => {
    const parsed = parseCostBlock([
      '## Cost',
      'input: 10',
      'output: 2',
      'providers:',
      '  __proto__: input: 5, output: 1, cache_read: 0, cache_creation: 0, cost_usd: 0, dispatches: 1, cost_unmetered: 1',
      '',
    ].join('\n'));

    expect(Object.hasOwn(parsed?.providers ?? {}, '__proto__')).toBe(true);
  });
});

describe('renderKpi', () => {
  it('keeps cost-unmetered feature tokens while excluding their cost', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/feat-codex.md'),
      record('feat-codex', [
        'input: 1000', 'output: 200', 'cost_usd: 0.25',
        'cost_unmetered: count: 1', 'unmetered: count: 0, duration_ms: 0', '',
      ].join('\n')),
    );
    await writeFile(
      join(root, '.docs/shipped/fully-metered.md'),
      record('fully-metered', [
        'input: 500', 'output: 100', 'cost_usd: 0.75',
        'cost_unmetered: count: 0', 'unmetered: count: 0, duration_ms: 0', '',
      ].join('\n')),
    );

    const report = await renderKpi(root);
    const partialLine = report.split('\n').find((line) => line.includes('feat-codex')) ?? '';

    expect(report).toMatch(/total tokens=1800/);
    expect(report).toMatch(/total cost_usd=0\.75/);
    expect(partialLine).toMatch(/cost[- _]?(?:partial|unmetered|unavailable)/i);
  });

  it('excludes a truly unmetered feature from both aggregates', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/unmetered.md'),
      record('unmetered', [
        'input: 9000', 'output: 900', 'cost_usd: 3.5',
        'cost_unmetered: count: 0', 'unmetered: count: 1, duration_ms: 1200', '',
      ].join('\n')),
    );
    await writeFile(
      join(root, '.docs/shipped/fully-metered.md'),
      record('fully-metered', [
        'input: 500', 'output: 100', 'cost_usd: 0.75',
        'cost_unmetered: count: 0', 'unmetered: count: 0, duration_ms: 0', '',
      ].join('\n')),
    );

    const report = await renderKpi(root);

    expect(report).toMatch(/total tokens=600/);
    expect(report).toMatch(/total cost_usd=0\.75/);
  });

  it('reports unavailable aggregate cost when every feature is cost-unmetered', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/codex.md'),
      record('codex', [
        'input: 1000', 'output: 200', 'cost_usd: 0',
        'cost_unmetered: count: 1', 'unmetered: count: 0, duration_ms: 0', '',
      ].join('\n')),
    );

    const report = await renderKpi(root);

    expect(report).toMatch(/total tokens=1200/);
    expect(report).toMatch(/total cost_usd=(?:unavailable|n\/a)/i);
  });

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

  it('attributes each shipped feature to the engine build that shipped it', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/feat-a.md'),
      record('feat-a', COST_LINES, '20260727T234833Z-b5b34bb9f015'),
    );

    const report = await renderKpi(root);

    expect(report).toContain('engine=20260727T234833Z-b5b34bb9f015');
  });

  it('reports an unstamped legacy record as engine=unknown rather than omitting it', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(join(root, '.docs/shipped/legacy.md'), record('legacy', COST_LINES));

    const report = await renderKpi(root);

    expect(report).toContain('engine=unknown');
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
