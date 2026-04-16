import type { ConductState, StepDefinition, StepStatus, Phase } from '../types/index.js';

const STATUS_ICONS: Record<string, string> = {
  done: '✓',
  in_progress: '▶',
  pending: '⬚',
  skipped: '→',
  stale: '⚠',
  failed: '✗',
};

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Render a text-based status dashboard showing all steps grouped by phase.
 * Returns an array of lines (no trailing newline on each).
 */
export function renderDashboardLines(
  state: ConductState,
  steps: StepDefinition[],
  featureName?: string,
): string[] {
  const lines: string[] = [];

  // Header
  const name = featureName ?? '(resuming)';
  const tier = state.complexity_tier;
  const headerParts = [`  Conductor: ${name}`];
  if (tier) {
    headerParts.push(`Tier: ${tier}`);
  }

  lines.push(SEPARATOR);
  lines.push(headerParts.join('  |  '));
  lines.push(SEPARATOR);
  lines.push('');

  // Group steps by phase, preserving order
  let currentPhase: Phase | null = null;

  for (const step of steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      lines.push(`  ${currentPhase}`);
    }

    const status: StepStatus = (state[step.name] as StepStatus) ?? 'pending';
    const icon = STATUS_ICONS[status] ?? STATUS_ICONS.pending;
    const suffix = status === 'in_progress' ? ' — running...' : '';
    lines.push(`    ${icon} ${step.label}${suffix}`);
  }

  return lines;
}
