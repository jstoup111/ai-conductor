import { describe, it, expect } from 'vitest';
import { createDefaultSleep } from '../../src/engine/daemon.js';

// #329 silent idle-exit regression.
//
// `createDefaultSleep` used to unref its poll timer ("don't block process
// exit"). During an idle poll with NO wake-watchers registered (zero halted/
// parked features — a completely drained backlog), that unref'd timer was the
// process's ONLY pending work, so the node event loop emptied and the daemon
// exited 0 silently mid-await: the continuous daemon died at its first idle
// with no log line, no HALT, no restart marker. Observed live 2026-07-07
// (three consecutive silent boot-deaths ~10s after startup, right after the
// startup sweep, on a drained backlog).
//
// The property that broke is the timer's REF: an idle-poll sleep must hold
// the event loop (`hasRef() === true`). A test-only `onTimer` seam exposes
// the timer because nothing else can observe it — under vitest the runner
// itself keeps the loop alive, so awaiting the sleep resolves either way and
// a naive await-based test is a false green.

describe('daemon idle keepalive (#329 silent idle-exit regression)', () => {
  it('the idle-poll sleep timer holds the event loop (hasRef true)', async () => {
    let timer: NodeJS.Timeout | undefined;
    const sleep = createDefaultSleep({ onTimer: (t) => (timer = t) });

    const p = sleep(20);
    expect(timer).toBeDefined();
    expect(timer!.hasRef()).toBe(true); // unref'd → the daemon dies at first idle

    await p; // still resolves normally
  });
});
