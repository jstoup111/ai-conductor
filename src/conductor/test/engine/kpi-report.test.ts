import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCostBlock, parseTimeBlock, renderKpi } from '../../src/engine/kpi-report.js';

let root: string;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

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

describe('parseTimeBlock', () => {
  it('returns the reason carried by a partial Time block', () => {
    expect(parseTimeBlock([
      '## Time',
      'state: partial',
      'active_ms: 80',
      'reason: provider-evidence-incomplete',
      '',
    ].join('\n'))).toEqual({
      state: 'partial',
      activeMs: 80,
      reason: 'provider-evidence-incomplete',
    });
  });

  it('preserves the parse states of committed reason-free partial and pre-Time records', async () => {
    const [reasonFreePartial, noTime] = await Promise.all([
      readFile(join(repoRoot, '.docs/shipped/codex-readiness-distinguishes-unavailable-doctor-p.md'), 'utf8'),
      readFile(join(repoRoot, '.docs/shipped/2026-04-12-phase-1-story-catalog.md'), 'utf8'),
    ]);

    expect({
      reasonFreePartial: parseTimeBlock(reasonFreePartial),
      noTime: parseTimeBlock(noTime),
    }).toEqual({
      reasonFreePartial: { state: 'partial' },
      noTime: { state: 'unavailable' },
    });
  });

  it('degrades a hand-edited Time block to partial instead of throwing', () => {
    expect(parseTimeBlock([
      '## Time',
      'state: measured',
      'active_ms: not-a-number',
      'provider_active_ms: 17',
      'no_provider_active_ms: 13',
      '',
    ].join('\n'))).toEqual({ state: 'partial' });
  });
});

