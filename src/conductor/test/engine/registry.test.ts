import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NOT-YET-BUILT registry module
// (`src/engine/registry.ts`), Phase 9.2.
//
// The module does not exist yet, so a plain top-level `import` would throw at
// module-collection time and crash the whole file — every test would error for
// the WRONG reason (missing module), masking which behavior is unimplemented.
//
// Instead each test dynamic-imports `registry.js` inside a try/catch and, on
// any import/shape failure, calls `expect.fail(...)` NAMING the missing export.
// That turns "module absent" into a per-test, assertion-level RED: every test
// runs and fails individually on its own behavioral contract.
//
// Real inputs only: a REAL temp registry file via `$AI_CONDUCTOR_REGISTRY`,
// REAL directories + REAL symlinks for canonical-path dedup, REAL git repos for
// remote discovery context, REAL credential-bearing URLs for redaction. Nothing
// is mocked — there is no external network here.
// ─────────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

// Dynamic-import the module under test. On failure, fail THIS test with a clear
// message so a missing module never crashes the file collection.
async function loadRegistry(): Promise<typeof import('../../src/engine/registry.js')> {
  try {
    return await import('../../src/engine/registry.js');
  } catch (e) {
    expect.fail(
      `src/engine/registry.ts is not implemented yet (cannot import): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

// Assert an export exists on the loaded module, failing with its name if not.
function requireExport<K extends string>(
  mod: Record<string, unknown>,
  name: K,
): unknown {
  const v = mod[name];
  if (v === undefined) {
    expect.fail(`registry module does not export \`${name}\` yet`);
  }
  return v;
}

describe('engine/registry — resolveRegistryPath (FR-1)', () => {
  it('defaults to <home>/.ai-conductor/registry.json with no override', async () => {
    const mod = await loadRegistry();
    const resolve = requireExport(mod, 'resolveRegistryPath') as (a: {
      home?: string;
      env?: Record<string, string | undefined>;
    }) => string;

    const home = '/home/operator';
    const path = resolve({ home, env: {} });
    // Derived from the REAL injected home — not an injected literal path.
    expect(path).toBe(join(home, '.ai-conductor', 'registry.json'));
  });

  it('honors $AI_CONDUCTOR_REGISTRY override when set', async () => {
    const mod = await loadRegistry();
    const resolve = requireExport(mod, 'resolveRegistryPath') as (a: {
      home?: string;
      env?: Record<string, string | undefined>;
    }) => string;

    const override = join(tmpdir(), 'custom-registry', 'reg.json');
    const path = resolve({
      home: '/home/operator',
      env: { AI_CONDUCTOR_REGISTRY: override },
    });
    expect(path).toBe(override);
  });

  it('resolves to a path OUTSIDE any given project repo (FR-1 negative)', async () => {
    const mod = await loadRegistry();
    const resolve = requireExport(mod, 'resolveRegistryPath') as (a: {
      home?: string;
      env?: Record<string, string | undefined>;
    }) => string;

    const home = '/home/operator';
    const projectRoot = join(home, 'code', 'my-project');
    const path = resolve({ home, env: {} });
    // The registry path must never live inside the project being registered.
    expect(path.startsWith(projectRoot + '/')).toBe(false);
    expect(path).not.toContain(projectRoot);
  });

  it('errors clearly when home is unresolvable and no override is given (FR-1 edge)', async () => {
    const mod = await loadRegistry();
    const resolve = requireExport(mod, 'resolveRegistryPath') as (a: {
      home?: string;
      env?: Record<string, string | undefined>;
    }) => string;

    // No override + no/empty home → must throw rather than write to a
    // relative/wrong location.
    expect(() => resolve({ home: '', env: {} })).toThrow();
  });
});

describe('engine/registry — ProjectRecord schema + SCHEMA_VERSION (FR-2)', () => {
  it('exports a SCHEMA_VERSION constant', async () => {
    const mod = await loadRegistry();
    const v = requireExport(mod, 'SCHEMA_VERSION');
    // A versioned schema so the 9.3 reader can evolve.
    expect(v === undefined || v === null).toBe(false);
  });
});

