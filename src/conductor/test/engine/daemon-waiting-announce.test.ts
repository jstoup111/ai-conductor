import { describe, it, expect, vi } from 'vitest';
import type { WaitingItem } from '../../src/engine/daemon-backlog.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for warn-once WAITING announcements (Task 18 / FR-6 negatives).
//
// `src/engine/daemon-waiting-announce.ts` does NOT exist yet.
//
// Contract:
//
//   function createWaitingAnnouncer(log: (m: string) => void): (waiting: WaitingItem[]) => void
//
// The returned function is called once per scan with the current `waiting`
// list. It logs exactly one line per slug the FIRST time it is seen waiting,
// and again only when that slug's verdict (kind + blocker/cycle refs / detail)
// CHANGES from the previously-announced one. A slug that drops out of
// `waiting` (moved to eligible/dispatched) stops being announced and its
// state is forgotten — a LATER re-entry into `waiting` with the SAME verdict
// re-announces (it's a fresh wait, not a continuation).
//
// The map is in-memory only, scoped to the returned closure (i.e. per daemon
// instance / per `createWaitingAnnouncer` call) — no durable marker.
// ─────────────────────────────────────────────────────────────────────────────

const MOD = '../../src/engine/daemon-waiting-announce.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

const blockedBy = (slug: string, repo: string, number: string): WaitingItem => ({
  slug,
  sourceRef: `${repo}#${number}`,
  verdict: { kind: 'blocked', blockers: [{ repo, number }] },
});

