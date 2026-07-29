import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it, vi } from 'vitest';
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

async function dumpPipelineDiagnostics(worktreeDir: string): Promise<void> {
  const logPath = join(worktreeDir, '.daemon/daemon.log');
  const daemonLog = await readFile(logPath, 'utf-8').catch(() => null);

  if (daemonLog === null) {
    console.error(`daemon log not found at ${logPath}`);
  } else {
    console.error(`daemon log tail from ${logPath}`);
    console.error(daemonLog.split('\n').slice(-50).join('\n'));
  }

  const haltPath = join(worktreeDir, '.pipeline/HALT');
  const haltReason = await readFile(haltPath, 'utf-8').catch(() => null);
  if (haltReason !== null) {
    console.error(`halt marker at ${haltPath}`);
    console.error(haltReason);
  }

  const parkedDir = join(worktreeDir, '.daemon/parked');
  const parkedEntries = await readdir(parkedDir).catch(() => []);
  for (const entry of parkedEntries) {
    const markerPath = join(parkedDir, entry);
    const reason = await readFile(markerPath, 'utf-8').catch(() => null);
    if (reason !== null) {
      console.error(`park marker at ${markerPath}`);
      console.error(reason);
    }
  }
}

function createFixtureAgentFake(
  worktreeDir: string,
  fixtureOptions: { omitTaskTrailer?: boolean } = {},
) {
  return createCodexProviderFake((options) => {
    if (options.prompt.includes('.pipeline/build-review.json')) {
      mkdirSync(join(worktreeDir, '.pipeline'), { recursive: true });
      writeFileSync(
        join(worktreeDir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          reasons: [],
          rubric: {
            tautology: true,
            scope: true,
            rootCause: true,
            completeness: true,
          },
        }),
        'utf-8',
      );
      return {
        success: true,
        output: 'fixture build review passed',
        exitCode: 0,
      };
    }

    if (options.prompt.includes('$finish')) {
      mkdirSync(join(worktreeDir, '.pipeline'), { recursive: true });
      writeFileSync(join(worktreeDir, '.pipeline/finish-choice'), 'keep\n', 'utf-8');
      return {
        success: true,
        output: 'fixture finish recorded local keep',
        exitCode: 0,
      };
    }

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
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: worktreeDir });
    } catch {
      const commitArgs = ['commit', '-m', 'test: complete fixture task'];
      if (!fixtureOptions.omitTaskTrailer) {
        commitArgs.push('-m', `Task: ${taskId}`);
      }
      execFileSync('git', commitArgs, { cwd: worktreeDir });
    }

    return {
      success: true,
      output: 'fixture agent completed',
      exitCode: 0,
    };
  });
}

