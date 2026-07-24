import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Generated HARNESS.md Model-Selection Table"
// (.docs/stories/generated-model-table.md, TS-2 happy path 3 + negative path 1).
//
// These drive the CLI's PUBLIC in-process entry point (the same one
// `bin/generate-model-table` execs via tsx — see the ADR and plan Task 8:
// "CLI invoked in-process with injected paths"), not the pure
// `renderModelTable`/`spliceGeneratedRegion` helpers in isolation (those are
// unit-covered by Tasks 5-7). The flow genuinely crosses two operations —
// write, then check, against the SAME file — which is what makes this an
// acceptance-level spec rather than a single-operation unit test.
//
// `runGenerateModelTableCli` does not exist yet at RED time, so it is loaded
// dynamically per test (a static top-level import of a missing module would
// error the whole file at collection time, which is not a valid RED).
// ─────────────────────────────────────────────────────────────────────────────

const CLI_MOD = '../../src/tools/generate-model-table.js';
const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

type CliResult = { exitCode: number; diff?: string; message?: string };
type CliOptions = { harnessMdPath: string; mode: 'write' | 'check' | 'pins' };

async function runCli(opts: CliOptions): Promise<CliResult> {
  const mod = (await import(CLI_MOD)) as Record<string, unknown>;
  const fn = mod.runGenerateModelTableCli;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "runGenerateModelTableCli" to be a function (not yet implemented)',
    );
  }
  return (fn as (o: CliOptions) => Promise<CliResult> | CliResult)(opts);
}

const PROSE_BEFORE = '# Harness Behavioral Rules\n\nSome hand-authored prose above the table.\n\n';
const PROSE_AFTER =
  '\n\n> Interim fallback note (#186): survives byte-identical outside the region.\n' +
  '\nTwo enforcement paths: engine defaults and SKILL.md pins.\n';

const MARKED_FIXTURE =
  PROSE_BEFORE +
  '<!-- BEGIN GENERATED: model-selection-table -->\n' +
  '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |\n' +
  '|---|---|---|---|---|---|---|\n' +
  '| stale | autonomous engine | stale | stale | stale | stale | stale row from a previous run |\n' +
  '<!-- END GENERATED: model-selection-table -->\n' +
  PROSE_AFTER;

const NO_MARKER_FIXTURE = PROSE_BEFORE + 'No generated-table markers anywhere in this doc.\n' + PROSE_AFTER;

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('Generator write mode rewrites only the marked region (TS-2)', () => {
  it(
    'happy path: write regenerates the region, then an immediate check is idempotent (exit 0)',
    async () => {
      dir = await mkdtemp(join(tmpdir(), 'generate-model-table-acceptance-'));
      const file = join(dir, 'HARNESS.md');
      await writeFile(file, MARKED_FIXTURE, 'utf8');

      const writeResult = await runCli({ harnessMdPath: file, mode: 'write' });
      expect(writeResult.exitCode).toBe(0);

      const afterWrite = await readFile(file, 'utf8');
      // Table header per the story's happy-path criterion.
      expect(afterWrite).toContain(
        '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |',
      );
      // The stale placeholder row must be gone — real regeneration happened.
      expect(afterWrite).not.toContain('stale row from a previous run');
      // Prose outside the markers is byte-identical.
      expect(afterWrite.startsWith(PROSE_BEFORE)).toBe(true);
      expect(afterWrite.endsWith(PROSE_AFTER)).toBe(true);

      // Second operation in the flow: check must see the just-written file as
      // already up to date (write -> check idempotency).
      const checkResult = await runCli({ harnessMdPath: file, mode: 'check' });
      expect(checkResult.exitCode).toBe(0);

      // Check must never write.
      const afterCheck = await readFile(file, 'utf8');
      expect(afterCheck).toBe(afterWrite);
    },
  );

  it(
    'negative path: missing BEGIN/END markers is a hard error and the file is left untouched',
    async () => {
      dir = await mkdtemp(join(tmpdir(), 'generate-model-table-acceptance-'));
      const file = join(dir, 'HARNESS.md');
      await writeFile(file, NO_MARKER_FIXTURE, 'utf8');
      const before = await readFile(file, 'utf8');

      const writeResult = await runCli({ harnessMdPath: file, mode: 'write' });
      expect(writeResult.exitCode).not.toBe(0);
      // Marker errors use a distinct (non-drift) exit code (C2 / story TS-2 neg path 1).
      expect(writeResult.exitCode).not.toBe(1);

      const after = await readFile(file, 'utf8');
      // Never append, never whole-file regenerate — file is byte-identical.
      expect(after).toBe(before);
    },
  );
});

