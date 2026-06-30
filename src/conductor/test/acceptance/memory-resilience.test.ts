import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1b — the full WRITE-FALLBACK + RECONCILE
// resilience cycle (FR-13 / FR-13a / FR-13b):
//
//   double ACTIVE but rejecting writes → persist routes to the `local` store
//   (1a `recordMemoryEntry`) tagged `pending-reconcile` + a warning; the run
//   COMPLETES (no throw escapes). Before reconcile the pending entry is NOT
//   surfaced from the platform (no phantom read). On reconnect, `reconcile`
//   pushes pending entries into the active double EXACTLY ONCE (idempotent;
//   re-running does not duplicate) and NEVER pulls FROM the platform
//   (one-directional). Repeated write failures in one run emit a BOUNDED number
//   of warnings (≤1, deduped) and never abort.
//
// Drives the not-yet-existing `src/conductor/src/engine/memory-fallback.ts`
// (persistMemory / listPendingReconcile / reconcilePending). The module does
// not exist yet → dynamically imported per-test so RED is "not yet implemented".
// "Not surfaced from the platform" is asserted against the double's OWN state
// (provider.list()) — the harness performs no retrieval (FR-3 stays locked).
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const FALLBACK_MOD = '../../src/engine/memory-fallback.js';
const STORE_MOD = '../../src/engine/memory-store.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// Self-contained test double — availability and write-acceptance togglable,
// with an in-memory entry log standing in for "what the platform holds".
function makeDouble(name: string, opts: { available?: boolean; acceptsWrites?: boolean } = {}) {
  const entries: any[] = [];
  return {
    name,
    kind: 'memory_provider' as const,
    _available: opts.available ?? true,
    _acceptsWrites: opts.acceptsWrites ?? true,
    setAvailable(b: boolean) {
      this._available = b;
    },
    setAcceptsWrites(b: boolean) {
      this._acceptsWrites = b;
    },
    isAvailable(): boolean {
      return this._available;
    },
    // Append-only on purpose: a non-idempotent reconcile would create duplicates
    // here, so "exactly once" must be enforced by reconcile clearing the pending
    // tag — not masked by dedup in the double.
    write(entry: any): void {
      if (!this._available || !this._acceptsWrites) {
        throw new Error(`provider ${name} rejected write`);
      }
      entries.push(entry);
    },
    list(): any[] {
      return [...entries];
    },
  };
}

let workDir: string;
let repo: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };
const savedProfile = { value: process.env.USERPROFILE };

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(name: string, originUrl: string): Promise<string> {
  const repoPath = join(workDir, name);
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-q', '-b', 'main'], repoPath);
  await git(['config', 'user.email', 'test@test.com'], repoPath);
  await git(['config', 'user.name', 'Test'], repoPath);
  await git(['remote', 'add', 'origin', originUrl], repoPath);
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await git(['add', 'README.md'], repoPath);
  await git(['commit', '-q', '-m', 'init'], repoPath);
  return repoPath;
}

