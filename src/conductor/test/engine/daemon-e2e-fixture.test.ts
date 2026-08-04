import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

export async function dumpPipelineDiagnostics(worktreeDir: string): Promise<void> {
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
  if (haltReason === null) {
    console.error(`halt marker not found at ${haltPath}`);
  } else {
    console.error(`halt marker at ${haltPath}`);
    console.error(haltReason);
  }

  for (const [label, path] of [
    ['task status', join(worktreeDir, '.pipeline/task-status.json')],
    ['task evidence', join(worktreeDir, '.pipeline/task-evidence.json')],
  ]) {
    const contents = await readFile(path, 'utf-8').catch(() => null);
    if (contents === null) {
      console.error(`${label} not found at ${path}`);
    } else {
      console.error(`${label} at ${path}`);
      console.error(contents);
    }
  }

  const parkedDir = join(worktreeDir, '.daemon/parked');
  const parkedEntries = await readdir(parkedDir).catch(() => []);
  if (parkedEntries.length === 0) {
    console.error(`park markers not found in ${parkedDir}`);
  }
  for (const entry of parkedEntries) {
    const markerPath = join(parkedDir, entry);
    const reason = await readFile(markerPath, 'utf-8').catch(() => null);
    if (reason !== null) {
      console.error(`park marker at ${markerPath}`);
      console.error(reason);
    }
  }
}

describe('daemon E2E diagnostics', () => {
  it('dumps daemon, halt, task status, and task evidence artifacts', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-diagnostics-'));
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      await mkdir(join(worktreeDir, '.daemon'), { recursive: true });
      await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
      await writeFile(join(worktreeDir, '.daemon/daemon.log'), 'daemon diagnostic\n');
      await writeFile(join(worktreeDir, '.pipeline/HALT'), 'halt diagnostic\n');
      await writeFile(join(worktreeDir, '.pipeline/task-status.json'), '{"tasks":[]}\n');
      await writeFile(join(worktreeDir, '.pipeline/task-evidence.json'), '{"evidence":[]}\n');

      await dumpPipelineDiagnostics(worktreeDir);

      const output = stderr.join('\n');
      expect({
        daemon: output.includes('daemon diagnostic'),
        halt: output.includes('halt diagnostic'),
        taskEvidence: output.includes('"evidence":[]'),
        taskStatus: output.includes('"tasks":[]'),
      }).toEqual({
        daemon: true,
        halt: true,
        taskEvidence: true,
        taskStatus: true,
      });
    } finally {
      errorSpy.mockRestore();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});

function createDaemonLogSink(worktreeDir: string): (message: string) => void {
  const daemonDir = join(worktreeDir, '.daemon');
  const logPath = join(daemonDir, 'daemon.log');
  mkdirSync(daemonDir, { recursive: true });
  return (message) => appendFileSync(logPath, `${message}\n`, 'utf-8');
}

function createFixtureAgentFake(
  worktreeDir: string,
  fixtureOptions: {
    omitTaskTrailer?: boolean;
    touchUnrelatedPath?: boolean;
  } = {},
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

    const touchedPath = fixtureOptions.touchUnrelatedPath
      ? 'test/fixtures/daemon-e2e/unrelated.txt'
      : 'test/fixtures/daemon-e2e/touched.txt';
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
  it('parses only fixture tasks and harvests only the declared Task 1 path', async () => {
    const fixturePlan = await readFile(fixturePlanPath, 'utf-8');
    const taskPaths = parsePlanTaskPaths(fixturePlan);
    const task1Paths = taskPaths.get('1') ?? new Set<string>();

    expect({
      taskIds: [...taskPaths.keys()].sort(),
      excludesProseToken: !task1Paths.has('not-a-path'),
      includesDeclaredPath: task1Paths.has(
        'test/fixtures/daemon-e2e/touched.txt',
      ),
    }).toEqual({
      taskIds: ['1', 'T0'],
      excludesProseToken: true,
      includesDeclaredPath: true,
    });
  });

  it('makes a real trailered commit when the fixture agent fake is invoked directly', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-agent-fake-'));

    try {
      await initTestRepo(worktreeDir);
      await writeFile(join(worktreeDir, 'README.md'), 'fixture baseline\n');
      await execa('git', ['add', 'README.md'], { cwd: worktreeDir });
      await execa('git', ['commit', '-m', 'test: seed fixture agent repo'], {
        cwd: worktreeDir,
      });
      const { stdout: baselineSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      const fake = createFixtureAgentFake(worktreeDir);

      await fake.provider.invoke({
        prompt: 'Task: 1\n\nImplement the fixture task.',
        sessionId: 'fixture-agent-fake-session',
        resume: false,
        cwd: worktreeDir,
      });

      const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: changedFiles } = await execa(
        'git',
        ['show', '--format=', '--name-only', 'HEAD'],
        { cwd: worktreeDir },
      );

      expect({
        madeCommit: commitSha.trim() !== baselineSha.trim(),
        commitBody: commitBody.trim(),
        changedFiles: changedFiles.trim().split('\n'),
      }).toEqual({
        madeCommit: true,
        commitBody: 'test: complete fixture task\n\nTask: 1',
        changedFiles: ['test/fixtures/daemon-e2e/touched.txt'],
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
          log: createDaemonLogSink(worktreeDir),
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
        daemonLog: existsSync(join(worktreeDir, '.daemon/daemon.log')),
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
        daemonLog: true,
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

      const daemonResult = await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            await conductor.run();
            return { slug: item.slug, status: 'halted' };
          },
          log: createDaemonLogSink(worktreeDir),
        },
        { concurrency: 1, once: true },
      );

      const haltReason = await readFile(join(pipelineDir, 'HALT'), 'utf-8');
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });

      expect({
        commitBody: commitBody.trim(),
        processed: daemonResult.processed.map((outcome) => outcome.slug),
        haltReason,
        done: existsSync(join(pipelineDir, 'DONE')),
        daemonLog: existsSync(join(worktreeDir, '.daemon/daemon.log')),
      }).toEqual({
        commitBody: 'test: complete fixture task',
        processed: [slug],
        haltReason: expect.stringMatching(/build.*completion|task 1|evidence/i),
        done: false,
        daemonLog: true,
      });
    } catch (error) {
      await dumpPipelineDiagnostics(worktreeDir);
      throw error;
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('halts when the trailered fixture commit does not touch its declared path', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-disjoint-path-'));
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
      await execa('git', ['checkout', '-b', 'feature/daemon-e2e-disjoint-path'], {
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
        touchUnrelatedPath: true,
      });
      const runner = new DefaultStepRunner(
        fake.provider,
        'fixture-disjoint-path-session',
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

      const daemonResult = await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            await conductor.run();
            return { slug: item.slug, status: 'halted' };
          },
          log: createDaemonLogSink(worktreeDir),
        },
        { concurrency: 1, once: true },
      );

      const haltReason = await readFile(join(pipelineDir, 'HALT'), 'utf-8');
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: changedFiles } = await execa(
        'git',
        ['show', '--format=', '--name-only', 'HEAD'],
        { cwd: worktreeDir },
      );

      expect({
        commitBody: commitBody.trim(),
        changedFiles: changedFiles.trim().split('\n'),
        processed: daemonResult.processed.map((outcome) => outcome.slug),
        haltReason,
        done: existsSync(join(pipelineDir, 'DONE')),
      }).toEqual({
        commitBody: 'test: complete fixture task\n\nTask: 1',
        changedFiles: ['test/fixtures/daemon-e2e/unrelated.txt'],
        processed: [slug],
        haltReason: expect.stringMatching(/task 1|declared|path|corroborat/i),
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
