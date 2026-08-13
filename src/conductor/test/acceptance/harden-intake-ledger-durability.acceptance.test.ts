// Acceptance specs for .docs/stories/harden-intake-ledger-durability.md.
//
// Story-level coverage is intentionally limited to the three flows that cross
// a real production boundary. Stories 1-3 and 7-9 describe individual ledger
// operations and lease mechanics; the implementation plan assigns those to
// focused unit/integration tests. These specs cover:
//   - Story 4: the real engineer claim command handler and its output contract;
//   - Story 5: the real launch-time poll -> ledger -> queue -> claim flow; and
//   - Story 6: separate OS processes mutating one shared ledger file.
//
// Third-party boundary: the claim flow receives a faithful fake `gh` runner.
// Filesystem, queue, ledger, process concurrency, and loop wiring remain real.

import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchEngineer } from '../../src/engine/engineer-cli.js';
import { runEngineerMode } from '../../src/engine/engineer/loop.js';
import { createLedger } from '../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../src/engine/engineer/intake/queue.js';
import { parseEnvelope, type Envelope } from '../../src/engine/engineer/intake/port.js';

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, '..', 'fixtures', 'intake-ledger-record-worker.ts');
const scratchDirs: string[] = [];

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function envelope(sourceRef: string): Envelope {
  return parseEnvelope({
    id: sourceRef,
    source: 'github-issues',
    sourceRef,
    text: `intake body for ${sourceRef}`,
    status: 'pending',
    receivedAt: '2026-08-12T00:00:00.000Z',
  });
}

function fakeGh(args: string[]): Promise<{ stdout: string }> {
  if (args[0] === 'api' && String(args[1]).includes('blocked_by')) {
    return Promise.resolve({ stdout: '[]' });
  }
  if (args[0] === 'api' && String(args[1]).includes('/issues/')) {
    return Promise.resolve({ stdout: JSON.stringify({ labels: [] }) });
  }
  if (args[0] === 'issue' && args[1] === 'view') {
    return Promise.resolve({ stdout: 'OPEN' });
  }
  return Promise.resolve({ stdout: '' });
}

describe('Story 4 — corrupt ledger fails the real claim command loudly', () => {
  it('returns non-zero, warns on stderr with both paths, and emits no success payload', async () => {
    const engineerDir = await freshDir('intake-ledger-cli-');
    const ledgerPath = join(engineerDir, 'ledger.json');
    const corruptBody = 'SECRET ISSUE BODY: {truncated';
    await writeFile(ledgerPath, corruptBody, 'utf8');
    await createFileQueue(join(engineerDir, 'inbox')).enqueue(envelope('acme/app#41'));

    const stdout: string[] = [];
    const stderr: string[] = [];
    let code: number | undefined;
    let thrown: unknown;
    try {
      code = await dispatchEngineer(
        { kind: 'claim' },
        {
          engineerDir,
          gh: (args) => fakeGh(args),
          print: (line) => stdout.push(line),
          printErr: (line) => stderr.push(line),
        },
      );
    } catch (error: unknown) {
      thrown = error;
    }

    const diagnostic = [
      ...stderr,
      thrown instanceof Error ? thrown.message : thrown === undefined ? '' : String(thrown),
    ].join('\n');
    const quarantineNames = (await import('node:fs/promises'))
      .readdir(engineerDir)
      .then((names) => names.filter((name) => name.startsWith('ledger.json.corrupt-')));

    expect(thrown).toBeUndefined();
    expect(code).not.toBe(0);
    expect(diagnostic).toContain(ledgerPath);
    expect(diagnostic).toMatch(/ledger\.json\.corrupt-/);
    expect(diagnostic).toMatch(/not modified/i);
    expect(diagnostic).not.toContain('SECRET ISSUE BODY');
    expect(stdout.join('\n')).not.toContain('{"kind":"claim"');
    expect(await quarantineNames).toHaveLength(1);
    expect(await readFile(ledgerPath, 'utf8')).toBe(corruptBody);
  });
});

describe('Story 5 — corrupt ledger stops the launch-time intake flow', () => {
  it('reports corruption before enqueue or claim while leaving per-envelope wiring real', async () => {
    const root = await freshDir('intake-ledger-loop-');
    const engineerDir = join(root, 'engineer');
    const registryPath = join(root, 'registry.json');
    await mkdir(engineerDir, { recursive: true });
    await writeFile(join(engineerDir, 'ledger.json'), '{broken', 'utf8');
    await writeFile(registryPath, '[]', 'utf8');

    const enqueued: Envelope[] = [];
    let claimCalls = 0;
    const output: string[] = [];
    let thrown: unknown;
    try {
      await runEngineerMode({
        route: { invoke: async () => '[]' },
        io: { prompt: async () => null, print: (line) => output.push(line) },
        registryPath,
        engineerDir,
        sources: [{ poll: async () => [envelope('acme/app#42')] }],
        ledger: createLedger(join(engineerDir, 'ledger.json')),
        queue: {
          enqueue: async (item) => void enqueued.push(item),
          claim: async () => {
            claimCalls += 1;
            return null;
          },
          ack: async () => undefined,
          release: async () => undefined,
          list: async () => [],
          remove: async () => undefined,
        },
      });
    } catch (error: unknown) {
      thrown = error;
    }

    const diagnostic = [
      ...output,
      thrown instanceof Error ? thrown.message : thrown === undefined ? '' : String(thrown),
    ].join('\n');
    expect(diagnostic).toMatch(/corrupt.*ledger|ledger.*corrupt/i);
    expect(enqueued).toEqual([]);
    expect(claimCalls).toBe(0);
  });
});

interface WorkerMessage {
  kind: 'ready' | 'done' | 'failed';
  reason?: string;
}

function waitForMessage(child: ChildProcess, kind: WorkerMessage['kind']): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      const candidate = message as Partial<WorkerMessage>;
      if (candidate.kind !== kind && candidate.kind !== 'failed') return;
      cleanup();
      if (candidate.kind === 'failed') reject(new Error(candidate.reason ?? 'ledger worker failed'));
      else resolve(candidate as WorkerMessage);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`ledger worker exited before ${kind} (code ${String(code)})`));
    };
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

describe('Story 6 — concurrent writes from separate processes are additive', () => {
  it('retains every distinct entry when four synchronized processes record together', async () => {
    const engineerDir = await freshDir('intake-ledger-processes-');
    const ledgerPath = join(engineerDir, 'ledger.json');
    const refs = ['acme/a#1', 'acme/b#2', 'acme/c#3', 'acme/d#4'];
    const children = refs.map((sourceRef) =>
      fork(workerPath, [JSON.stringify({ ledgerPath, sourceRef })], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }),
    );

    try {
      await Promise.all(children.map((child) => waitForMessage(child, 'ready')));
      const completions = children.map((child) => waitForMessage(child, 'done'));
      for (const child of children) child.send('go');
      await Promise.all(completions);
    } finally {
      for (const child of children) {
        if (child.connected) child.disconnect();
        if (child.exitCode === null) child.kill();
      }
    }

    const entries = await createLedger(ledgerPath).list();
    expect(entries.map((entry) => entry.sourceRef).sort()).toEqual([...refs].sort());
  });
});
