import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// Real-binary acceptance smoke for `conduct-ts manual-test-record`
// (Task 6: wire manual-test-record into the real CLI dispatch).
//
// Drives the REAL production entry point — bin/conduct-ts spawned as a
// genuine child process — NOT manual-test-record-cli.ts's
// detectManualTestRecordCommand/dispatchManualTestRecord in-process. Per §3b
// of writing-system-tests, a unit test calling those functions directly
// would pass even if src/index.ts's dispatch chain never wires the
// `manual-test-record` subcommand in at all; this test would not.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let scratchParent: string;
let cwd: string;
let pipelineDir: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'manual-test-record-real-binary-'));
  cwd = await mkdtemp(join(scratchParent, 'repo-'));
  pipelineDir = join(cwd, '.pipeline');
  await execa('git', ['init', '-b', 'main'], { cwd });
  await mkdir(pipelineDir);
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('conduct-ts manual-test-record — real-binary acceptance smoke', () => {
  // Covers: task:1
  it('--results - from the git root derives its pipeline directory and records the piped table', async () => {
    const table = '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n';
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--results', '-'], {
      cwd,
      input: table,
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    const contents = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
    expect(contents).toContain('## Attempt 1');
    expect(contents).toContain('| S1 | PASS |');
  }, 30_000);

  // Covers: task:1
  it('--skip --reason <r> from the git root derives its pipeline directory', async () => {
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--skip', '--reason', 'no ui yet'], {
      cwd,
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    const contents = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
    expect(contents).toMatch(/SKIPPED — no ui yet/);
  }, 30_000);

  // Covers: task:1
  it('--results - from a nested directory records in the git-root pipeline directory', async () => {
    const nestedCwd = join(cwd, 'sub', 'dir');
    await mkdir(nestedCwd, { recursive: true });
    const table = '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n';
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--results', '-'], {
      cwd: nestedCwd,
      input: table,
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8')).resolves.toContain('| S1 | PASS |');
    await expect(readFile(join(nestedCwd, '.pipeline', 'manual-test-results.md'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);

  // Covers: task:1
  it('an explicit absolute --pipeline-dir works from an unrelated directory', async () => {
    const unrelatedCwd = await mkdtemp(join(scratchParent, 'unrelated-'));
    const result = await execa(
      REAL_CONDUCT_TS,
      ['manual-test-record', '--skip', '--reason', 'override', '--pipeline-dir', pipelineDir],
      { cwd: unrelatedCwd, reject: false },
    );

    expect(result.exitCode).toBe(0);
    const contents = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
    expect(contents).toMatch(/SKIPPED — override/);
  }, 30_000);

  // Covers: task:2
  it('without --pipeline-dir outside a git work tree refuses with the override and leaves the directory unchanged', async () => {
    const unrelatedCwd = await mkdtemp(join(scratchParent, 'unrelated-'));
    const before = await readdir(unrelatedCwd);
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--results', '-'], {
      cwd: unrelatedCwd,
      input: '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n',
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('could not determine the pipeline directory');
    expect(result.stderr).toContain('--pipeline-dir');
    expect(await readdir(unrelatedCwd)).toEqual(before);
  }, 30_000);

  // Covers: task:2
  it('without --pipeline-dir refuses when the git toplevel has no pipeline directory and creates nothing', async () => {
    await rm(pipelineDir, { recursive: true, force: true });
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--results', '-'], {
      cwd,
      input: '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n',
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${cwd}/.pipeline`);
    await expect(readdir(cwd)).resolves.not.toContain('.pipeline');
    await expect(readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);

  // Covers: task:2
  it('a relative --pipeline-dir is refused with usage text and writes no results file', async () => {
    const result = await execa(
      REAL_CONDUCT_TS,
      ['manual-test-record', '--skip', '--reason', 'relative override', '--pipeline-dir', 'relative/dir'],
      { cwd, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/usage|pipeline-dir/i);
    await expect(readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);

  it('--skip --reason <r> exits 0 and appends a SKIPPED attempt section to manual-test-results.md', async () => {
    const result = await execa(
      REAL_CONDUCT_TS,
      ['manual-test-record', '--skip', '--reason', 'no ui yet', '--pipeline-dir', pipelineDir],
      { cwd, reject: false },
    );

    expect(result.exitCode).toBe(0);
    const contents = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
    expect(contents).toMatch(/SKIPPED — no ui yet/);
  }, 30_000);

  it('--skip without --reason exits non-zero and prints usage', async () => {
    const result = await execa(REAL_CONDUCT_TS, ['manual-test-record', '--skip', '--pipeline-dir', pipelineDir], {
      cwd,
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/usage|reason|pipeline-dir/i);
  }, 30_000);
});
