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

const PANE_LABEL_TIMEOUT_MS = 2_000;

async function labelPane(
  command: string,
  args: string[],
  run: PaneLabelRunner,
  warn: (line: string) => void,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`timed out after ${PANE_LABEL_TIMEOUT_MS} ms`)), PANE_LABEL_TIMEOUT_MS);
    });
    await Promise.race([
      Promise.resolve().then(() => run(command, args)),
      timeoutResult,
    ]);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
    warn(`compose: pane label skipped (${command}): ${reason}`);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Label the composer pane(s) explicitly identified by the provided environment.
 */
export async function labelComposerPane({
  slug,
  phase,
  env,
  run,
  warn,
}: LabelComposerPaneOptions): Promise<void> {
  const label = `${slug} · ${phase}`;
  const herdrPaneId = env.HERDR_PANE_ID;
  const tmuxPane = env.TMUX_PANE;
  const calls: Promise<void>[] = [];

  if (env.HERDR_ENV === '1' && herdrPaneId) {
    calls.push(labelPane('herdr', ['pane', 'rename', herdrPaneId, label], run, warn));
  }

  if (tmuxPane) {
    calls.push(labelPane('tmux', ['select-pane', '-t', tmuxPane, '-T', label], run, warn));
  }

  await Promise.all(calls);
}
