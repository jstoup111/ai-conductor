// Test: TargetRepo resolved once from registry (Task 6, FR-6/FR-11, ADR-004)
//
// resolveTargetRepo accepts a canonical project path string and a RegistryReader,
// looks the project up in the registry, and returns a TargetRepo value object
// with { name, canonicalPath, remote? } — parsed ONCE, never re-validated.
//
// This file covers ONLY the happy path. The stale-path/existence negative is
// a separate task and is NOT tested here.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRegistryReader } from '../../../src/engine/registry.js';
import { resolveTargetRepo } from '../../../src/engine/brain/target.js';
import type { TargetRepo } from '../../../src/engine/brain/target.js';

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

    await expect(resolveTargetRepo(unknownPath, reader)).rejects.toThrow();
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
