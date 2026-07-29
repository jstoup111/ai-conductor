import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { fileMatchesPlanPath } from '../../src/engine/autoheal.js';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';
import { createCodexProviderFake } from '../fixtures/codex-provider-fake.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);

function createFixtureAgentFake(worktreeDir: string) {
  return createCodexProviderFake((options) => {
    const taskId = options.prompt.match(/^Task:\s*([A-Za-z0-9._-]+)$/m)?.[1];
    if (!taskId) {
      throw new Error('fixture agent invocation is missing a Task: <id> line');
    }

    const touchedPath = 'test/fixtures/daemon-e2e/touched.txt';
    mkdirSync(join(worktreeDir, 'test/fixtures/daemon-e2e'), { recursive: true });
    writeFileSync(join(worktreeDir, touchedPath), `fixture task ${taskId}\n`, 'utf-8');
    execFileSync('git', ['add', touchedPath], { cwd: worktreeDir });
    execFileSync(
      'git',
      ['commit', '-m', 'test: complete fixture task', '-m', `Task: ${taskId}`],
      { cwd: worktreeDir },
    );

    return {
      success: true,
      output: 'fixture agent completed',
      exitCode: 0,
    };
  });
}

describe('daemon E2E fixture', () => {
  it('parses only the real task headings without a dependency-graph phantom', async () => {
    const plan = await readFile(fixturePlanPath, 'utf-8');

    expect([...parsePlanTaskPaths(plan).keys()].sort()).toEqual(['1', 'T0']);
  });

  it('excludes inline prose backticks from Task 1 corroboration paths', async () => {
    const plan = await readFile(fixturePlanPath, 'utf-8');

    expect([...parsePlanTaskPaths(plan).get('1')!]).toEqual([
      'test/fixtures/daemon-e2e/touched.txt',
    ]);
  });

  it('harvests Task 1 bullet path and rejects evidence that does not touch it', async () => {
    const plan = await readFile(fixturePlanPath, 'utf-8');
    const [declaredPath] = parsePlanTaskPaths(plan).get('1')!;

    expect({
      declaredPath,
      disjointEvidenceCorroborates: fileMatchesPlanPath(
        'test/fixtures/daemon-e2e/unrelated.txt',
        declaredPath,
      ),
    }).toEqual({
      declaredPath: 'test/fixtures/daemon-e2e/touched.txt',
      disjointEvidenceCorroborates: false,
    });
  });

  it('scripted fixture agent makes a real commit with the dispatched task trailer', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-agent-'));

    try {
      await initTestRepo(worktreeDir);
      const fake = createFixtureAgentFake(worktreeDir);

      const result = await fake.provider.invoke({
        prompt: 'Task: 1\nImplement the daemon E2E fixture task.',
        sessionId: 'fixture-session',
        resume: false,
        cwd: worktreeDir,
      });
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: committedFiles } = await execa(
        'git',
        ['show', '--pretty=format:', '--name-only', 'HEAD'],
        { cwd: worktreeDir },
      );

      expect({
        result,
        commitBody: commitBody.trim(),
        committedFiles: committedFiles.trim().split('\n'),
      }).toEqual({
        result: {
          success: true,
          output: 'fixture agent completed',
          exitCode: 0,
        },
        commitBody: 'test: complete fixture task\n\nTask: 1',
        committedFiles: ['test/fixtures/daemon-e2e/touched.txt'],
      });
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
