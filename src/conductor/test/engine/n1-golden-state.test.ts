import { afterEach, describe, expect, it, vi } from 'vitest';

// The engine mints `executionContext.executionId` via `node:crypto.randomUUID`
// (there is no runId injection seam on ConductorOptions/Conductor.run()). Make
// it deterministic here so the golden fixtures can pin real bytes instead of
// normalizing execution ids away. Distinct values per call preserve any
// uniqueness assumptions in the run; the counter is deterministic because the
// bounded run is serial.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  let counter = 0;
  return {
    ...actual,
    randomUUID: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
  };
});

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { bumpKickbackGateInLedger } from '../../src/engine/kickback-ledger.js';
import { runTaskStart } from '../../src/engine/task-cli.js';
import { loadConfig } from '../../src/engine/config.js';
import { CELLS, RECORD, expectGolden, readAndNormalize } from './n1-golden-shared.js';

const execFile = promisify(execFileCb);

describe('N=1 golden state', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('self-tests expectGolden against a one-byte-altered fixture', async () => {
    if (RECORD) return;
    const fixtureName = 'flag-off-unsliced-current-task';
    const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${fixtureName}.golden`);
    const goldenRaw = await readFile(fixturePath, 'utf8');
    const golden = goldenRaw.replace(/^<!-- Recorded from [a-f0-9]+ -->\n/, '');
    const altered = `${golden}X`;
    await expect(expectGolden(fixtureName, altered)).rejects.toThrow(`golden mismatch in ${fixtureName}: line`);
  });

  it.each(CELLS)('matches golden for $name', async (cell) => {
    const root = await mkdtemp(join(tmpdir(), `n1-golden-${cell.name}-`));
    roots.push(root);

    // Setup fixture root
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'n1-golden.md'), cell.planMd);

    // Git init with pinned identity and dates
    await execFile('git', ['init', '-b', 'main', '-q'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# n1-golden\n');
    await writeFile(join(root, '.gitignore'), '.pipeline/\n');
    await execFile('git', ['add', 'README.md', '.gitignore', '.docs/plans/n1-golden.md', '.ai-conductor/config.yml'], { cwd: root });
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      USER: 'test-user',
    };
    await execFile('git', ['commit', '-m', 'init'], { cwd: root, env });

    // Seed conduct-state: every step before acceptance_specs is done
    const pipeline = join(root, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    const statePath = join(pipeline, 'conduct-state.json');
    const state = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      coverage_binding: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      prd: 'done',
      prd_audit: 'done',
      acceptance_specs: 'pending',
      build: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
      manual_test: 'pending',
      architecture_review_as_built: 'pending',
      finish: 'pending',
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'n1-golden',
    };
    await writeState(statePath, state as any);

    // Setup EventPersister with fixed clock
    const events = new ConductorEventEmitter();
    const ledgerPath = join(pipeline, 'events.jsonl');
    let now = 1_000;
    const persister = new EventPersister(ledgerPath, events, { nowMs: () => now });
    persister.start();

    // Track completed region steps for park boundary
    const completedSteps = new Set<string>();

    // Mocked step runner
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'acceptance_specs' || step === 'build' || step === 'test_suite' || step === 'build_review') {
          completedSteps.add(step);
          return { success: true };
        }
        throw new Error(`sentinel failure at ${step}`);
      },
    };

    const configResult = await loadConfig(root);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: root,
      fromStep: 'acceptance_specs',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'n1-golden',
      baseBranch: 'main',
      operatorParkBoundary: async () => completedSteps.has('build_review'),
      config: configResult.ok ? configResult.config : undefined,
    });

    try {
      await conductor.run();
    } catch {
      // expected sentinel failure
    }
    persister.stop();

    // Bump kickback ledger and start task 2
    await bumpKickbackGateInLedger(root, 'build_review', {
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      resolvedCount: 1,
      reason: 'fixture bump',
    });
    await runTaskStart(root, '2');

    // Compare state files
    const stateContent = await readAndNormalize(statePath, root);
    await expectGolden(`${cell.name}-conduct-state`, stateContent);

    const taskStatusPath = join(pipeline, 'task-status.json');
    const taskStatusContent = await readAndNormalize(taskStatusPath, root);
    await expectGolden(`${cell.name}-task-status`, taskStatusContent);

    const currentTaskPath = join(pipeline, 'current-task');
    const currentTaskContent = await readFile(currentTaskPath, 'utf8');
    await expectGolden(`${cell.name}-current-task`, currentTaskContent);

    // Gate verdicts
    const gateDir = join(pipeline, 'gates');
    let gatePaths: string[] = [];
    try {
      const entries = await readdir(gateDir);
      gatePaths = entries.filter((e) => e.endsWith('.json')).sort();
    } catch {
      // no gates dir
    }
    const gateContents = await Promise.all(
      gatePaths.map(async (p) => {
        const content = await readAndNormalize(join(gateDir, p), root);
        return `--- ${p} ---\n${content}`;
      }),
    );
    await expectGolden(`${cell.name}-gate-paths`, gatePaths.join('\n'));
    for (let i = 0; i < gatePaths.length; i++) {
      await expectGolden(`${cell.name}-gate-${gatePaths[i].replace('.json', '')}`, gateContents[i]);
    }

    const eventsContent = await readAndNormalize(ledgerPath, root);
    await expectGolden(`${cell.name}-events`, eventsContent);

    const kickbackPath = join(pipeline, 'kickback-ledger.json');
    const kickbackContent = await readAndNormalize(kickbackPath, root);
    await expectGolden(`${cell.name}-kickback-ledger`, kickbackContent);

    // Assert no children directory and no "child" in events
    const pipelineEntries = await readdir(pipeline);
    if (pipelineEntries.includes('children')) {
      const childrenEntries = await readdir(join(pipeline, 'children')).catch(() => []);
      throw new Error(`.pipeline/children exists: ${childrenEntries.map((e) => `.pipeline/children/${e}`).join(', ')}`);
    }
    expect(eventsContent).not.toContain('"child"');
  });
});
