// Acceptance: durable intake ledger as SOLE dedup authority (FR-33/34, ADR-012, Stories 8).
// RED until intake/ledger.ts exists. Also asserts C2: intake/idempotency.ts is gone.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function loadLedger() {
  return import('../../../../src/engine/engineer/intake/ledger.js') as Promise<any>;
}

interface WorkerMessage {
  kind: 'ready' | 'done' | 'failed';
  reason?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, '../../../fixtures/intake-ledger-record-worker.ts');

function waitForWorkerMessage(child: ChildProcess, kind: WorkerMessage['kind']): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onMessage = (message: unknown) => {
      const candidate = message as Partial<WorkerMessage>;
      if (candidate.kind !== kind && candidate.kind !== 'failed') return;
      cleanup();
      if (candidate.kind === 'failed') reject(new Error(candidate.reason ?? 'ledger worker failed'));
      else resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`ledger worker exited before ${kind} (code ${String(code)})`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

function waitForWorkerExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

async function concurrentlyRecord(ledgerPath: string, sourceRefs: string[]): Promise<void> {
  const children = sourceRefs.map((sourceRef) =>
    fork(workerPath, [JSON.stringify({ ledgerPath, sourceRef })], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }),
  );

  try {
    await Promise.all(children.map((child) => waitForWorkerMessage(child, 'ready')));
    const completions = children.map((child) => waitForWorkerMessage(child, 'done'));
    for (const child of children) child.send('go');
    await Promise.all(completions);
  } finally {
    const exits = children.map(waitForWorkerExit);
    for (const child of children) {
      if (child.connected) child.disconnect();
      if (child.exitCode === null) child.kill();
    }
    await Promise.all(exits);
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-acc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FR-33 durable ledger lifecycle', () => {
  it('persists an entry across a fresh ledger over the same dir', async () => {
    const { createLedger } = await loadLedger();
    const a = createLedger(join(dir, 'ledger.json'));
    await a.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const b = createLedger(join(dir, 'ledger.json'));
    expect(await b.known('github-issues', 'o/a#1')).toBe(true);
  });

  it('records lifecycle transitions with metadata', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed');
    await l.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/1' });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry.status).toBe('done');
    expect(entry.prUrl).toBe('https://x/pr/1');
  });
});

describe('FR-34 exactly-once / no false dedup', () => {
  it('treats cross-repo same-number issues as distinct', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/b#1')).toBe(false);
  });

  it('does not dedup a re-filed idea under a new issue number', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/a#2')).toBe(false);
  });

  it('persists distinct refs and preserves a duplicate ref capturedAt across concurrent processes', async () => {
    const { createLedger } = await loadLedger();
    const distinctRefs = ['o/a#1', 'o/a#2', 'o/a#3'];
    const sameRef = 'o/a#same';
    const distinctLedgerPath = join(dir, 'distinct-ledger.json');
    const sameLedgerPath = join(dir, 'same-ledger.json');

    await concurrentlyRecord(distinctLedgerPath, distinctRefs);
    await concurrentlyRecord(sameLedgerPath, [sameRef, sameRef, sameRef]);
    const initialSameEntry = (await createLedger(sameLedgerPath).list())[0];
    await concurrentlyRecord(sameLedgerPath, [sameRef, sameRef, sameRef]);

    expect({
      distinctEntries: (await createLedger(distinctLedgerPath).list())
        .map((entry: { source: string; sourceRef: string }) => [entry.source, entry.sourceRef])
        .sort(),
      sameRefEntries: await createLedger(sameLedgerPath).list(),
    }).toEqual({
      distinctEntries: distinctRefs.map((sourceRef) => ['github-issues', sourceRef]),
      sameRefEntries: [expect.objectContaining({
        source: 'github-issues',
        sourceRef: sameRef,
        capturedAt: initialSameEntry.capturedAt,
      })],
    });
  });
});

describe('C2 in-memory idempotency guard removed', () => {
  it('intake/idempotency.ts no longer exists', () => {
    const p = join(__dirname, '../../../../src/engine/engineer/intake/idempotency.ts');
    expect(existsSync(p)).toBe(false);
  });

  it('no source file imports the removed guard', () => {
    // Walk intake/ src and reject module-specifier references to the deleted
    // guard. `idempotency` is a valid general term elsewhere (for example,
    // sanitize.ts documents its own idempotent replacement behavior).
    const intakeSrc = join(__dirname, '../../../../src/engine/engineer/intake');
    const offenders: string[] = [];
    const removedGuardImport =
      /\b(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"][^'"]*\/?idempotency(?:\.[cm]?[jt]s)?['"]/;
    const walk = (d: string) => {
      for (const e of require('node:fs').readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith('.ts') && removedGuardImport.test(readFileSync(fp, 'utf8'))) {
          offenders.push(fp);
        }
      }
    };
    walk(intakeSrc);
    expect(offenders).toEqual([]);
  });
});
