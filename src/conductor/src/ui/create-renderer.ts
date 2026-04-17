import type { ConductorEvent, ConductState, StepDefinition, StepName } from '../types/index.js';
import type { StateResult } from '../types/state.js';
import { formatDashboardSnapshot } from './dashboard-text.js';
import { buildDashboardSnapshot, type ArtifactsByStep } from './dashboard-snapshot.js';
import { getArtifactStatus, STEP_ARTIFACT_GLOBS } from '../engine/artifacts.js';
import { createLiveRegion, type LiveRegion } from './live-region.js';

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
}

const STATUS_ICONS: Record<string, string> = {
  done: '✓',
  in_progress: '▶',
  pending: '⬚',
  skipped: '→',
  stale: '⚠',
  failed: '✗',
};

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
    const snapshot = buildDashboardSnapshot(state, steps, featureDesc, artifacts);
    const lines = formatDashboardSnapshot(snapshot);
    region.update(lines);
  }

  return async (event: ConductorEvent): Promise<void> => {
    switch (event.type) {
      case 'step_started':
        // Transient log above the region, then suspend the region so the
        // interactive Claude session owns the terminal.
        region.log(`  ${STATUS_ICONS.in_progress} ${event.step} — running...`);
        region.suspend();
        break;

      case 'step_completed':
        region.resume();
        await renderDashboard();
        notify('Conductor', `Step completed: ${event.step}`);
        break;

      case 'step_failed':
        region.resume();
        region.log('');
        region.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        region.log(`  ${STATUS_ICONS.failed} STEP FAILED: ${event.step}`);
        region.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        if (event.error) {
          region.log(`  Error output:`);
          for (const line of event.error.split('\n')) region.log(`    ${line}`);
        }
        region.log('');
        await renderDashboard();
        notify('Conductor', `Step failed: ${event.step}`);
        break;

      case 'step_retry':
        region.log(
          `  ↻ ${event.step} — retry ${event.attempt}/${event.maxAttempts}: ${event.reason}`,
        );
        break;

      case 'rate_limit': {
        const mins = Math.ceil(event.waitSeconds / 60);
        region.log(`  ⏸  Rate limited — waiting ${event.waitSeconds}s (~${mins}m) before retry`);
        notify('Conductor', `Rate limited — resuming in ~${mins}m`);
        break;
      }

      case 'session_reset':
        region.log(`  ⟳  Session reset: ${event.reason}`);
        break;

      case 'tier_skip':
      case 'config_skip':
      case 'gate_blocked':
        await renderDashboard();
        break;

      case 'feature_complete':
        await renderDashboard();
        region.log(`\n✓ Feature complete.${event.prUrl ? ` PR: ${event.prUrl}` : ''}`);
        notify('Conductor', 'Pipeline complete!');
        break;

      case 'dashboard_refresh':
        await renderDashboard();
        break;

      case 'checkpoint_reached':
        region.log(`\n── Checkpoint: ${event.step} complete ──`);
        break;
    }
  };
}
