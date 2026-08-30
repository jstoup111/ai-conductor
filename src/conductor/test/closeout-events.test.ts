import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendCloseoutEvent,
  appendKickbackBudgetAuthorization,
} from '../src/engine/closeout-events.js';
import type { ConductStateLease } from '../src/engine/conduct-state-lease.js';

const authorization = {
  type: 'kickback_budget_adjustment_authorized' as const,
  adjustmentId: 'adjustment-1',
  feature: 'test-feature',
  gate: 'build_review' as const,
  kind: 'reset' as const,
  beforeCount: 5,
  afterCount: 0,
  beforeLimit: 5,
  afterLimit: 5,
  operator: 'james',
  rationale: 'new evidence',
  at: '2026-08-30T21:00:00.000Z',
};

function refusingLease(message: string): ConductStateLease {
  return { acquire: async () => ({ ok: false, kind: 'interrupted', message }) };
}

describe('appendCloseoutEvent', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })));
  });

  it('creates the pipeline ledger when absent', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);

    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    });
    await expect(readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(
        '{"type":"pipeline_closeout","obligation":"evaluator","startedAt":100,"endedAt":140,"ts":140}\n',
      );
  });

  it('appends events in order and leaves the engine ledger unchanged', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);
    const engineLedger = join(projectRoot, '.pipeline/events.jsonl');
    const originalEngineLedger = '{"type":"step_started","step":"build","ts":1}\n';
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(engineLedger, originalEngineLedger, 'utf8');

    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    });
    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'summary',
      startedAt: 150,
      endedAt: 180,
      ts: 180,
    });

    const pipelineLedger = await readFile(
      join(projectRoot, '.pipeline/pipeline-events.jsonl'),
      'utf8',
    );

    expect(pipelineLedger.trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      {
        type: 'pipeline_closeout',
        obligation: 'evaluator',
        startedAt: 100,
        endedAt: 140,
        ts: 140,
      },
      {
        type: 'pipeline_closeout',
        obligation: 'summary',
        startedAt: 150,
        endedAt: 180,
        ts: 180,
      },
    ]);
    await expect(readFile(engineLedger, 'utf8')).resolves.toBe(originalEngineLedger);
  });
});

describe('appendKickbackBudgetAuthorization', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })));
  });

  async function projectRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(root);
    return root;
  }

  it('appends the first authorization occurrence', async () => {
    const root = await projectRoot();

    await expect(appendKickbackBudgetAuthorization(root, authorization))
      .resolves.toEqual({ ok: true, kind: 'appended' });
    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(`${JSON.stringify(authorization)}\n`);
  });

  it('records identical retries exactly once', async () => {
    const root = await projectRoot();

    await expect(appendKickbackBudgetAuthorization(root, authorization)).resolves.toMatchObject({ kind: 'appended' });
    await expect(appendKickbackBudgetAuthorization(root, authorization)).resolves.toEqual({ ok: true, kind: 'already-recorded' });
    await expect(appendKickbackBudgetAuthorization(root, authorization)).resolves.toEqual({ ok: true, kind: 'already-recorded' });
    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(`${JSON.stringify(authorization)}\n`);
  });

  it('refuses a conflicting reuse of an adjustment id without appending', async () => {
    const root = await projectRoot();
    await appendKickbackBudgetAuthorization(root, authorization);

    await expect(appendKickbackBudgetAuthorization(root, { ...authorization, rationale: 'different rationale' }))
      .resolves.toMatchObject({ ok: false, kind: 'refused' });
    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(`${JSON.stringify(authorization)}\n`);
  });

  it('serializes contending writers and preserves both distinct occurrences', async () => {
    const root = await projectRoot();
    const second = { ...authorization, adjustmentId: 'adjustment-2' };

    await expect(Promise.all([
      appendKickbackBudgetAuthorization(root, authorization),
      appendKickbackBudgetAuthorization(root, second),
    ])).resolves.toEqual([
      { ok: true, kind: 'appended' },
      { ok: true, kind: 'appended' },
    ]);
    const records = (await readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toEqual(expect.arrayContaining([authorization, second]));
    expect(records).toHaveLength(2);
  });

  it('refuses an unreadable ledger without appending', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const ledger = join(root, '.pipeline/pipeline-events.jsonl');
    await writeFile(ledger, '{not json}\n', 'utf8');

    await expect(appendKickbackBudgetAuthorization(root, authorization))
      .resolves.toMatchObject({ ok: false, kind: 'refused' });
    await expect(readFile(ledger, 'utf8')).resolves.toBe('{not json}\n');
  });

  it('refuses an interrupted append before writing any bytes', async () => {
    const root = await projectRoot();

    await expect(appendKickbackBudgetAuthorization(root, authorization, {
      lease: refusingLease('append interrupted'),
    })).resolves.toEqual({ ok: false, kind: 'refused', message: 'append interrupted' });
    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses ownership loss before writing any bytes', async () => {
    const root = await projectRoot();

    await expect(appendKickbackBudgetAuthorization(root, authorization, {
      lease: refusingLease('pipeline event ledger lease ownership was lost'),
    })).resolves.toEqual({
      ok: false,
      kind: 'refused',
      message: 'pipeline event ledger lease ownership was lost',
    });
    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
