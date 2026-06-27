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

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { v4 as uuidv4 } from 'uuid';
import { Conductor } from './engine/conductor.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { ConductorEventEmitter } from './ui/events.js';
import { loadConfig } from './engine/config.js';
import { readState, writeState } from './engine/state.js';
import { parseArgs, createProgram, type CLIOptions } from './cli.js';
import type { StepName } from './types/index.js';
import { createRenderer } from './ui/create-renderer.js';
import { ALL_STEPS } from './engine/steps.js';
import { sendNotification } from './ui/notifications.js';
import { scanResumableFeatures, selectFeature, formatResumeMenu } from './engine/resume.js';
import { WorktreeManager, checkPrMerged } from './engine/worktree.js';
import { detectAutoResume } from './engine/auto-resume.js';
import {
  verifyCompleteState,
  formatGapReport,
} from './engine/complete-verifier.js';
import { ensureClaudeSettings } from './engine/preflight.js';
import { createLiveRegion } from './ui/live-region.js';
import { TerminalPromptHost } from './ui/terminal/prompt-host.js';
import { runProjectPrelude } from './engine/project-prelude.js';
import { discoverPlugins, registerBuiltins } from './engine/plugin-loader.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { EventPersister } from './engine/event-persister.js';
import { renderReport, ReportError } from './engine/report-renderer.js';
import type { LLMProvider } from "./execution/llm-provider.js";
import type { UISubscriber } from "./ui/types.js";
import { detectRegistryCommand, dispatchRegistry } from './engine/registry-cli.js';
import { detectEngineerCommand, dispatchEngineer } from './engine/engineer-cli.js';
import { detectDaemonCommand } from './engine/daemon-command.js';
import {
  detectDaemonObserveCommand,
  dispatchDaemonObserve,
} from './engine/daemon-observe-cli.js';

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
  // Registry subcommands (Phase 9.2) run NON-INTERACTIVELY and exit — they must
  // not boot the interactive pipeline / live region. Dispatch them before
  // parseArgs (whose "feature description required" rule doesn't apply here).
  const registryCmd = detectRegistryCommand(process.argv);
  if (registryCmd) {
    const code = await dispatchRegistry(registryCmd);
    process.exit(code);
  }

  // Engineer subcommand (Phase 9.3) runs NON-INTERACTIVELY and exits — it routes
  // ideas to registered projects, authors spec branches, and surfaces flywheel
  // lessons. Dispatched before parseArgs, mirroring registry subcommand pattern.
  const engineerCmd = detectEngineerCommand(process.argv);
  if (engineerCmd) {
    const code = await dispatchEngineer(engineerCmd);
    process.exit(code);
  }

  // Read-only daemon observability sub-subcommands (`daemon status` / `daemon
  // logs`) run NON-INTERACTIVELY and exit. Checked BEFORE the daemon run command
  // so `daemon status`/`logs` are never mistaken for a daemon launch.
  const daemonObserveCmd = detectDaemonObserveCommand(process.argv);
  if (daemonObserveCmd) {
    const code = await dispatchDaemonObserve(daemonObserveCmd);
    process.exit(code);
  }

  // Daemon subcommand (Phase 6, promoted from the `--daemon` flag) runs
  // unattended and exits — drain the backlog of features (each in its own
  // worktree, gate loop, PR on finish). Dispatched before parseArgs, mirroring
  // the registry/engineer subcommand pattern. runDaemonMode is imported lazily
  // so the heavy daemon runtime only loads when actually running the daemon.
  const daemonCmd = detectDaemonCommand(process.argv);
  if (daemonCmd) {
    const { runDaemonMode } = await import('./daemon-cli.js');
    await runDaemonMode({ projectRoot: process.cwd(), ...daemonCmd });
    process.exit(0);
  }

  // Top-level `--help` / `-h`: print the FULL command surface — every subcommand
  // (register/create/engineer/daemon) included — not just the bare-pipeline
  // flags. parseArgs uses the base program (no subcommands, so a bare feature
  // description is never mistaken for an unknown command); the discoverable
  // surface lives in createProgram(). Subcommand-specific help is already handled
  // by the dispatchers above, so any `--help` reaching here is top-level.
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    createProgram().outputHelp();
    process.exit(0);
  }

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

  // Handle --report: render summary from events.jsonl and exit (read-only, no Claude session)
  if (opts.report) {
    const eventsLogPath = join(pipelineDir, 'events.jsonl');
    try {
      const report = renderReport(eventsLogPath);
      console.log(report);
    } catch (err) {
      if (err instanceof ReportError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    process.exit(0);
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

  // Handle --diagnose: re-verify SHIP-phase evidence for the named (or
  // current) feature and report gaps. Non-mutating; exits 1 if the state
  // claims complete but evidence is missing, 0 otherwise.
  if (opts.diagnose) {
    let targetWorktree = projectRoot;
    let targetFeatureDesc: string | undefined;
    if (opts.featureDesc) {
      const detection = await detectAutoResume(projectRoot, opts.featureDesc);
      if (detection.kind === 'complete' || detection.kind === 'resume') {
        targetWorktree = detection.worktreePath;
        targetFeatureDesc = opts.featureDesc;
      } else if (detection.kind === 'none') {
        console.log(
          `No conductor state found for "${opts.featureDesc}" — nothing to diagnose.`,
        );
        return;
      } else {
        // orphaned-state: surface the same message --resume would
        console.error(
          `\nOrphaned conductor state in ${detection.stateFilePath}.\n  Run conduct-ts --reset to clear, or recreate the worktree.\n`,
        );
        process.exit(1);
      }
    }
    const verification = await verifyCompleteState(targetWorktree);
    if (verification.ok) {
      console.log(
        `\nState OK: ${targetFeatureDesc ? `"${targetFeatureDesc}"` : 'this worktree'} has consistent SHIP-phase evidence.\n`,
      );
      return;
    }
    console.error(formatGapReport(targetFeatureDesc, targetWorktree, verification));
    console.error(
      '  To roll back feature_status and resume at the first failing step, run:\n' +
        `    conduct-ts ${targetFeatureDesc ? `"${targetFeatureDesc}"` : ''}\n` +
        '  …and answer "y" at the recovery prompt. To inspect raw state: conduct-ts --status\n',
    );
    process.exit(1);
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
      // Re-verify SHIP-phase evidence before trusting feature_status=complete.
      // A prior buggy version of the conductor (pre-0.99.14) could mark a
      // feature complete when pipeline exited mid-implementation without
      // writing the halt marker — cascading lax SHIP gates would then fall
      // through to feature_status=complete. This re-check self-heals those
      // worktrees: if evidence is missing, we surface the gap and offer to
      // roll back to the actual stopping point.
      const verification = await verifyCompleteState(detection.worktreePath);
      if (!verification.ok) {
        console.warn(formatGapReport(opts.featureDesc, detection.worktreePath, verification));
        const answer = await promptHost.ask(
          'Roll back feature_status and resume at the first failing step? [Y/n/q]: ',
        );
        if (answer === 'n' || answer === 'q') {
          console.log(
            '\nNo changes made. To inspect: conduct-ts --status\n' +
              `  To start over: conduct-ts --fresh ${opts.featureDesc ? `"${opts.featureDesc}"` : ''}\n`,
          );
          return;
        }
        // Default Y → roll back. Drop feature_status and flip the failing
        // SHIP steps back to 'pending' so the conductor's resume index
        // lands at the earliest one and the loop re-runs them.
        projectRoot = detection.worktreePath;
        pipelineDir = join(projectRoot, '.pipeline');
        stateFilePath = join(pipelineDir, 'conduct-state.json');
        await mkdir(pipelineDir, { recursive: true });
        const r = await readState(stateFilePath);
        const fixed = r.ok ? { ...r.value } : {};
        delete fixed.feature_status;
        for (const step of verification.failedSteps) {
          (fixed as Record<string, unknown>)[step] = 'pending';
        }
        await writeState(stateFilePath, fixed);
        opts.resume = true;
        console.log(
          `\nRolled back. Resuming "${opts.featureDesc}" at ${verification.failedSteps[0]}.\n`,
        );
      } else {
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
    } else if (detection.kind === 'orphaned-state') {
      // Root-level state says we're past the worktree step, but no worktree
      // exists at any conventional location. Continuing would re-land all
      // downstream artifacts on main and lose the per-feature isolation
      // the worktree step is supposed to provide. Refuse and give the user
      // a clear next-action.
      console.error(
        `\nOrphaned conductor state in ${detection.stateFilePath}.\n` +
          `\n  Feature "${detection.featureDesc ?? opts.featureDesc}" was marked past the worktree step,\n` +
          `  but no worktree exists at any of:\n` +
          detection.expectedLocations.map((p) => `    - ${p}`).join('\n') +
          `\n\n  Either:\n` +
          `    1) Recreate the missing worktree at one of those paths, OR\n` +
          `    2) Run \`conduct-ts --reset\` from this directory to clear the stale state\n` +
          `       (you'll lose the recorded progress, but the actual code on the\n` +
          `       feature branch — if it exists — is untouched).\n` +
          `\n  Refusing to continue here so artifacts don't land on the wrong branch.\n`,
      );
      process.exit(1);
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
  const mode = deriveMode(opts);

  // Set up terminal UI with live dashboard (needed before registry initialization)
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

  // Initialize plugin registry and discover plugins
  const registry = new PluginRegistry();

  // Determine plugin directories
  const globalPluginsDir = join(process.env.HOME || '', '.ai-conductor', 'plugins');
  const projectPluginsDir = join(projectRoot, '.ai-conductor', 'plugins');

  // Discover and register external plugins, then built-ins
  await discoverPlugins(globalPluginsDir, projectPluginsDir, registry);
  registerBuiltins(registry, events, renderEvent);
  registry.markInitialized();

  // Retrieve provider and subscriber from registry with defaults
  const provider = registry.get<LLMProvider>(
    'llm_provider',
    config?.llm_provider ?? 'claude'
  );

  // Select UI subscriber based on config (default: 'terminal')
  const subscriber = registry.get<UISubscriber>(
    'ui_renderer',
    config?.ui_renderer ?? 'terminal'
  );

  subscriber.start();

  // Wire EventPersister: appends every ConductorEvent as a JSON line to .pipeline/events.jsonl
  const eventsLogPath = join(pipelineDir, 'events.jsonl');
  const persister = new EventPersister(eventsLogPath, events);
  persister.start();

  const stepRunner = new DefaultStepRunner(provider, sessionId, projectRoot, {
    featureDesc: opts.featureDesc,
    pipelineDir,
    stepCooldown: opts.cooldown,
    config,
    modelOverride: opts.model,
    mode,
  });

  // Project-level prelude: bootstrap (if never run or migration pending) and
  // assess (if project has code and assessment is missing/stale). Runs ONCE
  // before the per-feature loop. Auto mode skips the staleness prompt — users
  // get a nudge on the next interactive run.
  const harnessVersion = await readHarnessVersion();
  const interactivePrompt: ((r: { days: number; commits: number }) => Promise<boolean>) | undefined =
    mode === 'auto' ? undefined : async ({ days, commits }) => {
      console.log(
        `\n⚠ Last assessment was ${days} days / ${commits} commits ago ` +
          `(thresholds: ${config?.assess?.stale_after_days ?? 90} days / ` +
          `${config?.assess?.stale_after_commits ?? 500} commits).`,
      );
      const answer = await promptHost.confirm('Re-run /assess now?', false);
      return answer;
    };
  const prelude = await runProjectPrelude(
    projectRoot,
    provider,
    sessionId,
    config ?? {},
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
    featureDesc: opts.featureDesc,
    verifyArtifacts: true,
    onCheckpoint: (s) => promptHost.checkpoint(s),
    onNavigate: (steps) => promptHost.navigate(steps),
    onReviewArtifacts: (s, files) => promptHost.reviewArtifacts(s, files),
    onRecovery: (s, isGating) => promptHost.recovery(s, isGating),
    onComplexityAssessment: (r) => promptHost.complexityAssessment(r),
  });

  await conductor.run();

  persister.stop();
  subscriber.stop();
}

// Only run the CLI when executed directly (e.g. `node dist/index.js` via
// bin/conduct-ts) — NOT when imported (e.g. by tests importing `deriveMode`).
// Without this guard, importing the module runs main(), which process.exit(1)s
// in a non-CLI context and pollutes the parallel test run with an unhandled
// rejection (flaky failures + non-zero exit).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal:', err.message ?? err);
    process.exit(1);
  });
}
