import {
  computeBuildTailRollup,
  readBuildWindows,
  type BuildTailRollup,
} from './build-tail-rollup.js';

export interface BuildTailDispatch {
  kind: 'build-tail';
  worktree?: string;
}

/** Parse `ai-conductor build-tail [worktree]` without starting a pipeline. */
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
  }
  lines.push('Aggregate:');
  lines.push(`  Classifications: first-pass=${firstPass}, re-entry=${rollup.windows.length - firstPass}`);
  lines.push(`  Task execution: ${taskDurationMs}ms across ${taskWindows.length} window${taskWindows.length === 1 ? '' : 's'}`);
  lines.push(`  Post-resolution ticks: remediation=${remediationTicks}, closeout=${closeoutTicks}`);
  return lines.join('\n');
}

function renderBuildTailRollup(rollup: BuildTailRollup): string {
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
