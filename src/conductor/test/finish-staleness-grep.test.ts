/**
 * Regression test for jstoup111/ai-conductor#587 — the finish/pr skills'
 * fallback staleness-proof grep (`git reflog | grep "rebase: finish"`) never
 * matched real git output, because git actually writes the reflog entry as
 * `rebase (finish): returning to refs/heads/<branch>` (parenthesized, no
 * colon after "rebase").
 *
 * This test does not exercise any TypeScript module — the check itself lives
 * in prose (`skills/finish/SKILL.md`, `skills/pr/SKILL.md`). To keep the
 * regression coupled to the ACTUAL files (not a hardcoded copy of the
 * intended fix, which would pass even if a future edit reintroduced the wrong
 * literal), this test:
 *
 *   1. Runs a real `git rebase` in a scratch repo so git itself writes the
 *      `rebase (finish):` reflog entry (mirrors the manual reproduction
 *      performed while diagnosing #587).
 *   2. Extracts the fallback grep pattern directly out of both SKILL.md
 *      files' `git reflog | grep -E "..."` code fences.
 *   3. Asserts the extracted pattern matches the real reflog output, the old
 *      wrong literal ("rebase: finish") does not appear in real git output,
 *      and the corrected pattern does not over-match an unrelated line that
 *      merely contains the bare word "finish".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ -> conductor/ -> src/ -> repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const FINISH_SKILL_PATH = join(REPO_ROOT, 'skills/finish/SKILL.md');
const PR_SKILL_PATH = join(REPO_ROOT, 'skills/pr/SKILL.md');

const OLD_WRONG_LITERAL = 'rebase: finish';

/**
 * Extracts the `grep -E "..."` pattern from a SKILL.md's
 * `git reflog | grep -E "<pattern>"` fallback staleness-proof code fence.
 * Returns the raw pattern string (e.g. `rebase \(finish\)`), suitable for
 * `new RegExp(...)` — the same string a shell would pass to `grep -E`.
 */
function extractFallbackGrepPattern(skillMdText: string): string {
  const match = skillMdText.match(/git reflog \| grep -E "([^"]+)"/);
  if (!match) {
    throw new Error(
      'Could not find `git reflog | grep -E "..."` fallback staleness-proof pattern in SKILL.md — ' +
        'has the fallback proof been rewritten? Update this test to match.',
    );
  }
  return match[1];
}

describe('finish/pr staleness-proof fallback grep (#587 regression)', () => {
  let dir: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finish-staleness-grep-'));
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Builds a real repo, then runs a real clean `git rebase` so git itself
   * writes the `rebase (finish): returning to refs/heads/<branch>` reflog
   * entry — the exact reproduction performed while diagnosing #587. */
  async function repoWithCompletedRebase(): Promise<string> {
    await writeFile(join(dir, 'src/file.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');

    await git('checkout', '-b', 'feature');
    await writeFile(join(dir, 'src/feature-only.ts'), 'export const f = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');

    await git('checkout', 'main');
    await writeFile(join(dir, 'src/main-only.ts'), 'export const m = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'main work');

    await git('checkout', 'feature');
    await git('rebase', 'main'); // clean, non-conflicting — completes fully

    return git('reflog');
  }

  it('the corrected pattern (extracted from skills/finish/SKILL.md) matches a real "rebase (finish):" reflog entry', async () => {
    const reflog = await repoWithCompletedRebase();
    expect(reflog).toContain('rebase (finish): returning to refs/heads/feature');

    const skillMd = await readFile(FINISH_SKILL_PATH, 'utf-8');
    const pattern = extractFallbackGrepPattern(skillMd);
    const re = new RegExp(pattern);

    const matchingLine = reflog.split('\n').find((line) => re.test(line));
    expect(matchingLine).toBeDefined();
    expect(matchingLine).toContain('rebase (finish)');
  });

  it('the corrected pattern (extracted from skills/pr/SKILL.md) matches a real "rebase (finish):" reflog entry', async () => {
    const reflog = await repoWithCompletedRebase();

    const skillMd = await readFile(PR_SKILL_PATH, 'utf-8');
    const pattern = extractFallbackGrepPattern(skillMd);
    const re = new RegExp(pattern);

    const matchingLine = reflog.split('\n').find((line) => re.test(line));
    expect(matchingLine).toBeDefined();
    expect(matchingLine).toContain('rebase (finish)');
  });

  it('regression guard: the OLD wrong literal ("rebase: finish") never appears in real git reflog output', async () => {
    const reflog = await repoWithCompletedRebase();
    // Documents exactly why the pre-#587 grep silently never matched: git
    // writes "rebase (finish):" (parenthesized, no colon after "rebase"),
    // never the plain-colon form the old literal searched for.
    expect(reflog).not.toContain(OLD_WRONG_LITERAL);
  });

  it('neither skill still contains the old wrong grep literal as its fallback pattern', async () => {
    const finishSkillMd = await readFile(FINISH_SKILL_PATH, 'utf-8');
    const prSkillMd = await readFile(PR_SKILL_PATH, 'utf-8');

    expect(extractFallbackGrepPattern(finishSkillMd)).not.toBe(OLD_WRONG_LITERAL);
    expect(extractFallbackGrepPattern(prSkillMd)).not.toBe(OLD_WRONG_LITERAL);
  });

  it('the corrected pattern does not over-match an unrelated reflog line that merely contains the bare word "finish"', async () => {
    const skillMd = await readFile(FINISH_SKILL_PATH, 'utf-8');
    const pattern = extractFallbackGrepPattern(skillMd);
    const re = new RegExp(pattern);

    // A plausible unrelated reflog line: a commit subject that happens to
    // contain the word "finish" outside any rebase operation context.
    const unrelatedLine =
      'abc1234 HEAD@{0}: commit: finish the retry logic for the daemon';
    expect(re.test(unrelatedLine)).toBe(false);
  });
});
