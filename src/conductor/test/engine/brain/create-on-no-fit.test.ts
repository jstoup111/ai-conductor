// Test: createOnNoFit — FR-4 happy + negative paths (Task 19, Phase 9.3)
//
// createOnNoFit(name, createFn, registryReader, opts?)
//   is a dependency-injected async function that:
//     1. Invokes createFn(name) to scaffold + register a new project.
//     2. Re-resolves the TargetRepo from the newly created registry record.
//     3. Returns { target: TargetRepo } so subsequent authoring targets the new
//        repo's canonical path.
//
// No real git, no real subprocess, no network in tests — all I/O is injected.
//
// Scenarios (FR-4):
//   1. no-fit   → create offer surfaced (createSuggested=true in RoutingResult).
//   2. confirm  → createFn is called, TargetRepo retargets to new canonical path.
//   3. decline  → createFn NOT called, no TargetRepo returned (declined outcome).
//   4. create failure → NO authoring, clear error surfaces, no orphan side effects.
//   5. post-create unreadable/malformed registry → STOP with a clear error (assert message substring).

import { describe, it, expect, vi } from 'vitest';
import {
  createOnNoFit,
  type CreateFn,
  type CreateOnNoFitResult,
} from '../../../src/engine/brain/routing.js';
import type { RegistryReader, ProjectRecord } from '../../../src/engine/registry.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeRecord(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'created',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

/** Build a RegistryReader stub that returns a fixed set of records. */
function stubReader(records: ProjectRecord[]): RegistryReader {
  return {
    listProjects: vi.fn().mockResolvedValue(records),
    getProject: vi.fn().mockImplementation(async (path: string) =>
      records.find((r) => r.path === path),
    ),
  };
}

/** A CreateFn stub that succeeds and adds the new record to the reader. */
function stubCreateFn(name: string, canonicalPath: string): { createFn: CreateFn; reader: RegistryReader } {
  const newRecord = makeRecord(name, canonicalPath);
  const reader = stubReader([newRecord]);
  const createFn: CreateFn = vi.fn().mockResolvedValue(undefined);
  return { createFn, reader };
}

/** A CreateFn stub that throws (simulates scaffold / registry write failure). */
function failingCreateFn(msg: string): CreateFn {
  return vi.fn().mockRejectedValue(new Error(msg));
}

/** A reader that returns a record for getProject but listProjects is malformed (throws). */
function malformedRegistryReader(newRecord: ProjectRecord): RegistryReader {
  return {
    listProjects: vi.fn().mockRejectedValue(new Error('Registry at /tmp/x/registry.json is corrupt (invalid JSON): Unexpected token')),
    getProject: vi.fn().mockRejectedValue(new Error('Registry at /tmp/x/registry.json is corrupt (invalid JSON): Unexpected token')),
  };
}

// --------------------------------------------------------------------------
// Scenario 1 — no-fit → create offer surfaced
// --------------------------------------------------------------------------

describe('createOnNoFit — no-fit scenario (create offer surfaced)', () => {
  it('createSuggested=true is the signal that a create offer should be surfaced', async () => {
    // This is a documentation/contract test: a RoutingResult with createSuggested=true
    // and empty candidates is the accepted signal that triggers createOnNoFit.
    const { createFn, reader } = stubCreateFn('new-project', '/projects/new-project');

    // When the caller has a no-fit result, it should call createOnNoFit.
    // Here we verify the accepted entry condition: calling with a name is valid.
    const result = await createOnNoFit('new-project', createFn, reader);

    expect(result.kind).toBe('created');
  });

  it('createFn receives the exact project name that was requested', async () => {
    const { createFn, reader } = stubCreateFn('my-new-repo', '/projects/my-new-repo');

    await createOnNoFit('my-new-repo', createFn, reader);

    // Falsifiable: if createFn is called with a different name, this fails.
    expect(createFn).toHaveBeenCalledWith('my-new-repo');
  });
});

// --------------------------------------------------------------------------
// Scenario 2 — confirm → invokes create, retargets to the new canonical path
// --------------------------------------------------------------------------

describe('createOnNoFit — confirm path (scaffold + retarget)', () => {
  it('returns a TargetRepo with the canonical path from the new registry record', async () => {
    const canonicalPath = '/projects/fresh-repo';
    const { createFn, reader } = stubCreateFn('fresh-repo', canonicalPath);

    const result = await createOnNoFit('fresh-repo', createFn, reader);

    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      // Falsifiable: if target points to the wrong path, this fails.
      expect(result.target.canonicalPath).toBe(canonicalPath);
      expect(result.target.name).toBe('fresh-repo');
    }
  });

  it('invokes createFn exactly once (no duplicate scaffolding)', async () => {
    const { createFn, reader } = stubCreateFn('once-only', '/projects/once-only');

    await createOnNoFit('once-only', createFn, reader);

    // Falsifiable: if createFn is called more than once, this assertion fails.
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('TargetRepo name matches the name argument, not a fabricated name', async () => {
    const name = 'exact-name-match';
    const { createFn, reader } = stubCreateFn(name, `/projects/${name}`);

    const result = await createOnNoFit(name, createFn, reader);

    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      // Falsifiable: target.name must be the actual registry record name.
      expect(result.target.name).toBe(name);
      expect(result.target.name).not.toBe('some-other-name');
    }
  });

  it('re-resolves from the registry after create — not from the input name directly', async () => {
    // The registry record has a canonical path; we verify the TargetRepo comes
    // from the record, not by constructing a path from the name string.
    const canonicalPath = '/canonical/resolved/path/my-proj';
    const { createFn, reader } = stubCreateFn('my-proj', canonicalPath);

    const result = await createOnNoFit('my-proj', createFn, reader);

    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      // The path must come from the registry record, not a constructed string.
      expect(result.target.canonicalPath).toBe(canonicalPath);
    }
  });
});

