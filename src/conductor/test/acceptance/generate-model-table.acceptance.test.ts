import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  '| Skill/Agent | Model | Effort | Why |\n' +
  '|---|---|---|---|\n' +
  '| stale | stale | stale | stale row from a previous run |\n' +
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
      expect(afterWrite).toContain('| Skill/Agent | Model | Effort | Why |');
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
