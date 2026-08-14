// Task 16: a corrupt intake ledger is a CLI failure, not a success-shaped claim.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'engineer-cli-corrupt-ledger-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer claim: corrupt intake ledger', () => {
  it('reports the ledger and its quarantine path to stderr without a claim payload or ledger content', async () => {
    const engineerDir = join(workDir, 'engineer');
    const ledgerPath = join(engineerDir, 'ledger.json');
    const corruptLedgerContent = 'SECRET_LEDGER_ENTRY_MUST_NOT_REACH_THE_OPERATOR';
    await mkdir(engineerDir, { recursive: true });
    await writeFile(ledgerPath, corruptLedgerContent, 'utf8');
    await createFileQueue(join(engineerDir, 'inbox')).enqueue({
      id: 'github-issue-owner-repo-1',
      text: 'Queued intake item',
      source: 'github-issues',
      sourceRef: 'owner/repo#1',
      status: 'pending',
      receivedAt: '2026-08-13T00:00:00.000Z',
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const observed = await dispatchEngineer(
      { kind: 'claim' },
      {
        engineerDir,
        print: (line) => stdout.push(line),
        printErr: (line) => stderr.push(line),
        gh: async () => ({ stdout: '[]' }),
      },
    ).then(
      (exitCode) => ({ exitCode, threw: false }),
      () => ({ exitCode: undefined, threw: true }),
    );

    const diagnostic = stderr.join('\n');
    const quarantineNames = (await readdir(engineerDir))
      .filter((name) => name.startsWith('ledger.json.corrupt-'));
    expect(quarantineNames).toHaveLength(1);
    const quarantinePath = join(engineerDir, quarantineNames[0]);
    expect({
      ...observed,
      stdout,
      namesLedger: diagnostic.includes(ledgerPath),
      namesQuarantine: diagnostic.includes(quarantinePath),
      usesWildcard: diagnostic.includes(`${ledgerPath}.corrupt-*`),
      leaksLedgerContent: diagnostic.includes(corruptLedgerContent),
    }).toEqual({
      exitCode: 1,
      threw: false,
      stdout: [],
      namesLedger: true,
      namesQuarantine: true,
      usesWildcard: false,
      leaksLedgerContent: false,
    });
  });

  it('uses the same concrete quarantine diagnostic for another ledger-mutating verb', async () => {
    const engineerDir = join(workDir, 'engineer-forget');
    const ledgerPath = join(engineerDir, 'ledger.json');
    const corruptLedgerContent = 'SECRET_LEDGER_ENTRY_MUST_NOT_REACH_THE_OPERATOR';
    await mkdir(engineerDir, { recursive: true });
    await writeFile(ledgerPath, corruptLedgerContent, 'utf8');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'owner/repo#1' },
      {
        engineerDir,
        print: (line) => stdout.push(line),
        printErr: (line) => stderr.push(line),
        gh: async () => ({ stdout: '[]' }),
      },
    );

    const quarantineNames = (await readdir(engineerDir))
      .filter((name) => name.startsWith('ledger.json.corrupt-'));
    const diagnostic = stderr.join('\n');
    expect(quarantineNames).toHaveLength(1);
    const [quarantineName] = quarantineNames;
    if (!quarantineName) throw new Error('expected corrupt ledger quarantine');
    expect({ exitCode, stdout }).toEqual({ exitCode: 1, stdout: [] });
    expect(diagnostic).toContain(ledgerPath);
    expect(diagnostic).toContain(join(engineerDir, quarantineName));
    expect(diagnostic).not.toContain(corruptLedgerContent);
  });
});
