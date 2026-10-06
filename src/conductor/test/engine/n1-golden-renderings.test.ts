import { afterEach, describe, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { loadConfig } from '../../src/engine/config.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import { scanInheritedState, renderDashboard } from '../../src/engine/daemon-dashboard.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { renderShippedRecordWithCost } from '../../src/engine/shipped-record.js';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';
import { shipDraftPrBody } from '../../src/engine/ship-draft-pr.js';
import { bumpKickbackGateInLedger } from '../../src/engine/kickback-ledger.js';
import { runTaskStart } from '../../src/engine/task-cli.js';
import { CELLS, expectGolden, normalizeGolden } from './n1-golden-shared.js';

const execFile = promisify(execFileCb);

describe('N=1 golden renderings', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.each(CELLS)('matches golden for $name', async (cell) => {
    const root = await mkdtemp(join(tmpdir(), `n1-golden-render-${cell.name}-`));
    roots.push(root);

    // Setup fixture root (same as state test)
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'n1-golden.md'), cell.planMd);

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

    const events = new ConductorEventEmitter();
    const ledgerPath = join(pipeline, 'events.jsonl');
    let now = 1_000;
    const persister = new EventPersister(ledgerPath, events, { nowMs: () => now });
    persister.start();

    const completedSteps = new Set<string>();
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
      /* expected */
    }
    persister.stop();

    await bumpKickbackGateInLedger(root, 'build_review', {
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      resolvedCount: 1,
      reason: 'fixture bump',
    });
    await runTaskStart(root, '2');

    // 1. dispatchRewindCommand
    await writeFile(join(pipeline, 'HALT'), 'test halt\n');
    await writeFile(join(pipeline, 'HALT.class'), 'needs-human\n');
    const rewindLines: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: any[]) => { rewindLines.push(args.join(' ')); };
    console.error = () => {};
    const rewindCode = await dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, { emit: undefined });
    console.log = originalLog;
    console.error = originalError;
    const rewindEvents = (await readFile(ledgerPath, 'utf8')).trim().split('\n');
    const rewindRecord = rewindEvents.find((line) => line.includes('"operator_rewind"')) ?? '';
    const rewindNormalized = normalizeGolden([rewindLines.join('\n'), `exit:${rewindCode}`, rewindRecord].join('\n'), root);
    await expectGolden(`${cell.name}-rewind`, rewindNormalized);

    // 2. dispatchKickbackBudgetCommand inspect human
    const humanOutput: string[] = [];
    const humanCode = await dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'n1-golden', format: 'human' },
      { cwd: root, resolveMainRoot: async () => root, print: (line: string) => humanOutput.push(line) },
    );
    const humanNormalized = normalizeGolden(humanOutput.join('\n') + `\nexit:${humanCode}`, root);
    await expectGolden(`${cell.name}-kickback-human`, humanNormalized);

    // 3. dispatchKickbackBudgetCommand inspect json
    const jsonOutput: string[] = [];
    const jsonCode = await dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'n1-golden', format: 'json' },
      { cwd: root, resolveMainRoot: async () => root, print: (line: string) => jsonOutput.push(line) },
    );
    const jsonNormalized = normalizeGolden(jsonOutput.join('\n') + `\nexit:${jsonCode}`, root);
    await expectGolden(`${cell.name}-kickback-json`, jsonNormalized);

    // 4. runDaemonStatus
    const registryPath = join(root, '.daemon-registry.json');
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1,
      name: 'n1-golden-project',
      path: root,
      status: 'active',
      registeredAt: '2026-01-01T00:00:00Z',
    }]));
    const statusLines: string[] = [];
    await runDaemonStatus({
      registryPath,
      out: (line: string) => statusLines.push(line),
      clock: () => new Date('2026-01-01T00:00:00Z'),
    });
    const statusNormalized = normalizeGolden(statusLines.join('\n'), root);
    await expectGolden(`${cell.name}-daemon-status`, statusNormalized);

    // 5. renderDashboard(await scanInheritedState(...))
    // Need to create a worktree structure for scanInheritedState
    const worktreeBase = join(root, '.worktrees');
    const processedDir = join(root, '.docs', 'shipped');
    await mkdir(worktreeBase, { recursive: true });
    await mkdir(processedDir, { recursive: true });
    // Create a minimal halted worktree so the dashboard has something to render
    const wtSlug = join(worktreeBase, 'n1-golden');
    await mkdir(wtSlug, { recursive: true });
    await mkdir(join(wtSlug, '.pipeline'), { recursive: true });
    await writeFile(join(wtSlug, '.pipeline', 'HALT'), 'test halt\n');
    await writeFile(join(wtSlug, '.pipeline', 'conduct-state.json'), JSON.stringify({
      feature_desc: 'n1-golden', complexity_tier: 'S', track: 'technical',
      last_step: 'build_review', build: 'done', test_suite: 'done', build_review: 'done',
    }));
    const dashboardState = await scanInheritedState({
      worktreeBase,
      processedDir,
      now: () => new Date('2026-01-01T00:00:00Z').getTime(),
      discover: async () => [],
    });
    const dashboardText = normalizeGolden(renderDashboard(dashboardState), root);
    await expectGolden(`${cell.name}-dashboard`, dashboardText);

    // 6. finish-publication PR body
    const finishBody = await (async () => {
      const prUrl = 'https://github.com/acme/widget/pull/42';
      let body = shipDraftPrBody('n1-golden');
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: statePath,
        baseBranch: 'main',
        git: async () => ({ stdout: '' }),
        gh: async () => ({ stdout: JSON.stringify({ url: prUrl, title: 'feat: n1-golden', body, isDraft: true, labels: [] }) }),
        operations: {
          run: async (request: any) => {
            if (request.operation === 'pull-request.edit') body = request.payload.body;
            return {} as never;
          },
        },
        observeReleaseReadiness: async () => 'present',
        repairPresentation: async () => {},
        recordFinish: async () => 0,
      });
      const runState = {
        feature_desc: 'n1-golden', worktree_branch: 'feat/n1-golden', complexity_tier: 'S', track: 'technical',
        build_review: 'done', test_suite: 'done', manual_test: 'done',
        prd_audit: 'done', architecture_review_as_built: 'done', rebase: 'done',
        pr_url: prUrl,
      } as any;
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await (coordinator as any).advance({
          state: runState,
          mode: 'auto',
          daemon: true,
          dispatchJudgment: async () => ({ success: true, publicationDisposition: { kind: 'accepted' } }),
          dispatchAuthoring: async () => ({ success: true }),
          emit: async () => {},
        });
        if (result.kind === 'complete') break;
      }
      return body;
    })();
    await expectGolden(`${cell.name}-finish-body`, finishBody);

    // 7. renderShippedRecordWithCost
    const rollup = await computeCostRollup(root);
    const shippedRecord = renderShippedRecordWithCost({
      slug: 'n1-golden',
      specHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-01-01',
    }, rollup);
    await expectGolden(`${cell.name}-shipped-record`, shippedRecord);
  });
});
