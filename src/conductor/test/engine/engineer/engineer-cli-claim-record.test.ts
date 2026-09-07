// FR-13 round-trip: `engineer claim` persists a claim record ({ sourceRef, body })
// under <engDir>/claims/, and a later `engineer worktree --source-ref <ref>` (with no
// --body) resolves that body into createEngineerWorktree without the skill ever
// passing --body itself. Drives dispatchEngineer end-to-end for both commands.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const execFile = promisify(execFileCb);

const SOURCE = 'github-issues';
const SOURCE_REF = 'o/a#500';

const INTAKE_BODY = ['## Desired outcome', '', '- Widgets load in under 200ms.', ''].join('\n');

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    source: SOURCE,
    sourceRef: SOURCE_REF,
    text: INTAKE_BODY,
    status: 'pending',
    receivedAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

let workDir: string;
let engineerDir: string;
let repoPath: string;
let registryPath: string;

async function writeRegistry(): Promise<void> {
  const records = [
    {
      schemaVersion: 1,
      name: 'alpha',
      path: repoPath,
      status: 'registered',
      registeredAt: '2026-06-27T00:00:00.000Z',
    },
  ];
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

async function fakeGh(args: string[]): Promise<{ stdout: string }> {
  if (args[0] === 'pr' && args[1] === 'view') {
    return { stdout: JSON.stringify({ state: 'OPEN', mergedAt: null }) };
  }
  if (args[0] === 'issue' && args[1] === 'list') {
    return { stdout: JSON.stringify([]) };
  }
  return { stdout: JSON.stringify({}) };
}

function captureOpts(extra: Partial<DispatchEngineerOpts> = {}): {
  out: string[];
  err: string[];
  opts: DispatchEngineerOpts;
} {
  const out: string[] = [];
  const err: string[] = [];
  const opts: DispatchEngineerOpts = {
    registryPath,
    engineerDir,
    gh: fakeGh as DispatchEngineerOpts['gh'],
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  };
  return { out, err, opts };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-record-'));
  engineerDir = join(workDir, 'engineer');
  repoPath = join(workDir, 'alpha');
  registryPath = join(workDir, 'registry.json');
  await mkdir(engineerDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ['init', '-b', 'main', '-q']);
  await git(repoPath, ['config', 'user.email', 'test@test.com']);
  await git(repoPath, ['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(repoPath, ['add', 'README.md']);
  await git(repoPath, ['commit', '-m', 'init']);
  await writeRegistry();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('FR-13: claim → worktree Desired-outcome body threading', () => {
  it('claim persists a claim record, and a later worktree call with --source-ref (no --body) resolves the body', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'pending');
    await queue.enqueue(makeEnvelope());

    const { out: claimOut, opts: claimOpts } = captureOpts();
    const claimCode = await dispatchEngineer({ kind: 'claim' }, claimOpts);
    expect(claimCode).toBe(0);
    const claimResult = JSON.parse(claimOut[0]);
    expect(claimResult).toMatchObject({
      kind: 'claim',
      sourceRef: SOURCE_REF,
      body: INTAKE_BODY,
    });

    // The claim record was written to disk.
    const recordPath = join(engineerDir, 'claims', 'o-a-500.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    expect(record).toEqual({ sourceRef: SOURCE_REF, body: INTAKE_BODY });

    // A later worktree call with --source-ref but no --body resolves the body.
    const { out: wtOut, opts: wtOpts } = captureOpts();
    const wtCode = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'widget speed', sourceRef: SOURCE_REF },
      wtOpts,
    );
    expect(wtCode).toBe(0);
    const wtResult = JSON.parse(wtOut[0]);
    expect(wtResult.kind).toBe('worktree');

    // The staged intake outcomes file in the new worktree carries the resolved body.
    const stagedPath = join(wtResult.worktreePath, '.pipeline', 'intake-outcomes.md');
    const staged = await readFile(stagedPath, 'utf8').catch(() => null);
    expect(staged).not.toBeNull();
    expect(staged).toContain('Widgets load in under 200ms.');
    expect(staged).toContain(`Source-Ref: ${SOURCE_REF}`);
  });

  it('an explicit --body always wins over the persisted claim record', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'pending');
    await queue.enqueue(makeEnvelope());

    const claimCode = await dispatchEngineer({ kind: 'claim' }, captureOpts().opts);
    expect(claimCode).toBe(0);

    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      {
        kind: 'worktree',
        project: 'alpha',
        idea: 'explicit body wins',
        sourceRef: SOURCE_REF,
        body: 'Explicit override body.',
      },
      opts,
    );
    expect(code).toBe(0);
    const result = JSON.parse(out[0]);
    const stagedPath = join(result.worktreePath, '.pipeline', 'intake-outcomes.md');
    const staged = await readFile(stagedPath, 'utf8').catch(() => null);
    expect(staged).not.toBeNull();
    expect(staged).toContain(`Source-Ref: ${SOURCE_REF}`);
  });

  it('a missing/corrupt claim record degrades to no body — no throw, no staging', async () => {
    // No claim was ever made for this sourceRef, so no record exists.
    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'no record', sourceRef: 'o/a#999' },
      opts,
    );
    expect(code).toBe(0);
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('worktree');

    // No intake outcomes file was staged (matches the chat-origin negative path).
    const stagedPath = join(result.worktreePath, '.pipeline', 'intake-outcomes.md');
    await expect(readFile(stagedPath, 'utf8')).rejects.toThrow();
  });
});

