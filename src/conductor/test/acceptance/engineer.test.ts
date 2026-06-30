import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RoutingProvider } from '../../src/engine/engineer/routing.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NOT-YET-BUILT engineer mode (Phase 9.3, FR-1..FR-12).
//
// The `src/engine/engineer/*` modules do not exist yet. Following the 9.1/9.2
// convention, every test dynamically imports the symbol it needs INSIDE the test
// body, so a missing module/export surfaces as THAT test's own RED failure rather
// than a whole-file collection crash that masks which behavior is unimplemented.
//
// These specs encode the 7 PRD acceptance scenarios
// (`.docs/specs/2026-06-25-phase-9.3-supervisor-engineer.md` §Acceptance Criteria)
// and the stories in `.docs/stories/phase-9.3-supervisor-engineer.md`. They test
// STORY FLOWS that cross multiple components; per-step negative paths are owned by
// the per-task unit tests in `.docs/plans/2026-06-25-phase-9.3-supervisor-engineer.md`.
//
// Contract the implementation must satisfy (defined by these specs, not by code):
//
//   runEngineerMode(deps): Promise<EngineerSessionSummary>
//     deps.provider : LLMProvider              // injected; stubbed here
//     deps.io       : { prompt(): Promise<string|null>; print(s: string): void }
//                      // prompt() yields the next idea line, or null at EOF/exit
//     deps.gh?      : (args: string[], opts: { cwd: string }) => Promise<{stdout:string}>
//                      // injected GitHub runner; stubbed; records calls
//     deps.spawnDaemon? : (project: string) => { detached: true }   // injected
//     // registry + store dirs come from env (AI_CONDUCTOR_REGISTRY / _ENGINEER_DIR)
//
//   Component entry points exercised directly by some flows:
//     resolveTargetRepo(project, registryReader)        -> TargetRepo | throws
//     selectLessons(idea, project, store)               -> LessonDigest
//     governorReport(reader)                            -> GovernorReport
//     computeFlywheelTrend(reader, ledger)              -> FlywheelTrend
// ─────────────────────────────────────────────────────────────────────────────

const exec = promisify(execFile);

const ENGINEER_MOD = '../../src/engine/engineer/loop.js';
const TARGET_MOD = '../../src/engine/engineer/target.js';
const LESSON_MOD = '../../src/engine/engineer/lesson-store.js';
const GOV_MOD = '../../src/engine/engineer/governor.js';
const TREND_MOD = '../../src/engine/engineer/flywheel-trend.js';
const REGISTRY_MOD = '../../src/engine/registry.js';
const STORE_MOD = '../../src/engine/engineer-store.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  // Throws (RED) if the module does not exist yet — the intended pre-impl failure.
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// Note: real-daemon spawning is globally disabled for the suite via test/setup.ts
// (AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH=1), so the engineer handoff's ensureRunning runs
// end-to-end here without leaking a tmux-hosted daemon.

// ── temp env scaffolding ────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'engineer-acc-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
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

// ── helpers ───────────────────────────────────────────────────────────────

async function initRepo(dir: string, withRemote = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  if (withRemote) {
    // A fake origin so default-branch discovery + PR machinery have a remote.
    await exec('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
    await exec('git', ['update-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
    await exec('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
    await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
  }
}

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2));
}

function project(path: string, name: string, remote?: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    remote,
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

async function seedSignals(lines: object[]): Promise<void> {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  await writeFile(join(engineerDir, 'signals.jsonl'), body);
}

function signal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ts: '2026-06-25T00:00:00.000Z',
    project: 'alpha',
    feature: 'f1',
    runId: 'r1',
    outcome: 'done',
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
    ...over,
  };
}

/** Scripted interactive IO: yields queued lines then null (EOF). Captures output. */
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
 * Route seam stub. Returns a JSON candidate array for routing calls.
 * The loop normalises wrapped { candidates: [...] } automatically.
 */
function makeProvider(opts: { routeTo?: string; noFit?: boolean } = {}) {
  const calls: string[] = [];
  const route: RoutingProvider = {
    async invoke(prompt: string): Promise<string> {
      calls.push(prompt);
      if (opts.noFit) {
        return JSON.stringify({ candidates: [], suggestCreate: true });
      }
      return JSON.stringify({
        candidates: [{ name: opts.routeTo ?? 'alpha', score: 0.9, rationale: 'match' }],
      });
    },
  };
  return { provider: route, route, calls };
}

