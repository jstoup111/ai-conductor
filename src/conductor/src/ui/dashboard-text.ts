import chalk from 'chalk';
import type { ConductState, StepDefinition, Phase } from '../types/index.js';
import type { DashboardSnapshot, StepSnapshot, ViewMode } from './types.js';
import type { ArtifactPatternStatus } from '../engine/artifacts.js';
import { buildDashboardSnapshot, type ArtifactsByStep } from './dashboard-snapshot.js';

export type { ArtifactsByStep };

const ICONS = {
  done: chalk.green('✓'),
  in_progress: chalk.cyan('▶'),
  pending: chalk.dim('⬚'),
  skipped: chalk.gray('→'),
  stale: chalk.yellow('⚠'),
  failed: chalk.red('✗'),
} as const;

const SEPARATOR = chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

export interface FormatOptions {
  viewMode?: ViewMode;
  tailLines?: number;
}

/**
 * Render a text-based status dashboard showing all steps grouped by phase.
 * Returns an array of lines (no trailing newline on each).
 *
 * Thin formatter over `buildDashboardSnapshot`. Non-terminal UIs should
 * consume the snapshot directly instead of parsing these strings.
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

export function formatDashboardSnapshot(
  snapshot: DashboardSnapshot,
  opts: FormatOptions = {},
): string[] {
  const viewMode = opts.viewMode ?? 'full';
  const tailLines = opts.tailLines ?? 20;

  if (viewMode === 'log') {
    return formatLogPane(snapshot, tailLines);
  }

  const lines: string[] = [];

  lines.push(...formatHeader(snapshot));

  if (snapshot.currentStep) {
    lines.push(...formatCurrentStep(snapshot.currentStep));
    lines.push('');
  }

  if (viewMode === 'full') {
    lines.push(...formatStepList(snapshot));
  }

  if (snapshot.lastStepTail && tailLines > 0) {
    lines.push(...formatLastStepTail(snapshot.lastStepTail, tailLines));
  }

  return lines;
}

function formatHeader(snapshot: DashboardSnapshot): string[] {
  const lines: string[] = [];
  const name = snapshot.featureName ?? '(resuming)';
  const headerParts = [`  ${chalk.bold('Conductor:')} ${name}`];
  if (snapshot.complexityTier) {
    headerParts.push(`Tier: ${chalk.bold(snapshot.complexityTier)}`);
  }
  lines.push(SEPARATOR);
  lines.push(headerParts.join('  |  '));
  lines.push(SEPARATOR);
  lines.push('');
  return lines;
}

function formatCurrentStep(current: NonNullable<DashboardSnapshot['currentStep']>): string[] {
  const started = new Date(current.startedAtMs);
  const hh = String(started.getHours()).padStart(2, '0');
  const mm = String(started.getMinutes()).padStart(2, '0');
  const ss = String(started.getSeconds()).padStart(2, '0');
  return [`  ${chalk.cyan('▶')} ${chalk.bold(current.label)} ${chalk.dim(`— started ${hh}:${mm}:${ss}`)}`];
}

function formatStepList(snapshot: DashboardSnapshot): string[] {
  const lines: string[] = [];
  let currentPhase: Phase | null = null;
  for (const step of snapshot.steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      lines.push(`  ${chalk.bold(currentPhase)}`);
    }
    lines.push(...formatStep(step));
  }
  return lines;
}

function formatStep(step: StepSnapshot): string[] {
  const icon = ICONS[step.status as keyof typeof ICONS] ?? ICONS.pending;
  const suffix = step.status === 'in_progress' ? chalk.dim(' — running...') : '';
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
    return [`        ${chalk.red('✗')} ${status.pattern} — missing`];
  }
  if (status.files.length === 1) {
    return [`        ${chalk.green('✓')} ${status.files[0]}`];
  }
  const lines = [`        ${chalk.green('✓')} ${status.pattern} (${status.files.length} files)`];
  for (const f of status.files.slice(0, 3)) {
    lines.push(`            • ${f}`);
  }
  if (status.files.length > 3) {
    lines.push(chalk.dim(`            … +${status.files.length - 3} more`));
  }
  return lines;
}

function formatLastStepTail(
  tail: NonNullable<DashboardSnapshot['lastStepTail']>,
  tailLines: number,
): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.dim(`  Last step output (${tail.step}), last ${Math.min(tail.lines.length, tailLines)} line(s):`));
  for (const line of tail.lines.slice(-tailLines)) {
    lines.push(chalk.dim(`    > ${line}`));
  }
  return lines;
}

function formatLogPane(snapshot: DashboardSnapshot, tailLines: number): string[] {
  if (!snapshot.lastStepTail || tailLines <= 0) {
    return [chalk.dim('  (no step output yet)')];
  }
  const lines: string[] = [];
  lines.push(chalk.dim(`  ${snapshot.lastStepTail.step} — last ${Math.min(snapshot.lastStepTail.lines.length, tailLines)} line(s):`));
  for (const line of snapshot.lastStepTail.lines.slice(-tailLines)) {
    lines.push(chalk.dim(`  > ${line}`));
  }
  return lines;
}
