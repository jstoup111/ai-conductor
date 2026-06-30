// `conduct-ts engineer poll` + `engineer forget` CLI primitives (Phase 9.3b, T22/T23).
// FR-32 (poll-on-launch primitive) + FR-40 (manual forget). gh is injected — no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

// ── fake gh: issue list + edit (label strip) ──────────────────────────────────

function makeGh(issuesByRepo: Record<string, Array<{ number: number; title: string; body: string; labels?: string[] }>>) {
  const calls: string[][] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      const ri = args.indexOf('-R');
      const repo = ri >= 0 ? args[ri + 1] : opts.cwd;
      const issues = issuesByRepo[repo] ?? [];
      return {
        stdout: JSON.stringify(
          issues.map((i) => ({ number: i.number, title: i.title, body: i.body, labels: (i.labels ?? []).map((l) => ({ name: l })) })),
        ),
      };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

// ── scaffolding ───────────────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-intake-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeRegistry(repos: Array<{ name: string }>): Promise<void> {
  const records = repos.map((r) => ({
    schemaVersion: 1,
    name: r.name,
    path: join(workDir, r.name.replace('/', '_')),
    status: 'registered',
    registeredAt: '2026-06-27T00:00:00.000Z',
  }));
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts => ({
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  });
  return { out, err, opts };
}

// ═══════════════════════════════════════════════════════════════════════════════

// detectEngineerCommand reads process.argv offsets: [node, entry, 'engineer', sub, ...].
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

describe('detectEngineerCommand: poll + forget grammar', () => {
  it('parses `engineer poll`', () => {
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });
  it('parses `engineer forget <ref>`', () => {
    expect(detectEngineerCommand(argv('forget', 'o/a#1'))).toEqual({ kind: 'forget', sourceRef: 'o/a#1' });
  });
  it('forget without a ref → guide', () => {
    expect(detectEngineerCommand(argv('forget'))).toEqual({ kind: 'guide' });
  });
});

describe('engineer poll (T22, FR-32)', () => {
  it('polls issues and enqueues envelopes into the inbox', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 1, sourceRefs: ['o/a#1'] });

    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1);
  });

  it('double poll enqueues no duplicates (ledger dedups)', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, opts } = captureOut();

    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    out.length = 0;
    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));

    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 0 });
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1); // still just the one
  });
});

describe('engineer forget (T23, FR-40)', () => {
  it('drops a ledger entry and strips the engineer:handled label', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/a#1' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'forget', sourceRef: 'o/a#1', found: true });

    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(calls).toContainEqual(['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled']);
  });

  it('reports found:false for an absent ref without crashing or calling gh', async () => {
    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/z#9' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'forget', sourceRef: 'o/z#9', found: false });
    expect(calls.length).toBe(0);
  });
});
