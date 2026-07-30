/**
 * Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10
 *
 * Acceptance specs for
 * `.docs/stories/durable-provider-time-attribution.md`, governed by
 * `.docs/plans/no-durable-llm-time-vs-code-execution-time-breakdo.md`
 * Task 20.
 *
 * WHY ACCEPTANCE-LEVEL: the observable requirement crosses the feature event
 * ledger, shipment-time rollup, the real shipped-record entry point, a
 * committed `.docs/shipped/<slug>.md`, workspace cleanup, and the durable KPI
 * reader. Unit tests for interval union, rendering, or parsing cannot prove
 * that this production chain is wired together. These specs therefore drive
 * `dispatchShippedRecord` against a real temporary Git repository, remove the
 * transient `.pipeline` workspace, and then drive `renderKpi` from committed
 * records only. Provider processes are represented by faithful event fixtures;
 * ordinary acceptance tests must never invoke real Claude or Codex processes.
 *
 * REAL PRODUCTION CALL SITES:
 *   1. `src/engine/shipped-record-cli.ts#dispatchShippedRecord` — computes and
 *      commits the timing partition from feature-local evidence.
 *   2. `src/engine/kpi-report.ts#renderKpi` — reads timing only from durable
 *      shipment records after transient evidence is gone.
 *
 * PRE-IMPLEMENTATION RED: shipment currently writes Cost but no `## Time`
 * section, and `renderKpi` has no timing reader. Failures below are therefore
 * missing timing behavior, not syntax, collection, infrastructure, or
 * third-party failures.
 *
 * The stories pin states and values, not report prose. Assertions match the
 * required state and field/value pairs without prescribing sentence wording.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  detectShippedRecordCommand,
  dispatchShippedRecord,
} from '../../src/engine/shipped-record-cli.js';
import { renderKpi } from '../../src/engine/kpi-report.js';

const execFile = promisify(execFileCb);
const SLUG = 'no-durable-llm-time-vs-code-execution-time-breakdo';
const PR = 'https://github.com/jstoup111/ai-conductor/pull/1101';
const PLAN = [
  '# Plan',
  '',
  '**Stories:** `.docs/stories/durable-provider-time-attribution.md`',
  '',
  '### Task 1',
  '**Dependencies:** none',
  '',
].join('\n');
const STORIES = '# Stories\n\n**Status:** Accepted\n';

let repo: string;

const git = async (args: string[]): Promise<string> => {
  const { stdout } = await execFile('git', args, { cwd: repo });
  return stdout.trim();
};

async function writeFeatureArtifacts(): Promise<void> {
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.docs', 'plans', `${SLUG}.md`), PLAN);
  await writeFile(
    join(repo, '.docs', 'stories', 'durable-provider-time-attribution.md'),
    STORIES,
  );
}

async function writeEventsLedger(events: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(
    join(repo, '.pipeline', 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
}

async function ship(): Promise<void> {
  const command = detectShippedRecordCommand([
    'node',
    'conduct',
    'shipped-record',
    '--slug',
    SLUG,
    '--pr',
    PR,
  ]);
  if (!command || command.kind !== 'write') {
    throw new Error('failed to resolve the shipped-record command');
  }
  expect(await dispatchShippedRecord(command, repo)).toBe(0);
}

async function shippedRecord(): Promise<string> {
  return readFile(join(repo, '.docs', 'shipped', `${SLUG}.md`), 'utf8');
}

function expectTimingField(content: string, name: string, value: number): void {
  expect(content).toMatch(new RegExp(`^${name}:\\s*${value}$`, 'm'));
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'durable-provider-time-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), 'seed\n');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'seed']);
  await writeFeatureArtifacts();
  await git(['add', '.docs']);
  await git(['commit', '-q', '-m', `merge spec: ${SLUG}`]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('acceptance: durable provider-time attribution (#1101)', () => {
  it('commits an overlap-safe measured partition and reports it after transient workspace removal', async () => {
    await writeEventsLedger([
      {
        type: 'step_completed',
        step: 'build',
        status: 'done',
        activeInterval: { startedAtMs: 100, durationMs: 400 },
      },
      {
        type: 'step_completed',
        step: 'manual_test',
        status: 'done',
        activeInterval: { startedAtMs: 450, durationMs: 250 },
      },
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        observedIntervals: [{ startedAtMs: 120, durationMs: 180 }],
        tokenUsage: { input: 10, output: 2, durationMs: 999 },
      },
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'failure',
        invoked: true,
        observedIntervals: [{ startedAtMs: 250, durationMs: 200 }],
        tokenUsage: { input: 5, output: 1 },
      },
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        providerInvocationSkipped: true,
      },
    ]);

    await ship();
    const record = await shippedRecord();

    expect(record).toMatch(/^## Time$/m);
    expect(record).toMatch(/^state:\s*measured$/m);
    expectTimingField(record, 'active_ms', 600);
    expectTimingField(record, 'provider_active_ms', 330);
    expectTimingField(record, 'no_provider_active_ms', 270);
    expect(record).toMatch(/^## Cost$/m);
    expect(record).toMatch(/^input:\s*15$/m);
    expect(record).toMatch(/^output:\s*3$/m);
    expect(await git(['status', '--porcelain', '--', '.docs/shipped'])).toBe('');

    await rm(join(repo, '.pipeline'), { recursive: true, force: true });
    const report = await renderKpi(repo);

    expect(report).toContain(SLUG);
    expect(report).toMatch(/measured/i);
    expect(report).toMatch(/active(?:_ms)?[=:]\s*600/i);
    expect(report).toMatch(/provider(?:[_-]active)?(?:_ms)?[=:]\s*330/i);
    expect(report).toMatch(/no[_-]provider[_-]active(?:_ms)?[=:]\s*270/i);
  });

  it('ships incomplete evidence as partial without changing provider outcomes or fabricating a complete partition', async () => {
    await writeEventsLedger([
      {
        type: 'step_completed',
        step: 'build',
        status: 'done',
        activeInterval: { startedAtMs: 100, durationMs: 400 },
      },
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'failure',
        invoked: true,
        tokenUsage: { input: 7, output: 3, durationMs: 222 },
      },
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        providerInvocationSkipped: true,
      },
    ]);

    await ship();
    const record = await shippedRecord();

    expect(record).toMatch(/^## Time$/m);
    expect(record).toMatch(/^state:\s*partial$/m);
    expect(record).not.toMatch(/^state:\s*measured$/m);
    expect(record).not.toMatch(/^provider_active_ms:\s*0$/m);
    expect(record).toMatch(/^input:\s*7$/m);
    expect(record).toMatch(/^output:\s*3$/m);
    expect(await git(['log', '-1', '--format=%s'])).toBe(`shipped record: ${SLUG}`);
  });

  it('renders historical, malformed, and future-additive records without substituting unavailable timing with zero', async () => {
    const shippedDir = join(repo, '.docs', 'shipped');
    await mkdir(shippedDir, { recursive: true });
    await writeFile(
      join(shippedDir, 'historical.md'),
      [
        '---',
        'slug: historical',
        'spec_hash: historical-hash',
        'pr: local',
        'shipped: 2026-07-01',
        '---',
        '',
        '## Cost',
        'input: 11',
        'output: 4',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(shippedDir, 'malformed-time.md'),
      [
        '---',
        'slug: malformed-time',
        'spec_hash: malformed-hash',
        'pr: local',
        'shipped: 2026-07-02',
        '---',
        '',
        '## Time',
        'state: measured',
        'active_ms: nope',
        'provider_active_ms: 80',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(shippedDir, 'future-additive.md'),
      [
        '---',
        'slug: future-additive',
        'spec_hash: future-hash',
        'pr: local',
        'shipped: 2026-07-03',
        '---',
        '',
        '## Time',
        'state: measured',
        'active_ms: 100',
        'provider_active_ms: 40',
        'no_provider_active_ms: 60',
        'tests_ms: 25',
        'cumulative_provider_work_ms: 45',
        '',
      ].join('\n'),
    );

    const report = await renderKpi(repo);
    const historicalLine = report.split('\n').find((line) => line.includes('historical')) ?? '';
    const malformedLine =
      report.split('\n').find((line) => line.includes('malformed-time')) ?? '';
    const futureLine =
      report.split('\n').find((line) => line.includes('future-additive')) ?? '';

    expect(historicalLine).toMatch(/unavailable/i);
    expect(historicalLine).not.toMatch(/(?:provider|active)[^0-9]*0(?:\D|$)/i);
    expect(malformedLine).toMatch(/partial|unavailable/i);
    expect(futureLine).toMatch(/measured/i);
    expect(futureLine).toMatch(/provider(?:[_-]active)?(?:_ms)?[=:]\s*40/i);
    expect(futureLine).toMatch(/no[_-]provider[_-]active(?:_ms)?[=:]\s*60/i);
    expect(report).toMatch(/Aggregate|trend/i);
  });
});