describe('daemon E2E fixture', () => {
  it('reports the explicit daemon-log path when diagnostics find no log', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-diagnostics-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await dumpPipelineDiagnostics(worktreeDir);

      expect(error).toHaveBeenCalledWith(
        `daemon log not found at ${join(worktreeDir, '.daemon/daemon.log')}`,
      );
    } finally {
      error.mockRestore();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('prints a bounded daemon-log tail with halt and park reasons', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-diagnostics-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await mkdir(join(worktreeDir, '.daemon/parked'), { recursive: true });
      await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
      await writeFile(
        join(worktreeDir, '.daemon/daemon.log'),
        Array.from({ length: 55 }, (_, index) => `log line ${index + 1}`).join('\n'),
      );
      await writeFile(join(worktreeDir, '.pipeline/HALT'), 'missing Task 1 evidence\n');
      await writeFile(
        join(worktreeDir, '.daemon/parked/daemon-e2e-fixture'),
        'parked after evidence failure\n',
      );

      await dumpPipelineDiagnostics(worktreeDir);

      const output = error.mock.calls.map(([message]) => String(message)).join('\n');
      expect({
        includesFirstRetainedLine: output.includes('log line 6'),
        excludesDroppedLine: !output.includes('log line 5\n'),
        includesHaltReason: output.includes('missing Task 1 evidence'),
        includesParkReason: output.includes('parked after evidence failure'),
      }).toEqual({
        includesFirstRetainedLine: true,
        excludesDroppedLine: true,
        includesHaltReason: true,
        includesParkReason: true,
      });
    } finally {
      error.mockRestore();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

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
      await execa('git', ['checkout', '-b', 'feature/daemon-e2e-fixture'], {
        cwd: worktreeDir,
      });

      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          worktree: 'done',
          memory: 'done',
          explore: 'done',
          complexity: 'done',
          complexity_tier: 'S',
          track: 'technical',
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
      // 2. Expected dispatches: build, build_review, and finish; wiring,
      //    test_suite, tier/track-skipped validators, and rebase stay native.
      // 3. Terminal condition: finish records the local keep equivalent and
      //    the daemon Conductor writes DONE.
      // 4. Required artifacts: authoritative plan/stories plus the T0 baseline
      //    commit, Task 1's real commit, a fresh build-review verdict, aggregate
      //    verifier evidence, and the fresh finish-choice marker.
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
              mode: 'auto',
              daemon: true,
              verifyArtifacts: false,
              fullSuiteVerifier: {
                ensure: async () => ({
                  status: 'REUSED',
                  evidence: {} as never,
                }),
                inspect: async () => ({
                  status: 'CURRENT',
                  evidence: {} as never,
                }),
              },
              escalateBuildFailure: async () => ({}),
            });
            await conductor.run();
            return { slug: item.slug, status: 'done' };
          },
        },
        { concurrency: 1, once: true },
      );
      const state = JSON.parse(await readFile(statePath, 'utf-8')) as {
        build?: string;
        finish?: string;
      };
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });

      expect({
        claimed,
        processed: daemonResult.processed.map((outcome) => outcome.slug),
        providerCalls: fake.calls.length,
        build: state.build,
        finish: state.finish,
        commitBody: commitBody.trim(),
        done: existsSync(join(pipelineDir, 'DONE')),
        halt: existsSync(join(pipelineDir, 'HALT')),
        parked: existsSync(join(worktreeDir, `.daemon/parked/${slug}`)),
      }).toEqual({
        claimed: true,
        processed: [slug],
        providerCalls: 3,
        build: 'done',
        finish: 'done',
        commitBody: 'test: complete fixture task\n\nTask: 1',
        done: true,
        halt: false,
        parked: false,
      });
    } catch (error) {
      await dumpPipelineDiagnostics(worktreeDir);
      throw error;
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('halts when the fixture commit omits its Task 1 evidence trailer', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-no-evidence-'));
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
      await execa('git', ['checkout', '-b', 'feature/daemon-e2e-no-evidence'], {
        cwd: worktreeDir,
      });

      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          worktree: 'done',
          memory: 'done',
          explore: 'done',
          complexity: 'done',
          complexity_tier: 'S',
          track: 'technical',
          stories: 'done',
          conflict_check: 'done',
          plan: 'done',
          coherence_check: 'done',
          architecture_diagram: 'done',
          architecture_review: 'done',
          acceptance_specs: 'done',
        }),
      );

      const fake = createFixtureAgentFake(worktreeDir, {
        omitTaskTrailer: true,
      });
      const runner = new DefaultStepRunner(
        fake.provider,
        'fixture-no-evidence-session',
        worktreeDir,
        {
          featureDesc: slug,
          pipelineDir,
          planPath,
          providerKey: 'codex',
        },
      );
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: worktreeDir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: false,
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      const haltReason = await readFile(join(pipelineDir, 'HALT'), 'utf-8');
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });

      expect({
        commitBody: commitBody.trim(),
        haltReason,
        done: existsSync(join(pipelineDir, 'DONE')),
      }).toEqual({
        commitBody: 'test: complete fixture task',
        haltReason: expect.stringMatching(/build.*completion|task 1|evidence/i),
        done: false,
      });
    } catch (error) {
      await dumpPipelineDiagnostics(worktreeDir);
      throw error;
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
