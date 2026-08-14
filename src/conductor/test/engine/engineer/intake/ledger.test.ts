// Ledger.transition() writebackPending meta (#290).
// Covers: setting true, clearing (false), omission leaves existing flag untouched,
// and existing {branch, prUrl} meta behavior remains unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CorruptLedgerError,
  createLedger,
  loadStore,
} from '../../../../src/engine/engineer/intake/ledger.js';
import type { ConductStateLease } from '../../../../src/engine/conduct-state-lease.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-writeback-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CorruptLedgerError', () => {
  it('identifies a corrupt ledger with its path and reason', () => {
    const error = new CorruptLedgerError('/tmp/ledger.json', 'invalid JSON');

    expect({
      errorIsAnError: error instanceof Error,
      errorIsTyped: error instanceof CorruptLedgerError,
      ledgerPath: error.ledgerPath,
      reason: error.reason,
    }).toEqual({
      errorIsAnError: true,
      errorIsTyped: true,
      ledgerPath: '/tmp/ledger.json',
      reason: 'invalid JSON',
    });
  });
});

describe('loadStore()', () => {
  it('copies corrupt ledger bytes to a timestamped sibling without changing the ledger', async () => {
    const ledgerPath = join(dir, 'ledger.json');
    const corruptBytes = Buffer.from([0xff, 0xfe, 0x00, 0x7b]);
    await writeFile(ledgerPath, corruptBytes);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
      await expect(createLedger(ledgerPath).list()).rejects.toBeInstanceOf(CorruptLedgerError);
    } finally {
      vi.useRealTimers();
    }

    const sibling = (await readdir(dir)).find((name) => name.startsWith('ledger.json.corrupt-'));
    expect({
      sibling,
      original: await readFile(ledgerPath),
      quarantine: sibling === undefined ? undefined : await readFile(join(dir, sibling)),
    }).toEqual({
      sibling: 'ledger.json.corrupt-1786622400000',
      original: corruptBytes,
      quarantine: corruptBytes,
    });
  });

  it('reuses a quarantine for unchanged corrupt bytes and creates another for a new corruption', async () => {
    const ledgerPath = join(dir, 'ledger.json');
    const firstCorruption = Buffer.from('not valid json');
    const secondCorruption = Buffer.from('{ still not valid json');
    const ledger = createLedger(ledgerPath);
    await writeFile(ledgerPath, firstCorruption);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
      await expect(ledger.list()).rejects.toBeInstanceOf(CorruptLedgerError);
      vi.setSystemTime(new Date('2026-08-13T12:00:01.000Z'));
      await expect(ledger.known('github-issues', 'o/a#1')).rejects.toBeInstanceOf(CorruptLedgerError);
      vi.setSystemTime(new Date('2026-08-13T12:00:02.000Z'));
      await expect(ledger.get('github-issues', 'o/a#1')).rejects.toBeInstanceOf(CorruptLedgerError);

      await writeFile(ledgerPath, '{}', 'utf8');
      await expect(ledger.list()).resolves.toEqual([]);
      await writeFile(ledgerPath, secondCorruption);
      vi.setSystemTime(new Date('2026-08-13T12:00:03.000Z'));
      await expect(ledger.list()).rejects.toBeInstanceOf(CorruptLedgerError);
    } finally {
      vi.useRealTimers();
    }

    const quarantines = (await readdir(dir))
      .filter((name) => name.startsWith('ledger.json.corrupt-'))
      .sort();
    expect({
      quarantines,
      bytes: await Promise.all(quarantines.map((name) => readFile(join(dir, name)))),
    }).toEqual({
      quarantines: [
        'ledger.json.corrupt-1786622400000',
        'ledger.json.corrupt-1786622403000',
      ],
      bytes: [firstCorruption, secondCorruption],
    });
  });

  it('reports a failed quarantine alongside corruption without changing the ledger bytes', async () => {
    const lockedDir = join(dir, 'locked');
    const ledgerPath = join(lockedDir, 'ledger.json');
    const corruptBytes = Buffer.from('not valid json');
    await mkdir(lockedDir);
    await writeFile(ledgerPath, corruptBytes);
    await chmod(lockedDir, 0o555);

    try {
      const result = await createLedger(ledgerPath).list().then(
        () => ({ error: undefined, errorIsTyped: false, original: undefined }),
        async (error: unknown) => ({
          error,
          errorIsTyped: error instanceof CorruptLedgerError,
          original: await readFile(ledgerPath),
        }),
      );

      expect(result).toEqual({
        error: expect.objectContaining({
          message: expect.stringMatching(/corrupt:.*Unexpected.*quarantine.*EACCES/i),
        }),
        errorIsTyped: true,
        original: corruptBytes,
      });
    } finally {
      await chmod(lockedDir, 0o755);
    }
  });

  it('distinguishes a missing ledger from a valid empty ledger without warning or quarantine', async () => {
    const ledgerPath = join(dir, 'ledger.json');
    const stderr = vi.spyOn(process.stderr, 'write');

    try {
      const absent = await loadStore(ledgerPath);
      const ledger = createLedger(ledgerPath);
      const entries = await ledger.list();
      const afterAbsent = await readdir(dir);
      await writeFile(ledgerPath, '{}', 'utf8');
      const empty = await loadStore(ledgerPath);

      expect({ absent, entries, corruptFiles: afterAbsent.filter((name) => name.startsWith('ledger.json.corrupt-')), empty, stderrWrites: stderr.mock.calls }).toEqual({
        absent: { kind: 'absent' },
        entries: [],
        corruptFiles: [],
        empty: { kind: 'ok', store: {} },
        stderrWrites: [],
      });
    } finally {
      stderr.mockRestore();
    }
  });

  it('classifies a non-ENOENT read failure as corrupt and rejects ledger operations', async () => {
    const ledgerPath = join(dir, 'ledger.json');
    await mkdir(ledgerPath);

    await expect(loadStore(ledgerPath)).resolves.toMatchObject({
      kind: 'corrupt',
      reason: expect.stringContaining('EISDIR'),
    });
    await expect(createLedger(ledgerPath).list()).rejects.toBeInstanceOf(CorruptLedgerError);
  });

  it('classifies JSON values other than a ledger store as corrupt', async () => {
    const values = ['[]', '"text"', '42', 'null', '{ "k": { "no": "entry" } }'];
    const results = await Promise.all(
      values.map(async (value, index) => {
        const ledgerPath = join(dir, `invalid-${index}.json`);
        await writeFile(ledgerPath, value, 'utf8');
        return loadStore(ledgerPath);
      }),
    );

    expect(results.map((result) => result.kind)).toEqual(['corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt']);
  });
});