describe('real binary provider-labelled contract drift', () => {
  it(
    'reports a useful diff for every representative provider-labelled table mutation',
    async () => {
      dir = await mkdtemp(join(tmpdir(), 'generate-model-table-provider-drift-'));
      const fixtureHarness = join(dir, 'HARNESS.md');

      const committed = await readFile(join(harnessRoot, 'HARNESS.md'), 'utf8');
      const lines = committed.split('\n');
      const beginIndex = lines.indexOf('<!-- BEGIN GENERATED: model-selection-table -->');
      const endIndex = lines.indexOf('<!-- END GENERATED: model-selection-table -->');
      const generatedLines =
        beginIndex >= 0 && endIndex > beginIndex ? lines.slice(beginIndex + 1, endIndex) : [];
      const header =
        '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |';
      const cells = (line: string): string[] =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
      const rows = generatedLines.filter(
        (line) =>
          line !== header &&
          !line.startsWith('|---') &&
          line.startsWith('| ') &&
          line.split('|').length === 9,
      );
      const autonomousRows = rows.filter((row) => cells(row)[1] === 'autonomous engine');
      const interactiveRow = rows.find((row) => cells(row)[1] === 'Claude interactive') ?? '';
      const autonomousRowWith = (column: number): string =>
        autonomousRows.find((row) => Boolean(cells(row)[column])) ?? '';
      const changedCellRow = (row: string, column: number, suffix: string): string => {
        if (!row) return '';
        const rowCells = cells(row);
        const value = rowCells[column] ?? '';
        if (!value) return '';
        rowCells[column] = `${value}${suffix}`;
        return `| ${rowCells.join(' | ')} |`;
      };
      const replaceCell = (row: string, column: number, suffix: string): string => {
        const changed = changedCellRow(row, column, suffix);
        return changed ? committed.replace(row, changed) : committed;
      };

      const claudeModelRow = autonomousRowWith(2);
      const claudeEffortRow = autonomousRowWith(3);
      const codexModelRow = autonomousRowWith(4);
      const codexEffortRow = autonomousRowWith(5);
      const tierRow =
        autonomousRows.find((row) =>
          cells(row).slice(2, 6).some((cell) => /\([SML](?:\/[SML])+\)/.test(cell)),
        ) ?? '';
      const tierCellIndex = tierRow
        ? cells(tierRow).findIndex(
            (cell, index) => index >= 2 && index <= 5 && /\([SML](?:\/[SML])+\)/.test(cell),
          )
        : -1;
      const tierCell = tierCellIndex < 0 ? '' : cells(tierRow)[tierCellIndex]!;
      const tierToken = tierCell.match(/\(([SML])(?:\/[SML])+\)/)?.[0] ?? '';
      const narrowedTierToken = tierToken ? `(${tierToken[1]})` : '';
      const completeRow = autonomousRows[0] ?? '';
      const mutations = [
        {
          category: 'provider label',
          document: committed.replace('Claude model', 'Anthropic model'),
          removed: header.replace('Claude model', 'Anthropic model'),
          restored: header,
        },
        {
          category: 'interactive execution/provider label',
          document: replaceCell(interactiveRow, 1, '-drift'),
          removed: changedCellRow(interactiveRow, 1, '-drift'),
          restored: interactiveRow,
        },
        {
          category: 'Claude model',
          document: replaceCell(claudeModelRow, 2, '-drift'),
          removed: changedCellRow(claudeModelRow, 2, '-drift'),
          restored: claudeModelRow,
        },
        {
          category: 'Claude effort',
          document: replaceCell(claudeEffortRow, 3, '-drift'),
          removed: changedCellRow(claudeEffortRow, 3, '-drift'),
          restored: claudeEffortRow,
        },
        {
          category: 'Codex model',
          document: replaceCell(codexModelRow, 4, '-drift'),
          removed: changedCellRow(codexModelRow, 4, '-drift'),
          restored: codexModelRow,
        },
        {
          category: 'Codex effort',
          document: replaceCell(codexEffortRow, 5, '-drift'),
          removed: changedCellRow(codexEffortRow, 5, '-drift'),
          restored: codexEffortRow,
        },
        {
          category: 'tier variant',
          document:
            !tierToken
              ? committed
              : committed.replace(tierRow, tierRow.replace(tierToken, narrowedTierToken)),
          removed:
            !tierToken
              ? ''
              : tierRow.replace(tierToken, narrowedTierToken),
          restored: tierRow,
        },
        {
          category: 'complete row',
          document: completeRow ? committed.replace(`${completeRow}\n`, '') : committed,
          removed: '',
          restored: completeRow,
        },
      ];

      const results = [];
      for (const { category, document, removed, restored } of mutations) {
        await writeFile(fixtureHarness, document, 'utf8');
        const result = spawnSync(
          'bash',
          [join(harnessRoot, 'bin', 'generate-model-table'), '--check'],
          {
            cwd: harnessRoot,
            env: {
              ...process.env,
              GENERATE_MODEL_TABLE_HARNESS_MD: fixtureHarness,
            },
            encoding: 'utf8',
          },
        );
        const output = `${result.stdout}${result.stderr}`;
        results.push({
          category,
          seeded: document !== committed,
          driftExit: result.status === 1,
          unifiedDiff:
            /^--- a\/.*HARNESS\.md$/m.test(output) && /^\+\+\+ b\/.*HARNESS\.md$/m.test(output),
          usefulDatum:
            Boolean(restored) &&
            output.includes(`+${restored}`) &&
            (!removed || output.includes(`-${removed}`)),
        });
      }

      expect(results).toEqual(
        mutations.map(({ category }) => ({
          category,
          seeded: true,
          driftExit: true,
          unifiedDiff: true,
          usefulDatum: true,
        })),
      );
    },
    30_000,
  );
});
