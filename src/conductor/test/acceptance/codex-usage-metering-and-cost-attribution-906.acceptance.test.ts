/**
 * Acceptance specs for
 * `.docs/stories/2026-07-27-codex-usage-metering-and-cost-attribution-906.md`
 * (#906, absorbing one #1008 facet), governed by that feature's plan Task 9.
 *
 * WHY ACCEPTANCE-LEVEL (not unit). The defect this feature fixes is not in any
 * single helper — it is in the WIRING between four of them. `parseCodexJsonl`
 * produces tokens with no `costUsd`; `cost-rollup.ts:55` turns that ABSENCE into
 * a `0`; `shipped-record.ts` commits the `0`; `kpi-report.ts` sums the `0` into
 * an aggregate presented as measured. Every one of those helpers can pass its own
 * unit test while the chain still reports a Codex build as "fully metered at
 * $0.00" — which is exactly what `.docs/shipped/2026-07-26-daemon-merged-config-967.md`
 * records on main today (`codex: … cost_usd: 0, dispatches: 48`). This file
 * therefore drives the REAL production entry points across the whole chain:
 *
 *   codex stdout → parseCodexJsonl → .pipeline/events.jsonl
 *     → dispatchShippedRecord (the real `conduct shipped-record` entry point,
 *       against a real temp git repo)
 *     → the COMMITTED .docs/shipped/<slug>.md
 *     → parseCostBlock / renderKpi over real files on disk
 *
 * and asserts on the observable artifacts (the committed record's bytes, the
 * rendered report), never on a new helper's return value in isolation
 * (writing-system-tests §3b/§3d).
 *
 * CALL SITES ENUMERATED (§3d). The metering derivation — "does this dispatch
 * have tokens? does it have cost?" — is currently re-derived at four production
 * sites. Plan Task 4/R3 requires one exported classifier to own the rule:
 *   1. `src/conductor/src/engine/cost-rollup.ts:57` — `addDispatch`'s
 *      `event.unmetered === true || !tokenUsage` (the rollup; covered here).
 *   2. `src/conductor/src/engine/conductor.ts:6072` — `unmetered: stepResult?.tokenUsage ? undefined : true`
 *      (the `step_completed` emitter; its output shape is the ledger fixture below).
 *   3. `src/conductor/src/engine/kpi-report.ts:135` — the single `partial` gate
 *      (covered here via `renderKpi`).
 *   4. `src/conductor/src/engine/cost-rollup.ts:75` — `toFeatureUsageTotals`'s
 *      `dispatches - unmetered.count` (the finish usage-total log line) — see
 *      the FLAGGED ASSUMPTION below; deliberately NOT asserted here.
 *
 * PRE-FIX RED. Against current `main` these fail for missing behavior, not for
 * import/collection errors (every symbol imported below exists today):
 *   - no `cost_unmetered` line is ever written into the `## Cost` block;
 *   - `parseCodexJsonl` reports only the LAST turn, so a 3-turn stream commits
 *     300/30 instead of 600/60;
 *   - `cache_write_input_tokens` / `reasoning_output_tokens` are dropped;
 *   - `parseCostBlock` has no `costUnmetered` field at all;
 *   - `renderKpi` sums a cost-unmetered feature's cost into the aggregate and
 *     prints `total cost_usd=0` for an all-Codex repo as if it were measured;
 *   - `renderKpi` renders none of the six parsed-but-hidden fields and has no
 *     `providers:` parser (#1008);
 *   - `docs/reference/artifacts.md` still carries the "Known limitation" note.
 * Task 1's fixture file does not exist yet, so the Story 7 replay fails with an
 * explicit "fixture not committed" message rather than an opaque ENOENT.
 *
 * FLAGGED ASSUMPTIONS (verify-claims / writing-system-tests correctness gate) —
 * surfaced rather than silently frozen into assertions:
 *   A. RENDERED WORDING (~60%). Neither the stories nor the plan pin the exact
 *      text `conduct kpi` prints for the new states. Every report assertion below
 *      matches on VALUES (the numbers a reader needs) plus a tolerant
 *      marker regex, never on a fixed sentence.
 *   B. `cost_unmetered` SERIALIZATION (~70%). Story 4 pins the field NAME and
 *      that it appears top-level and on affected `providers:` entries, but not
 *      whether it is `cost_unmetered: 3` or `cost_unmetered: count: 3`. Assertions
 *      accept either shape; only the name and value are pinned.
 *   C. PER-PROVIDER `cost_unmetered: 0` (~65%). Story 4 says the field lands on
 *      "each affected `providers:` entry". Whether an unaffected (fully-metered)
 *      provider also gets an explicit `cost_unmetered: 0` is not pinned, so it is
 *      NOT asserted — only that the affected Codex entry carries it.
 *   D. `toFeatureUsageTotals` / the finish usage-total line (call site 4) is NOT
 *      covered here. With `cost-unmetered` introduced, a Codex dispatch still
 *      counts as a METERED dispatch there, so `/finish` will keep printing
 *      "N dispatches, $0.00" for an all-Codex feature — the same $0 fabrication
 *      one layer up. No story or ADR pins that surface, so freezing an expected
 *      behavior into a spec would be a guess. RAISED FOR THE OPERATOR: if that
 *      line should also distinguish cost-unmetered work, it needs a story.
 *   E. Story 6 HP-2's docs assertion pins the REMOVAL of the six-hidden-fields
 *      note and that the other #1008 notes survive (>= 3 remaining references,
 *      per the story's "the other three notes stay"); it does not pin their wording.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCodexJsonl } from '../../src/execution/codex-provider.js';
import {
  detectShippedRecordCommand,
  dispatchShippedRecord,
} from '../../src/engine/shipped-record-cli.js';
import { parseShippedRecord } from '../../src/engine/shipped-record.js';
import { parseCostBlock, renderKpi } from '../../src/engine/kpi-report.js';

const execFile = promisify(execFileCb);

const SLUG = '2026-07-27-codex-usage-metering-and-cost-attribution-906';
const PR = 'https://github.com/jstoup111/ai-conductor/pull/906';
const PLAN = '# Plan\n\n### Task 1\n**Dependencies:** none\n';
const STORIES = '# Stories\n**Status:** Accepted\n';
const REPO_ROOT = join(process.cwd(), '..', '..');

/**
 * The Codex capture the fixture must contain, recorded verbatim in
 * `.docs/architecture/2026-07-27-codex-usage-metering-and-cost-attribution-906.md`
 * decision 5 (codex-cli 0.145.0). Used to assert Task 1's committed fixture is
 * the real stream and not a hand-written stand-in.
 */
