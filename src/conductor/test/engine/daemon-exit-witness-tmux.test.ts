// Covers: task:9
import { describe, expect, it } from 'vitest';
import { buildDaemonForegroundCommand } from '../../src/engine/daemon-tmux.js';

describe('daemon pane exit-witness wrapper', () => {
  it('keeps the daemon child pid and status paired for the witness', () => {
    const command = buildDaemonForegroundCommand({});

    expect(command).toContain('daemon --continuous & pid=$!; wait "$pid"; rc=$?;');
    expect(command).toContain('daemon exit-witness --pid "$pid" --status "$rc"');
    expect(command).toContain('exit "$rc"');
  });
});
