/**
 * Acceptance specs for .docs/stories/per-feature-token-accounting.md Story 4
 * (#537), governed by .docs/plans/per-feature-token-accounting.md Task 7.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): plan Task 7 both writes a new pure
 * `renderKpi()` function AND registers a new `conduct kpi` subcommand in
 * `src/index.ts`'s dispatch chain. A unit test on `renderKpi()` directly
 * would pass even if the CLI dispatch chain is never wired to call it — the
 * exact "new command function exists, main() never routes to it" class
 * writing-system-tests §3b exists to catch (same convention as
 * `finish-record-real-binary.acceptance.test.ts`). This file spawns the REAL
 * `bin/conduct-ts` binary as a genuine child process against a scratch cwd
 * with real `.docs/shipped/*.md` files on disk — never importing
 * `renderKpi`/`detectKpiCommand`/`dispatchKpi` in-process.
 *
 * PRE-FIX RED: as of this file's authoring, `conduct kpi` is not a
 * recognized subcommand anywhere in `src/index.ts` — the binary falls
 * through to the interactive pipeline launcher instead of printing a KPI
 * report, so every scenario below fails (non-zero/hanging exit or pipeline
 * output, not the expected report).
 *
 * ASSUMPTION FLAGGED (per verify-claims / writing-system-tests correctness
 * gate): neither the story nor the plan pins the Cost block's exact
 * serialization (see the companion Story 3 acceptance spec's flagged
 * assumption), so the `.docs/shipped/*.md` fixtures below are hand-authored
 * using the story's literal field names in a plausible key:value shape.
 * If Task 6 lands a different serialization, this fixture (not the
 * assertions on `conduct kpi`'s own output contract) is what needs updating.
 * Confidence in the fixture shape: ~65% — flagged for operator confirmation
 * once Task 6's actual renderer exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

function costBlock(fields: {
  input: number; output: number; cacheRead: number; cacheCreation: number;
  costUsd: number; dispatches: number; retries: number; halts: number;
  unmeteredCount: number; unmeteredDurationMs: number;
}): string {
  return (
    `## Cost\n` +
    `input: ${fields.input}\n` +
    `output: ${fields.output}\n` +
    `cache_read: ${fields.cacheRead}\n` +
    `cache_creation: ${fields.cacheCreation}\n` +
    `cost_usd: ${fields.costUsd}\n` +
    `dispatches: ${fields.dispatches}\n` +
    `retries: ${fields.retries}\n` +
    `halts: ${fields.halts}\n` +
    `unmetered: { count: ${fields.unmeteredCount}, duration_ms: ${fields.unmeteredDurationMs} }\n`
  );
}

function shippedRecord(slug: string, cost: string): string {
  return (
    `---\n` +
    `slug: ${slug}\n` +
    `spec_hash: deadbeef\n` +
    `pr: https://github.com/acme/repo/pull/1\n` +
    `shipped: 2026-07-01\n` +
    `---\n` +
    cost
  );
}

let scratchParent: string;
let cwd: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'conduct-kpi-real-binary-'));
  cwd = await mkdtemp(join(scratchParent, 'repo-'));
  await mkdir(join(cwd, '.docs/shipped'), { recursive: true });
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('conduct kpi — real-binary acceptance smoke (Story 4, #537)', () => {
  it(
    'prints tokens-per-shipped-feature per feature plus an aggregate, reading only .docs/shipped/*.md',
    async () => {
      await writeFile(
        join(cwd, '.docs/shipped/feat-a.md'),
        shippedRecord(
          'feat-a',
          costBlock({
            input: 1000, output: 200, cacheRead: 0, cacheCreation: 0, costUsd: 0.1,
            dispatches: 3, retries: 0, halts: 0, unmeteredCount: 0, unmeteredDurationMs: 0,
          }),
        ),
      );
      await writeFile(
        join(cwd, '.docs/shipped/feat-b.md'),
        shippedRecord(
          'feat-b',
          costBlock({
            input: 2000, output: 400, cacheRead: 0, cacheCreation: 0, costUsd: 0.2,
            dispatches: 5, retries: 1, halts: 0, unmeteredCount: 0, unmeteredDurationMs: 0,
          }),
        ),
      );

      const result = await execa(REAL_CONDUCT_TS, ['kpi'], { cwd, reject: false });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/feat-a/);
      expect(result.stdout).toMatch(/feat-b/);
      // Aggregate/trend across both features (total tokens 1000+200+2000+400 = 3600).
      expect(result.stdout).toMatch(/3600|aggregate|trend/i);
    },
    30_000,
  );

  it(
    'a feature whose Cost block has unmetered.count > 0 is marked incomplete/partial — never silently folded into a clean average',
    async () => {
      await writeFile(
        join(cwd, '.docs/shipped/feat-partial.md'),
        shippedRecord(
          'feat-partial',
          costBlock({
            input: 500, output: 100, cacheRead: 0, cacheCreation: 0, costUsd: 0.05,
            dispatches: 2, retries: 0, halts: 0, unmeteredCount: 3, unmeteredDurationMs: 45000,
          }),
        ),
      );

      const result = await execa(REAL_CONDUCT_TS, ['kpi'], { cwd, reject: false });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/feat-partial/);
      expect(result.stdout).toMatch(/partial|incomplete/i);
    },
    30_000,
  );
});
