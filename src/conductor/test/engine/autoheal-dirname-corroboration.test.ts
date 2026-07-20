// ─────────────────────────────────────────────────────────────────────────────
// Test: fileDirMatchesPlanPath — bounded immediate-parent-dir corroboration
// predicate (#707).
//
// Pure predicate: strips a leading `./` on both sides, then compares
// dirname(file) === dirname(planDeclaredPath) exactly. No ancestor/prefix
// logic — a file in a sibling or nested directory does not match.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import {
  fileDirMatchesPlanPath,
  deriveCompletion,
  listCommitsWithTrailers,
  resetDeriveWarnOnce,
} from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

describe('fileDirMatchesPlanPath (#707)', () => {
  it('matches when file and plan path share the same directory', () => {
    expect(fileDirMatchesPlanPath('src/e/a.ts', 'src/e/conductor.ts')).toBe(true);
  });

  it('rejects when file is in a different directory', () => {
    expect(fileDirMatchesPlanPath('src/cli.ts', 'src/e/conductor.ts')).toBe(false);
  });

  it('rejects when file is at repo root but plan path is nested', () => {
    expect(fileDirMatchesPlanPath('README.md', 'src/e/conductor.ts')).toBe(false);
  });

  it('strips a leading ./ before comparing', () => {
    expect(fileDirMatchesPlanPath('./src/e/a.ts', 'src/e/conductor.ts')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCompletion: branch-aware corroboration (#707 Task 2)
//
// Exact/suffix corroboration still wins outright (short-circuits before the
// dirname pass); a same-immediate-dir (non-exact) commit is credited via the
// new bounded dirname branch.
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveCompletion branch-aware corroboration: exact/suffix then dirname (#707)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  async function commitFile(relPath: string, body: string, taskTrailer: string): Promise<void> {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await git('add', '.');
    await git('commit', '-q', '-m', `feat: work\n\nTask: ${taskTrailer}\n`);
  }

  async function derive(planPath: string) {
    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    return deriveCompletion(root, planPath, '', commits, evidence);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-dirname-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('same-immediate-dir (non-exact) commit corroborates via the bounded dirname pass', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/conductor.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    // Sibling file in the SAME immediate directory as the declared path, but
    // not an exact/suffix match itself.
    await commitFile('src/conductor/src/engine/other.ts', 'export const x = 1;', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBe(true);
  });

  it('exact/suffix corroboration still completes unchanged (short-circuits before dirname pass)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
- \`push-evidence.ts\`
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('src/conductor/src/engine/push-evidence.ts', 'export const x = 1;', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCompletion: evidence stamp `form` reflects which corroboration branch
// satisfied the task (#707 Task 3).
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveCompletion evidence stamp form: trailer vs trailer-dirname (#707)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  async function commitFile(relPath: string, body: string, taskTrailer: string): Promise<void> {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await git('add', '.');
    await git('commit', '-q', '-m', `feat: work\n\nTask: ${taskTrailer}\n`);
  }

  async function derive(planPath: string) {
    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    await deriveCompletion(root, planPath, '', commits, evidence);
    return evidence;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-form-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stamps form: trailer-dirname when credited via the bounded dirname pass', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/conductor.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('src/conductor/src/engine/other.ts', 'export const x = 1;', '1');

    const evidence = await derive(planPath);
    expect(evidence.evidenceStamps.get('1')?.form).toBe('trailer-dirname');
  });

  it('stamps form: trailer when credited via exact/suffix corroboration', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
- \`push-evidence.ts\`
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('src/conductor/src/engine/push-evidence.ts', 'export const x = 1;', '1');

    const evidence = await derive(planPath);
    expect(evidence.evidenceStamps.get('1')?.form).toBe('trailer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCompletion: #445 non-regression — ancestor-dir-only and repo-root-only
// commits must NOT be credited by the bounded dirname pass (#707 Task 4).
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveCompletion #445 non-regression: ancestor/repo-root do not corroborate (#707)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  async function commitFile(relPath: string, body: string, taskTrailer: string): Promise<void> {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await git('add', '.');
    await git('commit', '-q', '-m', `feat: work\n\nTask: ${taskTrailer}\n`);
  }

  async function derive(planPath: string) {
    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    return deriveCompletion(root, planPath, '', commits, evidence);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-nonregression-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writePlan(planPath: string): Promise<void> {
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/conductor.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');
  }

  it('a commit touching only an ancestor directory (not the immediate dir) is NOT credited', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await writePlan(planPath);

    // src/conductor/src is an ancestor of src/conductor/src/engine (the
    // immediate dir of the declared path), not the immediate dir itself.
    await commitFile('src/conductor/src/cli.ts', 'export const x = 1;', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBeFalsy();
  });

  it('a commit touching only repo-root files (README.md, VERSION) is NOT credited', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await writePlan(planPath);

    await writeFile(join(root, 'README.md'), '# readme');
    await writeFile(join(root, 'VERSION'), '0.0.1');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: work\n\nTask: 1\n');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBeFalsy();
  });

  it('a task inheriting Files via "same as Task N" is NOT dirname-credited by a commit touching an unrelated directory', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/conductor.ts

### Task 2: Inherits Task 1's Files
**Files:** same as Task 1
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    // Task 2's declared (inherited) dir is src/conductor/src/engine — this
    // commit touches an unrelated directory and carries Task 2's trailer.
    await commitFile('src/cli.ts', 'export const x = 1;', '2');

    const result = await derive(planPath);
    expect(result['2']?.completed).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCompletion: wrong-immediate-dir commit falls through to the unchanged
// reject path (#707 Task 6).
//
// Plan paths live only under src/conductor/src/engine/. A Task: N commit that
// touches only test/ and docs/ files is neither an exact/suffix match nor a
// same-immediate-dir match, so the bounded dirname pass must NOT credit it.
// On the resulting full miss (no `semantic-verified` stamp present), the
// existing `warnOnce` "Path corroboration failed" audit must still fire —
// this test asserts the reject/audit behavior is unchanged by the dirname
// pass, matching the assertion style in autoheal-warn-once.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveCompletion wrong-dir commit falls through to unchanged reject (#707)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  async function commitFile(relPath: string, body: string, taskTrailer: string): Promise<void> {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await git('add', '.');
    await git('commit', '-q', '-m', `feat: work\n\nTask: ${taskTrailer}\n`);
  }

  async function derive(planPath: string) {
    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    return deriveCompletion(root, planPath, '', commits, evidence);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-wrongdir-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('a commit touching only test/ + docs/ files is not dirname-credited, and the reject-path warnOnce audit still fires', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/conductor.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    // Touches only test/ and docs/ — neither exact/suffix nor same-immediate-dir
    // as the declared src/conductor/src/engine/ path.
    await mkdir(join(root, 'test/engine'), { recursive: true });
    await writeFile(join(root, 'test/engine/other.test.ts'), 'x');
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs/notes.md'), 'x');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: work\n\nTask: 1\n');

    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warns.push(args.join(' '));
    });

    const result = await derive(planPath);

    expect(result['1']?.completed).toBeFalsy();
    expect(
      warns.filter((w) => w.includes('Path corroboration failed for task 1')),
    ).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCompletion: semantic judge fallback path preserved (#707 Task 7).
//
// GUARD NOTE: this change set (Tasks 1-6, the bounded dirname corroboration
// pass) does not modify `src/conductor/src/engine/attribution-lane.ts` or any
// conductor judge-dispatch block — verified via
// `git diff 2c62ef32..HEAD -- src/conductor/src/engine/attribution-lane.ts`,
// which is empty. attribution-lane.ts is also the sole file matching a
// judge-dispatch search (`find src/conductor/src -iname '*judge*dispatch*'`
// found nothing; the judge lane lives in attribution-lane.ts). The
// pre-existing `semantic-verified` stamp branch in deriveCompletion (see
// "semantic-verified stamp outranks a Task: trailer..." in autoheal.test.ts)
// is consulted ahead of the trailer/path-overlap heuristic and is untouched
// by the new dirname pass, which only extends the trailer/path-overlap
// heuristic itself.
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveCompletion semantic judge fallback unchanged by dirname pass (#707)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-semantic-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a pre-existing semantic-verified stamp still credits the task when the dirname pass does not apply', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 9: Judged task
**Files:** src/judged.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: add plan');

    // Commit touches a wholly unrelated directory — neither exact/suffix nor
    // same-immediate-dir, so the dirname pass does not (and must not) apply.
    await mkdir(join(root, 'test/unrelated'), { recursive: true });
    await writeFile(join(root, 'test/unrelated/other.test.ts'), 'x');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: work\n\nTask: 9\n');

    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);

    // Judge lane already stamped this task as semantically satisfied — the
    // existing pre-dirname-pass branch this test guards.
    const judgeSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    evidence.evidenceStamps.set('9', { sha: judgeSha, form: 'semantic-verified' });

    const result = await deriveCompletion(root, planPath, '', commits, evidence);

    expect(result['9']?.completed).toBe(true);
  });
});