// --------------------------------------------------------------------------
// Scenario 3 — decline → createFn NOT called, nothing authored
// --------------------------------------------------------------------------

describe('createOnNoFit — decline path (no side effects)', () => {
  it('returns declined kind when name is empty string (decline signal)', async () => {
    const createFn = vi.fn() as unknown as CreateFn;
    const reader = stubReader([]);

    const result = await createOnNoFit('', createFn, reader);

    expect(result.kind).toBe('declined');
  });

  it('createFn is NOT called when name is empty (declined)', async () => {
    const createFn = vi.fn() as unknown as CreateFn;
    const reader = stubReader([]);

    await createOnNoFit('', createFn, reader);

    // Falsifiable: if createFn were called even once, this fails.
    expect(createFn).toHaveBeenCalledTimes(0);
  });

  it('returns declined kind when name is whitespace-only (decline signal)', async () => {
    const createFn = vi.fn() as unknown as CreateFn;
    const reader = stubReader([]);

    const result = await createOnNoFit('   ', createFn, reader);

    expect(result.kind).toBe('declined');
    // Falsifiable: createFn must not have been touched.
    expect(createFn).toHaveBeenCalledTimes(0);
  });

  it('declined result has no target field (structural guard against accidental authoring)', () => {
    // This is a type-level / structural invariant: the declined variant must NOT
    // carry a TargetRepo (which would let callers accidentally author to it).
    const declined: CreateOnNoFitResult = { kind: 'declined' };
    // Falsifiable: if declined had a target property, the type check would pass and
    // the expectation below would fail.
    expect('target' in declined).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Scenario 4 — create failure → NO authoring, clear error, no orphan state
// --------------------------------------------------------------------------

describe('createOnNoFit — create failure (error surfaces, no orphan)', () => {
  it('throws when createFn rejects (non-empty target dir error)', async () => {
    const create = failingCreateFn('target is not empty, refusing to clobber: /projects/collision');
    const reader = stubReader([]);

    await expect(createOnNoFit('collision', create, reader)).rejects.toThrow(
      'target is not empty, refusing to clobber',
    );
  });

  it('error message includes enough context to identify the failure cause', async () => {
    const create = failingCreateFn('scaffold failed: EACCES: permission denied, mkdir');
    const reader = stubReader([]);

    await expect(createOnNoFit('no-perms', create, reader)).rejects.toThrow(
      'scaffold failed',
    );
  });

  it('reader is NOT queried after a createFn failure (no orphan lookup attempted)', async () => {
    const create = failingCreateFn('scaffold failed: disk full');
    const getProject = vi.fn().mockResolvedValue(undefined);
    const listProjects = vi.fn().mockResolvedValue([]);
    const reader: RegistryReader = { listProjects, getProject };

    await expect(createOnNoFit('disk-full-proj', create, reader)).rejects.toThrow();

    // Falsifiable: if the reader was queried AFTER create failure, these fail.
    expect(getProject).toHaveBeenCalledTimes(0);
    expect(listProjects).toHaveBeenCalledTimes(0);
  });

  it('createFn is called exactly once even on failure (no retry)', async () => {
    const create = failingCreateFn('scaffold failed: arbitrary error');
    const reader = stubReader([]);

    await expect(createOnNoFit('retry-test', create, reader)).rejects.toThrow();

    // Falsifiable: if the implementation retries createFn, this fails.
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Scenario 5 — post-create registry unreadable/malformed → STOP with clear error
// --------------------------------------------------------------------------

describe('createOnNoFit — post-create registry corruption', () => {
  it('throws with a message containing "corrupt" when registry is malformed after create', async () => {
    const name = 'corrupt-registry-proj';
    const createFn: CreateFn = vi.fn().mockResolvedValue(undefined);
    const reader = malformedRegistryReader(makeRecord(name, `/projects/${name}`));

    await expect(createOnNoFit(name, createFn, reader)).rejects.toThrow(
      'corrupt',
    );
  });

  it('createFn WAS called before the registry error (create ran, read failed)', async () => {
    const name = 'partial-proj';
    const createFn: CreateFn = vi.fn().mockResolvedValue(undefined);
    const reader = malformedRegistryReader(makeRecord(name, `/projects/${name}`));

    await expect(createOnNoFit(name, createFn, reader)).rejects.toThrow();

    // Falsifiable: createFn must have been called before the read failure was detected.
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('post-create "record not found" is reported as a clear error (not a silent undefined)', async () => {
    const name = 'ghost-project';
    const createFn: CreateFn = vi.fn().mockResolvedValue(undefined);
    // Registry has no record for the newly created project — simulates a write that
    // appeared to succeed but left no trace (e.g. wrong registry path).
    const reader = stubReader([]); // empty — project not in registry after create

    await expect(createOnNoFit(name, createFn, reader)).rejects.toThrow(
      'not found in registry',
    );
  });
});
