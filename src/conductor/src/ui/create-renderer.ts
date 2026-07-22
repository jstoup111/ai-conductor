import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { ConductorEvent, ConductState, StepDefinition, StepName } from '../types/index.js';
import type { StateResult } from '../types/state.js';
import { formatDashboardSnapshot } from './dashboard-text.js';
import { buildDashboardSnapshot, type ArtifactsByStep } from './dashboard-snapshot.js';
import type { DashboardSnapshot, ViewMode } from './types.js';
import { getArtifactStatus, STEP_ARTIFACT_GLOBS } from '../engine/artifacts.js';
import { createLiveRegion, type LiveRegion } from './live-region.js';
import { formatProgressDelta, displayBuildPosition } from '../engine/format-retry-line.js';

export interface CreateRendererOptions {
  stateFilePath: string;
  featureDesc?: string;
  steps: StepDefinition[];
  readStateFn: (path: string) => Promise<StateResult<ConductState>>;
  notifyFn?: (title: string, message: string) => Promise<void>;
  /**
   * Project root for artifact discovery. When set, the dashboard shows each
   * artifact-producing step's files (or ✗ missing).
   */
  projectRoot?: string;
  /**
   * Optional preconstructed live region. Defaults to a TTY-backed region
   * writing to process.stdout. Tests can inject a non-TTY region.
   */
  liveRegion?: LiveRegion;
  /** How to lay out the dashboard. Defaults to 'full'. */
  viewMode?: ViewMode;
  /** Max lines to show in the post-step log tail. 0 disables. Default 20. */
  tailLines?: number;
}

/**
 * Create a render callback that draws the dashboard into a sticky live region.
 * Transient messages (step started / failed) go above the region as log lines;
 * the region is cleared during interactive step execution so the subprocess
 * can use the terminal cleanly.
 */
