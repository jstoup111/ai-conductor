import type { ConductorEvent, ConductState, StepDefinition } from '../types/index.js';
import type { StateResult } from '../types/state.js';
import { renderDashboardLines } from './dashboard-text.js';

export interface CreateRendererOptions {
  stateFilePath: string;
  featureDesc?: string;
  steps: StepDefinition[];
  readStateFn: (path: string) => Promise<StateResult<ConductState>>;
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
 * Create a render callback that captures state file path and renders
 * a dashboard on between-step events. Suppresses dashboard during
 * active interactive steps.
 */
export function createRenderer(opts: CreateRendererOptions): (event: ConductorEvent) => Promise<void> {
  const { stateFilePath, featureDesc, steps, readStateFn } = opts;
  let stepActive = false;

  async function renderDashboard(): Promise<void> {
    const stateResult = await readStateFn(stateFilePath);
    const state: ConductState = stateResult.ok ? stateResult.value : {};
    const lines = renderDashboardLines(state, steps, featureDesc);
    for (const line of lines) {
      console.log(line);
    }
  }

  return async (event: ConductorEvent): Promise<void> => {
    switch (event.type) {
      case 'step_started':
        stepActive = true;
        console.log(`  ${STATUS_ICONS.in_progress} ${event.step} — running...`);
        break;

      case 'step_completed':
        stepActive = false;
        await renderDashboard();
        break;

      case 'step_failed':
        stepActive = false;
        console.log(`  ${STATUS_ICONS.failed} ${event.step} — FAILED`);
        if (event.error) {
          console.log(`\n--- Step output ---\n${event.error}\n--- End output ---\n`);
        }
        break;

      case 'tier_skip':
        stepActive = false;
        await renderDashboard();
        break;

      case 'config_skip':
        stepActive = false;
        await renderDashboard();
        break;

      case 'gate_blocked':
        stepActive = false;
        await renderDashboard();
        break;

      case 'feature_complete':
        stepActive = false;
        await renderDashboard();
        console.log(`\n✓ Feature complete.${event.prUrl ? ` PR: ${event.prUrl}` : ''}`);
        break;

      case 'dashboard_refresh':
        if (!stepActive) {
          await renderDashboard();
        }
        break;

      case 'checkpoint_reached':
        console.log(`\n── Checkpoint: ${event.step} complete ──`);
        break;
    }
  };
}