describe('engine/registry — readRegistry tolerant parse (FR-2)', () => {
  let dir: string;
  let regPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-read-'));
    regPath = join(dir, 'registry.json');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when the registry file is absent', async () => {
    const mod = await loadRegistry();
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<unknown[]>;
    const records = await readRegistry(regPath);
    expect(records).toEqual([]);
  });

  it('reads back records from a real registry file', async () => {
    const mod = await loadRegistry();
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<Array<{ name: string; path: string }>>;

    const fixture = [
      {
        schemaVersion: 1,
        name: 'alpha',
        path: '/home/op/code/alpha',
        status: 'registered',
        registeredAt: '2026-06-25T00:00:00.000Z',
      },
    ];
    await writeFile(regPath, JSON.stringify(fixture), 'utf-8');

    const records = await readRegistry(regPath);
    expect(records).toHaveLength(1);
    // Derived from the REAL file content, not an injected literal.
    expect(records[0].name).toBe('alpha');
    expect(records[0].path).toBe('/home/op/code/alpha');
  });

  it('THROWS a clear error on malformed JSON — never a silent empty (FR-2 negative)', async () => {
    const mod = await loadRegistry();
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<unknown[]>;

    await writeFile(regPath, '{ this is not: valid json ]]', 'utf-8');
    // A corrupt registry must be surfaced, not masked as an empty registry.
    await expect(readRegistry(regPath)).rejects.toThrow();
  });
});

describe('engine/registry — writeRegistry atomic + concurrency-safe (FR-9)', () => {
  let dir: string;
  let regPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-write-'));
    regPath = join(dir, 'registry.json');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes valid JSON that reads back identically (atomic temp+rename)', async () => {
    const mod = await loadRegistry();
    const writeRegistry = requireExport(mod, 'writeRegistry') as (
      p: string,
      r: unknown[],
    ) => Promise<void>;
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<unknown[]>;

    const records = [
      {
        schemaVersion: 1,
        name: 'beta',
        path: '/home/op/code/beta',
        status: 'registered',
        registeredAt: '2026-06-25T00:00:00.000Z',
      },
    ];
    await writeRegistry(regPath, records);

    // Raw file is valid JSON (no torn write).
    const raw = await readFile(regPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(await readRegistry(regPath)).toEqual(records);
  });

  it('creates the parent dir on first write (FR-1 auto-create)', async () => {
    const mod = await loadRegistry();
    const writeRegistry = requireExport(mod, 'writeRegistry') as (
      p: string,
      r: unknown[],
    ) => Promise<void>;

    const nested = join(dir, 'a', 'b', 'c', 'registry.json');
    expect(existsSync(join(dir, 'a'))).toBe(false);
    await writeRegistry(nested, []);
    expect(existsSync(nested)).toBe(true);
  });

  it('≥2 CONCURRENT writes leave valid JSON, never a torn file (FR-9)', async () => {
    const mod = await loadRegistry();
    const writeRegistry = requireExport(mod, 'writeRegistry') as (
      p: string,
      r: unknown[],
    ) => Promise<void>;

    const mk = (n: number) => ({
      schemaVersion: 1,
      name: `proj-${n}`,
      path: `/home/op/code/proj-${n}`,
      status: 'registered' as const,
      registeredAt: '2026-06-25T00:00:00.000Z',
    });

    // Fire several writers at once; whichever wins, the file must always be
    // parseable JSON — no reader ever sees a half-written file.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => writeRegistry(regPath, [mk(i)])),
    );

    const raw = await readFile(regPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(Array.isArray(JSON.parse(raw))).toBe(true);
  });

  it('REPORTS (throws) on an unwritable registry dir — not swallowed (FR-9 negative)', async () => {
    const mod = await loadRegistry();
    const writeRegistry = requireExport(mod, 'writeRegistry') as (
      p: string,
      r: unknown[],
    ) => Promise<void>;

    // Point the registry at a path under a regular FILE (not a dir): mkdir of
    // the parent must fail, and the write must surface that error.
    const fileAsDir = join(dir, 'not-a-dir');
    await writeFile(fileAsDir, 'x', 'utf-8');
    const badPath = join(fileAsDir, 'registry.json');

    await expect(writeRegistry(badPath, [])).rejects.toThrow();
  });
});

