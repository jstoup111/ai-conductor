// Poll-on-launch wiring for runEngineerMode (Phase 9.3b, Story 7 / FR-31, T20/T21).
//
// Launch sequence: poll injected sources → enqueue → claim-oldest → process ONE.
// Empty inbox after poll → fall back to interactive chat capture (no error/hang).
// On the processed envelope, the write-back port reports routed + done and the
// ledger advances to done. Only ONE envelope is processed per launch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import type { Envelope, EnvelopeStatus, ReportMeta } from '../../../src/engine/engineer/intake/port.js';

const exec = promisify(execFileCb);

async function loadLoop(): Promise<{ runEngineerMode: (...args: any[]) => Promise<any> }> {
  return import('../../../src/engine/engineer/loop.js') as Promise<{
    runEngineerMode: (...args: any[]) => Promise<any>;
  }>;
}

// ── fakes ───────────────────────────────────────────────────────────────────

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

function makeProvider(routeTo: string) {
  return {
    route: {
      async invoke(): Promise<string> {
        return JSON.stringify([{ name: routeTo, score: 0.9, rationale: 'match' }]);
      },
    },
  };
}

function makeGh(prUrl: string) {
  const calls: string[][] = [];
  const gh = async (args: string[], _opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: prUrl };
    return { stdout: '' };
  };
  return { gh, calls };
}

function makeTestDecide() {
  return async (ctx: { step: 'brainstorm' | 'stories' | 'plan'; idea: string }) => {
    if (ctx.step === 'brainstorm') return { approved: true, artifact: `# PRD: ${ctx.idea}\n\nOk.\n` };
    if (ctx.step === 'stories')
      return {
        approved: true,
        artifact: `# Stories\n\n**Status:** Accepted\n\n## Story\n### AC\n- Given x, when y, then z.\n`,
      };
    return {
      approved: true,
      artifact: `# Plan\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n`,
    };
  };
}

/** A capturing write-back port + an IntakeSource over a fixed envelope list. */
function fakeIntake(envelopes: Envelope[]) {
  const reports: Array<{ sourceRef: string; status: EnvelopeStatus; meta?: ReportMeta }> = [];
  const port = {
    async report(sourceRef: string, status: EnvelopeStatus, meta?: ReportMeta) {
      reports.push({ sourceRef, status, meta });
    },
  };
  const source = { poll: async () => envelopes };
  return { source, port, reports };
}

function envelope(sourceRef: string, text: string, receivedAt: string): Envelope {
  return { id: sourceRef, source: 'github-issues', sourceRef, text, hintRepo: 'alpha', status: 'pending', receivedAt };
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  await exec('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
  await exec('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
  await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
}

function project(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    remote: 'https://example.invalid/alpha.git',
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

// ── scaffolding ───────────────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'loop-poll-'));
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

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('FR-31 poll-on-launch: process oldest, leave the rest queued', () => {
  it('polls two issues, processes the oldest, leaves the second queued, reports routed+done', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { route } = makeProvider('alpha');
    const { gh } = makeGh('https://example.invalid/alpha/pull/7');
    // 'y' confirms the routed envelope; 'exit' ends the session after the one idea.
    const { io } = scriptedIo(['y', 'exit']);

    const queue = createFileQueue(join(workDir, 'inbox'));
    const ledger = createLedger(join(workDir, 'ledger.json'));
    const { source, port, reports } = fakeIntake([
      envelope('o/a#1', 'oldest idea', '2026-06-27T00:00:01.000Z'),
      envelope('o/a#2', 'newer idea', '2026-06-27T00:00:02.000Z'),
    ]);

    const summary = await runEngineerMode({
      route,
      io,
      gh,
      decide: makeTestDecide(),
      engineerDir,
      sources: [source],
      queue,
      intakePort: port,
      ledger,
    });

    // Exactly one envelope processed this launch.
    expect(summary.ideasProcessed).toBe(1);
    expect(summary.authored.map((a: any) => a.project)).toEqual(['alpha']);

    // The newer envelope is still queued (claimable).
    const leftover = await queue.claim();
    expect(leftover?.sourceRef).toBe('o/a#2');

    // Write-back reported routed then done for the processed (oldest) issue.
    const forOldest = reports.filter((r) => r.sourceRef === 'o/a#1');
    expect(forOldest.map((r) => r.status)).toEqual(['routed', 'done']);
    expect(forOldest.find((r) => r.status === 'routed')?.meta?.repo).toBe('alpha');
    expect(forOldest.find((r) => r.status === 'done')?.meta?.prUrl).toBe(
      'https://example.invalid/alpha/pull/7',
    );

    // Ledger advanced to done for the processed issue.
    const entry = await ledger.get('github-issues', 'o/a#1');
    expect(entry?.status).toBe('done');
    expect(entry?.prUrl).toBe('https://example.invalid/alpha/pull/7');
  });
});

describe('FR-31 chat fallback when the inbox is empty after poll', () => {
  it('empty poll → no error, processes a subsequent chat idea normally', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { route } = makeProvider('alpha');
    const { gh } = makeGh('https://example.invalid/alpha/pull/1');
    const { io } = scriptedIo(['a typed chat idea', 'y', 'exit']);

    const queue = createFileQueue(join(workDir, 'inbox'));
    const { source, reports } = fakeIntake([]); // poll returns nothing

    const summary = await runEngineerMode({
      route,
      io,
      gh,
      decide: makeTestDecide(),
      engineerDir,
      sources: [source],
      queue,
    });

    // The chat idea was processed (fallback path), nothing reported.
    expect(summary.ideasProcessed).toBe(1);
    expect(summary.authored.map((a: any) => a.project)).toEqual(['alpha']);
    expect(reports.length).toBe(0);
  });

  it('processes only ONE envelope per launch even when many are queued', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo);
    await writeRegistry([project(repo, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { route } = makeProvider('alpha');
    const { gh } = makeGh('https://example.invalid/alpha/pull/3');
    const { io } = scriptedIo(['y', 'exit']);

    const queue = createFileQueue(join(workDir, 'inbox'));
    const { source } = fakeIntake([
      envelope('o/a#1', 'idea one', '2026-06-27T00:00:01.000Z'),
      envelope('o/a#2', 'idea two', '2026-06-27T00:00:02.000Z'),
      envelope('o/a#3', 'idea three', '2026-06-27T00:00:03.000Z'),
    ]);

    const summary = await runEngineerMode({ route, io, gh, decide: makeTestDecide(), engineerDir, sources: [source], queue });

    expect(summary.ideasProcessed).toBe(1);
    // Two remain queued.
    const a = await queue.claim();
    const b = await queue.claim();
    expect([a?.sourceRef, b?.sourceRef].sort()).toEqual(['o/a#2', 'o/a#3']);
  });
});