describe('createWaitingAnnouncer — identical verdict across scans logs once', () => {
  it('3 identical-verdict scans of the same waiting spec → exactly 1 log line', async () => {
    const mod = await load();
    const createWaitingAnnouncer = requireFn(mod, 'createWaitingAnnouncer');
    const log = vi.fn();
    const announce = createWaitingAnnouncer(log);

    const waiting = [blockedBy('feat-a', 'acme/repo', '1')];
    announce(waiting);
    announce(waiting);
    announce(waiting);

    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('createWaitingAnnouncer — blocker-set change re-announces exactly once', () => {
  it('#1 closes, new #2 added → exactly 1 more log line', async () => {
    const mod = await load();
    const createWaitingAnnouncer = requireFn(mod, 'createWaitingAnnouncer');
    const log = vi.fn();
    const announce = createWaitingAnnouncer(log);

    announce([blockedBy('feat-a', 'acme/repo', '1')]);
    announce([blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log).toHaveBeenCalledTimes(1);

    // blocker set changed: #1 closed, now blocked by #2 instead
    announce([blockedBy('feat-a', 'acme/repo', '2')]);
    expect(log).toHaveBeenCalledTimes(2);

    // stable again on the new verdict
    announce([blockedBy('feat-a', 'acme/repo', '2')]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('createWaitingAnnouncer — spec leaves waiting, announcements stop', () => {
  it('slug absent from waiting → no further logs for it; re-entry re-announces', async () => {
    const mod = await load();
    const createWaitingAnnouncer = requireFn(mod, 'createWaitingAnnouncer');
    const log = vi.fn();
    const announce = createWaitingAnnouncer(log);

    announce([blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log).toHaveBeenCalledTimes(1);

    // feat-a became eligible/dispatched — no longer in the waiting list.
    announce([]);
    expect(log).toHaveBeenCalledTimes(1);

    // Stays quiet while absent.
    announce([]);
    expect(log).toHaveBeenCalledTimes(1);

    // Re-enters waiting later with the SAME verdict as before — this is a
    // fresh wait (the map forgot it while it was absent), so it re-announces.
    announce([blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('createWaitingAnnouncer — independent slugs tracked independently', () => {
  it('two waiting slugs each announce once, unaffected by each other', async () => {
    const mod = await load();
    const createWaitingAnnouncer = requireFn(mod, 'createWaitingAnnouncer');
    const log = vi.fn();
    const announce = createWaitingAnnouncer(log);

    announce([blockedBy('feat-a', 'acme/repo', '1'), blockedBy('feat-b', 'acme/repo', '9')]);
    expect(log).toHaveBeenCalledTimes(2);

    announce([blockedBy('feat-a', 'acme/repo', '1'), blockedBy('feat-b', 'acme/repo', '9')]);
    expect(log).toHaveBeenCalledTimes(2);

    // Only feat-b's blocker changes.
    announce([blockedBy('feat-a', 'acme/repo', '1'), blockedBy('feat-b', 'acme/repo', '10')]);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[2][0]).toContain('feat-b');
  });
});

describe('createWaitingAnnouncer — instance-scoped map', () => {
  it('a fresh announcer instance has no memory of a prior instance', async () => {
    const mod = await load();
    const createWaitingAnnouncer = requireFn(mod, 'createWaitingAnnouncer');
    const log1 = vi.fn();
    const announcer1 = createWaitingAnnouncer(log1);
    announcer1([blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log1).toHaveBeenCalledTimes(1);

    const log2 = vi.fn();
    const announcer2 = createWaitingAnnouncer(log2);
    announcer2([blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log2).toHaveBeenCalledTimes(1); // fresh instance, not suppressed by announcer1's state
  });
});

describe('announceWaitingForRoot — module-level per-root registry', () => {
  it('3 identical-verdict calls for same root → exactly 1 log line', async () => {
    const mod = await load();
    const announceWaitingForRoot = requireFn(mod, 'announceWaitingForRoot');
    const log = vi.fn();

    const waiting = [blockedBy('feat-a', 'acme/repo', '1')];
    announceWaitingForRoot('/project/test-1', log, waiting);
    announceWaitingForRoot('/project/test-1', log, waiting);
    announceWaitingForRoot('/project/test-1', log, waiting);

    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('announceWaitingForRoot — verdict change re-announces', () => {
  it('#1 closes, new #2 added → exactly 1 more log line', async () => {
    const mod = await load();
    const announceWaitingForRoot = requireFn(mod, 'announceWaitingForRoot');
    const log = vi.fn();

    announceWaitingForRoot('/project/test-2', log, [blockedBy('feat-a', 'acme/repo', '1')]);
    announceWaitingForRoot('/project/test-2', log, [blockedBy('feat-a', 'acme/repo', '1')]);
    expect(log).toHaveBeenCalledTimes(1);

    // blocker set changed: #1 closed, now blocked by #2 instead
    announceWaitingForRoot('/project/test-2', log, [blockedBy('feat-a', 'acme/repo', '2')]);
    expect(log).toHaveBeenCalledTimes(2);

    // stable again on the new verdict
    announceWaitingForRoot('/project/test-2', log, [blockedBy('feat-a', 'acme/repo', '2')]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('announceWaitingForRoot — distinct projectRoots tracked independently', () => {
  it('two roots maintain separate warn-once state', async () => {
    const mod = await load();
    const announceWaitingForRoot = requireFn(mod, 'announceWaitingForRoot');
    const log = vi.fn();

    const waiting = [blockedBy('feat-a', 'acme/repo', '1')];

    // First root
    announceWaitingForRoot('/project/test-3-root-a', log, waiting);
    expect(log).toHaveBeenCalledTimes(1);
    announceWaitingForRoot('/project/test-3-root-a', log, waiting);
    expect(log).toHaveBeenCalledTimes(1); // stable, no new log

    // Second root with same slug and verdict
    announceWaitingForRoot('/project/test-3-root-b', log, waiting);
    expect(log).toHaveBeenCalledTimes(2); // fresh root, logs even though root-a saw the same verdict

    // Stable on root-b
    announceWaitingForRoot('/project/test-3-root-b', log, waiting);
    expect(log).toHaveBeenCalledTimes(2); // stable, no new log

    // Back to root-a with change
    announceWaitingForRoot('/project/test-3-root-a', log, [blockedBy('feat-a', 'acme/repo', '2')]);
    expect(log).toHaveBeenCalledTimes(3); // root-a's verdict changed
  });
});