describe('engine/registry — upsertProject canonical-path dedup + provenance (FR-4)', () => {
  let dir: string;
  let regPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-upsert-'));
    regPath = join(dir, 'registry.json');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // upsertProject signature: (registryPath, record) -> Promise<records-after>.
  // The test reads the file back via readRegistry to assert final state.
  type ProjectRecord = {
    schemaVersion: number;
    name: string;
    path: string;
    remote?: string;
    status: 'registered' | 'created';
    registeredAt: string;
  };
  function mkRecord(p: string, over: Partial<ProjectRecord> = {}): ProjectRecord {
    return {
      schemaVersion: 1,
      name: basename(p),
      path: p,
      status: 'registered',
      registeredAt: new Date().toISOString(),
      ...over,
    };
  }

  it('dedups a symlinked vs real path to ONE record (realpath canonicalization)', async () => {
    const mod = await loadRegistry();
    const upsertProject = requireExport(mod, 'upsertProject') as (
      p: string,
      r: ProjectRecord,
    ) => Promise<unknown>;
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<ProjectRecord[]>;

    // REAL dir + a REAL symlink pointing at it.
    const realDir = join(dir, 'real-project');
    await mkdir(realDir);
    const linkDir = join(dir, 'linked-project');
    await symlink(realDir, linkDir, 'dir');

    // Register first via the symlink, then via the real path.
    await upsertProject(regPath, mkRecord(linkDir));
    await upsertProject(regPath, mkRecord(realDir));

    const records = await readRegistry(regPath);
    // Canonicalization (realpath) collapses both to one record.
    expect(records).toHaveLength(1);
    expect(records[0].path).toBe(await realpath(realDir));
  });

  it('keeps TWO distinct records for two genuinely different real dirs', async () => {
    const mod = await loadRegistry();
    const upsertProject = requireExport(mod, 'upsertProject') as (
      p: string,
      r: ProjectRecord,
    ) => Promise<unknown>;
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<ProjectRecord[]>;

    const a = join(dir, 'proj-a');
    const b = join(dir, 'proj-b');
    await mkdir(a);
    await mkdir(b);

    await upsertProject(regPath, mkRecord(a));
    await upsertProject(regPath, mkRecord(b));

    const records = await readRegistry(regPath);
    expect(records).toHaveLength(2);
    const paths = records.map((r) => r.path).sort();
    expect(paths).toEqual([await realpath(a), await realpath(b)].sort());
  });

  it('re-upsert of the same path updates fields in place, count stays 1', async () => {
    const mod = await loadRegistry();
    const upsertProject = requireExport(mod, 'upsertProject') as (
      p: string,
      r: ProjectRecord,
    ) => Promise<unknown>;
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<ProjectRecord[]>;

    const p = join(dir, 'proj');
    await mkdir(p);

    await upsertProject(regPath, mkRecord(p, { remote: 'https://h/old.git' }));
    await upsertProject(regPath, mkRecord(p, { remote: 'https://h/new.git' }));

    const records = await readRegistry(regPath);
    expect(records).toHaveLength(1);
    // Fields updated in place — the second remote wins.
    expect(records[0].remote).toBe('https://h/new.git');
  });

  it('does NOT downgrade a `created` record to `registered` on re-upsert (status provenance)', async () => {
    const mod = await loadRegistry();
    const upsertProject = requireExport(mod, 'upsertProject') as (
      p: string,
      r: ProjectRecord,
    ) => Promise<unknown>;
    const readRegistry = requireExport(mod, 'readRegistry') as (
      p: string,
    ) => Promise<ProjectRecord[]>;

    const p = join(dir, 'created-proj');
    await mkdir(p);

    // First seen as a `create`d project, then later re-registered.
    await upsertProject(regPath, mkRecord(p, { status: 'created' }));
    await upsertProject(regPath, mkRecord(p, { status: 'registered' }));

    const records = await readRegistry(regPath);
    expect(records).toHaveLength(1);
    // Provenance preserved: `created` is NOT downgraded to `registered`.
    expect(records[0].status).toBe('created');
  });
});

