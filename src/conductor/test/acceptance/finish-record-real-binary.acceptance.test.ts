import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// Real-binary acceptance smoke for `conduct-ts finish-record`
// (.docs/stories/finish-step-fails-try-1-on-every-daemon-ship-skill.md,
// story "real-binary smoke test", D2/D3).
//
// Drives the REAL production entry point — bin/conduct-ts spawned as a genuine
// child process, resolving the real `dist` symlink exactly as the daemon's
// finish step invokes it — NOT the finish-record-cli.ts unit under test
// directly. This is the multi-step flow the story cares about: argv detection
// -> guard/verification chain -> ordered marker writes, observed end-to-end
// through the real binary and the real filesystem. Per §3b of
// writing-system-tests, a unit test that calls detectFinishRecordCommand /
// dispatchFinishRecord in-process would pass even if src/index.ts's dispatch
// chain never wires the subcommand in — this test fails in that scenario.
//
// cwd is an isolated scratch directory (nested mkdtemp parent, per the
// rekick-flake lesson) so a still-unwired `finish-record` falling through to
// the pipeline launcher cannot touch the real repo.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let scratchParent: string;
let cwd: string;
let pipelineDir: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-real-binary-'));
  cwd = await mkdtemp(join(scratchParent, 'repo-'));
  pipelineDir = await mkdtemp(join(scratchParent, 'pipeline-'));
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('conduct-ts finish-record — real-binary acceptance smoke', () => {
  it(
    '--choice keep exits 0 and writes finish-choice=keep with zero gh/git spawns',
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
