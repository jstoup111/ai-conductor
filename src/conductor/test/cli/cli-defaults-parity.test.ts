import { describe, expect, it } from 'vitest';
import { createProgram, renderDaemonHelp } from '../../src/cli.js';
import {
  DEFAULT_IDLE_POLL_SECONDS,
  RUNTIME_FALLBACK_FLAGS,
  defaultMismatches,
} from '../../src/cli-defaults.js';
import { detectDaemonCommand } from '../../src/engine/daemon-command.js';
import { buildDaemonModeOptions } from '../../src/index.js';

const argv = (...args: string[]) => ['node', 'bin/ai-conductor', ...args];

describe('daemon runtime fallback defaults', () => {
  it('keeps the declared daemon defaults aligned with runtime fallbacks', () => {
    const daemon = createProgram().commands.find((command) => command.name() === 'daemon');
    expect(daemon).toBeDefined();

    for (const entry of RUNTIME_FALLBACK_FLAGS) {
      const option = daemon?.options.find((candidate) => candidate.long === entry.flag);
      expect(option?.defaultValue).toBe(String(entry.value));
    }

    expect(defaultMismatches(RUNTIME_FALLBACK_FLAGS, daemon!)).toEqual([]);
  });

  it('uses the idle-poll fallback in help and a flagless daemon command', async () => {
    const command = detectDaemonCommand(argv('daemon'));
    expect(command?.idlePollSeconds).toBe(DEFAULT_IDLE_POLL_SECONDS);
    expect(renderDaemonHelp()).toMatch(/--idle-poll <seconds>[\s\S]*?\(default: "60"\)/);

    const options = await buildDaemonModeOptions('/repo', command!, {
      sessionNameForRepo: () => 'daemon-repo',
      hasSession: async () => false,
      respawnPane: async () => undefined,
    });
    expect(options.idlePollSeconds).toBe(DEFAULT_IDLE_POLL_SECONDS);
    // runDaemonMode converts this option from seconds to the daemon's milliseconds input.
    expect(options.idlePollSeconds! * 1000).toBe(60_000);
  });

  it('preserves an explicit idle-poll value through daemon mode options', async () => {
    const command = detectDaemonCommand(argv('daemon', '--idle-poll', '5'));
    expect(command?.idlePollSeconds).toBe(5);

    const options = await buildDaemonModeOptions('/repo', command!, {
      sessionNameForRepo: () => 'daemon-repo',
      hasSession: async () => false,
      respawnPane: async () => undefined,
    });
    expect(options.idlePollSeconds).toBe(5);
  });

  it('reports declared/runtime default drift and ignores flags with no declared default', () => {
    const daemon = createProgram().commands.find((command) => command.name() === 'daemon');
    expect(daemon).toBeDefined();

    expect(defaultMismatches([{ flag: '--idle-poll', value: 5 }], daemon!)).toEqual([
      { flag: '--idle-poll', declared: '60', runtime: 5 },
    ]);
    expect(defaultMismatches([{ flag: '--max-idle-polls', value: 5 }], daemon!)).toEqual([]);
  });
});