describe('engine/registry — redactRemote strips credentials (FR-11)', () => {
  it('strips user:token@ from an https URL, keeps host + path, drops the token', async () => {
    const mod = await loadRegistry();
    const redactRemote = requireExport(mod, 'redactRemote') as (u: string) => string;

    const out = redactRemote(
      'https://user:ghp_secrettoken@github.com/o/r.git',
    );
    // No credential material reaches disk.
    expect(out).not.toContain('ghp_secrettoken');
    expect(out).not.toContain('user:');
    expect(out).not.toContain('@github.com');
    // Host + path retained so the remote is still identifiable.
    expect(out).toContain('github.com');
    expect(out).toContain('/o/r.git');
  });

  it('leaves a plain https URL unchanged', async () => {
    const mod = await loadRegistry();
    const redactRemote = requireExport(mod, 'redactRemote') as (u: string) => string;

    const plain = 'https://github.com/o/r.git';
    expect(redactRemote(plain)).toBe(plain);
  });

  it('handles scp-style git@host: form without leaking credentials', async () => {
    const mod = await loadRegistry();
    const redactRemote = requireExport(mod, 'redactRemote') as (u: string) => string;

    // git@github.com:o/r.git carries no password; host/path must be retained.
    const out = redactRemote('git@github.com:o/r.git');
    expect(out).toContain('github.com');
    expect(out).toContain('o/r.git');
  });

  it('strips credentials from an ssh:// URL', async () => {
    const mod = await loadRegistry();
    const redactRemote = requireExport(mod, 'redactRemote') as (u: string) => string;

    const out = redactRemote('ssh://git:supersecret@host.example/o/r.git');
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('git:supersecret');
    expect(out).toContain('host.example');
    expect(out).toContain('/o/r.git');
  });
});

describe('engine/registry — RegistryReader / ProjectRecord type contract (FR-10)', () => {
  it('a fixture set of records type-checks against the exported contract', async () => {
    // This test is primarily a COMPILE-TIME contract: the imports below only
    // type-check if `ProjectRecord` and `RegistryReader` are exported with the
    // documented shapes. At runtime it also asserts the module loads.
    const mod = await loadRegistry();
    expect(mod).toBeDefined();

    // The following block is type-only; it is here so `tsc --noEmit` (and
    // vitest's TS transform) fail to resolve the types until they exist.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _Assert = () => void;
    const _typeCheck: _Assert = () => {
      // The types now exist (FR-10 shipped): this block type-checks the
      // contract directly. RegistryReader's methods are async, so the stub
      // returns Promises — a sync stub would be a real type error here.
      const _r: import('../../src/engine/registry.js').RegistryReader = {
        listProjects: () => Promise.resolve([]),
        getProject: () => Promise.resolve(undefined),
      };
      const _rec: import('../../src/engine/registry.js').ProjectRecord = {
        schemaVersion: 1,
        name: 'x',
        path: '/x',
        status: 'registered',
        registeredAt: '2026-06-25T00:00:00.000Z',
      };
      void _r;
      void _rec;
    };
    void _typeCheck;
  });
});

// A sanity check that the harness's own git is available for the CLI specs'
// real-repo setup (kept here so the module file documents the real-git dep).
describe('engine/registry — environment sanity', () => {
  it('git is available for real-repo derivations used by the CLI specs', async () => {
    const { stdout } = await execFileAsync('git', ['--version']);
    expect(stdout).toMatch(/git version/);
  });
});