export function createRenderer(
  opts: CreateRendererOptions,
): (event: ConductorEvent) => Promise<void> {
  const { stateFilePath, featureDesc, steps, readStateFn, notifyFn, projectRoot } = opts;
  const region = opts.liveRegion ?? createLiveRegion();
  const viewMode: ViewMode = opts.viewMode ?? 'full';
  const tailLines = opts.tailLines ?? 20;

  // UI-only overlay state (kept in the renderer, not in engine state).
  let currentStep: DashboardSnapshot['currentStep'];
  let lastStepTail: DashboardSnapshot['lastStepTail'];
  let spinner: Ora | null = null;

  function stopSpinner(): void {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  }

  function notify(title: string, message: string): void {
    if (notifyFn) notifyFn(title, message).catch(() => {});
  }

  async function collectArtifacts(): Promise<ArtifactsByStep | undefined> {
    if (!projectRoot) return undefined;
    const out: ArtifactsByStep = {};
    for (const step of steps) {
      const globs = STEP_ARTIFACT_GLOBS[step.name];
      if (!globs || globs.length === 0) continue;
      out[step.name as StepName] = await getArtifactStatus(projectRoot, step.name);
    }
    return out;
  }

  async function renderDashboard(): Promise<void> {
    const stateResult = await readStateFn(stateFilePath);
    const state: ConductState = stateResult.ok ? stateResult.value : {};
    const artifacts = await collectArtifacts();
    const base = buildDashboardSnapshot(state, steps, featureDesc, artifacts);
    const snapshot: DashboardSnapshot = { ...base, currentStep, lastStepTail };
    const lines = formatDashboardSnapshot(snapshot, { viewMode, tailLines });
    region.update(lines);
  }

  return async (event: ConductorEvent): Promise<void> => {
    // Any event other than rate_limit itself means we're unblocked — stop
    // the countdown spinner if one is running.
    if (event.type !== 'rate_limit' && spinner) {
      stopSpinner();
    }

    switch (event.type) {
      case 'step_started': {
        const def = steps.find((s) => s.name === event.step);
        currentStep = {
          name: event.step,
          label: def?.label ?? event.step,
          startedAtMs: Date.now(),
        };
        region.log(`  ${chalk.cyan('▶')} ${def?.label ?? event.step} ${chalk.dim('— running...')}`);
        region.suspend();
        break;
      }

      case 'step_completed':
        currentStep = undefined;
        if (event.tail && event.tail.length > 0) {
          lastStepTail = { step: event.step, lines: event.tail };
        }
        region.resume();
        await renderDashboard();
        notify('Conductor', `Step completed: ${event.step}`);
        break;

      case 'step_failed':
        currentStep = undefined;
        region.resume();
        region.log('');
        region.log(chalk.bold.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        region.log(chalk.bold.red(`  ✗ STEP FAILED: ${event.step}`));
        region.log(chalk.bold.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        if (event.error) {
          region.log(chalk.red('  Error output:'));
          for (const line of event.error.split('\n')) region.log(chalk.red(`    ${line}`));
        }
        region.log('');
        await renderDashboard();
        notify('Conductor', `Step failed: ${event.step}`);
        break;

      case 'step_retry': {
        const delta = formatProgressDelta(event.resolvedBefore, event.resolvedAfter);
        region.log(
          chalk.yellow(
            `  ↻ ${event.step} — retry ${event.attempt}/${event.maxAttempts}: ${event.reason}${delta ? ' ' + delta : ''}`,
          ),
        );
        break;
      }

      case 'rate_limit': {
        const mins = Math.ceil(event.waitSeconds / 60);
        // Install a spinner rather than a static line. The conductor is
        // sleeping in the engine; we stop the spinner when the next event
        // arrives (retry kicks in, or session_reset, or step_completed).
        stopSpinner();
        region.suspend();
        spinner = ora(chalk.yellow(`Rate limited — resuming in ~${mins}m (${event.waitSeconds}s)`)).start();
        notify('Conductor', `Rate limited — resuming in ~${mins}m`);
        break;
      }

      case 'session_reset':
        region.log(chalk.yellow(`  ⟳  Session reset: ${event.reason}`));
        break;

      case 'when_skip': {
        currentStep = undefined;
        const undefinedNote = event.undefinedKey
          ? chalk.dim(` (key "${event.undefinedKey}" undefined → false)`)
          : '';
        region.log(
          chalk.dim(`  ⊘ ${event.step} skipped — when: ${event.expression}${undefinedNote}`),
        );
        await renderDashboard();
        break;
      }

      case 'parallel_started':
        region.log(
          chalk.cyan(`  ⇶ ${event.step} — parallel [${event.branches.join(', ')}] started`),
        );
        break;

      case 'parallel_completed':
        currentStep = undefined;
        region.log(
          chalk.green(`  ✓ ${event.step} — parallel [${event.branches.join(', ')}] completed`),
        );
        await renderDashboard();
        break;

      case 'parallel_failure':
        region.log(
          chalk.red(`  ✗ ${event.step} — branch "${event.branch}" failed: ${event.error}`),
        );
        break;

      case 'tier_skip':
      case 'config_skip':
      case 'gate_blocked':
        currentStep = undefined;
        await renderDashboard();
        break;

      case 'feature_complete':
        currentStep = undefined;
        await renderDashboard();
        region.log(chalk.bold.green(`\n✓ Feature complete.${event.prUrl ? ` PR: ${event.prUrl}` : ''}`));
        notify('Conductor', 'Pipeline complete!');
        break;

      case 'dashboard_refresh':
        await renderDashboard();
        break;

      case 'checkpoint_reached':
        region.log(chalk.dim(`\n── Checkpoint: ${event.step} complete ──`));
        break;

      case 'build_progress': {
        const task = event.currentTaskId
          ? ` — ${event.currentTaskId}${event.currentTaskName ? ` ${event.currentTaskName}` : ''}`
          : '';
        const displayResolved = displayBuildPosition(
          event.resolved,
          event.total,
          Boolean(event.currentTaskId || event.currentTaskName),
        );
        region.log(
          chalk.cyan(`  ⠿ ${event.step} — progress ${displayResolved}/${event.total}${task}`),
        );
        break;
      }

      case 'build_no_progress': {
        const task = event.currentTaskId ? ` — stuck on ${event.currentTaskId}` : '';
        const displayResolved = displayBuildPosition(
          event.resolved,
          event.total,
          Boolean(event.currentTaskId),
        );
        region.log(
          chalk.yellow(
            `  ⚠ ${event.step} — no progress for ${event.quietMinutes}m (${displayResolved}/${event.total})${task}`,
          ),
        );
        break;
      }

      case 'build_stall':
        region.log(
          chalk.bold.red(
            `  ⛔ ${event.step} — build stalled (${event.reason}): ${event.resolvedBefore}→${event.resolvedAfter} resolved`,
          ),
        );
        break;
    }
  };
}
