import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, realpath, symlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for createRegistryReader (Task 1, Phase 9.3).
//
// Tests the runtime RegistryReader factory added to src/engine/registry.ts.
// The factory wraps readRegistry/resolveRegistryPath/canonicalizePath.
//
// All tests use a real temp registry file, no mocks.
// ─────────────────────────────────────────────────────────────────────────────

async function loadRegistry(): Promise<typeof import('../../src/engine/registry.js')> {
  return import('../../src/engine/registry.js');
}

let tmpDir: string;
let registryPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'registry-reader-test-'));
  registryPath = join(tmpDir, 'registry.json');
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
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

describe('createRegistryReader', () => {
  it('is exported from registry.ts as a function', async () => {
    const mod = await loadRegistry();
    expect(typeof mod.createRegistryReader).toBe('function');
  });

  it('listProjects() returns all ProjectRecords from registry file pointed to by env', async () => {
    const projectDir = join(tmpDir, 'project-a');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);

    const records = [makeRecord(canonicalPath, 'project-a', 'https://example.invalid/a.git')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();
    const projects = await reader.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('project-a');
    expect(projects[0].path).toBe(canonicalPath);
    expect(projects[0].remote).toBe('https://example.invalid/a.git');
  });

  it('listProjects() returns [] when registry file is absent (no crash)', async () => {
    // registryPath NOT written — absent file case
    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();
    const projects = await reader.listProjects();

    expect(projects).toEqual([]);
  });

  it('listProjects() throws when registry JSON is malformed (corrupt registry must surface)', async () => {
    await writeFile(registryPath, '{ not valid json', 'utf-8');
    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();

    await expect(reader.listProjects()).rejects.toThrow(/registry/i);
  });

  it('getProject(path) matches a record by canonical path', async () => {
    const projectDir = join(tmpDir, 'project-b');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);

    const records = [makeRecord(canonicalPath, 'project-b')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();
    const found = await reader.getProject(canonicalPath);

    expect(found).toBeDefined();
    expect(found!.name).toBe('project-b');
  });

  it('getProject(path) returns undefined when path is not registered', async () => {
    const records = [makeRecord(join(tmpDir, 'other'), 'other')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();
    const found = await reader.getProject(join(tmpDir, 'nonexistent'));

    expect(found).toBeUndefined();
  });

  it('getProject(path) matches via canonical path — a symlink to the real path still matches', async () => {
    const realDir = join(tmpDir, 'real-project');
    const symDir = join(tmpDir, 'link-to-project');
    await mkdir(realDir, { recursive: true });
    await symlink(realDir, symDir);

    const canonicalPath = await realpath(realDir);
    const records = [makeRecord(canonicalPath, 'real-project')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();

    // Look up via the symlink path — should resolve to canonical and match
    const found = await reader.getProject(symDir);

    expect(found).toBeDefined();
    expect(found!.name).toBe('real-project');
  });

  it('createRegistryReader accepts opts.registryPath to override env', async () => {
    const projectDir = join(tmpDir, 'project-c');
    await mkdir(projectDir, { recursive: true });
    const canonicalPath = await realpath(projectDir);
    const records = [makeRecord(canonicalPath, 'project-c')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    // Do NOT set env var — pass opts directly
    delete process.env.AI_CONDUCTOR_REGISTRY;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader({ registryPath });
    const projects = await reader.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('project-c');
  });

  it('returns multiple records from registry with multiple entries', async () => {
    const dirA = join(tmpDir, 'alpha');
    const dirB = join(tmpDir, 'beta');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    const pathA = await realpath(dirA);
    const pathB = await realpath(dirB);

    const records = [makeRecord(pathA, 'alpha'), makeRecord(pathB, 'beta')];
    await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    const mod = await loadRegistry();
    const reader = mod.createRegistryReader();
    const projects = await reader.listProjects();

    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });
});
