// ─────────────────────────────────────────────────────────────────────────────
// Test: path corroboration accepts plan paths written as basenames or partial
// paths (#425).
//
// Plans routinely declare "Files likely touched" as `push-evidence.ts` or
// `engine/push-evidence.ts` while git reports repo-relative paths
// (`src/conductor/src/engine/push-evidence.ts`). The old exact-set lookup
// rejected every such pair, false-halting three consecutive daemon features
// whose trailers and work were correct. Matching is suffix-based but anchored
// at a `/` segment boundary — `trail.ts` must never match `audit-trail.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import {
  fileMatchesPlanPath,
  deriveCompletion,
  listCommitsWithTrailers,
  resetDeriveWarnOnce,
} from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

describe('fileMatchesPlanPath (#425)', () => {
  it('exact repo-relative match', () => {
    expect(fileMatchesPlanPath('src/engine/push-evidence.ts', 'src/engine/push-evidence.ts')).toBe(true);
  });

  it('basename plan path matches the full commit path', () => {
    expect(fileMatchesPlanPath('src/conductor/src/engine/push-evidence.ts', 'push-evidence.ts')).toBe(true);
  });

  it('partial (multi-segment) plan path matches at a segment boundary', () => {
    expect(fileMatchesPlanPath('src/conductor/src/engine/push-evidence.ts', 'engine/push-evidence.ts')).toBe(true);
  });

  it('suffix that is not segment-anchored does NOT match (trail.ts vs audit-trail.ts)', () => {
    expect(fileMatchesPlanPath('src/engine/audit-trail.ts', 'trail.ts')).toBe(false);
  });

  it('different basename does not match', () => {
    expect(fileMatchesPlanPath('src/engine/push-evidence.ts', 'pull-evidence.ts')).toBe(false);
  });

  it('leading ./ is stripped from both sides', () => {
    expect(fileMatchesPlanPath('./src/a.ts', './a.ts')).toBe(true);
    expect(fileMatchesPlanPath('./src/a.ts', './src/a.ts')).toBe(true);
  });

  it('plan path longer than the file never matches', () => {
    expect(fileMatchesPlanPath('a.ts', 'src/deeper/a.ts')).toBe(false);
  });
});

describe('deriveCompletion path corroboration with basename plan paths (#425 incident shape)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'path-grammar-'));
    resetDeriveWarnOnce();
    await git('init', '-q');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('trailer commit touching a nested file satisfies a basename-declared task path', async () => {
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

    const file = join(root, 'src/conductor/src/engine/push-evidence.ts');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'export const x = 1;');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: work\n\nTask: 1\n');

    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    const result = await deriveCompletion(root, planPath, '', commits, evidence);

    expect(result['1']?.completed).toBe(true);
  });

  it('trailer commit touching an UNRELATED file still fails corroboration', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, `# Plan\n\n### Task 1: Implementation\n\n- \`push-evidence.ts\`\n`);
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await writeFile(join(root, 'unrelated.txt'), 'x');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: work\n\nTask: 1\n');

    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    const result = await deriveCompletion(root, planPath, '', commits, evidence);

    expect(result['1']?.completed).toBe(false);
    expect(result['1']?.auditEntry).toContain('no path overlap');
  });
});
