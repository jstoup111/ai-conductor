import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance spec for "Generated hooks/claude/docs-guard.sh + generator"
// (#788, plan Task 10).
//
// Drives the CLI's public in-process entry point (mirroring
// generate-model-table.acceptance.test.ts), the same one
// `bin/generate-docs-guard-hook` execs via tsx. `runGenerateDocsGuardHookCli`
// does not exist yet at RED time, so it is loaded dynamically per test.
// ─────────────────────────────────────────────────────────────────────────────

const CLI_MOD = '../../src/tools/generate-docs-guard-hook.js';

type CliResult = { exitCode: number; diff?: string; message?: string };
type CliOptions = { outPath: string; mode: 'write' | 'check' };

async function runCli(opts: CliOptions): Promise<CliResult> {
  const mod = (await import(CLI_MOD)) as Record<string, unknown>;
  const fn = mod.runGenerateDocsGuardHookCli;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "runGenerateDocsGuardHookCli" to be a function (not yet implemented)',
    );
  }
  return (fn as (o: CliOptions) => Promise<CliResult> | CliResult)(opts);
}

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('Generator writes DOCS_GUARD_HOOK verbatim to a file (#788 Task 10)', () => {
  it('happy path: write emits DOCS_GUARD_HOOK content byte-identical and executable, then check is idempotent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'generate-docs-guard-hook-acceptance-'));
    const file = join(dir, 'docs-guard.sh');

    const { DOCS_GUARD_HOOK } = (await import('../../src/engine/session-hook-assets.js')) as {
      DOCS_GUARD_HOOK: string;
    };
    const expected = DOCS_GUARD_HOOK.endsWith('\n') ? DOCS_GUARD_HOOK : `${DOCS_GUARD_HOOK}\n`;

    const writeResult = await runCli({ outPath: file, mode: 'write' });
    expect(writeResult.exitCode).toBe(0);

    const written = await readFile(file, 'utf8');
    expect(written).toBe(expected);

    const mode = (await stat(file)).mode & 0o777;
    expect(mode & 0o111).not.toBe(0); // executable bits set

    const checkResult = await runCli({ outPath: file, mode: 'check' });
    expect(checkResult.exitCode).toBe(0);
  });

  it('negative path: check reports drift (exit 1) without writing when file content differs', async () => {
    dir = await mkdtemp(join(tmpdir(), 'generate-docs-guard-hook-acceptance-'));
    const file = join(dir, 'docs-guard.sh');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '#!/bin/bash\necho stale\n', { mode: 0o755 });

    const checkResult = await runCli({ outPath: file, mode: 'check' });
    expect(checkResult.exitCode).toBe(1);

    const after = await readFile(file, 'utf8');
    expect(after).toBe('#!/bin/bash\necho stale\n');
  });
});
