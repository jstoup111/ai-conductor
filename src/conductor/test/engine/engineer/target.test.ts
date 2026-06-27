// Test: TargetRepo resolved once from registry (Task 6 + Task 7, FR-6/FR-11, ADR-004)
//
// resolveTargetRepo accepts a canonical project path string and a RegistryReader,
// looks the project up in the registry, and returns a TargetRepo value object
// with { name, canonicalPath, remote? } — parsed ONCE, never re-validated.
//
// Task 6: Happy-path tests (existing).
// Task 7: Stale-path negative tests — a registry record whose path no longer
//   exists on disk must throw TargetPathMissingError before returning anything.
//   No cwd fallback is permitted under any circumstances.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRegistryReader } from '../../../src/engine/registry.js';
import { resolveTargetRepo, TargetPathMissingError } from '../../../src/engine/engineer/target.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';

let tmpDir: string;
let registryPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'target-test-'));
  registryPath = join(tmpDir, 'registry.json');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeRecord(path: string, name: string, remote?: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    ...(remote ? { remote } : {}),
    status: 'registered' as const,
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

describe('resolveTargetRepo', () => {
  it('returns a TargetRepo with name and canonicalPath from a registered project', async () => {
    const projectDir = join(tmpDir, 'my-project');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);

    const records = [makeRecord(canonicalPath, 'my-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    const reader = createRegistryReader({ registryPath });
    const target = await resolveTargetRepo(canonicalPath, reader);

    expect(target.name).toBe('my-project');
    expect(target.canonicalPath).toBe(canonicalPath);
    expect(target.remote).toBeUndefined();
  });

  it('includes remote when the registry record has one', async () => {
    const projectDir = join(tmpDir, 'remote-project');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);
    const remoteUrl = 'https://github.example.com/org/remote-project.git';

    const records = [makeRecord(canonicalPath, 'remote-project', remoteUrl)];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    const reader = createRegistryReader({ registryPath });
    const target = await resolveTargetRepo(canonicalPath, reader);

    expect(target.name).toBe('remote-project');
    expect(target.canonicalPath).toBe(canonicalPath);
    expect(target.remote).toBe(remoteUrl);
  });

  it('throws when the path is not in the registry', async () => {
    const projectDir = join(tmpDir, 'registered-project');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);

    const records = [makeRecord(canonicalPath, 'registered-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    const reader = createRegistryReader({ registryPath });
    const unknownPath = join(tmpDir, 'unknown-project');

    await expect(resolveTargetRepo(unknownPath, reader)).rejects.toThrow(unknownPath);
  });

  it('TargetRepo shape has name, canonicalPath, and optional remote', () => {
    // Type-level assertion: construct TargetRepo values manually to confirm
    // TypeScript accepts the correct shapes.
    const withoutRemote: TargetRepo = {
      name: 'test',
      canonicalPath: '/some/path',
    };
    const withRemote: TargetRepo = {
      name: 'test',
      canonicalPath: '/some/path',
      remote: 'https://github.example.com/org/test.git',
    };
    expect(withoutRemote.name).toBe('test');
    expect(withRemote.remote).toBeDefined();
  });
});

describe('resolveTargetRepo — stale-path negative (Task 7, FR-11)', () => {
  // These tests guard against a critical failure mode: a registry record that
  // points at a path that no longer exists on disk (repo moved/deleted). If
  // resolveTargetRepo silently fell back to cwd, the engineer could author a spec
  // into the WRONG repo. These tests make that impossible.

  it('throws TargetPathMissingError (not a generic Error) when the registry record path does not exist', async () => {
    // Create a path in the registry that NEVER exists on disk — not even
    // temporarily. This is a real adversarial input: a deleted project dir.
    const deletedPath = join(tmpDir, 'deleted-project-that-was-never-created');
    // Do NOT mkdir — the path must be absent.

    const records = [makeRecord(deletedPath, 'stale-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    const reader = createRegistryReader({ registryPath });

    // Must throw — and the error must be TargetPathMissingError specifically,
    // not a generic Error. A plain `Error` would pass rejects.toThrow() but
    // fail the instanceof check below, making this assertion falsifiable.
    const err = await resolveTargetRepo(deletedPath, reader).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TargetPathMissingError);
    // The error message must name the missing path so the operator can act.
    expect((err as TargetPathMissingError).message).toContain(deletedPath);
  });

  it('names the exact missing path in the error message', async () => {
    // Adversarial: create then DELETE the directory to simulate a moved repo.
    const movedPath = join(tmpDir, 'moved-project');
    await mkdir(movedPath, { recursive: true });
    const canonicalPath = await realpath(movedPath);
    // Now register it, then delete it — registry is stale.
    const records = [makeRecord(canonicalPath, 'moved-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
    await rm(movedPath, { recursive: true, force: true });

    const reader = createRegistryReader({ registryPath });
    const err = await resolveTargetRepo(canonicalPath, reader).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TargetPathMissingError);
    // Falsifiable: a generic error thrown without the path would fail this.
    expect((err as TargetPathMissingError).message).toContain(canonicalPath);
  });

  it('NEVER falls back to cwd — stale record throws, not resolves to cwd', async () => {
    // This is the cwd-fallback guard. If resolveTargetRepo had a cwd fallback
    // (e.g. `path ?? process.cwd()`), the returned canonicalPath would equal
    // process.cwd() rather than throwing. We assert it is impossible.
    const stalePath = join(tmpDir, 'ghost-project-absolutely-does-not-exist');
    // stalePath is never created on disk.

    const records = [makeRecord(stalePath, 'ghost-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    const reader = createRegistryReader({ registryPath });

    // The call MUST reject — it must not return a TargetRepo at all.
    // If it resolved, the canonicalPath might equal cwd, which is catastrophic.
    await expect(resolveTargetRepo(stalePath, reader)).rejects.toBeInstanceOf(TargetPathMissingError);

    // Belt-and-suspenders: confirm cwd itself is reachable (it exists on disk),
    // meaning the only reason the call threw is the stale path check, not some
    // unrelated fs error. This rules out a test environment issue.
    const cwd = process.cwd();
    const { access } = await import('fs/promises');
    await expect(access(cwd)).resolves.toBeUndefined();
  });
});
