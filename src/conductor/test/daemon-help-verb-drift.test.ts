import { describe, expect, it } from 'vitest';
import { renderDaemonHelp } from '../src/cli.js';
import { DAEMON_SUBVERBS, MANAGEMENT_VERBS } from '../src/engine/daemon-command.js';

describe('daemon help verb drift', () => {
  // Help declarations do not capture the pre-boot dispatcher route: dispatch
  // precedence for pause/resume is covered by the named "returns {verb:\"pause\"}"
  // and "returns {verb:\"resume\"}" cases in daemon-supervisor-command.test.ts.
  it('declares every verb accepted by the daemon dispatcher', () => {
    const help = renderDaemonHelp();
    const commandListing = help.split(/\n\n─{72}\n/)[0];
    const expectedVerbs = new Set([...MANAGEMENT_VERBS, ...DAEMON_SUBVERBS]);
    const missing = [...expectedVerbs].filter(
      (verb) => !new RegExp(`^\\s+${verb}(?:\\s|$)`, 'm').test(commandListing),
    );

    expect(
      missing,
      `Daemon help is missing declared subcommand(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
