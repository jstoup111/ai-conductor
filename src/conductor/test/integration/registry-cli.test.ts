import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NOT-YET-BUILT conduct-ts `register` / `create`
// subcommands (Phase 9.2). These invoke the REAL CLI entry two ways:
//
//  1. Structural: import the real `createProgram()` (re-exported from
//     src/index.ts) and assert it dispatches `register`/`create`. Today it has
//     ZERO subcommands → fast, deterministic, assertion-level RED.
//
//  2. Behavioral: spawn the REAL built entry (`node dist/index.js …`) against
//     REAL temp git repos and a REAL temp registry (`$AI_CONDUCTOR_REGISTRY`),
//     then assert on the produced ARTIFACTS (registry record, scaffolded files,
//     redacted remote, no-clobber). The subcommands don't exist yet, so the
//     CLI never produces the artifact — every behavioral assertion fails on its
//     own contract (RED), and a per-spawn kill timeout keeps the un-implemented
//     CLI's interactive hang from wedging the run.
//
// `dist/index.js` is rebuilt from CURRENT source in beforeAll so the spawn
// always exercises the real, present-day entry (no stale build, no feature
// smuggled in — tsup only compiles what exists).
//
// Real inputs only: real `git init`, a real token-bearing origin URL, real
// directories. Nothing mocked.
// ─────────────────────────────────────────────────────────────────────────────

// Spawn-based behavioral specs invoke the real CLI with a 4s kill timeout for
// the (currently interactive, un-implemented) entry; the per-test vitest
// timeout must comfortably exceed that plus real-git setup, so a spawn kill is
// reported as our own RED assertion, never a runner timeout (wrong reason).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONDUCTOR_DIR = join(__dirname, '..', '..');
const DIST_ENTRY = join(CONDUCTOR_DIR, 'dist', 'index.js');

interface CliResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

// Spawn the REAL CLI entry. stdin is closed and a hard kill timeout fires so
// the not-yet-implemented (interactive) CLI cannot hang the test run; a
// timeout simply means "the subcommand produced no terminal result", which our
// artifact assertions then catch as RED.
function runCli(
  args: string[],
  opts: { cwd: string; registry: string; timeoutMs?: number },
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [DIST_ENTRY, ...args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        AI_CONDUCTOR_REGISTRY: opts.registry,
        // Force non-interactive where the CLI honors it.
        CI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true, stdout, stderr });
    }, opts.timeoutMs ?? 4000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, stdout, stderr });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, stdout, stderr });
    });
  });
}

// Read+parse the real registry file, or [] if absent.
async function readRegistryFile(
  p: string,
): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(p)) return [];
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

// Initialize a REAL git repo at `dir` (on a deterministic default branch) with
// one commit. Optionally set a real `origin` remote.
async function initRealRepo(dir: string, origin?: string): Promise<void> {
  await execFileAsync('git', ['init', '-q', '-b', 'main', dir]);
  const git = (...a: string[]) =>
    execFileAsync('git', ['-C', dir, ...a]).then((r) => r.stdout);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'README.md'), '# proj\n');
  await git('add', '.');
  await git('commit', '-qm', 'initial');
  if (origin) await git('remote', 'add', 'origin', origin);
}

let sandbox: string;

beforeAll(async () => {
  // Rebuild the real entry from current source so the spawn exercises today's
  // CLI (no stale dist). npm run build now uses the publish wrapper to manage
  // the versioned dist-versions/ layout.
  await execFileAsync('npm', ['run', 'build'], { cwd: CONDUCTOR_DIR });
  expect(existsSync(DIST_ENTRY)).toBe(true);
}, 60_000);

describe('CLI dispatch surface (FR-3 / FR-6) — structural RED', () => {
  it('the real CLI program dispatches a `register` subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    // Today there are no subcommands; this is the wiring contract.
    expect(names).toContain('register');
  });

  it('the real CLI program dispatches a `create` subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain('create');
  });
});

