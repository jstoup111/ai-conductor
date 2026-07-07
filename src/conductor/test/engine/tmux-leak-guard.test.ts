// ─────────────────────────────────────────────────────────────────────────────
// Test: tmux-leak-guard (#377) — the suite-level net that catches kill-switch
// escapes: any `cc-daemon-*` session created during the run is killed at
// teardown and fails the run with its pane cwd (fixture-dir attribution).
//
// Uses REAL tmux (skips when unavailable). The fixture session is created with
// the kill-switch env unset — same opt-out as the intentional smokes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  listDaemonSessions,
  reapLeakedDaemonSessions,
  killDaemonSession,
} from '../tmux-leak-guard.js';
import {
  tmuxInstalled,
  newDetachedSession,
  hasSession,
} from '../../src/engine/daemon-tmux.js';

describe('tmux-leak-guard (#377)', () => {
  it('a pre-existing session set yields no leaks (operator daemons untouched)', () => {
    const before = new Set(listDaemonSessions());
    expect(reapLeakedDaemonSessions(before)).toEqual([]);
  });

  it('kills and reports a cc-daemon-* session created after the snapshot', async () => {
    if (!(await tmuxInstalled())) return; // no tmux in this sandbox — skip

    const before = new Set(listDaemonSessions());
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;

    // Create the "leak" the way an escape would: real tmux, kill-switch off.
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', '/tmp');
      expect(await hasSession(name)).toBe(true);

      const leaks = reapLeakedDaemonSessions(before);

      // Reported by name with a pane-cwd fingerprint…
      expect(leaks.some((l) => l.includes(name))).toBe(true);
      expect(leaks.find((l) => l.includes(name))).toContain('pane cwd:');
      // …and actually gone (nothing left resident).
      expect(await hasSession(name)).toBe(false);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      } else {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevFlag;
      }
      killDaemonSession(name); // idempotent safety net
    }
  });
});
