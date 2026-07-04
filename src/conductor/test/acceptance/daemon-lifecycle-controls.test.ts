// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Daemon lifecycle controls" (issue #215).
//
// Stories: .docs/stories/2026-07-04-daemon-lifecycle-controls.md (21 stories)
// Plan:    .docs/plans/daemon-lifecycle-controls.md (38 tasks, 3 phases)
//
// Per writing-system-tests §3a, single-operation stories (status rendering,
// a lone CLI verb outcome) are unit-covered by the plan's own per-task tests
// (test/engine/*) written during /tdd — they are NOT duplicated here. This
// file covers only the stories that genuinely cross 2+ operations or process
// boundaries, which the plan itself flags as composed/end-to-end concerns:
//
//   - FR-1/FR-2 composed: pause gates dispatch, resume is its exact mirror
//     (Task 11+18) — driven through the REAL runDaemon entry point, not a
//     mocked predicate (§3b/§3d: the production wiring, not the unit alone).
//   - FR-7/FR-4: a pause set while stopped is honored by the next boot — two
//     process-lifetime operations (write while stopped; boot honors it).
//   - FR-11: restart composes with pause/resume end-to-end (explicitly called
//     out in the story as "composition of FR-2 and FR-11 verified end-to-end").
//   - FR-19: cross-repo isolation — acting on repo A must never leak into B.
//   - FR-13: the story's own Done-When calls this "the #215 acceptance proof"
//     — a real-binary smoke, not a unit test (per feedback: injected-runner
//     argv tests alone are insufficient for external-process adapters).
//
// NONE of this feature's production code exists yet: `pause-marker.ts`,
// `restart-marker.ts`, and `engine-store.ts` are brand-new modules (dynamic
// imports below so a missing module RRED's the one test that needs it, not
// the whole file — §6, a collection error is not RED). The existing, REAL
// entry points (`runDaemon`, `runDaemonMode`, `daemon-tmux.ts`) have not yet
// been widened to consult pause/restart state, so the composed flows below
// are expected to fail on their OBSERVABLE OUTCOME (dispatch happened when it
// shouldn't have) rather than on a missing symbol — that is the correct RED
// for a not-yet-wired production call site.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';

import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

const PAUSE_MOD = '../../src/engine/pause-marker.js';
const RESTART_MOD = '../../src/engine/restart-marker.js';
const ENGINE_STORE_MOD = '../../src/engine/engine-store.js';

async function load(modPath: string): Promise<Record<string, any>> {
  return (await import(modPath)) as Record<string, any>;
}
function requireFn(mod: Record<string, any>, name: string): (...a: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...a: any[]) => any;
}

