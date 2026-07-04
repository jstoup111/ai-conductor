// Tests for Task 17 — fleet selectors: multi-repo + --all + per-repo outcomes
// (FR-3/FR-17/FR-18). Exercises `runFleetAction` (src/engine/daemon-fleet.ts)
// directly against a REAL temp registry file, plus the pause/resume verb
// dispatch wired through `dispatchDaemonSupervisor`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeRegistry, type ProjectRecord } from '../../src/engine/registry.js';
import { runFleetAction } from '../../src/engine/daemon-fleet.js';
import { dispatchDaemonSupervisor } from '../../src/engine/daemon-supervisor-cli.js';
import { isPaused } from '../../src/engine/pause-marker.js';

let root: string;
let registryPath: string;

async function repo(name: string): Promise<string> {
  const p = join(root, name);
  await mkdir(p, { recursive: true });
  return p;
}

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'daemon-fleet-'));
  registryPath = join(root, 'registry.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runFleetAction (Task 17)', () => {
  it('a named subset acts on exactly those repos — the third is untouched', async () => {
    const a = await repo('a');
    const b = await repo('b');
    const c = await repo('c');
    await writeRegistry(registryPath, [record('a', a), record('b', b), record('c', c)]);

    const touched: string[] = [];
    const out: string[] = [];
    const result = await runFleetAction(
      { names: ['a', 'b'] },
      async (rec) => {
        touched.push(rec.name);
        return 'ok';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(touched.sort()).toEqual(['a', 'b']);
    expect(result.code).toBe(0);
    expect(out.some((l) => l.includes('c:'))).toBe(false);
  });

  it('--all iterates the registry, one outcome line per repo', async () => {
    const a = await repo('a');
    const b = await repo('b');
    await writeRegistry(registryPath, [record('a', a), record('b', b)]);

    const out: string[] = [];
    const result = await runFleetAction({ all: true }, async () => 'done', {
      registryPath,
      out: (l) => out.push(l),
    });

    expect(result.code).toBe(0);
    expect(result.outcomes).toHaveLength(2);
    expect(out).toHaveLength(2);
    expect(out.some((l) => l.startsWith('a:'))).toBe(true);
    expect(out.some((l) => l.startsWith('b:'))).toBe(true);
  });

  it('one repo with a broken path errors per-repo; the others still succeed', async () => {
    const a = await repo('a');
    const b = await repo('b');
    // Make `b`'s "path" a file, not a directory, so any fs op that expects a
    // dir under it throws — simulating a broken/missing-path registration.
    const brokenLeaf = join(root, 'b-is-a-file');
    await mkdir(root, { recursive: true });
    await writeFile(brokenLeaf, 'not a dir', 'utf-8');
    const broken = join(brokenLeaf, 'nested');
    await writeRegistry(registryPath, [record('a', a), record('b', broken)]);

    const out: string[] = [];
    const result = await runFleetAction(
      { all: true },
      async (rec) => {
        if (rec.name === 'b') {
          await mkdir(rec.path); // throws ENOTDIR — parent is a file
        }
        return 'ok';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(result.code).toBe(1);
    const aOutcome = result.outcomes.find((o) => o.name === 'a');
    const bOutcome = result.outcomes.find((o) => o.name === 'b');
    expect(aOutcome?.ok).toBe(true);
    expect(bOutcome?.ok).toBe(false);
    expect(out.some((l) => l.startsWith('a: ok'))).toBe(true);
    expect(out.some((l) => l.startsWith('b: error:'))).toBe(true);
  });

  it('an unknown name is reported verbatim; valid names in the same request are still acted on', async () => {
    const a = await repo('a');
    await writeRegistry(registryPath, [record('a', a)]);

    const touched: string[] = [];
    const out: string[] = [];
    const result = await runFleetAction(
      { names: ['a', 'ghost'] },
      async (rec) => {
        touched.push(rec.name);
        return 'ok';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(touched).toEqual(['a']);
    expect(out).toContain('unknown repo: ghost');
    expect(result.unknownNames).toEqual(['ghost']);
    // A partially-unknown request still surfaces non-zero (an unknown name is
    // itself a failure to fully honor the request), even though `a` succeeded.
    expect(result.code).toBe(1);
  });

  it('all names unknown → non-zero, zero side effects', async () => {
    const a = await repo('a');
    await writeRegistry(registryPath, [record('a', a)]);

    const touched: string[] = [];
    const result = await runFleetAction(
      { names: ['ghost1', 'ghost2'] },
      async (rec) => {
        touched.push(rec.name);
        return 'ok';
      },
      { registryPath, out: () => {} },
    );

    expect(touched).toEqual([]);
    expect(result.code).not.toBe(0);
    expect(result.outcomes).toEqual([]);
  });

  it('empty registry + --all → "no registered repos", exit 0', async () => {
    await writeRegistry(registryPath, []);

    const out: string[] = [];
    const touched: string[] = [];
    const result = await runFleetAction(
      { all: true },
      async (rec) => {
        touched.push(rec.name);
        return 'ok';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(result.code).toBe(0);
    expect(touched).toEqual([]);
    expect(out).toEqual(['no registered repos']);
  });
});

describe('pause/resume verb dispatch through the fleet selector (FR-3/FR-17/FR-18)', () => {
  it('`pause` with named repos pauses exactly those, leaving a third repo untouched', async () => {
    const a = await repo('a');
    const b = await repo('b');
    const c = await repo('c');
    await writeRegistry(registryPath, [record('a', a), record('b', b), record('c', c)]);

    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['a', 'b'] },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(a)).toBe(true);
    expect(await isPaused(b)).toBe(true);
    expect(await isPaused(c)).toBe(false);
  });

  it('`resume --all` resumes every registered repo', async () => {
    const a = await repo('a');
    const b = await repo('b');
    await writeRegistry(registryPath, [record('a', a), record('b', b)]);
    await dispatchDaemonSupervisor(
      { verb: 'pause', all: true },
      { registryPath, out: () => {} },
    );
    expect(await isPaused(a)).toBe(true);
    expect(await isPaused(b)).toBe(true);

    const code = await dispatchDaemonSupervisor(
      { verb: 'resume', all: true },
      { registryPath, out: () => {} },
    );

    expect(code).toBe(0);
    expect(await isPaused(a)).toBe(false);
    expect(await isPaused(b)).toBe(false);
  });
});
