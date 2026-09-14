// Covers: task:13
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createGithubIssuesAdapter,
  GITHUB_ISSUES_SOURCE,
} from '../../../src/engine/engineer/intake/github-issues.js';
import type { Ledger } from '../../../src/engine/engineer/intake/ledger.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';

const REPOSITORY = 'acme/intake';
const SOURCE_REF = `${REPOSITORY}#17`;

function ledger(): Ledger {
  return {
    known: async () => false,
    record: async () => {},
    transition: async () => {},
    get: async () => undefined,
    forget: async () => {},
    list: async () => [],
    reopen: async () => {},
    requeueClaimed: async () => ({ acted: false }),
  };
}

function terminal(initialAssignees: string[]): {
  assignees: string[];
  readonly mutations: string[][];
  readonly assignmentReads: number[];
  gh: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
} {
  const state = {
    assignees: initialAssignees,
    mutations: [] as string[][],
    assignmentReads: [] as number[],
    gh: async (args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'view' && args.includes('assignees')) {
        state.assignmentReads.push(1);
        return { stdout: JSON.stringify({ assignees: state.assignees.map((login) => ({ login })) }) };
      }
      if ((args[0] === 'issue' && args[1] === 'comment')
        || (args[0] === 'issue' && args[1] === 'close')
        || (args[0] === 'api' && args.includes('--method'))) {
        state.mutations.push(args);
        return { stdout: '' };
      }
      throw new Error(`unexpected terminal call: ${args.join(' ')}`);
    },
  };
  return state;
}

function adapter(
  fake: ReturnType<typeof terminal>,
  confirmation?: { mode: 'interactive'; confirm: (prompt: unknown) => Promise<boolean> },
) {
  return createGithubIssuesAdapter({
    gh: fake.gh,
    registry: { list: async () => [] },
    ledger: ledger(),
    resolveActor: async () => ({ resolved: true as const, id: 'alice' }),
    confirmation,
  });
}

describe('intake writeback — independent assignment authorization', () => {
  it('writes routed and handled markers only for the exclusively assigned operator, preserving assignees', async () => {
    const fake = terminal([' Alice ']);
    const intake = adapter(fake);

    await expect(intake.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toEqual({ ok: true });
    await expect(intake.report(SOURCE_REF, 'done', { prUrl: 'https://github.com/acme/target/pull/5' })).resolves.toEqual({ ok: true });

    expect(fake.assignees).toEqual([' Alice ']);
    expect(fake.mutations).toHaveLength(3);
    expect(fake.mutations.flat()).not.toContain('--add-assignee');
    expect(fake.mutations.flat()).not.toContain('--remove-assignee');
  });

  it.each([
    ['absent', []],
    ['foreign', ['bob']],
    ['multiple distinct', ['alice', 'bob']],
  ])('refuses %s assignment evidence with zero issue writes', async (_caseName, assignees) => {
    const fake = terminal(assignees);
    const intake = adapter(fake);

    await expect(intake.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toMatchObject({ ok: false });

    expect(fake.assignees).toEqual(assignees);
    expect(fake.mutations).toEqual([]);
  });

  it('accepts exact explicit approval but refuses an approval declined for this issue', async () => {
    const approvedFake = terminal([]);
    const approved = adapter(approvedFake, { mode: 'interactive', confirm: async () => true });
    await expect(approved.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toEqual({ ok: true });
    expect(approvedFake.mutations).toHaveLength(1);

    const deniedFake = terminal([]);
    const denied = adapter(deniedFake, { mode: 'interactive', confirm: async () => false });
    await expect(denied.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toMatchObject({ ok: false });
    expect(deniedFake.mutations).toEqual([]);
  });

  it('re-reads assignment evidence on retry and refuses after reassignment', async () => {
    const fake = terminal(['alice']);
    let failFirstMutation = true;
    const originalGh = fake.gh;
    fake.gh = async (args, opts) => {
      if (args[0] === 'issue' && args[1] === 'comment' && failFirstMutation) {
        failFirstMutation = false;
        fake.mutations.push(args);
        throw new Error('temporary GitHub outage');
      }
      return originalGh(args, opts);
    };
    const intake = adapter(fake);

    await expect(intake.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toMatchObject({ ok: false });
    fake.assignees = ['bob'];
    await expect(intake.report(SOURCE_REF, 'routed', { repo: 'acme/target' })).resolves.toMatchObject({ ok: false });

    expect(fake.assignmentReads).toHaveLength(2);
    expect(fake.mutations).toHaveLength(1);
  });

  it('does not treat the intake source itself as feature provenance', async () => {
    const fake = terminal(['bob']);
    const intake = adapter(fake);

    await expect(intake.report(SOURCE_REF, 'done', { prUrl: 'https://github.com/acme/owned/pull/9' })).resolves.toMatchObject({ ok: false });
    expect(fake.mutations).toEqual([]);
  });

  it('uses the same independent assignment guard for engineer forget comment, close, and cleanup', async () => {
    const engineerDir = await mkdtemp(join(tmpdir(), 'intake-ownership-'));
    try {
      const fake = terminal(['alice']);
      const originalGh = fake.gh;
      fake.gh = async (args, opts) => {
        if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
        return originalGh(args, opts);
      };
      const intakeLedger = createLedger(join(engineerDir, 'ledger.json'));
      await intakeLedger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: SOURCE_REF });

      const errors: string[] = [];
      const result = await dispatchEngineer(
        { kind: 'forget', sourceRef: SOURCE_REF, resolvedBy: 'acme/other#8' },
        {
          engineerDir,
          gh: fake.gh,
          intakeResolveActor: async () => ({ resolved: true, id: 'alice' }),
          print: () => {},
          printErr: (message) => errors.push(message),
        },
      );
      expect(result, errors.join('\n')).toBe(0);

      expect(fake.assignees).toEqual(['alice']);
      expect(fake.assignmentReads).toHaveLength(3);
      expect(fake.mutations).toHaveLength(3);
      expect(await intakeLedger.known(GITHUB_ISSUES_SOURCE, SOURCE_REF)).toBe(false);
    } finally {
      await rm(engineerDir, { recursive: true, force: true });
    }
  });
});