const CAPTURED_INPUT_TOKENS = 18057;
const CAPTURED_OUTPUT_TOKENS = 5;
const CODEX_FIXTURE = join(
  process.cwd(),
  'test',
  'fixtures',
  'codex-exec-json-turn-completed.jsonl',
);

/** A `codex exec --json` stream with one `turn.completed` per turn. */
function codexStream(turns: Array<Record<string, unknown>>): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-906' }),
    ...turns.flatMap((usage) => [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage }),
    ]),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'done' },
    }),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Real temp git repo driving the real `conduct shipped-record` entry point.
// ---------------------------------------------------------------------------

let repo: string;

const git = async (args: string[]): Promise<string> => {
  const { stdout } = await execFile('git', args, { cwd: repo });
  return stdout.trim();
};

async function writeEventsLedger(lines: Record<string, unknown>[]): Promise<void> {
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(
    join(repo, '.pipeline/events.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

/** Drives the REAL ship entry point, not `computeCostRollup` directly. */
async function shipRecord(): Promise<number> {
  const cmd = detectShippedRecordCommand([
    'node', 'conduct', 'shipped-record', '--slug', SLUG, '--pr', PR,
  ]);
  if (!cmd || cmd.kind !== 'write') throw new Error('detect failed for valid args');
  return dispatchShippedRecord(cmd, repo);
}

async function committedCostBlock(): Promise<string> {
  const content = await readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8');
  const idx = content.indexOf('## Cost');
  if (idx === -1) throw new Error(`committed record has no "## Cost" block:\n${content}`);
  return content.slice(idx);
}

/** The `  <provider>: …` line inside the block's `providers:` sub-block. */
function providerLine(block: string, provider: string): string {
  const match = new RegExp(`^\\s+${provider}:.*$`, 'm').exec(block);
  if (!match) throw new Error(`no providers: entry for "${provider}" in:\n${block}`);
  return match[0];
}

/** Offset of a top-level `name:` line, for relative-order assertions. */
function lineOffset(block: string, name: string): number {
  const match = new RegExp(`^${name}:`, 'm').exec(block);
  return match ? match.index : -1;
}

/**
 * The KPI report's aggregate line. Cost-total assertions are scoped to it: a
 * PER-FEATURE line may legitimately print a feature's own `cost_usd: 0`, but
 * the aggregate must never present an unmeasured total as a measured zero
 * (Story 5 NP-2).
 */
function aggregateLine(out: string): string {
  const lines = out.split('\n').filter((l) => l.trim().length > 0);
  return lines.find((l) => /aggregate|trend|total/i.test(l)) ?? lines[lines.length - 1] ?? '';
}

describe('acceptance: Codex usage metering and cost attribution (#906)', () => {
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'codex-usage-metering-906-'));
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(repo, 'README.md'), 'seed\n');
    await git(['add', 'README.md']);
    await git(['commit', '-q', '-m', 'seed']);
    await mkdir(join(repo, '.docs/plans'), { recursive: true });
    await mkdir(join(repo, '.docs/stories'), { recursive: true });
    await writeFile(join(repo, `.docs/plans/${SLUG}.md`), PLAN);
    await writeFile(join(repo, `.docs/stories/${SLUG}.md`), STORIES);
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', `merge spec: ${SLUG}`]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  // =========================================================================
  // Story 1 — usage accumulates across every turn of a dispatch.
  // Driven through the real chain (parse → ledger → committed record), not
  // through parseCodexJsonl's return value alone: the undercount only matters
  // because it reaches the committed artifact (§3d).
  // =========================================================================
  describe('Story 1 — Codex usage accumulates across every turn of a dispatch', () => {
    it('HP-1: a three-turn dispatch commits the SUM (600/60), not the final turn (300/30)', async () => {
      const parsed = parseCodexJsonl(
        codexStream([
          { input_tokens: 100, output_tokens: 10 },
          { input_tokens: 200, output_tokens: 20 },
          { input_tokens: 300, output_tokens: 30 },
        ]),
      );

      expect(parsed.tokenUsage).toMatchObject({ input: 600, output: 60 });
      expect(parsed.tokenUsage).toHaveProperty('numTurns', 3);

      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true, tokenUsage: parsed.tokenUsage,
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(/^input: 600$/m);
      expect(block).toMatch(/^output: 60$/m);
    });

    it('HP-2: a single-turn dispatch is unchanged — totals equal that turn', async () => {
      const parsed = parseCodexJsonl(
        codexStream([{ input_tokens: 12, cached_input_tokens: 4, output_tokens: 7 }]),
      );

      expect(parsed.tokenUsage).toMatchObject({ input: 12, output: 7, cacheRead: 4 });

      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true, tokenUsage: parsed.tokenUsage,
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(/^input: 12$/m);
      expect(block).toMatch(/^output: 7$/m);
      expect(block).toMatch(/^cache_read: 4$/m);
    });

    it('NP-1: a malformed turn contributes nothing and never lets NaN reach TokenUsage', async () => {
      const parsed = parseCodexJsonl(
        codexStream([
          { input_tokens: 100, output_tokens: 10 },
          { input_tokens: 'not-a-number', output_tokens: 20 },
          { input_tokens: 300, output_tokens: 30 },
        ]),
      );

      expect(parsed.tokenUsage).toMatchObject({ input: 400, output: 40 });
      expect(Number.isNaN(parsed.tokenUsage?.input)).toBe(false);
      expect(Number.isNaN(parsed.tokenUsage?.output)).toBe(false);

      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true, tokenUsage: parsed.tokenUsage,
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).not.toMatch(/NaN/);
      expect(block).toMatch(/^input: 400$/m);
    });
  });

  // =========================================================================
  // Story 2 — cache-creation and reasoning token classes are captured.
  // =========================================================================
  describe('Story 2 — Codex cache-creation and reasoning tokens are captured', () => {
    it('HP-1: cache_write_input_tokens and reasoning_output_tokens are mapped and reach the record', async () => {
      const parsed = parseCodexJsonl(
        codexStream([
          {
            input_tokens: 1000,
            cached_input_tokens: 250,
            cache_write_input_tokens: 77,
            output_tokens: 40,
            reasoning_output_tokens: 15,
          },
        ]),
      );

      expect(parsed.tokenUsage).toMatchObject({ input: 1000, output: 40, cacheRead: 250 });
      expect(parsed.tokenUsage).toHaveProperty('cacheCreation', 77);
      expect(parsed.tokenUsage).toHaveProperty('reasoningOutput', 15);

      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true, tokenUsage: parsed.tokenUsage,
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(/^cache_creation: 77$/m);
      expect(block).toMatch(/^cache_read: 250$/m);
    });

    it('NP-1: an omitted cache_write_input_tokens stays ABSENT, not 0 — "not reported" ≠ "reported as none"', () => {
      const parsed = parseCodexJsonl(
        codexStream([
          { input_tokens: 1000, cached_input_tokens: 250, output_tokens: 40 },
        ]),
      );

      expect(parsed.tokenUsage).toBeDefined();
      expect(parsed.tokenUsage).not.toHaveProperty('cacheCreation');
      expect(Object.prototype.hasOwnProperty.call(parsed.tokenUsage ?? {}, 'cacheCreation')).toBe(false);
    });
  });

  // =========================================================================
  // Story 3 — a dispatch with tokens but no cost is cost-unmetered.
  // Driven through the committed record, which is where the $0 fabrication is
  // observable today (`codex: … cost_usd: 0` on main).
  // =========================================================================
  describe('Story 3 — a dispatch with tokens but no cost is classified cost-unmetered', () => {
    async function shipMixedFeature(): Promise<string> {
      await writeEventsLedger([
        // Claude: tokens AND cost → fully-metered.
        {
          type: 'provider_attempt', step: 'plan', provider: 'claude',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 100, output: 20, cacheRead: 10, cacheCreation: 2, costUsd: 0.05 },
        },
        {
          type: 'step_completed', step: 'plan', status: 'done',
          actualProvider: 'claude',
          tokenUsage: { input: 100, output: 20, cacheRead: 10, cacheCreation: 2, costUsd: 0.05 },
        },
        // Codex: tokens, NO costUsd → cost-unmetered.
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 600, output: 60, cacheRead: 5, cacheCreation: 7 },
        },
        {
          type: 'step_completed', step: 'build', status: 'done',
          actualProvider: 'codex',
          tokenUsage: { input: 600, output: 60, cacheRead: 5, cacheCreation: 7 },
        },
        // A non-LLM step: no usage at all → plain unmetered (today's meaning).
        { type: 'step_completed', step: 'worktree', status: 'done' },
      ]);
      expect(await shipRecord()).toBe(0);
      return committedCostBlock();
    }

    it('HP-1: Codex tokens are added while its cost adds NOTHING, and cost_unmetered is counted', async () => {
      const block = await shipMixedFeature();

      // Tokens include Codex.
      expect(block).toMatch(/^input: 700$/m);
      expect(block).toMatch(/^output: 80$/m);
      expect(block).toMatch(/^cache_read: 15$/m);
      expect(block).toMatch(/^cache_creation: 9$/m);
      // Cost includes ONLY Claude — Codex contributed no cost, not a zero cost.
      expect(block).toMatch(/^cost_usd: 0\.05$/m);
      // The Codex dispatch is counted as cost-unmetered.
      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?1\b/m);
    });

    it('HP-2: Claude is unchanged — fully metered, and neither unmetered counter moves for it', async () => {
      const block = await shipMixedFeature();
      const claude = providerLine(block, 'claude');

      expect(claude).toMatch(/cost_usd: 0\.05\b/);
      expect(claude).toMatch(/input: 100\b/);
      expect(claude).toMatch(/output: 20\b/);
      // The Claude dispatch contributes to neither unmetered class.
      expect(claude).not.toMatch(/cost_unmetered:\s*(?:count:\s*)?[1-9]/);
      expect(claude).not.toMatch(/\bunmetered:\s*(?:count:\s*)?[1-9]/);
    });

    it('HP-1 (attribution): the Codex providers: entry carries cost_unmetered and no fabricated cost', async () => {
      const block = await shipMixedFeature();
      const codex = providerLine(block, 'codex');

      expect(codex).toMatch(/input: 600\b/);
      expect(codex).toMatch(/output: 60\b/);
      expect(codex).toMatch(/cost_unmetered:\s*(?:count:\s*)?1\b/);
    });

    it('NP-1: a step with no tokenUsage keeps today\'s meaning — unmetered, NOT cost_unmetered', async () => {
      await writeEventsLedger([
        // Only the non-LLM step: no usage at all.
        { type: 'step_completed', step: 'worktree', status: 'done' },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(/^unmetered: count: 1, duration_ms: 0$/m);
      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?0\b/m);
    });

    it('NP-2: an explicit costUsd of 0 is a MEASURED zero — fully metered, not cost-unmetered', async () => {
      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'plan', provider: 'claude',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 10, output: 2, costUsd: 0 },
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(/^cost_usd: 0$/m);
      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?0\b/m);
      expect(block).toMatch(/^unmetered: count: 0, duration_ms: 0$/m);
    });
  });

  // =========================================================================
  // Story 4 — the committed `## Cost` block grows ADDITIVELY.
  // =========================================================================
  describe('Story 4 — the committed ## Cost block records cost-unmetered, additively', () => {
    async function shipSimpleFeature(): Promise<string> {
      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'plan', provider: 'claude',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 100, output: 20, cacheRead: 10, cacheCreation: 2, costUsd: 0.05 },
        },
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 600, output: 60, cacheRead: 5, cacheCreation: 7 },
        },
        { type: 'step_retry', step: 'build' },
      ]);
      expect(await shipRecord()).toBe(0);
      return committedCostBlock();
    }

    it('HP-1: every pre-existing line keeps its exact name, format, and relative order', async () => {
      const block = await shipSimpleFeature();

      // Format preserved, line by line.
      expect(block).toMatch(/^input: 700$/m);
      expect(block).toMatch(/^output: 80$/m);
      expect(block).toMatch(/^cache_read: 15$/m);
      expect(block).toMatch(/^cache_creation: 9$/m);
      expect(block).toMatch(/^cost_usd: 0\.05$/m);
      expect(block).toMatch(/^dispatches: 2$/m);
      expect(block).toMatch(/^retries: 1$/m);
      expect(block).toMatch(/^halts: 0$/m);
      expect(block).toMatch(/^unmetered: count: 0, duration_ms: 0$/m);
      expect(block).toMatch(/^providers:$/m);

      // Relative order preserved (a new line may be inserted, but these keep
      // their sequence relative to one another).
      const order = [
        'input', 'output', 'cache_read', 'cache_creation',
        'cost_usd', 'dispatches', 'retries', 'halts', 'unmetered',
      ].map((name) => lineOffset(block, name));
      expect(order).not.toContain(-1);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('HP-1: cost_unmetered appears top-level AND on the affected providers: entry', async () => {
      const block = await shipSimpleFeature();

      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?1\b/m);
      expect(providerLine(block, 'codex')).toMatch(/cost_unmetered:\s*(?:count:\s*)?1\b/);
    });

    it('NP-1: a Cost block already committed on main (no cost_unmetered) still parses, defaulting to 0', () => {
      // Copied verbatim from .docs/shipped/2026-07-26-daemon-merged-config-967.md,
      // a record on main today. Note its `codex: … cost_usd: 0` — the exact
      // fabricated zero this feature exists to stop writing.
      const legacy = [
        '## Cost',
        'input: 37543054',
        'output: 385955',
        'cache_read: 57963852',
        'cache_creation: 1254825',
        'cost_usd: 54.1608',
        'dispatches: 97',
        'retries: 14',
        'halts: 0',
        'unmetered: count: 52, duration_ms: 0',
        'providers:',
        '  claude: input: 538, output: 232427, cache_read: 22903372, cache_creation: 1254825, cost_usd: 54.1608, dispatches: 33',
        '  codex: input: 37542516, output: 153528, cache_read: 35060480, cache_creation: 0, cost_usd: 0, dispatches: 48',
        '',
      ].join('\n');

      const parsed = parseCostBlock(legacy);

      expect(parsed).not.toBeNull();
      expect(parsed).toMatchObject({
        input: 37543054,
        output: 385955,
        cacheRead: 57963852,
        cacheCreation: 1254825,
        costUsd: 54.1608,
        dispatches: 97,
        retries: 14,
        halts: 0,
        unmeteredCount: 52,
        unmeteredDurationMs: 0,
      });
      expect(parsed).toHaveProperty('costUnmetered', 0);
    });

    it('NP-1 (boundary): cost_unmetered and unmetered are read as DISTINCT fields, in either order', () => {
      // Adversarial ordering: `cost_unmetered` placed BEFORE `unmetered`. The
      // existing unmetered regex is unanchored, so the substring "unmetered:"
      // inside "cost_unmetered:" is a live shadowing hazard.
      const block = [
        '## Cost',
        'input: 10',
        'output: 2',
        'cost_usd: 0',
        'cost_unmetered: count: 3',
        'unmetered: count: 7, duration_ms: 4200',
        '',
      ].join('\n');

      const parsed = parseCostBlock(block);

      expect(parsed).toMatchObject({ unmeteredCount: 7, unmeteredDurationMs: 4200 });
      expect(parsed).toHaveProperty('costUnmetered', 3);
    });

    it('NP-1 (boundary): an indented providers: cost_unmetered never shadows the top-level field', () => {
      const block = [
        '## Cost',
        'input: 10',
        'output: 2',
        'cost_usd: 0.5',
        'cost_unmetered: count: 0',
        'unmetered: count: 0, duration_ms: 0',
        'providers:',
        '  codex: input: 5, output: 1, cache_read: 0, cache_creation: 0, cost_usd: 0, cost_unmetered: 9, dispatches: 4',
        '',
      ].join('\n');

      const parsed = parseCostBlock(block);

      expect(parsed).toHaveProperty('costUnmetered', 0);
      expect(parsed).toMatchObject({ input: 10, output: 2, costUsd: 0.5 });
    });

    it('NP-2: render → parse → render is stable — deterministic bytes and lossless field fidelity', async () => {
      const first = await committedCostBlockAfterShip();
      const parsedFirst = parseCostBlock(first);

      // Re-shipping the identical ledger reproduces byte-identical output.
      const second = await committedCostBlockAfterShip();
      expect(second).toBe(first);

      // And parsing back loses nothing: every field the reader exposes matches
      // what the writer wrote.
      expect(parseCostBlock(second)).toEqual(parsedFirst);

      async function committedCostBlockAfterShip(): Promise<string> {
        await writeEventsLedger([
          {
            type: 'provider_attempt', step: 'plan', provider: 'claude',
            outcome: 'success', invoked: true,
            tokenUsage: { input: 100, output: 20, cacheRead: 10, cacheCreation: 2, costUsd: 0.05 },
          },
          {
            type: 'provider_attempt', step: 'build', provider: 'codex',
            outcome: 'success', invoked: true,
            tokenUsage: { input: 600, output: 60, cacheRead: 5, cacheCreation: 7 },
          },
        ]);
        expect(await shipRecord()).toBe(0);
        return committedCostBlock();
      }
    });

    it('NP-3: frontmatter parsing (discovery dedup) is unaffected by the new block content', async () => {
      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true,
          tokenUsage: { input: 600, output: 60 },
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const content = await readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8');
      const parsed = parseShippedRecord(content);

      expect(parsed).not.toHaveProperty('malformed');
      expect(parsed).toMatchObject({ slug: SLUG, pr: PR });
      // The new field lives after the closing frontmatter fence, as before.
      expect(content.indexOf('cost_unmetered')).toBeGreaterThan(content.indexOf('## Cost'));
    });
  });

  // =========================================================================
  // Story 5 / Story 6 — `conduct kpi` over real committed records.
  //
  // Driven through `renderKpi(root)` against real `.docs/shipped/*.md` files on
  // disk (loadFeatures → parseCostBlock → render). The CLI dispatch wiring for
  // `conduct kpi` is already covered by `conduct-kpi-real-binary.acceptance.test.ts`
  // (§2 overlap). That binary runs the prebuilt `dist/`, and `ensureEngineDist`
  // (test/engine-dist-guard.ts) rebuilds it only when it does not RESOLVE — never
  // when it is merely stale — so re-driving the binary here would assert this
  // feature's new behavior against pre-change bytes on any warm checkout.
  // =========================================================================
  describe('Story 5 / 6 — conduct kpi splits cost from tokens and renders attribution', () => {
    let root: string;

    const record = (slug: string, cost: string): string =>
      `---\nslug: ${slug}\nspec_hash: deadbeef\npr: ${PR}\nshipped: 2026-07-27\n---\n\n${cost}`;

    const writeRecord = async (slug: string, cost: string): Promise<void> => {
      await writeFile(join(root, '.docs/shipped', `${slug}.md`), record(slug, cost));
    };

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'codex-usage-metering-906-kpi-'));
      await mkdir(join(root, '.docs/shipped'), { recursive: true });
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('Story 5 HP-1: a cost-unmetered feature keeps its tokens in the aggregate but not its cost', async () => {
      await writeRecord('feat-mixed', [
        '## Cost',
        'input: 1000',
        'output: 200',
        'cache_read: 0',
        'cache_creation: 0',
        'cost_usd: 0.25',
        'dispatches: 4',
        'retries: 0',
        'halts: 0',
        'cost_unmetered: count: 3',
        'unmetered: count: 0, duration_ms: 0',
        '',
      ].join('\n'));
      await writeRecord('feat-clean', [
        '## Cost',
        'input: 500',
        'output: 100',
        'cache_read: 0',
        'cache_creation: 0',
        'cost_usd: 0.75',
        'dispatches: 2',
        'retries: 0',
        'halts: 0',
        'cost_unmetered: count: 0',
        'unmetered: count: 0, duration_ms: 0',
        '',
      ].join('\n'));

      const out = await renderKpi(root);

      // Tokens from BOTH features are aggregated: 1000+200+500+100 = 1800.
      expect(aggregateLine(out)).toMatch(/1800/);
      // Cost excludes the cost-unmetered feature: 0.75 only, never 1 (0.25+0.75).
      expect(aggregateLine(out)).toMatch(/0\.75\b/);
      expect(aggregateLine(out)).not.toMatch(/cost_usd=1\b/);
      // The feature's own line says cost is unavailable, not zero.
      const line = out.split('\n').find((l) => l.includes('feat-mixed')) ?? '';
      expect(line).toMatch(/cost[- _]?(?:partial|unmetered|unavailable)/i);
    });

    it('Story 5 NP-1: a truly unmetered feature is still excluded from BOTH aggregates', async () => {
      await writeRecord('feat-unmetered', [
        '## Cost',
        'input: 9000',
        'output: 900',
        'cost_usd: 3.5',
        'dispatches: 5',
        'retries: 0',
        'halts: 0',
        'cost_unmetered: count: 0',
        'unmetered: count: 1, duration_ms: 1200',
        '',
      ].join('\n'));
      await writeRecord('feat-clean', [
        '## Cost',
        'input: 500',
        'output: 100',
        'cost_usd: 0.75',
        'dispatches: 2',
        'retries: 0',
        'halts: 0',
        'cost_unmetered: count: 0',
        'unmetered: count: 0, duration_ms: 0',
        '',
      ].join('\n'));

      const out = await renderKpi(root);

      // Only feat-clean's 600 tokens and 0.75 cost are aggregated.
      expect(aggregateLine(out)).toMatch(/\b600\b/);
      expect(aggregateLine(out)).toMatch(/0\.75\b/);
      expect(aggregateLine(out)).not.toMatch(/\b10500\b/);
    });

    it('Story 5 NP-2: with every feature cost-unmetered the token aggregate is non-zero and cost reads unavailable, never a measured 0', async () => {
      for (const slug of ['feat-codex-a', 'feat-codex-b']) {
        await writeRecord(slug, [
          '## Cost',
          'input: 4000',
          'output: 400',
          'cost_usd: 0',
          'dispatches: 6',
          'retries: 0',
          'halts: 0',
          'cost_unmetered: count: 6',
          'unmetered: count: 0, duration_ms: 0',
          '',
        ].join('\n'));
      }

      const out = await renderKpi(root);

      // 4000+400 twice = 8800 tokens still reported.
      expect(aggregateLine(out)).toMatch(/8800/);
      // The cost total must not be presented as a measured zero.
      expect(aggregateLine(out)).not.toMatch(/cost_usd=0\b/);
      expect(aggregateLine(out)).toMatch(/unavailable|unmetered|not measured|n\/a/i);
    });

    it('Story 6 HP-1: each provider\'s tokens, cost, cost-unmetered count and dispatches render by name', async () => {
      await writeRecord('feat-attributed', [
        '## Cost',
        'input: 1100',
        'output: 220',
        'cache_read: 0',
        'cache_creation: 0',
        'cost_usd: 0.05',
        'dispatches: 5',
        'retries: 0',
        'halts: 0',
        'cost_unmetered: count: 2',
        'unmetered: count: 0, duration_ms: 0',
        'providers:',
        '  claude: input: 100, output: 20, cache_read: 0, cache_creation: 0, cost_usd: 0.05, cost_unmetered: 0, dispatches: 3',
        '  codex: input: 1000, output: 200, cache_read: 0, cache_creation: 0, cost_usd: 0, cost_unmetered: 2, dispatches: 2',
        '',
      ].join('\n'));

      const out = await renderKpi(root);

      const claudeLine = out.split('\n').find((l) => /claude/i.test(l)) ?? '';
      expect(claudeLine).toMatch(/\b100\b/);
      expect(claudeLine).toMatch(/\b20\b/);
      expect(claudeLine).toMatch(/0\.05/);
      expect(claudeLine).toMatch(/\b3\b/);

      const codexLine = out.split('\n').find((l) => /codex/i.test(l)) ?? '';
      expect(codexLine).toMatch(/\b1000\b/);
      expect(codexLine).toMatch(/\b200\b/);
      expect(codexLine).toMatch(/\b2\b/);
    });

    it('Story 6 HP-2: the six previously-hidden fields all render', async () => {
      await writeRecord('feat-full', [
        '## Cost',
        'input: 1000',
        'output: 200',
        'cache_read: 111111',
        'cache_creation: 222222',
        'cost_usd: 0.05',
        'dispatches: 33',
        'retries: 44',
        'halts: 55',
        'cost_unmetered: count: 0',
        'unmetered: count: 0, duration_ms: 66000',
        '',
      ].join('\n'));

      const out = await renderKpi(root);

      for (const value of ['111111', '222222', '33', '44', '55', '66000']) {
        expect(out).toMatch(new RegExp(`\\b${value}\\b`));
      }
    });

    it('Story 6 HP-2: documentation names halt consumers without promising --report halt or kickback tables', async () => {
      const artifacts = await readFile(join(REPO_ROOT, 'docs/reference/artifacts.md'), 'utf-8');
      const stalledRunbook = await readFile(join(REPO_ROOT, 'docs/runbooks/stalled-or-stuck-feature.md'), 'utf-8');

      // Tested as booleans, not whole-file regex matches, so a failure prints
      // the claim rather than the entire document.
      expect(/Six of the ten parsed fields/.test(artifacts)).toBe(false);
      expect(/per-provider cost sub-block written into every shipped record has no parser/.test(artifacts)).toBe(false);
      // Two unrelated #1008 notes remain. The former third note was corrected when
      // halt events became persisted, so it no longer truthfully tracks #1008.
      expect(artifacts.match(/issues\/1008/g)?.length ?? 0).toBe(2);

      for (const consumer of [
        'cost-rollup.halts',
        "shipped records' `## Cost` blocks",
        '`conduct-ts kpi`',
        'engineer-loop signal assembler',
      ]) {
        expect(artifacts).toContain(consumer);
      }
      expect(artifacts).toContain('renders neither halt nor kickback tables');
      expect(stalledRunbook).toContain('renders neither halt nor kickback tables');
      expect(artifacts).not.toMatch(/`aggregateHalts` always returns/);
      expect(artifacts).not.toMatch(/kickback table do reflect real/);
    });

    it('Story 6 NP-1: an older record with no providers: sub-block renders top-level totals without error', async () => {
      await writeRecord('feat-legacy', [
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
        '',
      ].join('\n'));

      const out = await renderKpi(root);

      expect(out).toMatch(/feat-legacy/);
      expect(out).toMatch(/\b700\b/);
      expect(out).toMatch(/\b80\b/);
      // No per-provider section is invented for a record that has none.
      expect(out).not.toMatch(/^\s+(?:claude|codex):/m);
    });
  });

  // =========================================================================
  // Story 7 — the parser is pinned against a REAL captured Codex stream.
  // =========================================================================
  describe('Story 7 — the parser is pinned against a real captured Codex stream', () => {
    it('HP-1: the committed real capture replays through parseCodexJsonl and reaches the record', async () => {
      let fixture: string;
      try {
        fixture = await readFile(CODEX_FIXTURE, 'utf-8');
      } catch {
        throw new Error(
          `Story 7 requires a REAL captured codex exec --json transcript committed at ` +
          `${CODEX_FIXTURE} (see the feature's architecture doc, decision 5 — captured ` +
          `against codex-cli 0.145.0). It is not present.`,
        );
      }

      // The capture is real, not hand-authored: it carries the CLI's own event
      // vocabulary and the two token classes the old parser dropped.
      expect(fixture).toMatch(/"type"\s*:\s*"turn\.completed"/);
      expect(fixture).toMatch(/cache_write_input_tokens/);
      expect(fixture).toMatch(/reasoning_output_tokens/);
      // And it records which CLI version it came from, so drift is detectable.
      expect(fixture).toMatch(/0\.145\.0/);

      const parsed = parseCodexJsonl(fixture);
      expect(parsed.tokenUsage).toMatchObject({
        input: CAPTURED_INPUT_TOKENS,
        output: CAPTURED_OUTPUT_TOKENS,
      });
      expect(parsed.tokenUsage).not.toHaveProperty('costUsd');

      await writeEventsLedger([
        {
          type: 'provider_attempt', step: 'build', provider: 'codex',
          outcome: 'success', invoked: true, tokenUsage: parsed.tokenUsage,
        },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      expect(block).toMatch(new RegExp(`^input: ${CAPTURED_INPUT_TOKENS}$`, 'm'));
      expect(block).toMatch(new RegExp(`^output: ${CAPTURED_OUTPUT_TOKENS}$`, 'm'));
      expect(block).toMatch(/^cost_usd: 0$/m);
      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?1\b/m);
    });

    it('NP-1: an unrecognized usage shape degrades to unmetered — never 0 tokens or 0 cost presented as measured', async () => {
      const parsed = parseCodexJsonl(
        codexStream([{ prompt_tokens: 4321, completion_tokens: 99 }]),
      );

      // Absent, not a fabricated zero.
      expect(parsed.tokenUsage).toBeUndefined();

      await writeEventsLedger([
        // This is the shape conductor.ts:6072 emits when tokenUsage is absent.
        { type: 'step_completed', step: 'build', status: 'done', actualProvider: 'codex', unmetered: true },
      ]);
      expect(await shipRecord()).toBe(0);

      const block = await committedCostBlock();
      // The one dispatch is wholly unmetered — the old state, not the new one.
      expect(block).toMatch(/^dispatches: 1$/m);
      expect(block).toMatch(/^unmetered: count: 1, duration_ms: 0$/m);
      expect(block).toMatch(/^cost_unmetered:\s*(?:count:\s*)?0\b/m);
    });
  });

  // =========================================================================
  // Story 8 — documentation matches what the code writes.
  // =========================================================================
  describe('Story 8 — documentation reflects the new metering states', () => {
    it('HP-1: artifacts.md documents cost_unmetered and cli.md\'s kpi entry reflects the new output', async () => {
      const artifacts = await readFile(join(REPO_ROOT, 'docs/reference/artifacts.md'), 'utf-8');
      const cli = await readFile(join(REPO_ROOT, 'docs/reference/cli.md'), 'utf-8');

      // Booleans rather than whole-file regex matches, so a failure prints the
      // claim instead of the entire document.
      expect(/cost_unmetered/.test(artifacts)).toBe(true);
      expect(/cost[- _]?unmetered/i.test(cli)).toBe(true);
      // The kpi entry exists and names per-provider attribution now that it renders it.
      expect(/kpi/.test(cli)).toBe(true);
    });
  });
});
