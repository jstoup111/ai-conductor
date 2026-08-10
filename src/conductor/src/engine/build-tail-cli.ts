import {
  computeBuildTailRollup,
  readBuildWindows,
  type BuildTailRollup,
} from './build-tail-rollup.js';

export interface BuildTailDispatch {
  kind: 'build-tail';
  worktree?: string;
}

/** Parse `conduct-ts build-tail [worktree]` without starting a pipeline. */
export function detectBuildTailCommand(argv: string[]): BuildTailDispatch | null {
  if (argv[2] !== 'build-tail') return null;
  return { kind: 'build-tail', worktree: argv[3] };
}

function renderMeasuredRollup(rollup: Extract<BuildTailRollup, { state: 'measured' }>): string {
  const firstPass = rollup.windows.filter((window) => window.classification === 'first-pass').length;
  const taskWindows = rollup.windows.filter((window) => window.taskExecution !== undefined);
  const taskDurationMs = taskWindows.reduce((total, window) => total + window.taskExecution!.durationMs, 0);
  const remediationTicks = rollup.windows.reduce(
    (total, window) => total + window.postResolutionTicks.filter((tick) => tick.classification === 'remediation').length,
    0,
  );
  const closeoutTicks = rollup.windows.reduce(
    (total, window) => total + window.postResolutionTicks.filter((tick) => tick.classification === 'closeout').length,
    0,
  );
  const recordedCloseouts = rollup.windows.filter((window) => window.closeout.state === 'recorded');
  const closeoutDurationMs = recordedCloseouts.reduce(
    (total, window) => total + (window.closeout.state === 'recorded' ? window.closeout.durationMs : 0),
    0,
  );
  const obligations = new Map<string, number>();
  for (const window of recordedCloseouts) {
    if (window.closeout.state !== 'recorded') continue;
    for (const [obligation, durationMs] of Object.entries(window.closeout.obligations)) {
      obligations.set(obligation, (obligations.get(obligation) ?? 0) + durationMs);
    }
  }
  const obligationSummary = [...obligations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([obligation, durationMs]) => `${obligation}=${durationMs}ms`)
    .join(', ');

  const lines = ['Build tail rollup: measured', `Windows: ${rollup.windows.length}`];
  for (const [index, window] of rollup.windows.entries()) {
    lines.push(`Window ${index + 1}: ${window.classification}`);
    lines.push(window.taskExecution === undefined
      ? '  Task execution: unresolved'
      : `  Task execution: ${window.taskExecution.durationMs}ms`);
    lines.push(
      `  Post-resolution ticks: remediation=${window.postResolutionTicks.filter((tick) => tick.classification === 'remediation').length}, ` +
      `closeout=${window.postResolutionTicks.filter((tick) => tick.classification === 'closeout').length}`,
    );
    lines.push(window.closeout.state === 'unrecorded'
      ? '  Closeout: unrecorded'
      : `  Closeout: ${window.closeout.durationMs}ms (${Object.entries(window.closeout.obligations)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([obligation, durationMs]) => `${obligation}=${durationMs}ms`)
        .join(', ')})`);
  }
  lines.push('Aggregate:');
  lines.push(`  Classifications: first-pass=${firstPass}, re-entry=${rollup.windows.length - firstPass}`);
  lines.push(`  Task execution: ${taskDurationMs}ms across ${taskWindows.length} window${taskWindows.length === 1 ? '' : 's'}`);
  lines.push(`  Post-resolution ticks: remediation=${remediationTicks}, closeout=${closeoutTicks}`);
  lines.push(`  Closeout: ${closeoutDurationMs}ms recorded across ${recordedCloseouts.length} window${recordedCloseouts.length === 1 ? '' : 's'}`);
  lines.push(`  Obligations: ${obligationSummary || 'unrecorded'}`);
  return lines.join('\n');
}

function renderBuildTailRollup(rollup: BuildTailRollup): string {
  if (rollup.state === 'partial' && rollup.closeout !== undefined) {
    const obligations = Object.entries(rollup.closeout.obligations)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([obligation, durationMs]) => `${obligation}=${durationMs}ms`)
      .join(', ');
    return `Build tail rollup: partial\nCloseout: ${rollup.closeout.durationMs}ms (${obligations})`;
  }
  if (rollup.state !== 'measured') return `Build tail rollup: ${rollup.state}`;
  return renderMeasuredRollup(rollup);
}

/** Render a read-only build-tail decomposition over a worktree's event ledgers. */
export async function dispatchBuildTailCommand(
  command: BuildTailDispatch,
  deps: { cwd?: string; print?: (output: string) => void } = {},
): Promise<number> {
  const worktree = command.worktree ?? deps.cwd ?? process.cwd();
  const windows = await readBuildWindows(worktree);
  const rollup = windows.state === 'measured'
    ? computeBuildTailRollup(windows.windows)
    : windows;
  (deps.print ?? console.log)(renderBuildTailRollup(rollup));
  return 0;
}
