import type { ConductState, StepDefinition, Phase, StepStatus } from '../types/index.js';
import type { DashboardSnapshot, StepSnapshot } from './types.js';
import type { ArtifactPatternStatus } from '../engine/artifacts.js';
import { buildDashboardSnapshot, type ArtifactsByStep } from './dashboard-snapshot.js';

export type { ArtifactsByStep };

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
 *
 * This is a thin formatter over `buildDashboardSnapshot`. Non-terminal UIs
 * should consume the snapshot directly instead of parsing these strings.
 */
export function renderDashboardLines(
  state: ConductState,
  steps: StepDefinition[],
  featureName?: string,
  artifacts?: ArtifactsByStep,
): string[] {
  const snapshot = buildDashboardSnapshot(state, steps, featureName, artifacts);
  return formatDashboardSnapshot(snapshot);
}

export function formatDashboardSnapshot(snapshot: DashboardSnapshot): string[] {
  const lines: string[] = [];

  const name = snapshot.featureName ?? '(resuming)';
  const headerParts = [`  Conductor: ${name}`];
  if (snapshot.complexityTier) {
    headerParts.push(`Tier: ${snapshot.complexityTier}`);
  }

  lines.push(SEPARATOR);
  lines.push(headerParts.join('  |  '));
  lines.push(SEPARATOR);
  lines.push('');

  let currentPhase: Phase | null = null;
  for (const step of snapshot.steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      lines.push(`  ${currentPhase}`);
    }
    lines.push(...formatStep(step));
  }

  return lines;
}

function formatStep(step: StepSnapshot): string[] {
  const icon = STATUS_ICONS[step.status] ?? STATUS_ICONS.pending;
  const suffix = step.status === 'in_progress' ? ' — running...' : '';
  const lines = [`    ${icon} ${step.label}${suffix}`];
  if (step.artifacts) {
    for (const a of step.artifacts) {
      lines.push(...renderArtifactPattern(a));
    }
  }
  return lines;
}

function renderArtifactPattern(status: ArtifactPatternStatus): string[] {
  if (!status.satisfied) {
    return [`        ✗ ${status.pattern} — missing`];
  }
  if (status.files.length === 1) {
    return [`        ✓ ${status.files[0]}`];
  }
  const lines = [`        ✓ ${status.pattern} (${status.files.length} files)`];
  for (const f of status.files.slice(0, 3)) {
    lines.push(`            • ${f}`);
  }
  if (status.files.length > 3) {
    lines.push(`            … +${status.files.length - 3} more`);
  }
  return lines;
}
