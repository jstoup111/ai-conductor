// Covers: task:12

import { describe, expect, it } from 'vitest';

import { sweep, type SweepConfig } from '../../../src/engine/halt-issues/sweep.js';
import { createGithubTrackerClient, type GhRunner } from '../../../src/engine/tracker-client.js';

const HALT_AT = '2026-09-14T12:00:00.000Z';

class FakeFs {
  private readonly files = new Map<string, string>();
  private readonly mtimes = new Map<string, Date>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing fixture file: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    const content = await this.readFile(from);
    this.files.set(to, content);
    this.files.delete(from);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async getFileStats(path: string): Promise<{ mtime: Date }> {
    const mtime = this.mtimes.get(path);
    if (!mtime) throw new Error(`missing fixture mtime: ${path}`);
    return { mtime };
  }

  setFile(path: string, content: string, mtime?: Date): void {
    this.files.set(path, content);
    if (mtime) this.mtimes.set(path, mtime);
  }
}

function mutationContext(repository: string, owner = 'alice') {
  return {
    provenance: {
      repository,
      defaultBranch: 'main',
      specBranch: 'spec/halt-owner',
      featureMarker: '.docs/specs/halt-owner.md',
      publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{
          path: '.docs/specs/halt-owner.md',
          content: `Owner: ${owner}\n`,
        }],
      },
    },
  };
}

function config(fs: FakeFs, repo: string, gh: ReturnType<typeof createGithubTrackerClient>): SweepConfig {
  return {
    monitorLogPath: '/fixture/monitor.log',
    ledgerPath: '/fixture/ledger.json',
    repoDir: '/fixture/repo',
    repo,
    dryRun: false,
    fs,
    gh,
    clock: { now: () => new Date('2026-09-14T13:00:00.000Z') },
  };
}

function monitorLog(slug: string, issue: number): string {
  return `${HALT_AT} NEW HALT: ${HALT_AT} [daemon] ✋ ${slug} halted\nHALT ${slug} -> filed #${issue}`;
}

function writeShipEvidence(fs: FakeFs, slug: string): void {
  fs.setFile(
    `/fixture/repo/.daemon/processed/${slug}.json`,
    JSON.stringify({ status: 'shipped', prUrl: 'https://github.com/acme/owned/pull/8' }),
    new Date('2026-09-14T12:00:00.001Z'),
  );
}

function isMutation(args: readonly string[]): boolean {
  return (args[0] === 'issue' && ['edit', 'comment', 'close'].includes(args[1] ?? ''))
    || (args[0] === 'api' && args.includes('--method'));
}

describe('halt-issue sweep ownership', () => {
  it('stamps, comments, and closes only an independently authorized eligible issue', async () => {
    const fs = new FakeFs();
    const terminalCalls: string[][] = [];
    const terminal: GhRunner = async (args) => {
      terminalCalls.push(args);
      if (args[0] === 'api') return { stdout: JSON.stringify({ labels: [] }) };
      if (args[0] === 'issue' && args[1] === 'view' && args.includes('--json')) {
        return { stdout: JSON.stringify(args.includes('body') ? { body: 'halted' } : { state: 'OPEN' }) };
      }
      return { stdout: '' };
    };
    const slug = 'owned-halt';
    fs.setFile('/fixture/monitor.log', monitorLog(slug, 17));
    writeShipEvidence(fs, slug);

    const result = await sweep(config(fs, 'acme/owned', createGithubTrackerClient(terminal, {
      mutation: mutationContext('acme/owned'), repository: 'acme/owned',
    })));

    expect(result).toMatchObject({ stamped: 1, closed: 1, errors: 0 });
    expect(terminalCalls.filter(isMutation).map((args) => args.slice(0, 2))).toEqual([
      ['issue', 'edit'], ['issue', 'comment'], ['issue', 'close'],
    ]);
  });

  it('keeps a refused eligible foreign issue unclosed and does not try an alternate write', async () => {
    const fs = new FakeFs();
    const terminalCalls: string[][] = [];
    const terminal: GhRunner = async (args) => {
      terminalCalls.push(args);
      if (args[0] === 'api') return { stdout: JSON.stringify({ labels: [] }) };
      if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ state: 'OPEN' }) };
      throw new Error(`unexpected terminal call: ${args.join(' ')}`);
    };
    const slug = 'foreign-halt';
    fs.setFile('/fixture/monitor.log', monitorLog(slug, 42));
    fs.setFile('/fixture/ledger.json', JSON.stringify({ version: 1, entries: {
      '42': { issue: '42', repo: 'acme/foreign', slug, haltAt: HALT_AT, status: 'stamped', stampedAt: HALT_AT },
    } }));
    writeShipEvidence(fs, slug);

    const result = await sweep(config(fs, 'acme/foreign', createGithubTrackerClient(terminal, {
      mutation: mutationContext('acme/owned'), repository: 'acme/owned',
    })));
    const ledger = JSON.parse(await fs.readFile('/fixture/ledger.json'));

    expect(result).toMatchObject({ closed: 0, errors: 1 });
    expect(ledger.entries['42']).toMatchObject({ status: 'stamped', stampedAt: HALT_AT, lastError: 'refused: invalid-target' });
    expect(terminalCalls.filter(isMutation)).toEqual([]);
  });

  it('retains the steady-state zero-call path for already stamped, unresolved issues', async () => {
    const fs = new FakeFs();
    const terminal: GhRunner = async (args) => {
      throw new Error(`steady-state issue unexpectedly reached terminal: ${args.join(' ')}`);
    };
    const slug = 'unresolved-halt';
    fs.setFile('/fixture/monitor.log', monitorLog(slug, 17));
    fs.setFile('/fixture/ledger.json', JSON.stringify({ version: 1, entries: {
      '17': { issue: '17', repo: 'acme/owned', slug, haltAt: HALT_AT, status: 'stamped', stampedAt: HALT_AT },
    } }));

    await expect(sweep(config(fs, 'acme/owned', createGithubTrackerClient(terminal, {
      mutation: mutationContext('acme/owned'), repository: 'acme/owned',
    })))).resolves.toMatchObject({ stamped: 0, closed: 0, errors: 0 });
  });
});