describe('conduct register — real temp git repo (FR-3)', () => {
  let registry: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-register-'));
    registry = join(sandbox, 'registry.json');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('registers a real repo: name=basename, absolute path, exit 0', async () => {
    const repo = join(sandbox, 'my-cool-project');
    await mkdir(repo);
    await initRealRepo(repo);

    const res = await runCli(['register', repo], { cwd: sandbox, registry });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    // Derived from the REAL repo, not injected literals.
    expect(records[0].name).toBe(basename(repo)); // 'my-cool-project'
    expect(records[0].path).toBe(repo); // absolute
    expect(records[0].status).toBe('registered');
  });

  it('stores an ABSOLUTE path even when given a relative arg (FR-3 negative)', async () => {
    const repo = join(sandbox, 'relproj');
    await mkdir(repo);
    await initRealRepo(repo);

    // Invoke with cwd=sandbox and a relative path argument.
    const res = await runCli(['register', 'relproj'], {
      cwd: sandbox,
      registry,
    });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    // Stored path is the resolved absolute path, a stable key for the engineer.
    expect(records[0].path).toBe(repo);
  });

  it('discovers the origin remote and stores it WITHOUT credentials (FR-3 × FR-11)', async () => {
    const repo = join(sandbox, 'tokenrepo');
    await mkdir(repo);
    // A REAL token-bearing origin URL.
    await initRealRepo(
      repo,
      'https://user:ghp_secrettoken@github.com/o/tokenrepo.git',
    );

    const res = await runCli(['register', repo], { cwd: sandbox, registry });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    const remote = String(records[0].remote ?? '');
    // The remote is discovered AND redacted — no token on disk.
    expect(remote).toContain('github.com');
    expect(remote).toContain('/o/tokenrepo.git');
    expect(remote).not.toContain('ghp_secrettoken');
    // And the WHOLE registry file contains no token byte.
    const rawFile = await readFile(registry, 'utf-8');
    expect(rawFile).not.toContain('ghp_secrettoken');
  });
});