// AB-1: the inbound-sanitization occurrence rides the one telemetry spine. The
// worktree case emits a real `intake_inbound_sanitized` ConductorEvent onto a
// ConductorEventEmitter with EventPersister attached, so the record lands in the
// canonical `<worktree>/.pipeline/events.jsonl` that every spine consumer reads.
// The former bespoke `intake-events.jsonl` sidecar is gone.
describe('inbound sanitization rides the event spine', () => {
  const INBOUND = {
    neutralizations: [{ category: 'agent-directive' as const, count: 2 }],
    digest: 'a'.repeat(64),
  };

  async function claimWithInbound(): Promise<void> {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'pending');
    await queue.enqueue(makeEnvelope({ inbound: INBOUND }));
    const code = await dispatchEngineer({ kind: 'claim' }, captureOpts().opts);
    expect(code).toBe(0);
  }

  it('persists the event to the canonical .pipeline/events.jsonl through the production emitter', async () => {
    await claimWithInbound();

    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'spine wiring', sourceRef: SOURCE_REF },
      opts,
    );
    expect(code).toBe(0);
    const { worktreePath } = JSON.parse(out[0]);

    const ledgerPath = join(worktreePath, '.pipeline', 'events.jsonl');
    const lines = (await readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean);
    const records = lines.map((l) => JSON.parse(l));
    const inboundRecords = records.filter((r) => r.type === 'intake_inbound_sanitized');
    expect(inboundRecords).toHaveLength(1);
    expect(inboundRecords[0]).toMatchObject({
      type: 'intake_inbound_sanitized',
      sourceRef: SOURCE_REF,
      neutralizations: INBOUND.neutralizations,
      digest: INBOUND.digest,
    });
    expect(typeof inboundRecords[0].ts).toBe('string');
  });

  it('writes no parallel sidecar ledger', async () => {
    await claimWithInbound();

    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'no sidecar', sourceRef: SOURCE_REF },
      opts,
    );
    expect(code).toBe(0);
    const { worktreePath } = JSON.parse(out[0]);

    await expect(
      readFile(join(worktreePath, '.pipeline', 'intake-events.jsonl'), 'utf8'),
    ).rejects.toThrow();
  });

  it('an empty neutralization list still records the occurrence', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'pending');
    await queue.enqueue(
      makeEnvelope({ inbound: { neutralizations: [], digest: 'b'.repeat(64) } }),
    );
    expect(await dispatchEngineer({ kind: 'claim' }, captureOpts().opts)).toBe(0);

    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'empty list', sourceRef: SOURCE_REF },
      opts,
    );
    expect(code).toBe(0);
    const { worktreePath } = JSON.parse(out[0]);
    const raw = await readFile(join(worktreePath, '.pipeline', 'events.jsonl'), 'utf8');
    const record = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .find((r) => r.type === 'intake_inbound_sanitized');
    expect(record).toMatchObject({ neutralizations: [], digest: 'b'.repeat(64) });
  });

  it('a chat-origin worktree (no claim record) emits nothing', async () => {
    const { out, opts } = captureOpts();
    const code = await dispatchEngineer(
      { kind: 'worktree', project: 'alpha', idea: 'chat origin' },
      opts,
    );
    expect(code).toBe(0);
    const { worktreePath } = JSON.parse(out[0]);

    const raw = await readFile(join(worktreePath, '.pipeline', 'events.jsonl'), 'utf8').catch(
      () => '',
    );
    expect(raw).not.toContain('intake_inbound_sanitized');
  });
});
