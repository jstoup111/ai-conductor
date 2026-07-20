// ─────────────────────────────────────────────────────────────────────────────
// Test: fileDirMatchesPlanPath — bounded immediate-parent-dir corroboration
// predicate (#707).
//
// Pure predicate: strips a leading `./` on both sides, then compares
// dirname(file) === dirname(planDeclaredPath) exactly. No ancestor/prefix
// logic — a file in a sibling or nested directory does not match.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
