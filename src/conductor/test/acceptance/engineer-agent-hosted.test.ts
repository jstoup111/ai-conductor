// engineer-agent-hosted.test.ts
//
// Orphaned-primitives guard + agent-hosted execution conformance (ADR-008 Phase 9.3),
// updated for engineer worktree isolation (FR-1..FR-11, adr-2026-06-30).
//
// PURPOSE:
//   1. STATIC GUARDS: read the source files and assert ClaudeProvider + node:readline
//      have zero occurrences anywhere in src/engine/engineer* (the orphaned-primitives
//      guard). Superseded symbols must have zero callers in the engineer path.
//   2. END-TO-END: drive the PRODUCTION primitives dispatchEngineer({kind:'worktree'|'land'
//      |'handoff'}) against a temp git repo. The skills author .docs INSIDE the per-idea
//      worktree; land commits them on spec/<slug> from the worktree; handoff opens the PR
//      (injected gh) and removes the worktree on success.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';

const execFile = promisify(execFileCb);

// ─── Source-file paths (for static grep guards) ───────────────────────────────
const CONDUCTOR_SRC = join(process.cwd(), 'src', 'engine');
const ENGINEER_CLI = join(process.cwd(), 'src', 'engine', 'engineer-cli.ts');
const ENGINEER_LOOP = join(process.cwd(), 'src', 'engine', 'engineer', 'loop.ts');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** Create a git repo with an initial commit on main. */
async function makeGitRepo(name: string, baseDir: string): Promise<string> {
  const repoPath = join(baseDir, name);
  await mkdir(repoPath, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.test'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  return repoPath;
}

const slugOf = (idea: string) =>
  idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

/** Write real (non-stub, non-DRAFT) .docs artifacts into a directory (a worktree). */
async function writeDocsArtifacts(dir: string, idea: string): Promise<void> {
  const slug = slugOf(idea);
  const specsDir = join(dir, '.docs', 'specs');
  const storiesDir = join(dir, '.docs', 'stories');
  const plansDir = join(dir, '.docs', 'plans');
  await mkdir(specsDir, { recursive: true });
  await mkdir(storiesDir, { recursive: true });
  await mkdir(plansDir, { recursive: true });

  await writeFile(join(specsDir, `${slug}.md`), `# PRD: ${idea}\n\nApproved spec content.\n`, 'utf-8');
  await writeFile(
    join(storiesDir, `${slug}.md`),
    `# Stories: ${idea}\n\n**Status:** Accepted\n\n## Story: main\n\n### AC\n- Given x, when y, then z.\n`,
    'utf-8',
  );
  await writeFile(
    join(plansDir, `${slug}.md`),
    `# Plan: ${idea}\n\n## Tasks\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n`,
    'utf-8',
  );
}

/** Create the per-idea worktree and write real .docs into it — the pre-`land` state. */
async function worktreeWithDocs(repo: string, idea: string): Promise<string> {
  const wt = await createEngineerWorktree(repo, idea);
  await writeDocsArtifacts(wt.worktreePath, idea);
  return wt.worktreePath;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function makeRecord(path: string, name: string, remote?: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    ...(remote ? { remote } : {}),
    status: 'registered',
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

// ─── Shared per-test state ─────────────────────────────────────────────────────

let workDir: string;
let repoPath: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'agent-hosted-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  registryPath = join(workDir, 'registry.json');
  repoPath = await makeGitRepo('target-repo', workDir);
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// STATIC ORPHANED-PRIMITIVES GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe('static: orphaned-primitive guard — ClaudeProvider + readline must be zero in engineer path', () => {
  it('engineer-cli.ts contains NO readline import', async () => {
    const src = await readFile(ENGINEER_CLI, 'utf-8');
    expect(src).not.toMatch(/node:readline/);
    expect(src).not.toMatch(/readline\.createInterface/);
  });

  it('engineer-cli.ts contains NO ClaudeProvider import or construction', async () => {
    const src = await readFile(ENGINEER_CLI, 'utf-8');
    expect(src).not.toMatch(/ClaudeProvider/);
  });

  it('engineer/loop.ts contains NO uuidv4 import', async () => {
    const src = await readFile(ENGINEER_LOOP, 'utf-8');
    expect(src).not.toMatch(/uuidv4/);
  });

  it('engineer/loop.ts contains NO LLMProvider import', async () => {
    const src = await readFile(ENGINEER_LOOP, 'utf-8');
    expect(src).not.toMatch(/LLMProvider/);
  });

  it('grep: ClaudeProvider has zero occurrences in src/engine/engineer* files', async () => {
    const engineerDir2 = join(CONDUCTOR_SRC, 'engineer');
    const files = await readdir(engineerDir2, { recursive: true });
    const tsFiles = (files as string[]).filter((f) => f.endsWith('.ts'));
    for (const f of tsFiles) {
      const content = await readFile(join(engineerDir2, f), 'utf-8');
      expect(content, `${f} must not reference ClaudeProvider`).not.toMatch(/ClaudeProvider/);
    }
    const cliSrc = await readFile(ENGINEER_CLI, 'utf-8');
    expect(cliSrc, 'engineer-cli.ts must not reference ClaudeProvider').not.toMatch(/ClaudeProvider/);
  });

  it('grep: node:readline has zero occurrences in src/engine/engineer* files', async () => {
    const engineerDir2 = join(CONDUCTOR_SRC, 'engineer');
    const files = await readdir(engineerDir2, { recursive: true });
    const tsFiles = (files as string[]).filter((f) => f.endsWith('.ts'));
    for (const f of tsFiles) {
      const content = await readFile(join(engineerDir2, f), 'utf-8');
      expect(content, `${f} must not reference node:readline`).not.toMatch(/node:readline/);
    }
    const cliSrc = await readFile(ENGINEER_CLI, 'utf-8');
    expect(cliSrc, 'engineer-cli.ts must not reference node:readline').not.toMatch(/node:readline/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// detectEngineerCommand: subcommand parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('detectEngineerCommand: subcommand dispatch parsing', () => {
  it('bare "engineer" (no subcommand) returns {kind:"launch"} — interactive front door', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    expect(detectEngineerCommand(['node', 'conduct', 'engineer'])).toMatchObject({ kind: 'launch' });
  });

  it('"engineer projects" returns {kind:"projects"}', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    expect(detectEngineerCommand(['node', 'conduct', 'engineer', 'projects'])).toMatchObject({
      kind: 'projects',
    });
  });

  it('"engineer worktree --project p --idea i" returns {kind:"worktree", project, idea}', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    const result = detectEngineerCommand([
      'node', 'conduct', 'engineer', 'worktree', '--project', 'myproj', '--idea', 'add csv export',
    ]);
    expect(result).toMatchObject({ kind: 'worktree', project: 'myproj', idea: 'add csv export' });
  });

  it('"engineer land" requires --worktree — without it, falls back to guide', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    const result = detectEngineerCommand([
      'node', 'conduct', 'engineer', 'land', '--project', 'myproj', '--idea', 'add csv export',
    ]);
    expect(result).toMatchObject({ kind: 'guide' });
  });

  it('"engineer land --project p --idea i --worktree w" returns {kind:"land",...worktree}', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    const result = detectEngineerCommand([
      'node', 'conduct', 'engineer', 'land',
      '--project', 'myproj', '--idea', 'add csv export', '--worktree', '/wt/engineer-add-csv-export',
    ]);
    expect(result).toMatchObject({
      kind: 'land', project: 'myproj', idea: 'add csv export', worktree: '/wt/engineer-add-csv-export',
    });
  });

  it('"engineer handoff --project p --branch b --worktree w" returns {kind:"handoff",...worktree}', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    const result = detectEngineerCommand([
      'node', 'conduct', 'engineer', 'handoff',
      '--project', 'myproj', '--branch', 'spec/my-idea', '--worktree', '/wt/engineer-my-idea',
    ]);
    expect(result).toMatchObject({
      kind: 'handoff', project: 'myproj', branch: 'spec/my-idea', worktree: '/wt/engineer-my-idea',
    });
  });

  it('non-engineer argv returns null', async () => {
    const { detectEngineerCommand } = await import('../../src/engine/engineer-cli.js');
    expect(detectEngineerCommand(['node', 'conduct', 'some-feature'])).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'guide'})
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"guide"})', () => {
  it('returns 0 and prints a message mentioning agent-hosted or /engineer skill', async () => {
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const code = await dispatchEngineer({ kind: 'guide' }, { print: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/agent.hosted|\/engineer|skill/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'launch'})
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"launch"})', () => {
  it('invokes the injected interactive launcher and returns its exit code', async () => {
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const launchInteractive = vi.fn().mockResolvedValue(0);
    const code = await dispatchEngineer({ kind: 'launch' }, { launchInteractive });
    expect(launchInteractive).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('inside a Claude Code session it prints a note and does NOT spawn (no launcher injected)', async () => {
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'launch' },
      { insideClaudeSession: true, print: (s) => out.push(s) },
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/already inside|run \/engineer directly/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'projects'})
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"projects"})', () => {
  it('prints JSON array of registry records to stdout, returns 0', async () => {
    await writeFile(registryPath, JSON.stringify([makeRecord(repoPath, 'my-project')], null, 2), 'utf-8');
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const code = await dispatchEngineer({ kind: 'projects' }, { registryPath, print: (s) => out.push(s) });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((r: any) => r.name === 'my-project')).toBe(true);
  });

  it('empty registry → prints empty JSON array, returns 0', async () => {
    await writeFile(registryPath, JSON.stringify([]), 'utf-8');
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const code = await dispatchEngineer({ kind: 'projects' }, { registryPath, print: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'worktree'}): create the per-idea authoring worktree
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"worktree"})', () => {
  it('creates the per-idea worktree on spec/<slug> and prints JSON {slug,branch,worktreePath}', async () => {
    await writeRegistry([makeRecord(repoPath, 'target-repo')]);
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'target-repo', idea: 'add csv export' },
      { registryPath, print: (s) => out.push(s) },
    );
    expect(code).toBe(0);
    const result = JSON.parse(out.join(''));
    expect(result.branch).toBe('spec/add-csv-export');
    expect(result.worktreePath).toContain('.worktrees/engineer-add-csv-export');
    // The worktree exists on disk, checked out on the spec branch.
    expect(await pathExists(result.worktreePath)).toBe(true);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], result.worktreePath)).toBe('spec/add-csv-export');
    // The primary tree is still on main.
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('main');
  });

  it('unknown project → error on stderr, returns 1', async () => {
    await writeFile(registryPath, JSON.stringify([]), 'utf-8');
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'nope', idea: 'x' },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/nope|not found/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'land'}): commit .docs from the worktree onto spec/<slug>
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"land"})', () => {
  it('commits worktree artifacts onto spec/<slug> and prints JSON {slug,branch,repoPath}', async () => {
    const idea = 'add csv export';
    await writeRegistry([makeRecord(repoPath, 'target-repo')]);
    const worktree = await worktreeWithDocs(repoPath, idea);

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const out: string[] = [];
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree },
      { registryPath, print: (s) => out.push(s), printErr: (s) => err.push(s) },
    );

    expect(code).toBe(0);
    const result = JSON.parse(out.join(''));
    expect(result.branch).toBe('spec/add-csv-export');
    expect(result.repoPath).toBe(worktree);

    // The land commit exists on the spec branch, and the primary tree is untouched.
    const log = await git(['log', '--oneline', 'spec/add-csv-export'], repoPath);
    expect(log).toMatch(/engineer\/land/);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).toBe('main');
  });

  it('unknown project → prints error to stderr, returns 1', async () => {
    await writeFile(registryPath, JSON.stringify([]), 'utf-8');
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'land', project: 'nonexistent', idea: 'some idea', worktree: join(workDir, 'x') },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/nonexistent|not found/i);
  });

  it('missing artifact dirs → prints error to stderr, returns non-zero (worktree kept)', async () => {
    const idea = 'missing artifacts';
    await writeRegistry([makeRecord(repoPath, 'target-repo')]);
    const wt = await createEngineerWorktree(repoPath, idea); // no .docs authored
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree: wt.worktreePath },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).not.toBe(0);
    // Keep-on-failure: the worktree remains for inspection (FR-6).
    expect(await pathExists(wt.worktreePath)).toBe(true);
  });

  it('DRAFT artifact → rejected, returns non-zero', async () => {
    const idea = 'draft idea';
    await writeRegistry([makeRecord(repoPath, 'target-repo')]);
    const wt = await createEngineerWorktree(repoPath, idea);
    const slug = slugOf(idea);
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', `${slug}.md`), `# PRD: ${idea}\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', `${slug}.md`), `# Stories\n\n**Status:** DRAFT\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'plans', `${slug}.md`), `# Plan\n\n### Task 1\n**Dependencies:** none\n`, 'utf-8');

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree: wt.worktreePath },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).not.toBe(0);
    expect(err.join('')).toMatch(/draft|rejected|invalid/i);
  });

  it('dirty worktree (tracked change outside .docs) → rejected before commit', async () => {
    const idea = 'dirty idea';
    await writeRegistry([makeRecord(repoPath, 'target-repo')]);
    const worktree = await worktreeWithDocs(repoPath, idea);
    // Dirty a TRACKED file in the worktree (README came from the base commit).
    await writeFile(join(worktree, 'README.md'), '# tampered\n', 'utf-8');

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).not.toBe(0);
    expect(err.join('')).toMatch(/dirty|uncommitted/i);
    // No land commit was made.
    const log = await git(['log', '--oneline', 'spec/dirty-idea'], repoPath);
    expect(log).not.toMatch(/engineer\/land/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispatchEngineer({kind:'handoff'}): open spec PR via injected gh, remove worktree
// ═════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"handoff"})', () => {
  it('gh pr create runs in the worktree, PR reported, worktree removed on success (FR-4/FR-5)', async () => {
    const idea = 'add csv export';
    await writeRegistry([makeRecord(repoPath, 'target-repo', 'https://example.invalid/repo.git')]);
    const worktree = await worktreeWithDocs(repoPath, idea);

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const landOut: string[] = [];
    const landCode = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree },
      { registryPath, print: (s) => landOut.push(s) },
    );
    expect(landCode).toBe(0);
    const branch = JSON.parse(landOut.join('')).branch;

    const ghCalls: { args: string[]; cwd: string }[] = [];
    const fakeGh = async (args: string[], opts: { cwd: string }) => {
      ghCalls.push({ args, cwd: opts.cwd });
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://example.invalid/repo/pull/42' };
      }
      return { stdout: '' };
    };
    const launchCalls: string[] = [];
    const fakeLaunch = (p: string) => { launchCalls.push(p); };

    const handoffOut: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'target-repo', branch, worktree },
      {
        registryPath,
        engineerDir,
        gh: fakeGh,
        ensureRunningLaunch: fakeLaunch,
        print: (s) => handoffOut.push(s),
      },
    );

    expect(code).toBe(0);
    const result = JSON.parse(handoffOut.join(''));
    expect(result.kind).toBe('pr-opened');
    expect(result.url).toMatch(/pull\/42/);
    const prCreate = ghCalls.find((c) => c.args[0] === 'pr' && c.args[1] === 'create');
    expect(prCreate).toBeTruthy();
    // gh ran in the WORKTREE, not the primary checkout (FR-4).
    expect(prCreate!.cwd).toBe(worktree);
    // Never merges.
    expect(ghCalls.some((c) => c.args.includes('merge'))).toBe(false);
    // ensureRunning fired against the MAIN checkout (not the worktree).
    expect(launchCalls[0]).toBe(repoPath);
    // Remove-on-success: the worktree is gone, spec branch still reachable (FR-5).
    expect(await pathExists(worktree)).toBe(false);
    expect(await git(['rev-parse', '--verify', branch], repoPath)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('no-remote target → local-commit fallback, returns 0, worktree removed but branch reachable', async () => {
    const idea = 'offline idea';
    await writeRegistry([makeRecord(repoPath, 'target-repo')]); // no remote
    const worktree = await worktreeWithDocs(repoPath, idea);

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const landOut: string[] = [];
    await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree },
      { registryPath, print: (s) => landOut.push(s) },
    );
    const branch = JSON.parse(landOut.join('')).branch;

    // gh reports "no git remotes found" — the no-remote skip path.
    const noRemoteGh = async () => {
      throw new Error('no git remotes found');
    };
    const handoffOut: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'target-repo', branch, worktree },
      { registryPath, engineerDir, gh: noRemoteGh, print: (s) => handoffOut.push(s) },
    );
    expect(code).toBe(0);
    const result = JSON.parse(handoffOut.join(''));
    expect(['pr-opened', 'local-commit', 'pr-skipped']).toContain(result.kind);
    // The local-only spec commit remains reachable after worktree removal (FR-5 negative).
    expect(await pathExists(worktree)).toBe(false);
    expect(await git(['rev-parse', '--verify', branch], repoPath)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('handoff PR-open failure (no URL) KEEPS the worktree and reports its path (FR-6)', async () => {
    const idea = 'kept idea';
    await writeRegistry([makeRecord(repoPath, 'target-repo', 'https://example.invalid/repo.git')]);
    const worktree = await worktreeWithDocs(repoPath, idea);

    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const landOut: string[] = [];
    await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree },
      { registryPath, print: (s) => landOut.push(s) },
    );
    const branch = JSON.parse(landOut.join('')).branch;

    // gh "succeeds" but returns NO PR URL → openSpecPr throws (not a no-remote skip),
    // so the handoff fails: the worktree must be KEPT for inspection (FR-6).
    const noUrlGh = async () => ({ stdout: 'created but no url here\n' });
    const out: string[] = [];
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'target-repo', branch, worktree },
      { registryPath, engineerDir, gh: noUrlGh, print: (s) => out.push(s), printErr: (s) => err.push(s) },
    );
    expect(code).toBe(0); // non-fatal: work preserved on the branch
    const result = JSON.parse(out.join(''));
    expect(result.kind).toBe('local-commit');
    // Keep-on-failure: the worktree survives and its path is reported.
    expect(await pathExists(worktree)).toBe(true);
    expect(result.worktreePath).toBe(worktree);
    expect(err.join('')).toMatch(/worktree kept for inspection/i);
  });

  it('unknown project → prints error to stderr, returns 1', async () => {
    await writeFile(registryPath, JSON.stringify([]), 'utf-8');
    const { dispatchEngineer } = await import('../../src/engine/engineer-cli.js');
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'nonexistent', branch: 'spec/x', worktree: join(workDir, 'x') },
      { registryPath, printErr: (s) => err.push(s) },
    );
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/nonexistent|not found/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// landSpec: the underlying primitive (tested directly, in a worktree)
// ═════════════════════════════════════════════════════════════════════════════

