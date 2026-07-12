import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { ConductorEvent, ConductState, StepDefinition, StepName } from '../types/index.js';
import type { StateResult } from '../types/state.js';
import { formatDashboardSnapshot } from './dashboard-text.js';
import { buildDashboardSnapshot, type ArtifactsByStep } from './dashboard-snapshot.js';
import type { DashboardSnapshot, UIRenderer, ViewMode } from './types.js';
import { getArtifactStatus, STEP_ARTIFACT_GLOBS } from '../engine/artifacts.js';
import { createLiveRegion, type LiveRegion } from './live-region.js';
import { formatProgressDelta } from '../engine/format-retry-line.js';

export interface TerminalRendererOptions {
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
 * UIRenderer implementation that draws the dashboard into a sticky live region.
 * Transient messages (step started / failed) go above the region as log lines;
 * the region is cleared during interactive step execution so the subprocess
 * can use the terminal cleanly.
 */
export class TerminalRenderer implements UIRenderer {
  readonly name = 'terminal';

  private readonly stateFilePath: string;
  private readonly featureDesc: string | undefined;
  private readonly steps: StepDefinition[];
  private readonly readStateFn: (path: string) => Promise<StateResult<ConductState>>;
  private readonly notifyFn: ((title: string, message: string) => Promise<void>) | undefined;
  private readonly projectRoot: string | undefined;
  private readonly region: LiveRegion;
  private readonly viewMode: ViewMode;
  private readonly tailLines: number;

  private currentStep: DashboardSnapshot['currentStep'];
  private lastStepTail: DashboardSnapshot['lastStepTail'];
  private spinner: Ora | null = null;

  constructor(opts: TerminalRendererOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.featureDesc = opts.featureDesc;
    this.steps = opts.steps;
    this.readStateFn = opts.readStateFn;
    this.notifyFn = opts.notifyFn;
    this.projectRoot = opts.projectRoot;
    this.region = opts.liveRegion ?? createLiveRegion();
    this.viewMode = opts.viewMode ?? 'full';
    this.tailLines = opts.tailLines ?? 20;
  }

  private stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  private notify(title: string, message: string): void {
    if (this.notifyFn) this.notifyFn(title, message).catch(() => {});
  }

  private async collectArtifacts(): Promise<ArtifactsByStep | undefined> {
    if (!this.projectRoot) return undefined;
    const out: ArtifactsByStep = {};
    for (const step of this.steps) {
      const globs = STEP_ARTIFACT_GLOBS[step.name];
      if (!globs || globs.length === 0) continue;
      out[step.name as StepName] = await getArtifactStatus(this.projectRoot, step.name);
    }
    return out;
  }

  private async renderDashboard(): Promise<void> {
    const stateResult = await this.readStateFn(this.stateFilePath);
    const state: ConductState = stateResult.ok ? stateResult.value : {};
    const artifacts = await this.collectArtifacts();
    const base = buildDashboardSnapshot(state, this.steps, this.featureDesc, artifacts);
    const snapshot: DashboardSnapshot = { ...base, currentStep: this.currentStep, lastStepTail: this.lastStepTail };
    const lines = formatDashboardSnapshot(snapshot, { viewMode: this.viewMode, tailLines: this.tailLines });
    this.region.update(lines);
  }

