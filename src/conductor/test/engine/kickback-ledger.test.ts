import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readKickbackLedger,
  writeKickbackLedger,
  type KickbackLedger,
} from '../../src/engine/kickback-ledger.js';

describe('kickback-ledger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kickback-ledger-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty ledger when the ledger file is absent', async () => {
    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('returns an empty ledger and warns when the ledger JSON is corrupt', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), 'not valid json {');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('treats a ledger with an unsupported version as absent', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/kickback-ledger.json'),
      JSON.stringify({ version: 2, gates: { wiring_check: { count: 2 } } }),
    );

    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('round-trips populated gate entries', async () => {
    const ledger: KickbackLedger = {
      version: 1,
      gates: {
        wiring_check: {
          count: 2,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await writeKickbackLedger(dir, ledger);

    await expect(readKickbackLedger(dir)).resolves.toEqual(ledger);
  });

  it('never leaves a torn ledger for readers during concurrent writes', async () => {
    const ledgers: KickbackLedger[] = Array.from({ length: 10 }, (_, index) => ({
      version: 1,
      gates: {
        wiring_check: {
          count: index + 1,
          treeHash: `${index}`.padStart(40, '0'),
          lastReason: `attempt ${index + 1}`,
          priorVerdict: false,
          resolvedBefore: index,
        },
      },
    }));

    await Promise.all(ledgers.map((ledger) => writeKickbackLedger(dir, ledger)));

    const raw = await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
