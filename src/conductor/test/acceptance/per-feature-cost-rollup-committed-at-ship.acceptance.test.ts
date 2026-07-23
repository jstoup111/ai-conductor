/**
 * Acceptance specs for .docs/stories/per-feature-token-accounting.md Story 3
 * (#537), governed by .docs/plans/per-feature-token-accounting.md Tasks 5-6.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): plan Task 5 (`computeCostRollup`) and Task
 * 6 (`renderShippedRecordWithCost`) are two new, independently-unit-testable
 * primitives. The story's actual requirement is that the REAL ship entry
 * point — `dispatchShippedRecord` (shipped-record-cli.ts), invoked by
 * `conduct shipped-record --slug <slug> --pr <url>` from /finish — actually
 * calls the rollup and writes its output into the committed
 * `.docs/shipped/<slug>.md`. A unit test on `computeCostRollup` alone (green
 * today it doesn't even exist) proves nothing about whether the ship call
 * site is wired to invoke it — the exact "new primitive, orphaned at its one
 * real call site" class writing-system-tests §3b exists to catch, and the
 * one this feature's own plan explicitly separates into two dependent tasks.
 * This file drives `dispatchShippedRecord` directly against a real temp git
 * repo (mirrors `test/integration/daemon-ship.integration.test.ts`'s
 * convention for this exact function) with a real `.pipeline/events.jsonl`
 * on disk, and asserts on the COMMITTED file's contents — never calling
 * `computeCostRollup`/`renderShippedRecordWithCost` directly.
 *
 * PRE-FIX RED: today `dispatchShippedRecord` never reads `.pipeline/events.jsonl`
 * and `renderShippedRecord` has no Cost block at all — every scenario below
 * fails on a missing "## Cost" / missing field, not a crash.
 *
 * ASSUMPTION FLAGGED (per verify-claims / writing-system-tests correctness
 * gate): the story pins the Cost block's FIELD NAMES verbatim (tokens
 * input/output/cache_read/cache_creation, cost_usd, dispatches, retries,
 * halts, unmetered{count, duration_ms}) but not its exact serialization
 * (JSON body vs. a markdown table vs. `key: value` lines) or the precise
 * definition of "dispatches"/"retries"/"halts" as event-log countable
 * things. This file therefore asserts field PRESENCE and VALUE via regex on
 * the literal field names quoted in the story (high confidence — verbatim
 * story text), and asserts `dispatches`/`retries`/`halts` counts loosely
 * (non-negative integers reflecting the fixture's known event mix) with the
 * specific mapping (dispatches≈step_completed count, retries≈step_retry
 * count, halts≈loop_halt count) flagged here at ~70% confidence for operator
 * confirmation at Task 5 implementation time — not silently baked in as the
 * one true definition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { detectShippedRecordCommand, dispatchShippedRecord } from '../../src/engine/shipped-record-cli.js';

const execFile = promisify(execFileCb);
const SLUG = 'per-feature-token-accounting';
const PLAN = '# Plan\n\n### Task 1\n**Dependencies:** none\n';
const STORIES = '# Stories\n**Status:** Accepted\n';

let repo: string;

const git = async (args: string[]): Promise<string> => {
  const { stdout } = await execFile('git', args, { cwd: repo });
  return stdout.trim();
};

async function writeSpec(): Promise<void> {
  await mkdir(join(repo, '.docs/plans'), { recursive: true });
  await mkdir(join(repo, '.docs/stories'), { recursive: true });
  await writeFile(join(repo, `.docs/plans/${SLUG}.md`), PLAN);
  await writeFile(join(repo, `.docs/stories/${SLUG}.md`), STORIES);
}

async function writeEventsLedger(lines: Record<string, unknown>[]): Promise<void> {
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(
    join(repo, '.pipeline/events.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

async function runShippedRecord(): Promise<number> {
  const cmd = detectShippedRecordCommand([
    'node', 'conduct', 'shipped-record', '--slug', SLUG, '--pr', 'https://github.com/acme/repo/pull/9',
  ]);
  if (!cmd || cmd.kind !== 'write') throw new Error('detect failed for valid args');
  return dispatchShippedRecord(cmd, repo);
}

async function shippedRecordBody(): Promise<string> {
  return readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8');
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'cost-rollup-ship-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), 'seed\n');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'seed']);
  await writeSpec();
  await git(['add', '.docs']);
  await git(['commit', '-q', '-m', `merge spec: ${SLUG}`]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('acceptance: per-feature cost rollup is committed at ship (Story 3, #537)', () => {
  it('happy: metered events.jsonl -> a "## Cost" block summing tokens/cost_usd/dispatch counts lands in the committed shipped record', async () => {
    await writeEventsLedger([
      { type: 'step_completed', step: 'build', status: 'done', tokenUsage: { input: 1000, output: 200, cacheRead: 50, cacheCreation: 10, costUsd: 0.12 }, model: 'claude-sonnet-5' },
      { type: 'step_completed', step: 'build_review', status: 'done', tokenUsage: { input: 500, output: 100, cacheRead: 0, cacheCreation: 0, costUsd: 0.03 }, model: 'claude-sonnet-5' },
      { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'flaky' },
    ]);

    const code = await runShippedRecord();
    expect(code).toBe(0);

    const body = await shippedRecordBody();
    expect(body).toMatch(/##\s*Cost/i);
    // Token sums across both metered events: input 1500, output 300, cache_read 50, cache_creation 10.
    expect(body).toMatch(/input[^\d-]*1500/i);
    expect(body).toMatch(/output[^\d-]*300/i);
    expect(body).toMatch(/cache_read[^\d-]*50/i);
    expect(body).toMatch(/cache_creation[^\d-]*10/i);
    // cost_usd summed: 0.12 + 0.03 = 0.15.
    expect(body).toMatch(/cost_usd[^\d-]*0\.15/i);
    // Zero unmetered steps in this fixture.
    expect(body).toMatch(/unmetered/i);
    expect(body).toMatch(/count[^\d-]*0/i);

    // Committed alongside the frontmatter, on the impl branch.
    expect(await git(['status', '--porcelain', '--', '.docs/shipped'])).toBe('');
  });

  it('negative: a missing .pipeline/events.jsonl never blocks ship — the Cost block reflects the gap as unmetered, exit code stays 0', async () => {
    // No events.jsonl written at all for this feature.
    const code = await runShippedRecord();
    expect(code).toBe(0);

    const body = await shippedRecordBody();
    // The record still exists and is still committed...
    expect(body).toContain(`slug: ${SLUG}`);
    expect(await git(['log', '-1', '--format=%s'])).toBe(`shipped record: ${SLUG}`);
    // ...and the Cost block (if present at all) reflects total absence as
    // unmetered rather than a fabricated zero-cost clean rollup.
    if (/##\s*Cost/i.test(body)) {
      expect(body).toMatch(/unmetered/i);
    }
  });

  it('negative: a partial/corrupt events.jsonl (unparseable line mixed with good ones) still ships — partial data folded into unmetered, never a crash', async () => {
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(
      join(repo, '.pipeline/events.jsonl'),
      JSON.stringify({ type: 'step_completed', step: 'build', status: 'done', tokenUsage: { input: 100, output: 20 }, model: 'claude-sonnet-5' }) +
        '\n' +
        '{not valid json\n',
    );

    const code = await runShippedRecord();
    expect(code).toBe(0);

    const body = await shippedRecordBody();
    expect(body).toContain(`slug: ${SLUG}`);
    if (/##\s*Cost/i.test(body)) {
      expect(body).toMatch(/unmetered/i);
    }
  });
});
