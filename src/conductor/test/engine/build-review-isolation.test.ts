import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import type { GitRunner } from '../../src/engine/rebase.js';

// ── Structural input-isolation test (build_review) ───────────────────────
//
// The build_review grader must see ONLY the diff + plan body — never the
// maker's `.pipeline/task-status.json` or any transcript. This is enforced
// two ways:
//   1. Structurally: assembleBuildReviewInputs(git, planPath) and
//      buildGraderPrompt(inputs) have signatures that admit no state/summary
//      parameter at all (a compile-level guarantee — see the type-only
//      assertions below).
//   2. At runtime: seed a fixture repo whose tree contains a maker "summary"
//      sentinel in task-status.json and a transcript-like file, assemble the
//      full grader prompt from it, and assert the sentinel never appears.

const SENTINEL = 'MAKER_SUMMARY_SENTINEL_12345';

const execFileAsync = promisify(execFile);

describe('build_review input isolation', () => {
  let dir: string;
  let planPath: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  function realGit(): GitRunner {
    return async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
        return { exitCode: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      }
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-isolation-'));
    planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Plan body\n\nDo the isolated thing.\n', 'utf-8');

    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    await writeFile(join(dir, 'base.txt'), 'base\n');
    await git('add', '.');
    await git('commit', '-m', 'initial commit on base');
    await git('remote', 'add', 'origin', dir);
    await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

    await git('checkout', '-b', 'feature/foo');

    // Commit an unrelated feature change — this is what should actually
    // appear in the graded diff.
    await writeFile(join(dir, 'feature.txt'), 'feature change\n');
    await git('add', 'feature.txt');
    await git('commit', '-m', 'add feature change');

    // Seed maker-internal-state fixtures (task-status.json + a
    // transcript-like file) on disk in the same working tree, but leave
    // them untracked/uncommitted — exactly like `.pipeline/` in the real
    // repo (see .gitignore), which holds maker state that must never reach
    // the grader. assembleBuildReviewInputs must not read these directly,
    // and they must not show up via `git diff` either, so this proves the
    // full pipeline (diff assembly -> prompt assembly) never surfaces them.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ summary: SENTINEL, status: 'done' }, null, 2),
    );
    await writeFile(
      join(dir, 'transcript.log'),
      `maker session transcript\n${SENTINEL}\nsome narrative about the work\n`,
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('never leaks the maker-summary sentinel into the assembled grader prompt', async () => {
    const inputs = await assembleBuildReviewInputs(realGit(), planPath);
    const prompt = buildGraderPrompt(inputs);

    // Sanity check: the sentinel-bearing files are real, on disk, in the
    // same working tree the diff was computed from — this test would only
    // pass trivially (not meaningfully) if they didn't actually exist.
    expect(inputs.diff).toContain('feature.txt');
    expect(inputs.diff).not.toContain('task-status.json');
    expect(inputs.diff).not.toContain('transcript.log');

    expect(prompt).not.toContain(SENTINEL);
  });

  it('admits only (git, planPath) / (inputs) at the type level — no state parameter exists', () => {
    // Compile-level check: these assignments only type-check if the
    // functions' parameter lists are exactly as narrow as documented. If a
    // future maintainer adds a `state`/`summary` parameter, this file fails
    // to compile (tsc), not just fails at runtime.
    type AssembleParams = Parameters<typeof assembleBuildReviewInputs>;
    type PromptParams = Parameters<typeof buildGraderPrompt>;

    const assembleArity: AssembleParams extends [unknown, unknown] ? true : false = true;
    const promptArity: PromptParams extends [unknown] ? true : false = true;

    expect(assembleArity).toBe(true);
    expect(promptArity).toBe(true);
  });
});
