// Covers: task:1, task:3, task:35, task:rem-prd-audit-rem-v3-n1-guard-gate, task:rem-as-built-rem-as-built-rem-v4-n1-push-argv, task:rem-as-built-rem-asbuilt-d1-n1-golden-probe-list, task:rem-as-built-rem-asbuilt-d1-durable-ref-detection, task:rem-prd-audit-rem-s1-4-n1-golden-leaf-push, task:rem-prd-audit-rem-s1-6-resume-golden-pushed-receipt
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { execa } from 'execa';
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
import { appendTimingSection, renderShippedRecordWithCost } from '../../src/engine/shipped-record.js';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import { shipDraftPrBody } from '../../src/engine/ship-draft-pr.js';
import { bumpKickbackGateInLedger } from '../../src/engine/kickback-ledger.js';
import { runTaskStart } from '../../src/engine/task-cli.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { BASE_SHA, CELLS, expectGolden, normalizeGolden, partitionConductorRefProbes, RECORD, withGitArgvShim } from './n1-golden-shared.js';

const execFile = promisify(execFileCb);

describe('N=1 golden renderings', () => {
  const roots: string[] = [];
  const finishFixture = (name: string) => join(
    import.meta.dirname,
    '..',
    'fixtures',
    'n1-golden',
    'finish',
    `${name}.golden`,
  );
  const expectFinishGolden = async (name: string, actual: string) => {
    const path = finishFixture(name);
    if (RECORD) {
      await mkdir(join(import.meta.dirname, '..', 'fixtures', 'n1-golden', 'finish'), { recursive: true });
      await writeFile(path, `<!-- Recorded from ${BASE_SHA} -->\n${actual}`);
      return;
    }
    const expected = (await readFile(path, 'utf8')).replace(/^<!-- Recorded from [a-f0-9]+ -->\n/, '');
    expect(actual).toBe(expected);
  };

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

    // The operator command resolves only named feature worktrees. Preserve the
    // production-written state and ledger in that worktree so inspect renders
    // the same no-child budget view the CLI sees in a live feature.
    const budgetWorktree = join(root, '.worktrees', 'n1-golden');
    const budgetPipeline = join(budgetWorktree, '.pipeline');
    await mkdir(budgetPipeline, { recursive: true });
    await writeFile(join(budgetPipeline, 'conduct-state.json'), await readFile(statePath));
    await writeFile(
      join(budgetPipeline, 'kickback-ledger.json'),
      await readFile(join(pipeline, 'kickback-ledger.json')),
    );

    // 2. dispatchKickbackBudgetCommand inspect human
    const humanOutput: string[] = [];
    const humanCode = await dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'n1-golden', format: 'human' },
      { cwd: root, resolveMainRoot: async () => root, print: (line: string) => humanOutput.push(line) },
    );
    expect(humanCode).toBe(0);
    expect(humanOutput.join('\n')).not.toContain('is unavailable');
    const humanNormalized = normalizeGolden(humanOutput.join('\n') + `\nexit:${humanCode}`, root);
    await expectGolden(`${cell.name}-kickback-human`, humanNormalized);

    // 3. dispatchKickbackBudgetCommand inspect json
    const jsonOutput: string[] = [];
    const jsonCode = await dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'n1-golden', format: 'json' },
      { cwd: root, resolveMainRoot: async () => root, print: (line: string) => jsonOutput.push(line) },
    );
    expect(jsonCode).toBe(0);
    expect(jsonOutput.join('\n')).not.toContain('is unavailable');
    const jsonNormalized = normalizeGolden(jsonOutput.join('\n') + `\nexit:${jsonCode}`, root);
    await expectGolden(`${cell.name}-kickback-json`, jsonNormalized);
    await rm(budgetWorktree, { recursive: true, force: true });

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
    const worktreeBase = join(root, '.dashboard-worktrees');
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

  it('freezes the N=1 FINISH leaf, state, commands, events, and resumed authoring path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'n1-golden-finish-'));
    roots.push(root);
    const pipeline = join(root, '.pipeline');
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const statePath = join(pipeline, 'conduct-state.json');
    const normalizeRecord = (record: string) => record
      .replace(/^shipped: \d{4}-\d{2}-\d{2}$/m, 'shipped: <DATE>')
      .replace(/^(active_ms|provider_active_ms|no_provider_active_ms): .+$/gm, '$1: <TIME_VALUE>');

    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'n1-golden.md'), '# Implementation Plan: n1-golden\n');
    await writeFile(join(root, 'README.md'), '# n1 golden\n');
    await execFile('git', ['init', '-b', 'main', '-q'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await execFile('git', ['add', 'README.md', '.docs/plans/n1-golden.md'], { cwd: root });
    await execFile('git', ['commit', '-m', 'fixture'], { cwd: root });
    await execFile('git', ['checkout', '-b', 'feat/daemon-n1-golden'], { cwd: root });
    const origin = join(root, 'origin.git');
    await execFile('git', ['init', '--bare', '-b', 'main', '-q', origin], { cwd: root });
    await execFile('git', ['remote', 'add', 'origin', origin], { cwd: root });
    await execFile('git', ['push', '-u', 'origin', 'feat/daemon-n1-golden'], { cwd: root });
    await writeFile(join(pipeline, 'finish-choice'), 'pr\n');

    const state = {
      feature_desc: 'n1-golden',
      worktree_branch: 'feat/daemon-n1-golden',
      complexity_tier: 'S',
      track: 'technical',
      test_suite: 'done',
      build_review: 'done',
      manual_test: 'done',
      architecture_review_as_built: 'done',
      pr_url: prUrl,
    } as any;
    await writeState(statePath, state);
    await writeFile(
      join(pipeline, 'events.jsonl'),
      `${JSON.stringify({
        type: 'step_completed',
        step: 'finish',
        activeInterval: { startedAtMs: 100, durationMs: 250 },
        observedIntervals: [{ startedAtMs: 150, durationMs: 100 }],
      })}\n`,
    );

    const run = async (resumeAfterAuthoring: boolean) => {
      let title = 'feat: n1 golden';
      let body = shipDraftPrBody('n1-golden');
      let isDraft = true;
      const ghArgv: string[][] = [];
      const events: unknown[] = [];
      const git = async (args: string[], opts: { cwd: string }) => {
        const result = await execFile('git', args, { cwd: opts.cwd });
        return { stdout: result.stdout };
      };
      const gh = async (args: string[]) => {
        ghArgv.push(args);
        if (args[0] === 'auth' && args[1] === 'status') return { stdout: 'logged in\n' };
        if (args[0] === 'api' && args[1] === 'user') return { stdout: JSON.stringify({ login: 'test-user', id: 1 }) };
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ url: prUrl, title, body, isDraft, labels: [] }) };
        }
        throw new Error(`unexpected gh argv: ${JSON.stringify(args)}`);
      };
      const operations = {
        run: async (request: { operation: string; payload?: { body?: string } }) => {
          if (request.operation === 'pull-request.edit' && request.payload?.body !== undefined) body = request.payload.body;
          if (request.operation === 'pull-request.ready') isDraft = false;
          return {};
        },
      };
      const makeCoordinator = () => createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: statePath,
        baseBranch: 'main',
        git,
        gh,
        operations: operations as any,
        observeReleaseReadiness: async () => 'present',
        writeShippedRecord: async (command, cwd) => {
          if (command.kind !== 'write') return 1;
          const { slug, pr } = command;
          const record = appendTimingSection(
            renderShippedRecordWithCost({
              slug,
              pr,
              shipped: '2026-01-01',
              specHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            }, await computeCostRollup(cwd)),
            await computeTimingRollup(cwd),
          );
          await mkdir(join(cwd, '.docs', 'shipped'), { recursive: true });
          await writeFile(join(cwd, '.docs', 'shipped', `${slug}.md`), record);
          return 0;
        },
        recordFinish: async () => 0,
      });
      const advance = async (coordinator: ReturnType<typeof makeCoordinator>) => coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchAuthoring: async () => {
          title = 'feat: freeze N=1 FINISH';
          body = '## Why\n\nFreeze the single-leaf FINISH baseline.\n\n## What Changed\n\nCommitted N=1 goldens.\n\n## Testing\n\nai-conductor scoped-run src/conductor/test/engine/n1-golden-renderings.test.ts\n';
          return { success: true };
        },
        dispatchJudgment: async () => ({ success: true, output: '{"kind":"accepted"}' }),
        emit: async (event) => { events.push(event); },
      });

      const gitArgv = await withGitArgvShim(root, async () => {
        let coordinator = makeCoordinator();
        const first = await advance(coordinator);
        expect(first).toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });
        if (resumeAfterAuthoring) coordinator = makeCoordinator();
        const outcomes: unknown[] = [];
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const result = await advance(coordinator);
          outcomes.push(result);
          if (result.kind === 'complete') return;
        }
        throw new Error(`N=1 FINISH did not reach its terminal outcome: ${JSON.stringify(outcomes)}`);
      });

      return { body, ghArgv, gitArgv, events, record: await readFile(join(root, '.docs', 'shipped', 'n1-golden.md'), 'utf8') };
    };

    const normal = await run(false);
    await expectFinishGolden('leaf-body', normal.body);
    await expectFinishGolden('conduct-state', JSON.stringify(JSON.parse(await readFile(statePath, 'utf8')), null, 2));
    await expectFinishGolden('gh-argv', JSON.stringify(normal.ghArgv, null, 2));
    // ADR 2026-10-17 D1 (amended 2026-10-20): local read-only conductor-ref
    // probes are recorded separately; remote and mutating argv stay pinned.
    const normalGit = partitionConductorRefProbes(normal.gitArgv, 'n1-golden');
    await expectFinishGolden('git-argv', JSON.stringify(normalGit.parity, null, 2));
    await expectFinishGolden('git-probe-argv', `${JSON.stringify(normalGit.probes, null, 2)}\n`);
    await expectFinishGolden('events', normal.events.map((event) => JSON.stringify(event)).join('\n'));
    await expectFinishGolden('shipped-record', normalizeRecord(normal.record));
    expect(normal.record).toMatch(/^## Cost\n[\s\S]*^## Time\n(?:state|active_ms):/m);

    await rm(join(root, '.docs', 'shipped'), { recursive: true, force: true });
    await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
    // A resumed real N=1 feature carries the pushed-tip receipt every daemon
    // push records; it is not durable stack state and must not change FINISH.
    await execFile('git', ['update-ref', 'refs/conductor/n1-golden/pushed/feat/daemon-n1-golden', 'HEAD'], { cwd: root });
    const resumed = await run(true);
    await expectFinishGolden('resumed-events', resumed.events.map((event) => JSON.stringify(event)).join('\n'));
    const resumedGit = partitionConductorRefProbes(resumed.gitArgv, 'n1-golden');
    expect(JSON.stringify(resumedGit.parity)).not.toContain('refs/conductor/n1-golden/');
  });

  it('pushes an N=1 FINISH leaf with only local read-only stack probes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'n1-golden-finish-push-'));
    roots.push(root);
    const pipeline = join(root, '.pipeline');
    const branch = 'feat/daemon-n1-push';
    const prUrl = 'https://github.com/acme/widget/pull/43';
    const origin = join(root, 'origin.git');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(root, 'README.md'), '# n1 push golden\n');
    await execFile('git', ['init', '-b', 'main', '-q'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await execFile('git', ['add', 'README.md'], { cwd: root });
    await execFile('git', ['commit', '-m', 'fixture'], { cwd: root });
    await execFile('git', ['checkout', '-b', branch], { cwd: root });
    await writeFile(join(root, 'leaf.txt'), 'leaf\n');
    await execFile('git', ['add', 'leaf.txt'], { cwd: root });
    await execFile('git', ['commit', '-m', 'leaf'], { cwd: root });
    await execFile('git', ['init', '--bare', '-b', 'main', '-q', origin], { cwd: root });
    await execFile('git', ['remote', 'add', 'origin', origin], { cwd: root });
    await execFile('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: root });
    await writeFile(join(root, 'leaf-push.txt'), 'leaf push\n');
    await execFile('git', ['add', 'leaf-push.txt'], { cwd: root });
    await execFile('git', ['commit', '-m', 'leaf push'], { cwd: root });

    const state = {
      feature_desc: 'n1-push',
      worktree_branch: branch,
      complexity_tier: 'S',
      track: 'technical',
      test_suite: 'done',
      build_review: 'done',
      manual_test: 'done',
      architecture_review_as_built: 'done',
    } as any;
    await writeState(join(pipeline, 'conduct-state.json'), state);

    let created = false;
    const git = async (args: string[], opts: { cwd: string }) => {
      if (args.join('\0') === 'remote\0get-url\0--push\0origin') {
        return { stdout: 'https://github.com/acme/widget.git\n' };
      }
      const result = await execFile('git', args, { cwd: opts.cwd });
      return { stdout: result.stdout };
    };
    const gh = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === branch) {
        if (!created) throw new Error('no open PR');
        return { stdout: JSON.stringify({ url: prUrl, state: 'OPEN' }) };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
        return { stdout: JSON.stringify({ url: prUrl, title: 'feat: n1 push', body: shipDraftPrBody('n1-push'), isDraft: true, labels: [] }) };
      }
      throw new Error(`unexpected gh argv: ${JSON.stringify(args)}`);
    };
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: root,
      stateFilePath: join(pipeline, 'conduct-state.json'),
      baseBranch: 'main',
      git,
      gh,
      operations: {
        run: async (request: { operation: string }) => {
          if (request.operation === 'pull-request.create') created = true;
          return {} as never;
        },
      },
      remoteMutation: {
        provenance: {
          repository: 'acme/widget', defaultBranch: 'main', specBranch: branch,
          featureMarker: '.docs/intake/n1-push.md', publication: 'initial',
        },
        dependencies: {
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'test-user' }),
          provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/n1-push.md', content: 'Owner: test-user\n' }] },
        },
      },
      observeReleaseReadiness: async () => 'present',
      recordFinish: async () => 0,
    });

    let outcome: unknown;
    const gitArgv = await withGitArgvShim(root, async () => {
      outcome = await coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchAuthoring: async () => ({ success: true }),
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => {},
      });
    });
    expect(outcome).toEqual({ kind: 'publication_progress', transition: 'establish_pr' });

    const pushed = await execFile('git', ['--git-dir', origin, 'rev-parse', `refs/heads/${branch}`], { cwd: root });
    const leaf = await execFile('git', ['rev-parse', 'HEAD'], { cwd: root });
    expect(pushed.stdout.trim()).toBe(leaf.stdout.trim());
    const pushGit = partitionConductorRefProbes(gitArgv, 'n1-push');
    // Commit SHAs carry fixture timestamps; every other argv byte is pinned.
    const shaFree = (argv: readonly string[][]) => `${JSON.stringify(argv, null, 2).replace(/\b[0-9a-f]{40}\b/g, '<SHA>')}\n`;
    await expectFinishGolden('push-git-argv', shaFree(pushGit.parity));
    await expectFinishGolden('push-git-probe-argv', shaFree(pushGit.probes));
    // The leaf push recorded the ordinary pushed-tip receipt, which is not stack state.
    await execFile('git', ['rev-parse', '--verify', `refs/conductor/n1-push/pushed/${branch}`], { cwd: root });
    expect(pushGit.parity).toContainEqual(expect.arrayContaining(['push', 'origin', `HEAD:refs/heads/${branch}`]));
    expect(JSON.stringify(pushGit.parity)).not.toContain('refs/conductor/n1-push/publication');
    expect(pushGit.parity.some((args) => args[0] === 'ls-remote')).toBe(false);
    // The D11 guard always probes durable child refs; absent metadata is not proof of N=1.
    expect(pushGit.probes).toContainEqual(['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);

    // Resume: push a new leaf tip while that pushed-tip receipt exists. It must
    // stay on the historical unguarded N=1 path (no ls-remote, no stack lease).
    await writeFile(join(root, 'leaf-resume.txt'), 'leaf resume\n');
    await execFile('git', ['add', 'leaf-resume.txt'], { cwd: root });
    await execFile('git', ['commit', '-m', 'leaf resume'], { cwd: root });
    const localArgv: string[][] = [];
    const remoteArgv: string[][] = [];
    await expect(executeRemoteGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
      cwd: root,
      config: async () => ({ stdout: 'https://github.com/acme/widget.git\n' }),
      mutation: {
        provenance: {
          repository: 'acme/widget', defaultBranch: 'main', specBranch: branch,
          featureMarker: '.docs/intake/n1-push.md', publication: 'initial',
        },
        dependencies: {
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'test-user' }),
          provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/n1-push.md', content: 'Owner: test-user\n' }] },
        },
      },
      pushLeaseGit: async (args, input) => {
        localArgv.push([...args]);
        const result = await execa('git', args, { cwd: root, input, reject: false });
        return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
      },
      runRemoteGit: async (args) => {
        remoteArgv.push([...args]);
        return { stdout: '' };
      },
    })).resolves.toMatchObject({ kind: 'executed' });
    const localGit = partitionConductorRefProbes(localArgv, 'n1-push');
    await expectFinishGolden('push-resumed-git-argv', shaFree([...localGit.parity, ...remoteArgv]));
    await expectFinishGolden('push-resumed-git-probe-argv', shaFree(localGit.probes));
    expect(localGit.probes).toEqual(expect.arrayContaining([
      ['for-each-ref', '--format=%(refname)', 'refs/heads/feat'],
      ['for-each-ref', '--format=%(refname)', 'refs/conductor/n1-push/'],
    ]));
    expect(JSON.stringify(localGit.parity)).not.toContain('refs/conductor/n1-push/publication');
  });
});
