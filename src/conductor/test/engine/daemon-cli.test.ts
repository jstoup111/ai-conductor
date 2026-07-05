// ─────────────────────────────────────────────────────────────────────────────
// Task 12 (adr-2026-07-03-gated-snapshot-status-read-model): the daemon must
// write `.daemon/gated.json` on EVERY discovery pass — populated, explicitly
// empty, and the identity-unresolved early-return alike.
//
// daemon-cli.ts wires this via `localWorkSource`'s `onGatedDiscovered` hook
// (daemon-work-source.ts): `discover()` invokes it with the exact `gated`
// list `discoverBacklog` computed, on every pass, BEFORE priority ordering
// runs. This drives that hook exactly the way daemon-cli.ts wires it —
// `(gated) => writeGatedSnapshot(daemonDir, { gated })` — against the REAL
// `gated-snapshot.ts` writer and a real temp directory, so these specs cover
// the actual single call site rather than a re-implementation of it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { localWorkSource, type LocalWorkSourceDeps } from '../../src/engine/daemon-work-source.js';
import { writeGatedSnapshot } from '../../src/engine/gated-snapshot.js';

let daemonDir: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'daemon-cli-gated-snapshot-'));
  daemonDir = join(root, '.daemon');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<LocalWorkSourceDeps> = {}): LocalWorkSourceDeps {
  return {
    projectRoot: root,
    baseBranch: 'main',
    log: vi.fn(),
    isProcessed: vi.fn().mockResolvedValue(false),
    hasWarned: vi.fn().mockResolvedValue(false),
    markWarned: vi.fn().mockResolvedValue(undefined),
    fastForwardRoot: vi.fn().mockResolvedValue(undefined),
    discoverBacklog: vi.fn(),
    // The exact wiring daemon-cli.ts installs at its single call site.
    onGatedDiscovered: (gated) => writeGatedSnapshot(daemonDir, { gated }),
    ...overrides,
  } as LocalWorkSourceDeps;
}

describe('daemon-cli discover-path gated snapshot wiring (Task 12)', () => {
  it('a pass with 2 gated + 1 warning writes a full snapshot', async () => {
    const deps = baseDeps({
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [{ slug: 'buildable' } satisfies BacklogItem],
        waiting: [],
        gated: [
          { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
          { kind: 'spec', slug: 'bar', reason: 'unowned-post-cutover', remedy: 'add Owner: marker' },
          { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover' },
        ],
      }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.gated).toHaveLength(2);
    expect(parsed.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'no-cutover' })]),
    );
  });

  it('the NEXT pass with zero gated overwrites the stale file with an explicit empty snapshot and a fresh writtenAt', async () => {
    const deps = baseDeps({
      discoverBacklog: vi
        .fn()
        .mockResolvedValueOnce({
          items: [],
          waiting: [],
          gated: [{ kind: 'spec', slug: 'stale-gated', reason: 'unowned-indeterminate', remedy: 'set cutover' }],
        })
        .mockResolvedValueOnce({ items: [], waiting: [], gated: [] }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });
    const firstRaw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(firstRaw.gated).toHaveLength(1);
    const firstWrittenAt = firstRaw.writtenAt;

    // Ensure a distinguishable clock tick between passes.
    await new Promise((r) => setTimeout(r, 5));

    await source.discover({ refresh: false });
    const secondRaw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(secondRaw.gated).toEqual([]);
    expect(secondRaw.writtenAt).not.toBe(firstWrittenAt);
  });

  it('the identity-unresolved early return (repo warning, empty gated) still writes a snapshot', async () => {
    const deps = baseDeps({
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [],
        waiting: [],
        gated: [{ kind: 'repo', warning: 'identity-unresolved', remedy: 'authenticate gh' }],
      }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });

    const raw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(raw.gated).toEqual([]);
    expect(raw.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'identity-unresolved' })]),
    );
  });

  it('daemon-cli.ts wires onGatedDiscovered to writeGatedSnapshot at a single call site in localWorkSource construction', () => {
    // Static wiring check: guards against the call site being silently
    // dropped/duplicated in a future refactor of daemon-cli.ts.
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');
    const matches = src.match(/onGatedDiscovered:/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(src).toContain('writeGatedSnapshot(daemonDir, { gated })');
  });
});
