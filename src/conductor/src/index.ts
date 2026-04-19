export * from './types/index.js';
export { parseArgs, createProgram, type CLIOptions } from './cli.js';

import type { RunMode } from './types/index.js';

export function deriveMode(opts: { auto: boolean; interactive: boolean }): RunMode {
  if (opts.auto && opts.interactive) {
    console.error('Error: --auto and --interactive are mutually exclusive');
    process.exit(1);
  }
  return opts.auto ? 'auto' : opts.interactive ? 'interactive' : 'default';
}

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { Conductor } from './engine/conductor.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { ClaudeProvider } from './execution/claude-provider.js';
import { ConductorEventEmitter } from './ui/events.js';
import { TerminalSubscriber } from './ui/subscriber.js';
import { loadConfig } from './engine/config.js';
import { readState, writeState } from './engine/state.js';
import { parseArgs, type CLIOptions } from './cli.js';
import type { StepName } from './types/index.js';
import { createRenderer } from './ui/create-renderer.js';
import { ALL_STEPS } from './engine/steps.js';
import { sendNotification } from './ui/notifications.js';
import { scanResumableFeatures, selectFeature, formatResumeMenu } from './engine/resume.js';
import { WorktreeManager, checkPrMerged } from './engine/worktree.js';
import { detectAutoResume } from './engine/auto-resume.js';
import { ensureClaudeSettings } from './engine/preflight.js';
import { createLiveRegion } from './ui/live-region.js';
import { TerminalPromptHost } from './ui/terminal/prompt-host.js';
import { runProjectPrelude } from './engine/project-prelude.js';

// Harness VERSION lookup: probes a few candidate locations because the
// installed layout can be a symlink chain (~/.local/bin/conduct-ts →
// <harness>/bin/conduct-ts → <harness>/src/conductor/dist/index.js).
// Returns '0.0.0' on failure so `defaultHasMigration` returns false (no
// re-bootstrap triggered).
async function readHarnessVersion(): Promise<string> {
  // Resolve relative to the bundled entry: <harness>/src/conductor/dist/index.js
  // or the dev path <harness>/src/conductor/src/index.ts. Either way VERSION
  // is two levels up from the conductor package root.
  const candidates = [
    join(process.cwd(), 'VERSION'),
    join(__dirname, '..', '..', '..', 'VERSION'),
    join(__dirname, '..', '..', '..', '..', 'VERSION'),
  ];
  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf-8');
      const v = raw.trim();
      if (/^\d+\.\d+\.\d+/.test(v)) return v;
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}

// --- Merged worktree cleanup ---

async function cleanupMergedWorktrees(
  projectRoot: string,
  promptHost: TerminalPromptHost,
): Promise<void> {
  const features = await scanResumableFeatures(projectRoot);
  const manager = new WorktreeManager(projectRoot);
  let cleaned = 0;

  for (const feature of features) {
    // Read state to check for pr_url
    let prUrl: string | undefined;
    try {
      const stateResult = await readState(join(feature.path, 'conduct-state.json'));
      if (stateResult.ok) {
        prUrl = stateResult.value.pr_url;
      }
    } catch {
      // No state — skip
    }
    // Also check .pipeline location
    if (!prUrl) {
      try {
        const stateResult = await readState(join(feature.path, '.pipeline', 'conduct-state.json'));
        if (stateResult.ok) {
          prUrl = stateResult.value.pr_url;
        }
      } catch {
        // No state — skip
      }
    }

    if (!prUrl) continue;

    const merged = await checkPrMerged(prUrl);
    if (merged) {
      const answer = await promptHost.ask(`  Remove merged worktree "${feature.name}"? [y/n]: `);
      if (answer === 'y') {
        await manager.cleanup(feature.name);
        console.log(`  Removed: ${feature.name}`);
        cleaned++;
      }
    }
  }

  if (cleaned === 0) {
    console.log('  No merged worktrees to clean up.');
  } else {
    console.log(`  Cleaned up ${cleaned} merged worktree${cleaned === 1 ? '' : 's'}.`);
  }
}

// --- Main ---

