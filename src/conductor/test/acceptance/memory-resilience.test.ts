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

// ═════════════════════════════════════════════════════════════════════════════
// FIX-1 (NEW): persistMemory is TOTAL — never throws even when the fallback
// path itself fails internally (e.g. invalid category passed to recordMemoryEntry).
// ═════════════════════════════════════════════════════════════════════════════
describe('FIX-1: persistMemory never throws even when the local fallback write fails', () => {
  it('returns {sink:local, pendingReconcile:false} and pushes a warning when recordMemoryEntry throws due to invalid category', async () => {
    const persistMemory = requireFn(await load(FALLBACK_MOD), 'persistMemory');

    // Provider rejects all writes → triggers the fallback path.
    const double = makeDouble('double', { available: true, acceptsWrites: false });
    const ctx = { warnings: [] as string[] };

    // An entry with an invalid category will cause recordMemoryEntry to throw
    // inside the fallback block.
    const badEntry = {
      category: 'nope' as any,
      name: 'invalid-cat',
      body: 'some body\n',
      indexLine: '- invalid',
    };

    // Must NOT throw — the promise must resolve.
    const result = await persistMemory({ repoPath: repo, provider: double, entry: badEntry, ctx });

    expect(result).toBeDefined();
    expect(result.sink).toBe('local');
    expect(result.pendingReconcile).toBe(false);
    expect(ctx.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX-2 (NEW): reconcilePending drains incrementally — partial failure removes
// only the succeeded entries from the ledger so a retry never duplicates them.
// ═════════════════════════════════════════════════════════════════════════════
describe('FIX-2: reconcilePending incremental drain — exactly-once under partial failure', () => {
  it('on partial failure: removes succeeded entries from ledger, keeps failed ones; second pass completes without duplicates', async () => {
    const mod = await load(FALLBACK_MOD);
    const persistMemory = requireFn(mod, 'persistMemory');
    const listPendingReconcile = requireFn(mod, 'listPendingReconcile');
    const reconcilePending = requireFn(mod, 'reconcilePending');

    // Provider that throws ONLY for the entry named 'p2'.
    const landed: any[] = [];
    let rejectP2 = true;
    const selectiveProvider = {
      isAvailable: () => false as boolean, // start unavailable → both go to fallback
      write(e: any) {
        if (e.name === 'p2' && rejectP2) {
          throw new Error('selective rejection of p2');
        }
        landed.push(e);
      },
    };

    const ctx = { warnings: [] as string[] };

    // Both writes fail (provider unavailable) → both go to the ledger.
    await persistMemory({ repoPath: repo, provider: selectiveProvider, entry: entry('p1', 'one\n'), ctx });
    await persistMemory({ repoPath: repo, provider: selectiveProvider, entry: entry('p2', 'two\n'), ctx });
    expect((await listPendingReconcile(repo)).length).toBe(2);

    // First reconcile — provider now reachable but p2 still rejects.
    selectiveProvider.isAvailable = () => true;
    const first = await reconcilePending({ repoPath: repo, provider: selectiveProvider, ctx });
    expect(first.reconciled).toBe(1); // only p1 drained

    // After first reconcile only p2 remains pending.
    const afterFirst = await listPendingReconcile(repo);
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0].name).toBe('p2');

    // p1 landed exactly once.
    expect(landed.filter((x: any) => x.name === 'p1').length).toBe(1);

    // Second reconcile — p2 now accepted.
    rejectP2 = false;
    const second = await reconcilePending({ repoPath: repo, provider: selectiveProvider, ctx });
    expect(second.reconciled).toBe(1);

    // No duplicates: p1 and p2 each appear exactly once on the platform.
    expect(landed.filter((x: any) => x.name === 'p1').length).toBe(1);
    expect(landed.filter((x: any) => x.name === 'p2').length).toBe(1);
    expect(await listPendingReconcile(repo)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX-3 (NEW): explicit pending-reconcile tag intrinsic to the stored artifact.
// The local file carries a <!-- pending-reconcile --> marker; the platform copy
// (written by reconcile) must be clean (no marker in body).
// ═════════════════════════════════════════════════════════════════════════════
describe('FIX-3: pending-reconcile marker embedded in local store; platform copy is clean', () => {
  it('fallback writes carry an explicit pending-reconcile marker; reconcile does not leak the marker to the platform', async () => {
    const mod = await load(FALLBACK_MOD);
    const persistMemory = requireFn(mod, 'persistMemory');
    const reconcilePending = requireFn(mod, 'reconcilePending');

    const double = makeDouble('double', { available: true, acceptsWrites: false });
    const ctx = { warnings: [] as string[] };
    const e = entry('marker-test', 'marker body\n');

    await persistMemory({ repoPath: repo, provider: double, entry: e, ctx });

    // (a) Local store file physically contains the pending-reconcile marker.
    expect(await treeContains(join(repo, '.memory'), 'pending-reconcile')).toBe(true);
    // Original body text is still present after the marker.
    expect(await treeContains(join(repo, '.memory'), 'marker body')).toBe(true);

    // Reconcile to the now-accepting platform.
    double.setAcceptsWrites(true);
    await reconcilePending({ repoPath: repo, provider: double, ctx });

    // (b) Platform entry body is clean — marker must NOT appear in the body.
    expect(
      double.list().some((x: any) => typeof x.body === 'string' && x.body.includes('pending-reconcile')),
    ).toBe(false);
    // But the actual content is present.
    expect(
      double.list().some((x: any) => typeof x.body === 'string' && x.body.includes('marker body')),
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX-5 (NEW): readLedger validates the parsed shape before trusting it.
// ═════════════════════════════════════════════════════════════════════════════
describe('FIX-5: listPendingReconcile handles malformed ledger JSON gracefully', () => {
  async function writeBadLedger(content: string): Promise<void> {
    const storeMod = await load(STORE_MOD);
    const projectKeyFn = requireFn(storeMod, 'projectKey');
    const key = await projectKeyFn(repo);
    const ledgerPath = join(
      fakeHome,
      '.ai-conductor',
      'memory',
      key,
      'harness',
      'pending-reconcile.json',
    );
    // Directory was created by ensureMemoryStore in beforeEach.
    await writeFile(ledgerPath, content, 'utf8');
  }

  it('returns [] when the ledger root is an object (not an array)', async () => {
    await writeBadLedger('{"not":"an array"}');
    const listPendingReconcile = requireFn(await load(FALLBACK_MOD), 'listPendingReconcile');
    const result = await listPendingReconcile(repo);
    expect(result).toEqual([]);
  });

  it('filters out entries that are missing required MemoryEntry fields', async () => {
    // Entry has only `name`; missing category, body, indexLine.
    await writeBadLedger('[{"name":"x"}]');
    const listPendingReconcile = requireFn(await load(FALLBACK_MOD), 'listPendingReconcile');
    const result = await listPendingReconcile(repo);
    expect(result).toEqual([]);
  });
});