describe('conduct register — invalid targets do not corrupt the registry (FR-5)', () => {
  let registry: string;
  // A pre-existing valid registry that a failed register must leave intact.
  const PRIOR = [
    {
      schemaVersion: 1,
      name: 'existing',
      path: '/home/op/code/existing',
      status: 'registered',
      registeredAt: '2026-06-25T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-bad-'));
    registry = join(sandbox, 'registry.json');
    await writeFile(registry, JSON.stringify(PRIOR, null, 2), 'utf-8');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('non-existent path → non-zero exit, registry byte-identical', async () => {
    const before = await readFile(registry, 'utf-8');
    const missing = join(sandbox, 'does-not-exist');

    const res = await runCli(['register', missing], { cwd: sandbox, registry });
    expect(res.timedOut).toBe(false);
    expect(res.code).not.toBe(0);

    // The prior registry is untouched (byte-identical, still valid JSON).
    const after = await readFile(registry, 'utf-8');
    expect(after).toBe(before);
    expect(() => JSON.parse(after)).not.toThrow();
  });

  it('existing non-git dir → non-zero exit, registry byte-identical', async () => {
    const notGit = join(sandbox, 'plain-dir');
    await mkdir(notGit);
    await writeFile(join(notGit, 'file.txt'), 'hi', 'utf-8');
    const before = await readFile(registry, 'utf-8');

    const res = await runCli(['register', notGit], { cwd: sandbox, registry });
    expect(res.timedOut).toBe(false);
    expect(res.code).not.toBe(0);

    const after = await readFile(registry, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('conduct create — scaffold + register (FR-6)', () => {
  let registry: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-create-'));
    registry = join(sandbox, 'registry.json');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('scaffolds git repo + CLAUDE.md + .gitignore (4 ignores) + a `created` record', async () => {
    const res = await runCli(['create', 'fresh-proj'], {
      cwd: sandbox,
      registry,
    });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const proj = join(sandbox, 'fresh-proj');
    // Real git repo.
    expect(existsSync(join(proj, '.git'))).toBe(true);
    // Bootstrap CLAUDE.md.
    expect(existsSync(join(proj, 'CLAUDE.md'))).toBe(true);
    // .gitignore seeded with the required ignores; .serena/ is no longer
    // seeded since the harness dropped its Serena MCP dependency.
    const gitignore = await readFile(join(proj, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.pipeline/');
    expect(gitignore).toContain('.daemon/');
    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).not.toContain('.serena/');

    // A `created` record (status provenance).
    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('fresh-proj');
    expect(records[0].status).toBe('created');
  });

  it('--remote sets the remote (add-only, NO push) and stores it (FR-6 negative)', async () => {
    const remoteUrl = 'https://github.com/o/fresh-remote.git';
    const res = await runCli(
      ['create', 'fresh-remote', '--remote', remoteUrl],
      { cwd: sandbox, registry },
    );
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const proj = join(sandbox, 'fresh-remote');
    // The new repo must exist with the remote added (add-only — no push).
    // Guard the git read so a missing scaffold fails on a clear assertion
    // rather than an unhandled rejection.
    expect(existsSync(join(proj, '.git'))).toBe(true);
    const originUrl = await execFileAsync('git', [
      '-C',
      proj,
      'remote',
      'get-url',
      'origin',
    ])
      .then((r) => r.stdout.trim())
      .catch(() => '');
    expect(originUrl).toBe(remoteUrl);

    const records = await readRegistryFile(registry);
    expect(records[0].remote).toBe(remoteUrl);
  });

  it('--remote with embedded credentials → token NEVER reaches the registry (FR-11)', async () => {
    const tokenUrl = 'https://user:ghp_secretcreatetoken@github.com/o/leaky.git';
    const res = await runCli(
      ['create', 'leaky', '--remote', tokenUrl],
      { cwd: sandbox, registry },
    );
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    const remote = String(records[0].remote ?? '');
    // Redacted on disk: host/path kept, NO token.
    expect(remote).toContain('github.com');
    expect(remote).toContain('/o/leaky.git');
    expect(remote).not.toContain('ghp_secretcreatetoken');
    // The WHOLE registry file contains no token byte.
    const rawFile = await readFile(registry, 'utf-8');
    expect(rawFile).not.toContain('ghp_secretcreatetoken');

    // But git still has the REAL credential-bearing URL (git needs it).
    const originUrl = await execFileAsync('git', [
      '-C', join(sandbox, 'leaky'), 'remote', 'get-url', 'origin',
    ]).then((r) => r.stdout.trim()).catch(() => '');
    expect(originUrl).toBe(tokenUrl);
  });

  it('omitting --remote registers with remote absent, no network', async () => {
    const res = await runCli(['create', 'no-remote'], {
      cwd: sandbox,
      registry,
    });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    // remote absent/null — not an empty string masquerading as a remote.
    expect(records[0].remote == null || records[0].remote === undefined).toBe(
      true,
    );
  });
});

describe('conduct create — refuses to clobber (FR-7)', () => {
  let registry: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-clobber-'));
    registry = join(sandbox, 'registry.json');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('non-empty target → non-zero exit, NOTHING written (dir untouched, no record)', async () => {
    const proj = join(sandbox, 'occupied');
    await mkdir(proj);
    // Pre-existing user work that must survive untouched.
    await writeFile(join(proj, 'important.txt'), 'do not lose me', 'utf-8');

    const res = await runCli(['create', 'occupied'], {
      cwd: sandbox,
      registry,
    });
    expect(res.timedOut).toBe(false);
    expect(res.code).not.toBe(0);

    // Existing file untouched; no scaffold; no git init.
    expect(await readFile(join(proj, 'important.txt'), 'utf-8')).toBe(
      'do not lose me',
    );
    expect(existsSync(join(proj, '.git'))).toBe(false);
    expect(existsSync(join(proj, 'CLAUDE.md'))).toBe(false);

    // No orphan registry record for the refused project.
    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(0);
  });
});

describe('conduct register/create — unwritable registry is reported (FR-9)', () => {
  let registry: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-unwritable-'));
    // Point the registry under a regular FILE so the parent cannot be a dir;
    // any write must fail and be REPORTED (not swallowed).
    const fileAsDir = join(sandbox, 'blocker');
    await writeFile(fileAsDir, 'x', 'utf-8');
    registry = join(fileAsDir, 'registry.json');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('register against an unwritable registry → non-zero exit (reported, not swallowed)', async () => {
    const repo = join(sandbox, 'okrepo');
    await mkdir(repo);
    await initRealRepo(repo);

    const res = await runCli(['register', repo], { cwd: sandbox, registry });
    expect(res.timedOut).toBe(false);
    // Registration is a deliberate action — a write failure must surface.
    expect(res.code).not.toBe(0);
  });
});

describe('conduct register — status provenance end-to-end (FR-4 × FR-6)', () => {
  let registry: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'reg-cli-prov-'));
    registry = join(sandbox, 'registry.json');
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('create (created) → later register on same path keeps `created`', async () => {
    const created = await runCli(['create', 'prov-proj'], {
      cwd: sandbox,
      registry,
    });
    expect(created.timedOut).toBe(false);
    expect(created.code).toBe(0);

    const proj = join(sandbox, 'prov-proj');
    const reReg = await runCli(['register', proj], { cwd: sandbox, registry });
    expect(reReg.timedOut).toBe(false);
    expect(reReg.code).toBe(0);

    const records = await readRegistryFile(registry);
    expect(records).toHaveLength(1);
    // Provenance preserved end-to-end through the CLI.
    expect(records[0].status).toBe('created');
  });
});
