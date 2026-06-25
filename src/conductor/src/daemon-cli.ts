import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { LLMProvider } from './execution/llm-provider.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { registerBuiltins } from './engine/plugin-loader.js';
import { ConductorEventEmitter } from './ui/events.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { Conductor } from './engine/conductor.js';
import { loadConfig } from './engine/config.js';
import type { ConductState, ConductorEvent, StepName } from './types/index.js';
import { runDaemon, type BacklogItem } from './engine/daemon.js';
import { discoverBacklog } from './engine/daemon-backlog.js';
import { makeRunFeature, type FeatureWorktree } from './engine/daemon-runner.js';
import { isProcessed, makeFeatureRunnerDeps } from './engine/daemon-deps.js';

export interface DaemonModeOptions {
  projectRoot: string;
  /** Parallel workers (>= 1). */
  concurrency: number;
  /** Stop after this many features (default: drain the backlog once). */
  maxItems?: number;
  /** Branch the worktrees fork from. */
  baseBranch?: string;
}

// Front-half steps the daemon treats as already done — the human authored the
// specs, so the loop starts at BUILD (acceptance_specs onward).
const PRESEEDED_DONE: StepName[] = [
  'worktree',
  'memory',
  'brainstorm',
  'complexity',
  'stories',
  'conflict_check',
  'plan',
  'architecture_diagram',
  'architecture_review',
];

/**
 * Daemon entry (Phase 6). Drains the backlog of features with existing
 * stories+plan, running each in its own worktree via the gate loop
 * (verifyArtifacts + freshContextPerStep), opening a PR on finish, and tearing
 * the worktree down on success. Unattended; ceilings + supervision live in
 * runDaemon / makeRunFeature.
 */
export async function runDaemonMode(opts: DaemonModeOptions): Promise<void> {
  const { projectRoot } = opts;
  const baseBranch = opts.baseBranch ?? 'main';
  const log = (msg: string) => console.log(`[daemon] ${msg}`);

  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : undefined;

  // One shared provider + event bus across workers (rate limits are shared).
  const events = new ConductorEventEmitter();
  const registry = new PluginRegistry();
  // Surface per-step loop progress on the console. Without this the daemon was
  // silent between `▶ start` and `✓ shipped` (the no-op renderer threw every
  // step_started/gate_verdict/kickback away). Events don't carry a feature slug,
  // so with concurrency > 1 lines from different workers interleave; the `·`
  // prefix marks them as inner-loop progress under the active feature.
  const subscriber = registerBuiltins(registry, events, (event) =>
    renderDaemonEvent(event, log),
  );
  registry.markInitialized();
  subscriber.start();
  const provider = registry.get<LLMProvider>('llm_provider', config?.llm_provider ?? 'claude');

  const worktreeBase = join(projectRoot, '.worktrees');
  await mkdir(worktreeBase, { recursive: true });

  const runConductorInWorktree = async (wt: FeatureWorktree, item: BacklogItem) => {
    const pipelineDir = join(wt.path, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Pre-seed: specs are authored; start the loop at BUILD.
    const seeded: ConductState = { complexity_tier: 'M', feature_desc: item.slug };
    for (const name of PRESEEDED_DONE) {
      (seeded as Record<string, unknown>)[name] = 'done';
    }
    const stateFilePath = join(pipelineDir, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify(seeded, null, 2));

    const stepRunner = new DefaultStepRunner(provider, uuidv4(), wt.path, {
      featureDesc: item.slug,
      pipelineDir,
      config,
      mode: 'auto',
    });

    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      mode: 'auto',
      config,
      projectRoot: wt.path,
      verifyArtifacts: true,
      freshContextPerStep: true,
      fromStep: 'acceptance_specs',
    });
    await conductor.run();
  };

  const deps = makeFeatureRunnerDeps({
    projectRoot,
    worktreeBase,
    baseBranch,
    runConductorInWorktree,
    log,
  });
  const runFeature = makeRunFeature(deps);

  log(`scanning backlog (concurrency ${opts.concurrency})…`);
  const result = await runDaemon(
    {
      discoverBacklog: () => discoverBacklog(projectRoot, (slug) => isProcessed(projectRoot, slug)),
      runFeature,
      log,
    },
    { concurrency: opts.concurrency, maxItems: opts.maxItems, once: true },
  );

  subscriber.stop();
  log(`finished: ${result.processed.length} feature(s) (${result.stoppedReason})`);
  for (const o of result.processed) {
    log(
      `  ${o.slug}: ${o.status}${o.prUrl ? ` ${o.prUrl}` : ''}${o.reason ? ` — ${o.reason}` : ''}`,
    );
  }
}

/**
 * Render the meaningful inner-loop events to the daemon console. Keeps the
 * signal high: step boundaries, failures/retries, unsatisfied gates, kickbacks,
 * halts/convergence, and rate limits — not the full event firehose.
 */
export function renderDaemonEvent(event: ConductorEvent, log: (msg: string) => void): void {
  switch (event.type) {
    case 'step_started':
      log(`· ▶ ${event.step}`);
      break;
    case 'step_completed':
      log(`·   ${event.step} ✓ ${event.status}`);
      break;
    case 'step_failed':
      log(`· ✗ ${event.step} failed (try ${event.retryCount}): ${event.error}`);
      break;
    case 'step_retry':
      log(`· ↻ ${event.step} retry`);
      break;
    case 'gate_verdict':
      if (!event.satisfied) {
        log(`· gate ${event.step}: unsatisfied${event.reason ? ` — ${event.reason}` : ''}`);
      }
      break;
    case 'kickback':
      log(
        `· ↩ kickback: ${event.from} re-opened ${event.to}${event.evidence ? ` — ${event.evidence}` : ''} (×${event.count})`,
      );
      break;
    case 'loop_halt':
      log(`· ✋ loop halted: ${event.reason}`);
      break;
    case 'loop_converged':
      log(`· ✓ gate loop converged`);
      break;
    case 'rate_limit':
      log(`· ⏳ rate limited: waiting ${event.waitSeconds}s`);
      break;
    case 'session_reset':
      log(`· session reset: ${event.reason}`);
      break;
    default:
      break;
  }
}