describe('renderKpi', () => {
  it('renders persisted raw build-review denominators and reduced coverage on the public KPI output', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(join(root, '.docs/shipped/feature.md'), record('feature', COST_LINES) + [
      '', '## Build Review', 'laps_to_pass: 2', 'skipped: 1', 'cache_hits: 3',
      'infrastructure_failures: 1', 'rubrics:', '  scope: failures: 1, judged: 2', 'skip_reasons:', '  disabled: 1', '',
    ].join('\n'));

    const report = await renderKpi(root);

    expect(report).toContain('build_review=laps_to_pass=2 skipped=1 cache_hits=3 infrastructure_failures=1');
    expect(report).toContain('scope: raw_failures=1/2');
  });

  it('reports historical and corrupt timing explicitly without polluting measured averages', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    const fixtures: Record<string, string> = {
      measured: 'state: measured\nactive_ms: 100\nprovider_active_ms: 60\nno_provider_active_ms: 40\nfuture_work_ms: 900\n',
      partial: 'state: partial\nactive_ms: 80\n',
      unavailable: 'state: unavailable\n',
      malformed: 'state: measured\nactive_ms: nope\nprovider_active_ms: 17\nno_provider_active_ms: 13\n',
      missing: 'state: measured\nactive_ms: 100\nno_provider_active_ms: 7\n',
      impossible: 'state: measured\nactive_ms: 100\nprovider_active_ms: 70\nno_provider_active_ms: 40\n',
    };
    for (const [slug, time] of Object.entries(fixtures)) {
      await writeFile(
        join(root, `.docs/shipped/${slug}.md`),
        record(slug, COST_LINES) + `\n## Time\n${time}`,
      );
    }
    await writeFile(join(root, '.docs/shipped/legacy.md'), record('legacy', COST_LINES));
    await writeFile(
      join(root, '.docs/shipped/mixed-version.md'),
      record('mixed-version', COST_LINES, '20260701T000000Z-oldengine'),
    );

    const report = await renderKpi(root);
    const featureLines = report.split('\n').filter((line) => line.startsWith('- '));
    const timingBySlug = Object.fromEntries(featureLines.map((line) => {
      const slug = /^- ([^:]+):/.exec(line)?.[1] ?? '';
      return [slug, line.slice(line.indexOf('time='))];
    }));
    const aggregate = report.split('\n').find((line) => line.startsWith('Aggregate')) ?? '';

    expect({
      timingBySlug,
      costPreserved: featureLines.every((line) => /tokens=1200.*cost_usd=0\.1/.test(line)),
      mixedVersionPreserved: featureLines.some(
        (line) => line.includes('mixed-version: engine=20260701T000000Z-oldengine'),
      ),
      aggregate,
    }).toEqual({
      timingBySlug: {
        measured: 'time=measured active_ms=100 provider_active_ms=60 no_provider_active_ms=40',
        partial: 'time=partial active_ms=80',
        unavailable: 'time=unavailable',
        malformed: 'time=partial',
        missing: 'time=partial active_ms=100',
        impossible: 'time=partial active_ms=100',
        legacy: 'time=unavailable',
        'mixed-version': 'time=unavailable',
      },
      costPreserved: true,
      mixedVersionPreserved: true,
      aggregate:
        'Aggregate / trend across 8 feature(s): total tokens=9600 ' +
        '(input=8000, output=1600), total cost_usd=0.8; timing measured=1 ' +
        'partial=4 unavailable=3 avg_active_ms=100 avg_provider_active_ms=60 ' +
        'avg_no_provider_active_ms=40',
    });
  });

  it('renders a partial timing reason on the feature row while preserving active time', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/partial.md'),
      record('partial', COST_LINES) +
        '\n## Time\nstate: partial\nactive_ms: 80\nreason: provider-evidence-incomplete\n',
    );

    const report = await renderKpi(root);

    expect(report).toContain('time=partial active_ms=80 reason=provider-evidence-incomplete');
  });

  it('reports measured timing partitions and measured-only aggregate averages', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/feat-a.md'),
      record('feat-a', COST_LINES) +
        '\n## Time\nstate: measured\nactive_ms: 1200\nprovider_active_ms: 800\nno_provider_active_ms: 400\n',
    );
    await writeFile(
      join(root, '.docs/shipped/feat-b.md'),
      record('feat-b', COST_LINES) +
        '\n## Time\nstate: measured\nactive_ms: 800\nprovider_active_ms: 200\nno_provider_active_ms: 600\n',
    );
    await writeFile(join(root, '.docs/shipped/legacy.md'), record('legacy', COST_LINES));

    const report = await renderKpi(root);

    expect(report).toContain(
      '- feat-a: engine=unknown input=1000 output=200 tokens=1200 cache_read=0 ' +
        'cache_creation=0 dispatches=3 retries=0 halts=0 duration_ms=0 cost_usd=0.1 ' +
        'time=measured active_ms=1200 provider_active_ms=800 no_provider_active_ms=400\n' +
        '- feat-b: engine=unknown input=1000 output=200 tokens=1200 cache_read=0 ' +
        'cache_creation=0 dispatches=3 retries=0 halts=0 duration_ms=0 cost_usd=0.1 ' +
        'time=measured active_ms=800 provider_active_ms=200 no_provider_active_ms=600\n' +
        '- legacy: engine=unknown input=1000 output=200 tokens=1200 cache_read=0 ' +
        'cache_creation=0 dispatches=3 retries=0 halts=0 duration_ms=0 cost_usd=0.1 time=unavailable\n' +
        '\nAggregate / trend across 3 feature(s): total tokens=3600 ' +
        '(input=3000, output=600), total cost_usd=0.3; timing measured=2 partial=0 unavailable=1 ' +
        'avg_active_ms=1000 avg_provider_active_ms=500 avg_no_provider_active_ms=500',
    );
  });

  it('renders per-provider attribution and cache-related Cost fields', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs/shipped/attributed.md'),
      record('attributed', [
        'input: 700', 'output: 80', 'cache_read: 15', 'cache_creation: 9', 'cost_usd: 0.05',
        'dispatches: 3', 'retries: 1', 'halts: 0',
        'unmetered: count: 1, duration_ms: 4200', 'cost_unmetered: count: 1',
        'providers:',
        '  claude: input: 100, output: 20, cache_read: 10, cache_creation: 2, cost_usd: 0.05, dispatches: 1, cost_unmetered: 0',
        '  codex: input: 600, output: 60, cache_read: 5, cache_creation: 7, cost_usd: 0, dispatches: 2, cost_unmetered: 1',
        '',
      ].join('\n')),
    );

    const report = await renderKpi(root);

    expect(report).toMatch(/cache_read=15.*cache_creation=9.*dispatches=3.*retries=1.*halts=0.*duration_ms=4200/);
    expect(report).toMatch(/claude:.*tokens=120.*cost_usd=0\.05.*cost_unmetered=0.*dispatches=1/);
    expect(report).toMatch(/codex:.*tokens=660.*cost_usd=unavailable.*cost_unmetered=1.*dispatches=2/);
  });

  it('renders legacy top-level totals without provider detail', async () => {
    await mkdir(join(root, '.docs/shipped'), { recursive: true });
    await writeFile(join(root, '.docs/shipped/legacy.md'), record('legacy', COST_LINES));

    const report = await renderKpi(root);

    expect(report).toMatch(/legacy:.*input=1000.*output=200/);
    expect(report).not.toMatch(/^\s+(?:-\s+)?(?:claude|codex):/m);
  });

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