async function main(): Promise<void> {
  let opts: CLIOptions;
  try {
    opts = parseArgs(process.argv);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : 'Failed to parse arguments');
    process.exit(1);
  }

  let projectRoot = process.cwd();
  let pipelineDir = join(projectRoot, '.pipeline');
  let stateFilePath = join(pipelineDir, 'conduct-state.json');

  // Ensure .pipeline/ exists
  await mkdir(pipelineDir, { recursive: true });

  // Preflight: ensure .claude/settings.json exists with project-scoped
  // permissions. Solves the chicken-and-egg where bootstrap can't write its
  // own permission file without permission. Idempotent — no-op if present.
  await ensureClaudeSettings(projectRoot);

  // Shared UI state: one live region, one prompt host. The host suspends the
  // region around each readline prompt so dashboard and prompts don't fight
  // for the terminal.
  const liveRegion = createLiveRegion();
  const promptHost = new TerminalPromptHost(liveRegion);

  // Load config (optional — conductor works without it)
  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : undefined;
  if (configResult.ok && configResult.warnings.length > 0) {
    for (const w of configResult.warnings) {
      console.warn(`⚠ Config warning: ${w}`);
    }
  }
  if (!configResult.ok && configResult.error.type !== 'missing') {
    console.error(`Config error: ${configResult.error.message}`);
    process.exit(1);
  }

  // Handle --status: show state and exit
  if (opts.status) {
    const stateResult = await readState(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    console.log('\n## Conductor State\n');
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  // Handle --reset: clear state and exit
  if (opts.reset) {
    await writeState(stateFilePath, {});
    console.log('State cleared.');
    return;
  }

  // Handle --cleanup: check for merged worktrees and clean up
  if (opts.cleanup) {
    console.log('\nChecking for merged worktrees...\n');
    await cleanupMergedWorktrees(projectRoot, promptHost);
    return;
  }

  // Auto-resume: if a feature description was provided and a worktree for its
  // slug already exists with in-progress state, silently redirect to that
  // worktree and enable resume. --fresh bypasses this.
  if (opts.featureDesc && !opts.resume && !opts.fresh && !opts.from && !opts.step) {
    const detection = await detectAutoResume(projectRoot, opts.featureDesc);
    if (detection.kind === 'resume') {
      projectRoot = detection.worktreePath;
      pipelineDir = join(projectRoot, '.pipeline');
      stateFilePath = detection.stateFilePath;
      await mkdir(pipelineDir, { recursive: true });
      opts.resume = true;
      const position =
        detection.lastStep
          ? `${detection.stepIndex}/${detection.totalSteps} (after ${detection.lastStep})`
          : 'step 1';
      console.log(
        `\nResuming "${opts.featureDesc}" at ${position}. Use --fresh to start over.\n`,
      );
    } else if (detection.kind === 'complete') {
      const answer = await promptHost.ask(
        `Feature "${opts.featureDesc}" is already marked complete (${detection.worktreePath}). Start over? [y/N]: `,
      );
      if (answer !== 'y') {
        console.log('Exiting. Use --fresh to force a new start.');
        return;
      }
      // User chose to start over — clear the existing state and continue fresh.
      projectRoot = detection.worktreePath;
      pipelineDir = join(projectRoot, '.pipeline');
      stateFilePath = join(pipelineDir, 'conduct-state.json');
      await mkdir(pipelineDir, { recursive: true });
      await writeState(stateFilePath, {});
    }
  }

  // Handle --resume: check for merged worktrees, then scan and present selection menu
  if (opts.resume && !opts.featureDesc) {
    await cleanupMergedWorktrees(projectRoot, promptHost);
    const features = await scanResumableFeatures(projectRoot);
    if (features.length === 0) {
      console.error('No active features found in .worktrees/');
      process.exit(1);
    }

    let selected = selectFeature(features, undefined);
    if (!selected) {
      // Multiple features — show menu and prompt
      console.log(`\n${formatResumeMenu(features)}\n`);
      const answer = await promptHost.ask(`Choose feature [0-${features.length}]: `);
      const choice = parseInt(answer, 10);
      selected = selectFeature(features, isNaN(choice) ? 0 : choice);
      if (!selected) {
        console.log('Cancelled.');
        return;
      }
    }

    // Reconfigure paths to point at the selected worktree
    projectRoot = selected.path;
    pipelineDir = join(projectRoot, '.pipeline');
    stateFilePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(pipelineDir, { recursive: true });

    // Also check for state in worktree root (legacy location)
    const legacyStatePath = join(selected.path, 'conduct-state.json');
    try {
      const legacyState = await readFile(legacyStatePath, 'utf-8');
      if (legacyState.trim()) {
        // Use worktree root state if .pipeline state doesn't exist
        const pipelineResult = await readState(stateFilePath);
        if (!pipelineResult.ok || Object.keys(pipelineResult.value).length === 0) {
          stateFilePath = legacyStatePath;
        }
      }
    } catch {
      // No legacy state — use .pipeline
    }

    if (!opts.featureDesc && selected.featureDesc) {
      opts.featureDesc = selected.featureDesc;
    }
  }

  // Set up conductor — reuse persisted session ID if resuming
  let sessionId: string;
  const sessionIdPath = join(pipelineDir, 'conduct-session-id');
  try {
    const persisted = await readFile(sessionIdPath, 'utf-8');
    sessionId = persisted.trim() || uuidv4();
  } catch {
    sessionId = uuidv4();
  }

  const events = new ConductorEventEmitter();
  const provider = new ClaudeProvider();
  const mode = deriveMode(opts);
  const stepRunner = new DefaultStepRunner(provider, sessionId, projectRoot, {
    featureDesc: opts.featureDesc,
    pipelineDir,
    stepCooldown: opts.cooldown,
    config,
    modelOverride: opts.model,
    mode,
  });

  // Set up terminal UI with live dashboard
  const renderEvent = createRenderer({
    stateFilePath,
    featureDesc: opts.featureDesc,
    steps: ALL_STEPS,
    readStateFn: readState,
    notifyFn: sendNotification,
    projectRoot,
    liveRegion,
    viewMode: opts.view,
    tailLines: opts.tailLines,
  });
  const subscriber = new TerminalSubscriber(events, renderEvent);
  subscriber.start();

  // Store feature description in state if provided
  if (opts.featureDesc) {
    const stateResult = await readState(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    if (!state.feature_desc) {
      state.feature_desc = opts.featureDesc;
      await writeState(stateFilePath, state);
    }
  }

  console.log(`\n## Conductor: ${opts.featureDesc ?? '(resuming)'}\n`);

  // Project-level prelude: bootstrap (if never run or migration pending) and
  // assess (if project has code and assessment is missing/stale). Runs ONCE
  // before the per-feature loop. Auto mode skips the staleness prompt — users
  // get a nudge on the next interactive run.
  const harnessVersion = await readHarnessVersion();
  const interactivePrompt: ((r: { days: number; commits: number }) => Promise<boolean>) | undefined =
    mode === 'auto' ? undefined : async ({ days, commits }) => {
      console.log(
        `\n⚠ Last assessment was ${days} days / ${commits} commits ago ` +
          `(thresholds: ${config.assess?.stale_after_days ?? 90} days / ` +
          `${config.assess?.stale_after_commits ?? 500} commits).`,
      );
      const answer = await promptHost.confirm('Re-run /assess now?', false);
      return answer;
    };
  const prelude = await runProjectPrelude(
    projectRoot,
    provider,
    sessionId,
    config,
    { harnessVersion, onAssessStalePrompt: interactivePrompt },
  );
  if (prelude.bootstrapExecuted) {
    console.log(
      `[prelude] bootstrap ran (${prelude.bootstrapReason}): ${
        prelude.bootstrapSuccess ? 'ok' : 'failed'
      }`,
    );
  }
  if (prelude.assessExecuted) {
    console.log(
      `[prelude] assess ran (${prelude.assessReason}): ${
        prelude.assessSuccess ? 'ok' : 'failed'
      }`,
    );
  }

  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    events,
    resume: opts.resume,
    fromStep: opts.from as StepName | undefined,
    mode,
    config,
    projectRoot,
    verifyArtifacts: true,
    onCheckpoint: (s) => promptHost.checkpoint(s),
    onNavigate: (steps) => promptHost.navigate(steps),
    onReviewArtifacts: (s, files) => promptHost.reviewArtifacts(s, files),
    onRecovery: (s, isGating) => promptHost.recovery(s, isGating),
    onComplexityAssessment: (r) => promptHost.complexityAssessment(r),
  });

  await conductor.run();

  subscriber.stop();
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
