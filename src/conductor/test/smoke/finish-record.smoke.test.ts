/**
 * Real-binary smoke test for `conduct-ts finish-record` (Task 12,
 * story: "real-binary smoke test",
 * .docs/stories/finish-step-fails-try-1-on-every-daemon-ship-skill.md).
 *
 * Unlike the unit suite (test/engine/finish-record-cli.test.ts), which calls
 * `detectFinishRecordCommand`/`dispatchFinishRecord` in-process, this test
 * spawns the REAL `bin/conduct-ts` entry point as a genuine child process —
 * the same binary the daemon's finish step invokes. A unit test would pass
 * even if src/index.ts's dispatch chain never wired the `finish-record`
 * subcommand in at all; this test would not.
 *
 * Pattern: test/smoke/autoresolve-smoke.test.ts (nested-mkdtemp temp parent,
 * temp absolute pipeline dir, real subprocess).
 *
 *   Case 1: `--choice keep` → exit 0 and the `finish-choice` marker exists
 *           and contains `keep`.
 *   Case 2: `--choice pr` without `--pr-url` → exit != 0, usage printed, and
 *           nothing is written under the pipeline dir.
 *
 * The global vitest setup (test/setup.ts) sets `AI_CONDUCTOR_NO_REAL_EXEC=1`
 * so any accidental real gh/git spawn inside the child process is refused —
 * neither case here reaches that seam (guide path returns before any spawn;
 * `keep` never calls gh/git), so both assert genuine end-to-end behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let scratchParent: string;
let cwd: string;
let pipelineDir: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-smoke-'));
  cwd = await mkdtemp(join(scratchParent, 'repo-'));
  pipelineDir = await mkdtemp(join(scratchParent, 'pipeline-'));
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('smoke/finish-record — real-binary', () => {
  it(
    '--choice keep exits 0 and writes finish-choice=keep',
    async () => {
      const result = await execa(
        REAL_CONDUCT_TS,
        ['finish-record', '--choice', 'keep', '--pipeline-dir', pipelineDir],
        { cwd, reject: false },
      );

      expect(result.exitCode).toBe(0);
      const marker = await readFile(join(pipelineDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('keep');
    },
    30_000,
  );

  it(
    '--choice pr without --pr-url exits non-zero, prints usage, and writes nothing under the pipeline dir',
    async () => {
      const before = await readdir(pipelineDir);
      expect(before).toEqual([]);

      const result = await execa(
        REAL_CONDUCT_TS,
        ['finish-record', '--choice', 'pr', '--pipeline-dir', pipelineDir],
        { cwd, reject: false },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/usage|pr-url|choice/i);
      const after = await readdir(pipelineDir);
      expect(after).toEqual([]);
    },
    30_000,
  );
});