describe('lease-bracketed ledger access', () => {
  it('acquires before record loads, releases after save, and releases when record throws', async () => {
    const ledgerPath = join(dir, 'ledger.json');
    const events: string[] = [];
    let acquireCount = 0;
    let savedPreAcquireEntry = false;
    let releaseAfterSave = false;
    const lease: ConductStateLease = {
      acquire: async () => {
        acquireCount += 1;
        events.push(`acquire-${acquireCount}`);
        if (acquireCount === 1) await writeFile(ledgerPath, '{}', 'utf8');
        return {
          ok: true,
          handle: {
            release: async () => {
              events.push(`release-${acquireCount}`);
              if (acquireCount === 1) {
                const saved = await readFile(ledgerPath, 'utf8');
                savedPreAcquireEntry = saved.includes('o/a#old');
                releaseAfterSave = saved.includes('o/a#new');
              }
              return { ok: true };
            },
          },
        };
      },
    };
    await writeFile(ledgerPath, JSON.stringify({
      'github-issues\u0000o/a#old': {
        source: 'github-issues', sourceRef: 'o/a#old', status: 'pending', attempts: 0,
      },
    }), 'utf8');
    const ledger = createLedger(ledgerPath, { lease });

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#new' });
    await writeFile(ledgerPath, 'not valid json', 'utf8');
    const rejected = await ledger.record({ source: 'github-issues', sourceRef: 'o/a#broken' }).then(
      () => false,
      () => true,
    );

    expect({ events, savedPreAcquireEntry, releaseAfterSave, rejected }).toEqual({
      events: ['acquire-1', 'release-1', 'acquire-2', 'release-2'],
      savedPreAcquireEntry: false,
      releaseAfterSave: true,
      rejected: true,
    });
  });

  it('fails closed when release fails without masking a body failure', async () => {
    const releaseMessage = 'intake ledger lease release failed';
    const lease: ConductStateLease = {
      acquire: async () => ({
        ok: true,
        handle: {
          release: async () => ({ ok: false, message: releaseMessage }),
        },
      }),
    };
    const successfulBodyLedger = createLedger(join(dir, 'successful-body.json'), { lease });
    const failedBodyLedger = createLedger(join(dir, 'failed-body.json'), { lease });
    await writeFile(join(dir, 'failed-body.json'), 'not valid json', 'utf8');

    const successfulBodyError = await successfulBodyLedger.record({
      source: 'github-issues', sourceRef: 'o/a#1',
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    const failedBodyError = await failedBodyLedger.record({
      source: 'github-issues', sourceRef: 'o/a#2',
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect({
      successfulBodyMessage: successfulBodyError instanceof Error ? successfulBodyError.message : undefined,
      failedBodyIsCorrupt: failedBodyError instanceof CorruptLedgerError,
    }).toEqual({
      successfulBodyMessage: releaseMessage,
      failedBodyIsCorrupt: true,
    });
  });
});

describe('transition() writebackPending marker (#290)', () => {
  it('persists writebackPending: true on the entry', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBe(true);
  });

  it('removes writebackPending when transitioned with false', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: false });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBeUndefined();
  });

  it('leaves an existing writebackPending flag untouched when omitted', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    await l.transition('github-issues', 'o/a#1', 'done', {});
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBe(true);
  });

  it('keeps existing {branch, prUrl} meta behavior unchanged', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed', { branch: 'feat/x' });
    await l.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/1' });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.branch).toBe('feat/x');
    expect(entry?.prUrl).toBe('https://x/pr/1');
  });
});

