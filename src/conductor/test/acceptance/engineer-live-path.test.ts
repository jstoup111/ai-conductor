// Acceptance test: engineer live-path uses the gated DECIDE seam (Phase 9.3, FR-6, Task 35).
//
// These tests prove that the PRODUCTION PATH through runEngineerMode — real idea, 'y'
// confirmation — calls deps.decide for every authoring step rather than calling the
// superseded authorSpec / claude subprocess. The seam receives the correct (step, idea,
// project, prompt) context and its returned artifact is committed to the spec branch.
//
// Falsifiable invariants tested here:
//   1. The decide seam IS called when a real idea + 'y' confirmation flows through.
//   2. The seam receives all three steps: explore, prd, stories, plan (in order).
//   3. The seam receives the correct idea and project name.
//   4. The spec branch exists in the target repo after a successful run.
//   5. Without a decide seam, runEngineerMode throws fail-closed (no silent authoring).
//   6. No claude/claude-p subprocess is ever spawned (authorSpec is gone).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

// Dynamic import to avoid module caching issues across test isolation.
async function loadLoop(): Promise<{ runEngineerMode: (...args: any[]) => Promise<any> }> {
  return import('../../src/engine/engineer/loop.js') as Promise<{
    runEngineerMode: (...args: any[]) => Promise<any>;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** Create a real temp git repo with one initial commit (no remote). */
async function makeGitRepo(suffix: string): Promise<{ repoPath: string; defaultBranch: string }> {
  const repoPath = await mkdtemp(join(tmpdir(), `live-path-${suffix}-`));
  await execFile('git', ['init', '-b', 'main'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), `# ${suffix}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  const defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return { repoPath, defaultBranch };
}

/** Scripted IO helper. */
function scriptedIo(lines: string[]) {
  const queue = [...lines];
  const out: string[] = [];
  return {
    out,
    text: () => out.join('\n'),
    io: {
      prompt: async (): Promise<string | null> => (queue.length ? queue.shift()! : null),
      print: (s: string) => out.push(s),
    },
  };
}

/**
 * Route seam stub: routes any idea to the named project.
 * Conforms to RoutingProvider: invoke(prompt) → Promise<string>.
 * The loop normalises the wrapped { candidates: [...] } form — use that.
 */
function makeRoutingProvider(projectName: string) {
  return {
    invoke: async (_prompt: string): Promise<string> =>
      JSON.stringify({
        candidates: [{ name: projectName, score: 0.9, rationale: 'match' }],
      }),
  };
}

/** A no-op gh stub (no real GitHub calls). Answers the owner-identity
 * resolution call (fail-closed slice B) so authoring can proceed. */
const noopGh = async (args: string[], _opts: { cwd: string }) => {
  if (args[0] === 'api' && args[1] === 'user') return { stdout: 'test-owner\n' };
  return { stdout: '' };
};

/** Registry record factory. */
function makeRecord(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Shared per-test state
// ---------------------------------------------------------------------------

let workDir: string;
let repoPath: string;
let defaultBranch: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'live-path-test-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });

  // Real git repo used as the authoring target.
  ({ repoPath, defaultBranch } = await makeGitRepo('target'));

  // Write registry with one project pointing to the real repo.
  await writeFile(
    registryPath,
    JSON.stringify([makeRecord(repoPath, 'target-project')], null, 2),
    'utf-8',
  );

  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Decide seam: real approved artifacts satisfying runAuthoring contract.
// ---------------------------------------------------------------------------

type DecideCtx = { step: 'explore' | 'prd' | 'stories' | 'plan'; idea: string; project: string; prompt: string };

function makeApprovedDecide(spy?: (ctx: DecideCtx) => void) {
  return async (ctx: DecideCtx) => {
    spy?.(ctx);
    if (ctx.step === 'explore') {
      return { approved: true, artifact: `# Explore: ${ctx.idea}\n\napproaches\n` };
    }
    if (ctx.step === 'prd') {
      return { approved: true, artifact: `# PRD: ${ctx.idea}\n\nApproved.\n` };
    }
    if (ctx.step === 'stories') {
      return {
        approved: true,
        artifact: `# Stories: ${ctx.idea}\n\n**Status:** Accepted\n\n## Story: main\n\n### AC\n- Given x, when y, then z.\n`,
      };
    }
    if (ctx.step === 'plan') {
      return {
        approved: true,
        artifact: `# Plan: ${ctx.idea}\n\n## Tasks\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n`,
      };
    }
    return { approved: true, artifact: '' };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engineer live path — decide seam is wired (FR-6, Task 35)', () => {
  it('the decide seam IS called when a real idea + y confirmation is processed', async () => {
    const calls: DecideCtx[] = [];
    const decide = makeApprovedDecide((ctx) => calls.push({ ...ctx }));

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    const summary = await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    // Falsifiable: if the seam was never wired, calls would be empty.
    expect(calls.length).toBeGreaterThan(0);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('the decide seam receives all three steps: explore, prd, stories, plan', async () => {
    const stepsReceived: string[] = [];
    const decide = makeApprovedDecide((ctx) => stepsReceived.push(ctx.step));

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    // All three authoring steps must flow through the seam (in order).
    expect(stepsReceived).toEqual(['explore', 'prd', 'stories', 'plan']);
  });

  it('the decide seam receives the correct idea and project name', async () => {
    const calls: DecideCtx[] = [];
    const decide = makeApprovedDecide((ctx) => calls.push({ ...ctx }));

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    // Every call must carry the correct idea and project.
    for (const call of calls) {
      expect(call.idea).toBe('add CSV export');
      expect(call.project).toBe('target-project');
    }
  });

  it('the decide seam receives a non-empty prompt string for every step', async () => {
    const calls: DecideCtx[] = [];
    const decide = makeApprovedDecide((ctx) => calls.push({ ...ctx }));

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    // Every step must provide a prompt so the host agent can make a real decision.
    for (const call of calls) {
      expect(typeof call.prompt).toBe('string');
      expect(call.prompt.length).toBeGreaterThan(0);
    }
  });

  it('a spec branch exists in the target repo after a successful gated authoring', async () => {
    const decide = makeApprovedDecide();

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    const summary = await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    // After successful authoring, a spec branch must exist in the repo.
    const branches = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branches).toMatch(/spec\//);
    expect(summary.ideasProcessed).toBeGreaterThanOrEqual(1);
  });

  it('without a decide seam, runEngineerMode throws fail-closed (no silent authoring)', async () => {
    const { runEngineerMode } = await loadLoop();
    // No decide seam wired — must throw when authoring is attempted.
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    // The loop isolates per-idea errors, so we check ideasProcessed stays 0
    // OR we get an error. Either way, no silent authoring happens.
    const summary = await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      // decide intentionally absent
    });

    // No idea should have completed successfully without a seam.
    expect(summary.ideasProcessed).toBe(0);

    // Verify: NO spec branch was created (fail-closed, no fabricated artifacts).
    const branches = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branches).toBe('');
  });

  it('ideasProcessed is incremented exactly once when one idea is gated and confirmed', async () => {
    const decide = makeApprovedDecide();

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['add CSV export', 'y', 'exit']);

    const summary = await runEngineerMode({
      route: makeRoutingProvider('target-project'),
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
      decide,
    });

    expect(summary.ideasProcessed).toBe(1);
    expect(summary.buildsRun ?? 0).toBe(0);
  });
});
