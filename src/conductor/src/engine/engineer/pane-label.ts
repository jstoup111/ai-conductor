import { execa } from 'execa';

export type PaneLabelRunner = (command: string, args: string[]) => Promise<void>;

export interface LabelComposerPaneOptions {
  slug: string;
  phase: string;
  env: Record<string, string | undefined>;
  run: PaneLabelRunner;
  warn: (line: string) => void;
}

/** Production process boundary for pane-label commands. */
export const defaultPaneLabelRunner: PaneLabelRunner = async (command, args) => {
  await execa(command, args, { timeout: 2_000 });
};

/**
 * Label the composer pane(s) explicitly identified by the provided environment.
 * Error recovery and timeout handling are added by the following task.
 */
export async function labelComposerPane({
  slug,
  phase,
  env,
  run,
}: LabelComposerPaneOptions): Promise<void> {
  const label = `${slug} · ${phase}`;
  const herdrPaneId = env.HERDR_PANE_ID;
  const tmuxPane = env.TMUX_PANE;
  const calls: Promise<void>[] = [];

  if (env.HERDR_ENV === '1' && herdrPaneId) {
    calls.push(run('herdr', ['pane', 'rename', herdrPaneId, label]));
  }

  if (tmuxPane) {
    calls.push(run('tmux', ['select-pane', '-t', tmuxPane, '-T', label]));
  }

  await Promise.all(calls);
}