const tempRoots: string[] = [];
async function tempRepo(prefix = 'lifecycle-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tempRoots.map((d) => rm(d, { recursive: true, force: true })));
});

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-1/FR-2 composed — pause gates the real dispatch entry point; resume is
// its exact mirror (byte-identical dispatch order, nothing dropped).
// ─────────────────────────────────────────────────────────────────────────────
describe('Pause gates real dispatch; resume restores it with backlog intact (FR-1/FR-2)', () => {
  it('a paused repo dispatches zero items across multiple ticks though backlog is eligible', async () => {
    const repo = await tempRepo();
    const { writePauseMarker, isPaused } = await load(PAUSE_MOD);
    await writePauseMarker(repo, { pausedBy: 'test-operator' });

    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(3),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      isPaused: () => isPaused(repo),
    };
    await runDaemon(deps as unknown as DaemonDeps, { concurrency: 1, once: true });

    expect(dispatched).toEqual([]);
  });

  it('resuming dispatches exactly the backlog the scheduler would have chosen, in order (FR-2 mirror)', async () => {
    const repo = await tempRepo();
    const { writePauseMarker, removePauseMarker, isPaused } = await load(PAUSE_MOD);

    // Control run: never paused.
    const controlOrder: string[] = [];
    const controlDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (it: BacklogItem) => {
        controlOrder.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
    };
    await runDaemon(controlDeps as unknown as DaemonDeps, { concurrency: 1, once: true });

    // Pause → resume run: same backlog, gated then lifted.
    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    const pausedOrder: string[] = [];
    const pausedDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (it: BacklogItem) => {
        pausedOrder.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      isPaused: () => isPaused(repo),
    };
    await runDaemon(pausedDeps as unknown as DaemonDeps, { concurrency: 1, once: true });
    expect(pausedOrder).toEqual([]); // still gated

    await removePauseMarker(repo);
    const resumedDeps = {
      ...pausedDeps,
      isPaused: () => isPaused(repo),
    };
    await runDaemon(resumedDeps as unknown as DaemonDeps, { concurrency: 1, once: true });

    expect(pausedOrder).toEqual(controlOrder);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-4/FR-7 — a pause set while the repo has no running daemon is honored the
// next time anything boots it (advance pause survives the process boundary).
// ─────────────────────────────────────────────────────────────────────────────
describe('A pause set while stopped is honored on the next boot (FR-4/FR-7)', () => {
  it('boot (a fresh runDaemon invocation) reading only the persisted marker dispatches zero items', async () => {
    const repo = await tempRepo();
    const { writePauseMarker, isPaused } = await load(PAUSE_MOD);
    // Simulates "paused while stopped": the marker is written with no daemon
    // process alive at all — the next boot must discover it from disk only.
    await writePauseMarker(repo, { pausedBy: 'test-operator' });

    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(2),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      isPaused: () => isPaused(repo),
    };
    await runDaemon(deps as unknown as DaemonDeps, { concurrency: 1, once: true });

    expect(dispatched).toEqual([]);
  });

  it('a corrupted pause marker is still treated as paused — ambiguity never dispatches (fail-closed)', async () => {
    const repo = await tempRepo();
    await mkdir(join(repo, '.daemon'), { recursive: true });
    await writeFile(join(repo, '.daemon', 'PAUSED'), '{not valid json', 'utf-8');
    const { isPaused } = await load(PAUSE_MOD);

    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(1),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      isPaused: () => isPaused(repo),
    };
    await runDaemon(deps as unknown as DaemonDeps, { concurrency: 1, once: true });

    expect(dispatched).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-11 — restart composes with pause/resume end-to-end: "pause fleet →
// upgrade → restart fleet" must leave everything still quiesced until resume.
// ─────────────────────────────────────────────────────────────────────────────
describe('Restart preserves pause; a later resume dispatches with backlog intact (FR-11)', () => {
  it('a queued/consumed restart never touches the pause marker file', async () => {
    const repo = await tempRepo();
    const { writePauseMarker, isPaused } = await load(PAUSE_MOD);
    const { writeRestartPending, consumeOnBoot } = await load(RESTART_MOD);

    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    await writeRestartPending(repo, { blockingSlug: 'f0' });

    // A boot (fresh daemon start) consumes the restart intent exactly once.
    const intent = await consumeOnBoot(repo);
    expect(intent).toBeTruthy();

    // The replacement daemon must still observe the fleet as paused.
    expect(await isPaused(repo)).toBe(true);

    // And a second boot must not re-fire the already-consumed restart.
    const second = await consumeOnBoot(repo);
    expect(second).toBeNull();
  });

  it('restart of a paused daemon followed by resume dispatches the intact backlog (FR-2 + FR-11 composed)', async () => {
    const repo = await tempRepo();
    const { writePauseMarker, removePauseMarker, isPaused } = await load(PAUSE_MOD);
    const { writeRestartPending, consumeOnBoot } = await load(RESTART_MOD);

    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    await writeRestartPending(repo, { blockingSlug: 'idle' }); // paused counts as idle → fires immediately
    await consumeOnBoot(repo); // "restart" = the replacement process's boot

    // Replacement must come up still paused.
    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(2),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      isPaused: () => isPaused(repo),
    };
    await runDaemon(deps as unknown as DaemonDeps, { concurrency: 1, once: true });
    expect(dispatched).toEqual([]);

    await removePauseMarker(repo);
    await runDaemon(deps as unknown as DaemonDeps, { concurrency: 1, once: true });
    expect(dispatched).toEqual(['f0', 'f1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-19 — lifecycle actions on one repo never leak into another, including
// two registered repos that share a basename (path identity, not name).
// ─────────────────────────────────────────────────────────────────────────────
describe('Lifecycle actions never leak across repos (FR-19)', () => {
  it('pausing repo A leaves repo B\'s .daemon/ contents byte-for-byte untouched', async () => {
    const repoA = await tempRepo('lifecycle-a-');
    const repoB = await tempRepo('lifecycle-b-');
    const { writePauseMarker, isPaused } = await load(PAUSE_MOD);

    // Seed B with unrelated pre-existing state to prove it is never touched.
    await mkdir(join(repoB, '.daemon'), { recursive: true });
    await writeFile(join(repoB, '.daemon', 'sentinel'), 'untouched', 'utf-8');
    const before = await readdir(join(repoB, '.daemon'));

    await writePauseMarker(repoA, { pausedBy: 'test-operator' });

    const after = await readdir(join(repoB, '.daemon'));
    expect(after).toEqual(before);
    expect(await isPaused(repoB)).toBe(false);
  });

  it('two registered repos with the same basename at different paths stay independent', async () => {
    const parentX = await tempRepo('lifecycle-parent-x-');
    const parentY = await tempRepo('lifecycle-parent-y-');
    const repoX = join(parentX, 'shared-name');
    const repoY = join(parentY, 'shared-name');
    await mkdir(repoX, { recursive: true });
    await mkdir(repoY, { recursive: true });

    const { writePauseMarker, isPaused } = await load(PAUSE_MOD);
    await writePauseMarker(repoX, { pausedBy: 'test-operator' });

    expect(await isPaused(repoX)).toBe(true);
    expect(await isPaused(repoY)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-13 — real-binary smoke: "the #215 acceptance proof." A long-lived
// process pinned to version A must survive a real publish to version B,
// including a FIRST-TIME lazy import performed AFTER the publish — the exact
// hazard that crashed running daemons pre-fix (in-place `dist` rebuild).
// Per feedback (injected-runner argv tests alone are insufficient for
// external-process adapters), this spawns a REAL child process rather than
// asserting only against in-process fakes.
// ─────────────────────────────────────────────────────────────────────────────
describe('Rebuilding the engine never crashes a running daemon (FR-13, real-binary smoke)', () => {
  it('a child process pinned to version A resolves a lazy import from A after B is published and made current', async () => {
    const store = await tempRepo('engine-store-');
    const { listVersions, currentTarget } = await load(ENGINE_STORE_MOD);

    // Version A: a package with an index and a submodule loaded LAZILY.
    const versionA = join(store, 'dist-versions', 'v-a');
    await mkdir(versionA, { recursive: true });
    await writeFile(join(versionA, 'lazy.mjs'), 'export const version = "A";\n', 'utf-8');
    await writeFile(
      join(versionA, 'index.mjs'),
      [
        'process.send({ ready: true });',
        'process.on("message", async (msg) => {',
        '  if (msg !== "load-lazy") return;',
        '  const mod = await import(new URL("./lazy.mjs", import.meta.url));',
        '  process.send({ loadedVersion: mod.version });',
        '});',
      ].join('\n'),
      'utf-8',
    );
    const currentLink = join(store, 'current');
    // Test-established contract: `current` is a symlink into dist-versions/,
    // flipped atomically by publish (adr-2026-07-04-versioned-engine-store-atomic-flip).
    await (await import('node:fs/promises')).symlink(versionA, currentLink);

    const child = fork(join(versionA, 'index.mjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    tempRoots.push(store);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child never signaled ready')), 5000);
        child.once('message', (msg: any) => {
          clearTimeout(timer);
          if (msg?.ready) resolve();
          else reject(new Error('unexpected first message'));
        });
        child.once('error', reject);
      });

      // Real publish: version B appears, `current` flips atomically — the
      // long-lived child above is NEVER told to re-exec or re-resolve.
      const versionB = join(store, 'dist-versions', 'v-b');
      await mkdir(versionB, { recursive: true });
      await writeFile(join(versionB, 'lazy.mjs'), 'export const version = "B";\n', 'utf-8');
      await writeFile(join(versionB, 'index.mjs'), 'export const version = "B";\n', 'utf-8');

      // engine-store.ts is expected to expose the atomic flip primitive used
      // by publish-engine.mjs; this smoke drives it directly rather than
      // shelling out to the full publish script.
      const mod = await load(ENGINE_STORE_MOD);
      const flip = requireFn(mod, 'flipCurrent');
      await flip(store, versionB);

      const versions = await listVersions(store);
      expect(versions.map((v: any) => v.id ?? v)).toEqual(expect.arrayContaining(['v-a', 'v-b']));
      expect(await currentTarget(store)).toBe(versionB);

      // The already-running child, first-time lazy-importing AFTER the flip,
      // must still resolve from ITS OWN pinned version A — never ENOENT, never B.
      const loaded = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child never responded to load-lazy')), 5000);
        child.once('message', (msg: any) => {
          clearTimeout(timer);
          if (typeof msg?.loadedVersion === 'string') resolve(msg.loadedVersion);
          else reject(new Error(`unexpected message: ${JSON.stringify(msg)}`));
        });
        child.send('load-lazy');
      });
      expect(loaded).toBe('A');
    } finally {
      child.kill();
    }
  });
});