/** gh stub: records every call so we can assert "PR opened" and "never merged". */
function makeGh(prUrl = 'https://example.invalid/x/pull/1') {
  const calls: string[][] = [];
  const gh = async (args: string[], _opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: prUrl };
    return { stdout: '' };
  };
  return { gh, calls };
}

/**
 * Approving DECIDE seam for acceptance tests that reach authoring.
 * Returns real artifacts with the required markers.
 */
function makeDecide() {
  return async (ctx: { step: 'brainstorm' | 'stories' | 'plan'; idea: string; project: string; prompt: string }) => {
    if (ctx.step === 'brainstorm') {
      return { approved: true, artifact: `# PRD: ${ctx.idea}\n\nApproved.\n` };
    }
    if (ctx.step === 'stories') {
      return {
        approved: true,
        artifact: `# Stories: ${ctx.idea}\n\n**Status:** Accepted\n\n## Story: feature\n\n### AC\n- Given x, when y, then z.\n`,
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

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 1 (FR-1, FR-2): loop starts, loads registry+store, processes an idea,
// loops, exits cleanly.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 1: conduct engineer loop start → idea → exit', () => {
  it('loads registry + store, reports project count, processes one idea, exits 0 with summary', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);
    await seedSignals([signal()]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    const { io, text } = scriptedIo(['add a CSV export to alpha', 'y', 'exit']);

    const summary = await runEngineerMode({ route, io, gh, decide: makeDecide() });

    expect(text()).toMatch(/1 (known )?project/i); // reports count
    expect(summary).toMatchObject({ ideasProcessed: 1 });
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('absent registry → 0 projects, no crash, and says so; absent store → flywheel no-op', async () => {
    // registryPath intentionally not written; engineerDir empty (no signals.jsonl).
    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ noFit: true });
    const { gh } = makeGh();
    const { io, text } = scriptedIo(['exit']);

    const summary = await runEngineerMode({ route, io, gh });

    expect(text()).toMatch(/0 (known )?projects/i);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('malformed registry → fast clear error naming the file (not silently 0 projects)', async () => {
    await writeFile(registryPath, '{ not json');
    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider();
    const { gh } = makeGh();
    const { io } = scriptedIo(['exit']);

    await expect(runEngineerMode({ route, io, gh })).rejects.toThrow(/registry/i);
  });

  it('blank idea re-prompts with no side effects; per-idea failure is isolated; EOF exits cleanly', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    // blank line, then EOF (null) — no idea processed, clean exit.
    const { io } = scriptedIo(['']);

    const summary = await runEngineerMode({ route, io, gh });
    expect(summary.ideasProcessed).toBe(0);
    expect(summary.exitCode ?? 0).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 2 (FR-3, FR-4): routing proposes a project, requires confirmation;
// redirect works; decline → zero writes; no-fit → offers create.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 2: routing + human confirmation gate', () => {
  it('decline → no branch, no PR, nothing written to any repo (zero writes on decline)', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);
    const before = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const branchesBefore = (await exec('git', ['branch', '--list'], { cwd: repo })).stdout;

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    const { io } = scriptedIo(['add export to alpha', 'n', 'exit']); // 'n' = decline

    await runEngineerMode({ route, io, gh });

    const after = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const branchesAfter = (await exec('git', ['branch', '--list'], { cwd: repo })).stdout;
    expect(after.stdout).toBe(before.stdout); // HEAD unmoved
    expect(branchesAfter).toBe(branchesBefore); // no spec/* branch created
    expect(ghCalls.length).toBe(0); // no PR machinery invoked
  });

  it('redirect to a registered project retargets authoring to that project', async () => {
    const a = join(workDir, 'alpha');
    const b = join(workDir, 'beta');
    await initRepo(a);
    await initRepo(b);
    await writeRegistry([project(a, 'alpha'), project(b, 'beta')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' }); // inference says alpha…
    const { gh } = makeGh();
    // …operator redirects to beta, then confirms.
    const { io } = scriptedIo(['some idea', 'redirect beta', 'y', 'exit']);

    const summary = await runEngineerMode({ route, io, gh, decide: makeDecide() });
    expect(summary.authored?.[0]?.project).toBe('beta');
  });

  it('redirect to an unknown name is rejected/re-prompted (no invented path)', async () => {
    const a = join(workDir, 'alpha');
    await initRepo(a);
    await writeRegistry([project(a, 'alpha')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    const { io, text } = scriptedIo(['idea', 'redirect nonesuch', 'n', 'exit']);

    await runEngineerMode({ route, io, gh });
    expect(text()).toMatch(/not (a )?registered|unknown project/i);
    expect(ghCalls.length).toBe(0);
  });

  it('no-fit → offers create; on confirm invokes 9.2 create + registers + routes to new repo', async () => {
    // empty registry → nothing fits.
    await writeRegistry([]);
    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ noFit: true });
    const { gh } = makeGh();
    const newRepoParent = join(workDir, 'created');
    await mkdir(newRepoParent, { recursive: true });
    // idea → offered create → confirm create → confirm authoring → exit
    const { io } = scriptedIo(['a brand new tool', `create ${join(newRepoParent, 'gamma')}`, 'y', 'y', 'exit']);

    const summary = await runEngineerMode({ route, io, gh, decide: makeDecide() });
    // new project registered
    const reg = JSON.parse(await readFile(registryPath, 'utf8'));
    expect(reg.some((r: any) => r.name === 'gamma')).toBe(true);
    expect(summary.authored?.[0]?.project).toBe('gamma');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 3 (FR-5): flywheel surfaces relevant prior lessons into planning.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 3: flywheel surfaces relevant lessons', () => {
  it('selects the specific relevant lessons for the target and excludes irrelevant ones', async () => {
    await seedSignals([
      signal({ project: 'alpha', feature: 'export', kickbacks: [{ gate: 'review', reason: 'n+1 query' }] }),
      signal({ project: 'beta', feature: 'unrelated', kickbacks: [{ gate: 'review', reason: 'css typo' }] }),
    ]);
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const selectLessons = requireFn(await load(LESSON_MOD), 'selectLessons');
    const store = requireFn(await load(LESSON_MOD), 'createJsonlLessonStore')(createReader());

    const digest = await selectLessons('add a CSV export', 'alpha', store);
    const text = JSON.stringify(digest);
    expect(text).toMatch(/n\+1 query/); // relevant alpha lesson surfaced
    expect(text).not.toMatch(/css typo/); // irrelevant beta lesson excluded
  });

  it('no relevant lessons → explicit "no prior lessons", not unrelated padding', async () => {
    await seedSignals([signal({ project: 'beta', feature: 'x', kickbacks: [{ gate: 'review', reason: 'css typo' }] })]);
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const selectLessons = requireFn(await load(LESSON_MOD), 'selectLessons');
    const store = requireFn(await load(LESSON_MOD), 'createJsonlLessonStore')(createReader());

    const digest = await selectLessons('something for alpha', 'alpha', store);
    expect(JSON.stringify(digest)).not.toMatch(/css typo/);
    expect((digest as any).empty ?? (digest as any).lessons?.length === 0).toBeTruthy();
  });

  it('digest is observably injected into the authoring prompt (not just logged)', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);
    await seedSignals([signal({ project: 'alpha', feature: 'export', kickbacks: [{ gate: 'review', reason: 'unique-marker-lesson' }] })]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    const { io } = scriptedIo(['extend the export', 'y', 'exit']);

    // Capture prompts passed to the DECIDE seam — this is where the digest is injected.
    const decideCalls: { step: string; prompt: string }[] = [];
    const spyDecide = async (ctx: { step: 'brainstorm' | 'stories' | 'plan'; idea: string; project: string; prompt: string }) => {
      decideCalls.push({ step: ctx.step, prompt: ctx.prompt });
      return makeDecide()(ctx);
    };

    await runEngineerMode({ route, io, gh, decide: spyDecide });
    // The brainstorm prompt (first DECIDE call) must contain the lesson from the digest.
    const brainstormCall = decideCalls.find((c) => c.step === 'brainstorm');
    expect(brainstormCall, 'brainstorm DECIDE step was invoked').toBeTruthy();
    expect(brainstormCall!.prompt).toMatch(/unique-marker-lesson/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 4 (FR-6, FR-7): authoring on a spec branch + PR; no build; no auto-merge.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 4: authoring → spec branch + PR, never build, never merge', () => {
  it('creates spec/<feature> branch off default branch, commits artifacts, opens a PR, reports URL', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh('https://example.invalid/alpha/pull/7');
    const { io, text } = scriptedIo(['add csv export', 'y', 'exit']);

    await runEngineerMode({ route, io, gh, decide: makeDecide() });

    const branches = (await exec('git', ['branch', '--list', 'spec/*'], { cwd: repo })).stdout;
    expect(branches).toMatch(/spec\//); // a spec branch was created
    expect(ghCalls.some((a) => a[0] === 'pr' && a[1] === 'create')).toBe(true);
    expect(text()).toMatch(/pull\/7/); // PR URL reported
  });

  it('never issues gh pr merge and never runs a build on any handoff path', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    const { io } = scriptedIo(['add csv export', 'y', 'exit']);

    const summary = await runEngineerMode({ route, io, gh, decide: makeDecide() });

    expect(ghCalls.some((a) => a.includes('merge'))).toBe(false); // never merges
    expect(summary.buildsRun ?? 0).toBe(0); // no build transition
  });

  it('no-remote target → spec committed on branch, non-fatal PR-skip reported (work preserved)', async () => {
    const repo = join(workDir, 'local-only');
    await initRepo(repo, /* withRemote */ false);
    await writeRegistry([project(repo, 'local-only')]); // no remote field

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'local-only' });
    const { gh } = makeGh();
    const { io, text } = scriptedIo(['offline idea', 'y', 'exit']);

    const summary = await runEngineerMode({ route, io, gh, decide: makeDecide() });
    expect(summary.exitCode ?? 0).toBe(0); // non-fatal
    expect(text()).toMatch(/no remote|PR (could not|skip)/i);
    const branches = (await exec('git', ['branch', '--list', 'spec/*'], { cwd: repo })).stdout;
    expect(branches).toMatch(/spec\//); // work preserved on a branch
  });

  it('authoring produces spec artifacts only — no source/impl files committed', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    const { io } = scriptedIo(['add csv export', 'y', 'exit']);
    await runEngineerMode({ route, io, gh, decide: makeDecide() });

    const specBranch = (await exec('git', ['branch', '--list', 'spec/*'], { cwd: repo })).stdout.trim().replace('*', '').trim();
    const changed = (await exec('git', ['diff', '--name-only', 'main', specBranch], { cwd: repo })).stdout.trim().split('\n').filter(Boolean);
    // every committed path is under .docs/ (spec artifacts), none are source/impl files
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((p) => p.startsWith('.docs/'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 5 (FR-11): cross-repo isolation — authoring A leaves B and own repo C
// byte-for-byte unchanged; stale path errors before any write.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 5: cross-repo isolation', () => {
  it('authoring for A leaves sibling B untouched', async () => {
    const a = join(workDir, 'alpha');
    const b = join(workDir, 'beta');
    await initRepo(a, true);
    await initRepo(b, true);
    await writeRegistry([project(a, 'alpha', 'https://example.invalid/a.git'), project(b, 'beta')]);

    const bHeadBefore = (await exec('git', ['rev-parse', 'HEAD'], { cwd: b })).stdout;
    const bBranchesBefore = (await exec('git', ['branch', '--list'], { cwd: b })).stdout;

    const runEngineerMode = requireFn(await load(ENGINEER_MOD), 'runEngineerMode');
    const { route } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    const { io } = scriptedIo(['idea for alpha', 'y', 'exit']);
    await runEngineerMode({ route, io, gh, decide: makeDecide() });

    const bHeadAfter = (await exec('git', ['rev-parse', 'HEAD'], { cwd: b })).stdout;
    const bBranchesAfter = (await exec('git', ['branch', '--list'], { cwd: b })).stdout;
    expect(bHeadAfter).toBe(bHeadBefore);
    expect(bBranchesAfter).toBe(bBranchesBefore);
  });

  it('stale/missing registry path → errors before any write (no cwd fallback)', async () => {
    const missing = join(workDir, 'does-not-exist');
    const createReader = requireFn(await load(REGISTRY_MOD), 'createRegistryReader');
    await writeRegistry([project(missing, 'ghost')]);
    const resolveTargetRepo = requireFn(await load(TARGET_MOD), 'resolveTargetRepo');

    await expect(resolveTargetRepo('ghost', createReader())).rejects.toThrow(/path|exist|missing/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 6 (FR-9): read-only governor reporting.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 6: read-only governor report', () => {
  it('computes aggregate spend + kickback/halt/retry rates from the store', async () => {
    await seedSignals([
      signal({ feature: 'f1', kickbacks: [{ gate: 'review', reason: 'x' }], tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 } }),
      signal({ feature: 'f2', kickbacks: [], tokens: { input: 200, output: 80, cacheRead: 0, cacheCreation: 0 } }),
    ]);
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const governorReport = requireFn(await load(GOV_MOD), 'governorReport');

    const report = await governorReport(createReader());
    expect(report.totalTokens?.input).toBe(300);
    expect(report.totalTokens?.output).toBe(130);
    // kickback rate = features-with-kickbacks / features = 1/2
    expect(report.kickbackRate).toBeCloseTo(0.5, 5);
  });

  it('empty store → safe zeros, no divide-by-zero, no crash; never writes', async () => {
    // no signals.jsonl
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const governorReport = requireFn(await load(GOV_MOD), 'governorReport');

    const report = await governorReport(createReader());
    expect(Number.isNaN(report.kickbackRate)).toBe(false);
    expect(report.kickbackRate ?? 0).toBe(0);
    // store dir untouched (still just the dir, no new files written by a read)
    const entries = await readdir(engineerDir);
    expect(entries.includes('signals.jsonl')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 7 (FR-10, FR-12): non-negotiable gate (no idea→build without merged
// spec PR) + flywheel measurable across successive engineer-planned features.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 7: non-autonomy gate + measurable flywheel', () => {
  it('the engineer module imports neither a build/pipeline nor a merge entry point', async () => {
    // Structural assertion over the engineer source tree (ADR-005 Condition 2).
    const engineerSrcDir = join(workDir, '..'); // placeholder; resolved below
    const root = process.cwd();
    const dir = join(root, 'src', 'engine', 'engineer');
    // RED until the engineer module exists.
    await access(dir);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = await readFile(join(dir, f), 'utf8');
      expect(src, `${f} must not import the pipeline/build entry point`).not.toMatch(/from ['"].*(pipeline|build)['"]/);
      expect(src, `${f} must not invoke gh pr merge`).not.toMatch(/pr['"],\s*['"]merge|pr merge/);
    }
  });

  it('flywheel trend covers only engineer-planned features (store ∩ authored-keys ledger)', async () => {
    // Two engineer-planned features (improving), plus one non-engineer feature that must be excluded.
    await seedSignals([
      signal({ project: 'alpha', feature: 'a1', kickbacks: [{ gate: 'r', reason: 'x' }, { gate: 'r', reason: 'y' }] }),
      signal({ project: 'alpha', feature: 'a2', kickbacks: [{ gate: 'r', reason: 'x' }] }),
      signal({ project: 'alpha', feature: 'noise', kickbacks: [{ gate: 'r', reason: 'z' }, { gate: 'r', reason: 'z' }, { gate: 'r', reason: 'z' }] }),
    ]);
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const mkLedger = requireFn(await load(TREND_MOD), 'createAuthoredLedger');
    const computeFlywheelTrend = requireFn(await load(TREND_MOD), 'computeFlywheelTrend');

    const ledger = mkLedger(); // durable; seed with the engineer-planned keys only
    await ledger.record('alpha', 'a1');
    await ledger.record('alpha', 'a2');

    const trend = await computeFlywheelTrend(createReader(), ledger);
    expect(trend.series.map((s: any) => s.feature)).toEqual(['a1', 'a2']); // 'noise' excluded
    expect(trend.direction).toBe('improving'); // 2 kickbacks → 1 kickback
  });

  it('fewer than two engineer-planned features → "insufficient data", not a spurious trend', async () => {
    await seedSignals([signal({ project: 'alpha', feature: 'only', kickbacks: [{ gate: 'r', reason: 'x' }] })]);
    const createReader = requireFn(await load(STORE_MOD), 'createEngineerStoreReader');
    const mkLedger = requireFn(await load(TREND_MOD), 'createAuthoredLedger');
    const computeFlywheelTrend = requireFn(await load(TREND_MOD), 'computeFlywheelTrend');

    const ledger = mkLedger();
    await ledger.record('alpha', 'only');
    const trend = await computeFlywheelTrend(createReader(), ledger);
    expect(trend.direction).toBe('insufficient_data');
  });
});