describe('Jira ref dedup (Story 3/5) — ledger key is opaque to ref shape', () => {
  it('recording the same (source, "PROJ-123") twice recognizes the duplicate', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    expect(await l.known('jira', 'PROJ-123')).toBe(false);
    await l.record({ source: 'jira', sourceRef: 'PROJ-123' });
    expect(await l.known('jira', 'PROJ-123')).toBe(true);

    // Recording again must not create a second entry or reset status/attempts.
    await l.transition('jira', 'PROJ-123', 'claimed');
    await l.record({ source: 'jira', sourceRef: 'PROJ-123' });
    const entry = await l.get('jira', 'PROJ-123');
    expect(entry?.status).toBe('claimed');

    const entries = await l.list();
    expect(entries.filter((e) => e.sourceRef === 'PROJ-123')).toHaveLength(1);
  });

  it('treats "acme/app#49" and "PROJ-49" from the same source as distinct entries', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'jira', sourceRef: 'acme/app#49' });
    await l.record({ source: 'jira', sourceRef: 'PROJ-49' });

    expect(await l.known('jira', 'acme/app#49')).toBe(true);
    expect(await l.known('jira', 'PROJ-49')).toBe(true);

    const entries = await l.list();
    const refs = entries.map((e) => e.sourceRef).sort();
    expect(refs).toEqual(['PROJ-49', 'acme/app#49']);
  });

  it('leaves existing GitHub dedup behavior unchanged alongside Jira refs', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/a#1')).toBe(true);

    // Same sourceRef shape but from Jira source is distinct.
    await l.record({ source: 'jira', sourceRef: 'o/a#1' });
    const entries = await l.list();
    expect(entries.filter((e) => e.sourceRef === 'o/a#1')).toHaveLength(2);

    // Duplicate github-issues record is still a no-op.
    await l.transition('github-issues', 'o/a#1', 'done');
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const ghEntry = await l.get('github-issues', 'o/a#1');
    expect(ghEntry?.status).toBe('done');
  });
});

describe('list() enumerator', () => {
  it('returns all LedgerEntry records regardless of status', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.record({ source: 'github-issues', sourceRef: 'o/a#2' });
    await l.transition('github-issues', 'o/a#2', 'done');
    await l.record({ source: 'github-issues', sourceRef: 'o/a#3' });
    await l.transition('github-issues', 'o/a#3', 'claimed');

    const entries = await l.list();

    expect(entries).toHaveLength(3);
    const statuses = entries.map((e) => e.status).sort();
    expect(statuses).toEqual(['claimed', 'done', 'pending']);
    const refs = entries.map((e) => e.sourceRef).sort();
    expect(refs).toEqual(['o/a#1', 'o/a#2', 'o/a#3']);
  });
});

describe('requeueClaimed() — claimed to pending recovery (FR-1, FR-4, FR-11)', () => {
  it('moves a claimed entry to pending, preserves capturedAt, bumps attempts, refreshes lastSeenAt', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed');
    const before = await l.get('github-issues', 'o/a#1');

    const result = await l.requeueClaimed('github-issues', 'o/a#1');

    const after = await l.get('github-issues', 'o/a#1');
    expect(after?.status).toBe('pending');
    expect(after?.capturedAt).toBe(before?.capturedAt);
    expect(after?.attempts).toBe((before?.attempts ?? 0) + 1);
    expect(after?.lastSeenAt).toBeDefined();
    expect(result).toEqual({ acted: true });
  });

  it.each(['done', 'routed', 'deciding'] as const)(
    'leaves a %s entry unchanged and reports did-not-act',
    async (status) => {
      const l = createLedger(join(dir, 'ledger.json'));
      await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
      await l.transition('github-issues', 'o/a#1', status);
      const before = await l.get('github-issues', 'o/a#1');

      const result = await l.requeueClaimed('github-issues', 'o/a#1');

      const after = await l.get('github-issues', 'o/a#1');
      expect(after).toEqual(before);
      expect(result).toEqual({ acted: false });
    },
  );

  it('is a no-op and reports did-not-act for an absent entry', async () => {
    const l = createLedger(join(dir, 'ledger.json'));

    const result = await l.requeueClaimed('github-issues', 'o/a#does-not-exist');

    const after = await l.get('github-issues', 'o/a#does-not-exist');
    expect(after).toBeUndefined();
    expect(result).toEqual({ acted: false });
  });
});
