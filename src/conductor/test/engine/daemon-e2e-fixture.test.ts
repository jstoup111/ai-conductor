import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { fileMatchesPlanPath } from '../../src/engine/autoheal.js';
import { Conductor } from '../../src/engine/conductor.js';
import { runDaemon } from '../../src/engine/daemon.js';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createCodexProviderFake } from '../fixtures/codex-provider-fake.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);
const fixtureStoriesPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/stories.md', import.meta.url),
);
const fixtureTouchedPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/touched.txt', import.meta.url),
);

function createFixtureAgentFake(worktreeDir: string) {
  return createCodexProviderFake((options) => {
    const explicitTaskId =
      options.prompt.match(/^Task:\s*([A-Za-z0-9._-]+)$/m)?.[1];
    const taskId =
      explicitTaskId && explicitTaskId !== 'none'
        ? explicitTaskId
        : options.prompt.includes('$pipeline')
          ? '1'
          : undefined;
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

  it('claims the fixture and dispatches its build through the scripted provider', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-dispatch-'));
    const slug = 'daemon-e2e-fixture';
    const pipelineDir = join(worktreeDir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    const planPath = join(worktreeDir, `.docs/plans/${slug}.md`);

    try {
      await initTestRepo(worktreeDir);
      await mkdir(join(worktreeDir, '.docs/plans'), { recursive: true });
      await mkdir(join(worktreeDir, '.docs/stories'), { recursive: true });
      await mkdir(join(worktreeDir, 'test/fixtures/daemon-e2e'), {
        recursive: true,
      });
      await copyFile(fixturePlanPath, planPath);
      await copyFile(fixtureStoriesPath, join(worktreeDir, `.docs/stories/${slug}.md`));
      await copyFile(
        fixtureTouchedPath,
        join(worktreeDir, 'test/fixtures/daemon-e2e/touched.txt'),
      );
      await execa('git', ['add', '-A'], { cwd: worktreeDir });
      await execa(
        'git',
        ['commit', '-m', 'test: seed daemon E2E fixture', '-m', 'Task: T0'],
        { cwd: worktreeDir },
      );

      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          worktree: 'done',
          memory: 'done',
          explore: 'done',
          complexity: 'done',
          complexity_tier: 'S',
          stories: 'done',
          conflict_check: 'done',
          plan: 'done',
          coherence_check: 'done',
          architecture_diagram: 'done',
          architecture_review: 'done',
          acceptance_specs: 'done',
        }),
      );

      const fake = createFixtureAgentFake(worktreeDir);
      const runner = new DefaultStepRunner(
        fake.provider,
        'fixture-build-session',
        worktreeDir,
        {
          featureDesc: slug,
          pipelineDir,
          planPath,
          providerKey: 'codex',
        },
      );
      let claimed = false;

      // Bounded Conductor fixture:
      // 1. First runnable step: build (all prior steps are pre-resolved).
      // 2. Expected dispatches: build only.
      // 3. Terminal condition: the post-build checkpoint returns "quit".
      // 4. Required artifacts: authoritative plan/stories plus the T0 baseline
      //    commit; build completion is proven by Task 1's real commit and state.
      const daemonResult = await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            claimed = item.slug === slug;
            const conductor = new Conductor({
              stateFilePath: statePath,
              stepRunner: runner,
              events: new ConductorEventEmitter(),
              projectRoot: worktreeDir,
              fromStep: 'build',
              verifyArtifacts: false,
              onCheckpoint: async () => 'quit',
            });
            await conductor.run();
            return { slug: item.slug, status: 'done' };
          },
        },
        { concurrency: 1, once: true },
      );
      const state = JSON.parse(await readFile(statePath, 'utf-8')) as {
        build?: string;
      };
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });

      expect({
        claimed,
        processed: daemonResult.processed.map((outcome) => outcome.slug),
        providerCalls: fake.calls.length,
        build: state.build,
        commitBody: commitBody.trim(),
      }).toEqual({
        claimed: true,
        processed: [slug],
        providerCalls: 1,
        build: 'done',
        commitBody: 'test: complete fixture task\n\nTask: 1',
      });
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
