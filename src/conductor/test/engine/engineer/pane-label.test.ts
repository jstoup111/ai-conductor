// Covers: task:1, task:2
import { describe, expect, it, vi } from 'vitest';

const PANE_LABEL_MODULE = '../../../src/engine/engineer/pane-label.js';

async function loadLabelComposerPane(): Promise<(options: {
  slug: string;
  phase: string;
  env: Record<string, string | undefined>;
  run: (command: string, args: string[]) => Promise<void>;
  warn: (line: string) => void;
}) => Promise<void>> {
  const module = await import(PANE_LABEL_MODULE) as Record<string, unknown>;
  const labelComposerPane = module.labelComposerPane;
  if (typeof labelComposerPane !== 'function') {
    throw new Error('expected pane-label module to export labelComposerPane');
  }
  return labelComposerPane as (options: {
    slug: string;
    phase: string;
    env: Record<string, string | undefined>;
    run: (command: string, args: string[]) => Promise<void>;
    warn: (line: string) => void;
  }) => Promise<void>;
}

type Call = { command: string; args: string[] };

function recordingRunner() {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
    },
  };
}

const slug = 'demo-idea';
const phase = 'stories';
const label = 'demo-idea · stories';

describe('labelComposerPane', () => {
  it('renames only the herdr pane with the exact argv when the herdr environment is present', async () => {
    const runner = recordingRunner();
    const labelComposerPane = await loadLabelComposerPane();

    await labelComposerPane({
      slug,
      phase,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
      run: runner.run,
      warn: () => {},
    });

    expect(runner.calls).toEqual([
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', label] },
    ]);
  });

  it('renames only the tmux pane with the exact argv when TMUX_PANE is present', async () => {
    const runner = recordingRunner();
    const labelComposerPane = await loadLabelComposerPane();

    await labelComposerPane({
      slug,
      phase,
      env: { TMUX_PANE: '%3' },
      run: runner.run,
      warn: () => {},
    });

    expect(runner.calls).toEqual([
      { command: 'tmux', args: ['select-pane', '-t', '%3', '-T', label] },
    ]);
  });

  it('renames both panes with the same label when both environments are present', async () => {
    const runner = recordingRunner();
    const labelComposerPane = await loadLabelComposerPane();

    await labelComposerPane({
      slug,
      phase,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', TMUX_PANE: '%3' },
      run: runner.run,
      warn: () => {},
    });

    expect(runner.calls).toEqual(expect.arrayContaining([
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', label] },
      { command: 'tmux', args: ['select-pane', '-t', '%3', '-T', label] },
    ]));
    expect(runner.calls).toHaveLength(2);
  });

  it('does not invoke either runner outside herdr or tmux, including TMUX-only environments', async () => {
    const runner = recordingRunner();
    const labelComposerPane = await loadLabelComposerPane();

    await labelComposerPane({ slug, phase, env: {}, run: runner.run, warn: () => {} });
    await labelComposerPane({ slug, phase, env: { TMUX: '/tmp/tmux-1000/default,1,0' }, run: runner.run, warn: () => {} });

    expect(runner.calls).toEqual([]);
  });

  it('warns once and resolves when the herdr runner rejects', async () => {
    const warn = vi.fn();
    const labelComposerPane = await loadLabelComposerPane();

    await expect(labelComposerPane({
      slug,
      phase,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
      run: async () => { throw new Error('herdr unavailable'); },
      warn,
    })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^compose: pane label skipped \(herdr\): /);
  });

  it('warns once and resolves after 2000 ms when the herdr runner never settles', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const labelComposerPane = await loadLabelComposerPane();
      const result = labelComposerPane({
        slug,
        phase,
        env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
        run: async () => new Promise<void>(() => {}),
        warn,
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^compose: pane label skipped \(herdr\): /);
    } finally {
      vi.useRealTimers();
    }
  });
});