  async handle(event: ConductorEvent): Promise<void> {
    // Any event other than rate_limit itself means we're unblocked — stop
    // the countdown spinner if one is running.
    if (event.type !== 'rate_limit' && this.spinner) {
      this.stopSpinner();
    }

    switch (event.type) {
      case 'step_started': {
        const def = this.steps.find((s) => s.name === event.step);
        this.currentStep = {
          name: event.step,
          label: def?.label ?? event.step,
          startedAtMs: Date.now(),
        };
        this.region.log(`  ${chalk.cyan('▶')} ${def?.label ?? event.step} ${chalk.dim('— running...')}`);
        this.region.suspend();
        break;
      }

      case 'step_completed':
        this.currentStep = undefined;
        if (event.tail && event.tail.length > 0) {
          this.lastStepTail = { step: event.step, lines: event.tail };
        }
        this.region.resume();
        await this.renderDashboard();
        this.notify('Conductor', `Step completed: ${event.step}`);
        break;

      case 'step_failed':
        this.currentStep = undefined;
        this.region.resume();
        this.region.log('');
        this.region.log(chalk.bold.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        this.region.log(chalk.bold.red(`  ✗ STEP FAILED: ${event.step}`));
        this.region.log(chalk.bold.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        if (event.error) {
          this.region.log(chalk.red('  Error output:'));
          for (const line of event.error.split('\n')) this.region.log(chalk.red(`    ${line}`));
        }
        this.region.log('');
        await this.renderDashboard();
        this.notify('Conductor', `Step failed: ${event.step}`);
        break;

      case 'step_retry': {
        const delta = formatProgressDelta(event.resolvedBefore, event.resolvedAfter);
        this.region.log(
          chalk.yellow(
            `  ↻ ${event.step} — retry ${event.attempt}/${event.maxAttempts}: ${event.reason}${delta ? ' ' + delta : ''}`,
          ),
        );
        break;
      }

      case 'rate_limit': {
        const mins = Math.ceil(event.waitSeconds / 60);
        this.stopSpinner();
        this.region.suspend();
        this.spinner = ora(chalk.yellow(`Rate limited — resuming in ~${mins}m (${event.waitSeconds}s)`)).start();
        this.notify('Conductor', `Rate limited — resuming in ~${mins}m`);
        break;
      }

      case 'session_reset':
        this.region.log(chalk.yellow(`  ⟳  Session reset: ${event.reason}`));
        break;

      case 'tier_skip':
      case 'config_skip':
      case 'gate_blocked':
        this.currentStep = undefined;
        await this.renderDashboard();
        break;

      case 'feature_complete': {
        this.currentStep = undefined;
        await this.renderDashboard();
        const title = event.featureDesc
          ? `   FEATURE COMPLETE: ${event.featureDesc}   `
          : '   FEATURE COMPLETE   ';
        // Pad both sides of the title bar to a fixed minimum so the banner
        // is unmistakable even on a long terminal.
        const minWidth = Math.max(title.length, 44);
        const bar = ' '.repeat(minWidth);
        const padded = title.padEnd(minWidth, ' ');
        const lines = [
          '',
          chalk.bold.bgGreen.black(bar),
          chalk.bold.bgGreen.black(padded),
          chalk.bold.bgGreen.black(bar),
          '',
          chalk.green(
            event.prUrl
              ? `  PR: ${event.prUrl}`
              : '  No PR (chosen outcome was merge-local / keep / discard).',
          ),
          chalk.dim(
            '  All 14 steps verified. Re-run with --fresh to start a new feature.',
          ),
          '',
        ];
        this.region.log(lines.join('\n'));
        this.notify(
          'Conductor',
          event.featureDesc ? `Feature complete: ${event.featureDesc}` : 'Pipeline complete!',
        );
        break;
      }

      case 'dashboard_refresh':
        await this.renderDashboard();
        break;

      case 'checkpoint_reached':
        this.region.log(chalk.dim(`\n── Checkpoint: ${event.step} complete ──`));
        break;

      case 'renderer_error':
        // Log renderer errors as warnings — don't crash the pipeline.
        this.region.log(chalk.yellow(`  ⚠ Renderer error [${event.rendererName}]: ${event.error}`));
        break;
      case 'gate_verdict':
        // Only surface unsatisfied verdicts — satisfied ones are routine.
        if (!event.satisfied) {
          this.region.log(
            chalk.dim(`  gate ${event.step}: unsatisfied${event.reason ? ` — ${event.reason}` : ''}`),
          );
        }
        break;
      case 'kickback':
        this.region.log(
          chalk.yellow(
            `  ↩ kickback: ${event.from} re-opened ${event.to}${event.evidence ? ` — ${event.evidence}` : ''} (×${event.count})`,
          ),
        );
        break;
      case 'loop_halt':
        this.region.log(chalk.red(`  ✋ loop halted: ${event.reason}`));
        break;
      case 'loop_converged':
        this.region.log(chalk.green('  ✓ gate loop converged'));
        break;
    }
  }

  stop(): void {
    this.stopSpinner();
    this.region.clear();
  }
}