describe('landSpec primitive (src/engine/engineer/land-spec.ts)', () => {
  it('commits worktree artifacts onto spec/<slug> and returns {slug, branch, repoPath}', async () => {
    const idea = 'add tag filtering';
    const worktree = await worktreeWithDocs(repoPath, idea);

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    const result = await landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree, undefined, {
      ownerConfig: { spec_owner: 'test-owner' },
    });

    expect(result.slug).toBe('add-tag-filtering');
    expect(result.branch).toBe('spec/add-tag-filtering');
    expect(result.repoPath).toBe(worktree);
    const log = await git(['log', '--oneline', 'spec/add-tag-filtering'], repoPath);
    expect(log).toMatch(/engineer\/land/);
  });

  it('missing worktree path → throws (no fallback to the primary checkout)', async () => {
    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, 'missing wt idea', join(workDir, 'no-such-worktree')),
    ).rejects.toThrow(/worktree|exist/i);
  });

  it('missing artifact → throws field-named error (C2 regression guard)', async () => {
    const idea = 'missing artifact idea';
    const wt = await createEngineerWorktree(repoPath, idea);
    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, wt.worktreePath, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/artifact|missing|spec|stories|plan/i);
  });

  it('empty artifact content → throws field-named error', async () => {
    const idea = 'empty artifact idea';
    const wt = await createEngineerWorktree(repoPath, idea);
    const slug = slugOf(idea);
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', `${slug}.md`), `# PRD\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', `${slug}.md`), `   \n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'plans', `${slug}.md`), `# Plan\n`, 'utf-8');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, wt.worktreePath, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/empty|blank|whitespace|invalid/i);
  });

  it('stub stories → throws (C2 regression guard for the exact shipped-bug string)', async () => {
    const idea = 'stub idea test';
    const wt = await createEngineerWorktree(repoPath, idea);
    const slug = slugOf(idea);
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', `${slug}.md`), `# PRD\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', `${slug}.md`), `# Stories: ${idea}\n\n_Generated by engineer._\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'plans', `${slug}.md`), `# Plan\n`, 'utf-8');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, wt.worktreePath, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/stub|generated|invalid/i);
  });

  it('stories with NO status line → throws (must require "Status: Accepted")', async () => {
    const idea = 'no status line idea';
    const wt = await createEngineerWorktree(repoPath, idea);
    const slug = slugOf(idea);
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', `${slug}.md`), `# PRD\n\nApproved spec content.\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', `${slug}.md`), `# Stories: ${idea}\n\n## Story: main\n\n### AC\n- Given x, when y, then z.\n`, 'utf-8');
    await writeFile(join(wt.worktreePath, '.docs', 'plans', `${slug}.md`), `# Plan\n\n### Task 1\n**Dependencies:** none\n`, 'utf-8');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, wt.worktreePath, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/not approved|Status: Accepted/i);
  });

  it('dirty worktree → throws before any commit (C2 regression guard)', async () => {
    const idea = 'dirty tree idea';
    const worktree = await worktreeWithDocs(repoPath, idea);
    // Modify a tracked file (README) in the worktree — dirty outside .docs.
    await writeFile(join(worktree, 'README.md'), '# modified\n', 'utf-8');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree),
    ).rejects.toThrow(/dirty|uncommitted/i);
    // No land commit was made on the branch.
    const log = await git(['log', '--oneline', 'spec/dirty-tree-idea'], repoPath);
    expect(log).not.toMatch(/engineer\/land/);
  });

  it('missing target (registry) path → throws TargetPathMissingError', async () => {
    // A worktree that does not exist under a canonical path that also does not exist.
    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec(
        { name: 'ghost', canonicalPath: join(workDir, 'does-not-exist') },
        'some idea',
        join(workDir, 'does-not-exist', '.worktrees', 'engineer-some-idea'),
      ),
    ).rejects.toThrow(/exist|missing|path|worktree/i);
  });

  it('C1/FR-10: a full land leaves a sibling repo byte-for-byte unchanged', async () => {
    const sibling = await makeGitRepo('sibling', workDir);
    const worktree = await worktreeWithDocs(repoPath, 'guarded idea');
    const siblingHeadBefore = await git(['rev-parse', 'HEAD'], sibling);

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    const result = await landSpec({ name: 'target', canonicalPath: repoPath }, 'guarded idea', worktree, undefined, {
      ownerConfig: { spec_owner: 'test-owner' },
    });
    expect(result.repoPath).toBe(worktree);

    expect(await git(['rev-parse', 'HEAD'], sibling)).toBe(siblingHeadBefore);
  });

  // ── Full DECIDE set: complexity marker + tier-conditional architecture ──────
  /** Write the complexity marker + (when non-Small) conflict/architecture/ADR into a worktree. */
  async function writeDecideExtras(
    dir: string,
    idea: string,
    tier: 'S' | 'M' | 'L',
    opts: { adrStatus?: string; skipArchitecture?: boolean } = {},
  ): Promise<void> {
    const slug = slugOf(idea);
    await mkdir(join(dir, '.docs', 'complexity'), { recursive: true });
    await writeFile(join(dir, '.docs', 'complexity', `${slug}.md`), `# Complexity\n\nTier: ${tier}\n`);
    if (tier === 'S' || opts.skipArchitecture) return;
    await mkdir(join(dir, '.docs', 'conflicts'), { recursive: true });
    await mkdir(join(dir, '.docs', 'architecture'), { recursive: true });
    await mkdir(join(dir, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(dir, '.docs', 'conflicts', `2026-06-28-${slug}.md`), '# Conflicts\n\nNone.\n');
    await writeFile(join(dir, '.docs', 'architecture', `${slug}.md`), '# Architecture\n\nDiagram.\n');
    await writeFile(
      join(dir, '.docs', 'decisions', 'adr-001-streaming.md'),
      `# ADR-001\n\n**Status:** ${opts.adrStatus ?? 'APPROVED'}\n`,
    );
  }

  it('non-Small: commits the full DECIDE set (complexity/conflicts/architecture/decisions)', async () => {
    const idea = 'add reporting module';
    const worktree = await worktreeWithDocs(repoPath, idea);
    await writeDecideExtras(worktree, idea, 'L');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    const result = await landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree, undefined, {
      ownerConfig: { spec_owner: 'test-owner' },
    });

    const tracked = await git(['ls-tree', '-r', '--name-only', result.branch], repoPath);
    expect(tracked).toMatch(/\.docs\/complexity\//);
    expect(tracked).toMatch(/\.docs\/conflicts\//);
    expect(tracked).toMatch(/\.docs\/architecture\//);
    expect(tracked).toMatch(/\.docs\/decisions\/adr-001-streaming\.md/);
  });

  it('Small: commits base artifacts + complexity, no architecture required', async () => {
    const idea = 'tiny tweak';
    const worktree = await worktreeWithDocs(repoPath, idea);
    await writeDecideExtras(worktree, idea, 'S');

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    const result = await landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree, undefined, {
      ownerConfig: { spec_owner: 'test-owner' },
    });

    const tracked = await git(['ls-tree', '-r', '--name-only', result.branch], repoPath);
    expect(tracked).toMatch(/\.docs\/complexity\//);
    expect(tracked).not.toMatch(/\.docs\/architecture\//);
    expect(tracked).not.toMatch(/\.docs\/decisions\//);
  });

  it('non-Small with a DRAFT ADR → throws before landing (no land commit)', async () => {
    const idea = 'feature with draft adr';
    const worktree = await worktreeWithDocs(repoPath, idea);
    await writeDecideExtras(worktree, idea, 'M', { adrStatus: 'DRAFT' });

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/DRAFT|APPROVED/i);
    expect(await git(['log', '--oneline', 'spec/feature-with-draft-adr'], repoPath)).not.toMatch(/engineer\/land/);
  });

  it('non-Small but missing architecture artifacts → throws (tier/artifact mismatch)', async () => {
    const idea = 'medium feature no arch';
    const worktree = await worktreeWithDocs(repoPath, idea);
    await writeDecideExtras(worktree, idea, 'M', { skipArchitecture: true });

    const { landSpec } = await import('../../src/engine/engineer/land-spec.js');
    await expect(
      landSpec({ name: 'target', canonicalPath: repoPath }, idea, worktree, undefined, {
        ownerConfig: { spec_owner: 'test-owner' },
      }),
    ).rejects.toThrow(/non-Small|conflicts|architecture|decisions/i);
    expect(await git(['log', '--oneline', 'spec/medium-feature-no-arch'], repoPath)).not.toMatch(/engineer\/land/);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}