/** Recursively returns true if any file under `dir` contains `needle`. */
async function treeContains(dir: string, needle: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return false;
  }
  for (const n of names) {
    const p = join(dir, n);
    try {
      const stat = await (await import('fs/promises')).stat(p);
      if (stat.isDirectory()) {
        if (await treeContains(p, needle)) return true;
      } else {
        const body = await readFile(p, 'utf8').catch(() => '');
        if (body.includes(needle)) return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function entry(name: string, body: string) {
  return {
    category: 'decisions' as const,
    name,
    body,
    indexLine: `- [${name}](decisions/${name}.md) — ${body.trim()}`,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-resilience-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  savedProfile.value = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  repo = await makeRepo('alpha', 'https://example.com/alpha.git');
  const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
  await ensureMemoryStore(repo);
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  process.env.USERPROFILE = savedProfile.value;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-13 / FR-13a: rejected write → saved to local (not lost) + pending-reconcile
// + warning; the run completes (no throw escapes).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-13a: rejected write → local store, pending-reconcile, warning, run continues', () => {
  it('persistMemory never throws; routes to local, tags pending, does not surface on the platform', async () => {
    const persistMemory = requireFn(await load(FALLBACK_MOD), 'persistMemory');
    const listPendingReconcile = requireFn(await load(FALLBACK_MOD), 'listPendingReconcile');

    const double = makeDouble('double', { available: true, acceptsWrites: false }); // rejects
    const ctx = { warnings: [] as string[] };
    const e = entry('reject-1', 'rejected by platform\n');

    const result = await persistMemory({ repoPath: repo, provider: double, entry: e, ctx });

    // Saved to local, flagged pending — never to the platform.
    expect(result.sink).toBe('local');
    expect(result.pendingReconcile).toBe(true);
    expect(ctx.warnings.length).toBeGreaterThanOrEqual(1);

    // Not lost: the entry is recoverable as a pending entry AND physically in the store.
    const pending = await listPendingReconcile(repo);
    expect(pending.some((p: any) => p.name === 'reject-1')).toBe(true);
    expect(await treeContains(join(repo, '.memory'), 'rejected by platform')).toBe(true);

    // No phantom: the platform itself does NOT hold the pending entry yet.
    expect(double.list().some((x: any) => x.name === 'reject-1')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-13: an UNAVAILABLE platform at persist time still completes — no throw.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-13: unavailable platform at persist time warns but never aborts', () => {
  it('persistMemory resolves (sink=local) when the platform is down', async () => {
    const persistMemory = requireFn(await load(FALLBACK_MOD), 'persistMemory');
    const double = makeDouble('double', { available: false });
    const ctx = { warnings: [] as string[] };

    const result = await persistMemory({
      repoPath: repo,
      provider: double,
      entry: entry('down-1', 'platform down\n'),
      ctx,
    });

    expect(result.sink).toBe('local');
    expect(result.pendingReconcile).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-13b: reconcile on reconnect — idempotent, exactly once; pending then surfaced.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-13b: reconcile pushes pending entries into the platform exactly once', () => {
  it('after reconnect pending entries land on the platform; re-running reconcile does not duplicate', async () => {
    const mod = await load(FALLBACK_MOD);
    const persistMemory = requireFn(mod, 'persistMemory');
    const listPendingReconcile = requireFn(mod, 'listPendingReconcile');
    const reconcilePending = requireFn(mod, 'reconcilePending');

    const double = makeDouble('double', { available: true, acceptsWrites: false });
    const ctx = { warnings: [] as string[] };

    // Two writes fail while the platform rejects → both held pending locally.
    await persistMemory({ repoPath: repo, provider: double, entry: entry('p1', 'one\n'), ctx });
    await persistMemory({ repoPath: repo, provider: double, entry: entry('p2', 'two\n'), ctx });
    expect((await listPendingReconcile(repo)).length).toBe(2);
    expect(double.list().length).toBe(0); // nothing surfaced pre-reconcile

    // Reconnect, then reconcile.
    double.setAcceptsWrites(true);
    const first = await reconcilePending({ repoPath: repo, provider: double, ctx });
    expect(first.reconciled).toBe(2);

    // Pending entries are now on the platform and cleared from the pending set.
    expect(double.list().map((x: any) => x.name).sort()).toEqual(['p1', 'p2']);
    expect(await listPendingReconcile(repo)).toEqual([]);

    // Idempotent: a second reconcile pushes nothing and creates no duplicate.
    const second = await reconcilePending({ repoPath: repo, provider: double, ctx });
    expect(second.reconciled).toBe(0);
    expect(double.list().filter((x: any) => x.name === 'p1').length).toBe(1);
    expect(double.list().length).toBe(2);
  });

  it('reconcile is one-directional — it never pulls platform entries into the local store', async () => {
    const mod = await load(FALLBACK_MOD);
    const persistMemory = requireFn(mod, 'persistMemory');
    const listPendingReconcile = requireFn(mod, 'listPendingReconcile');
    const reconcilePending = requireFn(mod, 'reconcilePending');

    const double = makeDouble('double', { available: true, acceptsWrites: true });
    // A platform-only entry that exists ONLY on the platform, never written locally.
    double.write({ name: 'platform-only', body: 'lives only on the platform\n' });

    // One local pending entry (written while the platform briefly rejected).
    double.setAcceptsWrites(false);
    await persistMemory({
      repoPath: repo,
      provider: double,
      entry: entry('local-pending', 'born local\n'),
      ctx: { warnings: [] },
    });
    double.setAcceptsWrites(true);

    await reconcilePending({ repoPath: repo, provider: double, ctx: { warnings: [] } });

    // The platform-only entry was NOT pulled into the local store (one-directional).
    expect(await treeContains(join(repo, '.memory'), 'lives only on the platform')).toBe(false);
    expect((await listPendingReconcile(repo)).some((p: any) => p.name === 'platform-only')).toBe(
      false,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-13b: bounded warnings under repeated failure; never aborts.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-13b: repeated write failures emit bounded warnings and never abort', () => {
  it('many rejected writes in one run produce ≤1 warning and all complete', async () => {
    const persistMemory = requireFn(await load(FALLBACK_MOD), 'persistMemory');
    const double = makeDouble('double', { available: true, acceptsWrites: false });
    const ctx = { warnings: [] as string[] };

    for (let i = 0; i < 5; i++) {
      const result = await persistMemory({
        repoPath: repo,
        provider: double,
        entry: entry(`burst-${i}`, `entry ${i}\n`),
        ctx,
      });
      expect(result.sink).toBe('local'); // none aborted
    }

    expect(ctx.warnings.length).toBeLessThanOrEqual(1);
  });
});
