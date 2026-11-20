// Covers: task:12
// Covers: task:15
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { contextForRun, parseResumeTarget, resumeComposerRun } from '../../../src/engine/engineer/resume.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import type { RunRecord } from '../../../src/engine/engineer/run-record.js';

const execFile = promisify(execFileCb);

const record: RunRecord = {
  schemaVersion: 1,
  slug: 'demo',
  track: 'technical',
  steps: {
    explore: {
      state: 'accepted',
      actor: 'A',
      provider: 'codex',
      at: '2026-11-08T00:00:00.000Z',
      artifacts: [{ path: '.docs/track/demo.md', sha256: 'a'.repeat(64) }],
    },
    prd: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:01:00.000Z', artifacts: [] },
    architecture_diagram: { state: 'draft' },
  },
  needsReconfirm: [],
  ownerHistory: [],
  notes: { explore: { decisions: ['technical'], openQuestions: ['why?'] } },
};
describe('Composer resume', () => {
  it('parses PR, branch and intake targets', () => {
    expect(parseResumeTarget('17')).toEqual({ kind: 'pr', number: 17 });
    expect(parseResumeTarget('spec/demo')).toEqual({ kind: 'branch', branch: 'spec/demo' });
    expect(parseResumeTarget('o/r#17')).toEqual({ kind: 'intake', repository: 'o/r', number: 17 });
  });
  it('uses the record for the first unaccepted step and emits a resume transition', async () => {
    const emitted: unknown[] = [];
    const result = await resumeComposerRun('spec/demo', {
      attach: async () => ({ worktree: '/tmp/demo' }),
      readRunRecord: async () => JSON.stringify(record),
      resolveBranch: async () => undefined,
      emit: async (event) => {
        emitted.push(event);
      },
    });
    expect(result.context).toMatchObject({
      nextStep: 'architecture_diagram',
      lastActor: 'A',
      decisions: ['technical'],
    });
    expect(emitted).toHaveLength(1);
    expect(contextForRun(record).drafts).toContain('architecture_diagram');
  });

  it('Covers: Task 12 resolves PR, branch, and intake selectors to one fetched attached remote run without owner approval', async () => {
    for (const target of ['17', 'spec/demo', 'acme/demo#12']) {
      const fetch = vi.fn(async () => {});
      const attach = vi.fn(async () => ({ worktree: '/repo/.worktrees/engineer-demo' }));
      const resolved = await resumeComposerRun(target, {
        resolveBranch: async () => ({ branch: 'spec/demo', draftPrUrl: 'https://github.com/acme/demo/pull/17' }),
        fetch,
        attach,
        readRunRecord: async () => JSON.stringify(record),
      });
      expect(fetch).toHaveBeenCalledWith('spec/demo');
      expect(attach).toHaveBeenCalledWith('spec/demo');
      expect(resolved.worktree).toBe('/repo/.worktrees/engineer-demo');
    }
  });

  it('Covers: Task 12 reports complete run context from the durable record and directs a landed record to delivery', () => {
    expect(contextForRun(record)).toMatchObject({
      nextStep: 'architecture_diagram',
      acceptedArtifacts: ['.docs/track/demo.md'],
      decisions: ['technical'],
      openQuestions: ['why?'],
      drafts: ['architecture_diagram'],
      lastActor: 'A',
      lastAt: '2026-11-08T00:01:00.000Z',
    });
    const landed: RunRecord = {
      ...record,
      steps: { explore: record.steps.explore, prd: record.steps.prd },
      needsReconfirm: [],
    };
    // A partial accept-only record is still mid-run. A stripped landed record
    // reaches delivery through resumeComposerRun's ENOENT handling instead.
    expect(contextForRun(landed).nextStep).toBe('architecture_diagram');
  });

  it('Covers: Task 12 treats the deliberately stripped landed record as delivery, not corruption', async () => {
    const deciding = vi.fn(async () => {});
    const emitted = vi.fn(async () => {});
    const result = await resumeComposerRun('spec/demo', {
      resolveBranch: async () => ({ branch: 'spec/demo' }),
      attach: async () => ({ worktree: '/tmp/landed-demo' }),
      readRunRecord: async () => {
        throw new Error('ENOENT .docs/composer-runs/demo.json');
      },
      recordDeciding: deciding,
      emit: emitted,
    });
    expect(result.context).toMatchObject({ slug: 'demo', branch: 'spec/demo', nextStep: 'delivery' });
    expect(deciding).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('does not expose a needs-reconfirm plan as accepted in resume context', () => {
    const { architecture_diagram: _draftArchitectureDiagram, ...stepsWithoutDraft } = record.steps;
    const planNeedsReconfirm: RunRecord = {
      ...record,
      steps: {
        ...stepsWithoutDraft,
        stories: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:02:00.000Z', artifacts: [] },
        plan: {
          state: 'accepted',
          actor: 'A',
          provider: 'codex',
          at: '2026-11-08T00:03:00.000Z',
          artifacts: [{ path: '.docs/plans/demo.md', sha256: 'b'.repeat(64) }],
        },
      },
      needsReconfirm: ['plan'],
    };

    const context = contextForRun(planNeedsReconfirm);

    expect(context.nextStep).toBe('plan');
    expect(context.acceptedArtifacts).not.toContain('.docs/plans/demo.md');
    expect(context.drafts).toContain('plan');
  });

  it('Covers: Task 12 leaves worktrees untouched for unknown targets and failed fetches, while no-remote attach skips fetch', async () => {
    const attach = vi.fn(async () => ({ worktree: '/should-not-exist' }));
    await expect(
      resumeComposerRun('not a target', {
        resolveBranch: async () => undefined,
        attach,
        readRunRecord: async () => JSON.stringify(record),
      }),
    ).rejects.toThrow(/searched PR, spec branch, and intake reference/);
    expect(attach).not.toHaveBeenCalled();

    const failedAttach = vi.fn(async () => ({ worktree: '/should-not-exist' }));
    await expect(
      resumeComposerRun('spec/demo', {
        resolveBranch: async () => undefined,
        fetch: async () => {
          throw new Error('network unavailable');
        },
        attach: failedAttach,
        readRunRecord: async () => JSON.stringify(record),
      }),
    ).rejects.toThrow('network unavailable');
    expect(failedAttach).not.toHaveBeenCalled();

    const localFetch = vi.fn(async () => {});
    const local = await resumeComposerRun('spec/demo', {
      resolveBranch: async () => undefined,
      attach: async () => ({ worktree: '/local/.worktrees/engineer-demo' }),
      readRunRecord: async () => JSON.stringify(record),
    });
    expect(localFetch).not.toHaveBeenCalled();
    expect(local.context.nextStep).toBe('architecture_diagram');
  });

  it('Covers: Task 12 refuses an unregistered project before it fetches or creates a worktree', async () => {
    const git = vi.fn(async () => ({ stdout: '', exitCode: 0 }));
    const errors: string[] = [];
    const registry = await mkdtemp(join(tmpdir(), 'composer-unregistered-'));
    try {
      const code = await dispatchEngineer(
        { kind: 'resume', target: 'acme/demo#12', project: 'missing', provider: 'codex' },
        {
          registryPath: join(registry, 'registry.json'),
          env: {},
          git,
          print: () => {},
          printErr: (line) => errors.push(line),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/project "missing" is not registered.*conduct register/i);
      expect(git).not.toHaveBeenCalled();
    } finally {
      await rm(registry, { recursive: true, force: true });
    }
  });

  it('Covers: Task 12 records deciding with the draft PR URL and emits exactly one resumed transition without ledger history', async () => {
    const transitions: unknown[] = [];
    const emitted: unknown[] = [];
    await resumeComposerRun('17', {
      resolveBranch: async () => ({ branch: 'spec/demo', draftPrUrl: 'https://github.com/acme/demo/pull/17' }),
      attach: async () => ({ worktree: '/tmp/demo' }),
      readRunRecord: async () => JSON.stringify(record),
      recordDeciding: async (entry) => {
        transitions.push(entry);
      },
      emit: async (event) => {
        emitted.push(event);
      },
    });
    expect(transitions).toEqual([{ branch: 'spec/demo', draftPrUrl: 'https://github.com/acme/demo/pull/17' }]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ slug: 'demo', worktreePath: '/tmp/demo' });
  });

  it('Covers: Tasks 12 and 13 attach a remote-only branch through production reconciliation, then reconstruct deciding once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-resume-remote-only-'));
    const origin = join(root, 'origin');
    const remote = join(root, 'remote.git');
    const client = join(root, 'client');
    const registryPath = join(root, 'registry.json');
    const engineerDir = join(root, 'engineer');
    const spawned = vi.fn(async () => 0);
    try {
      await execFile('git', ['init', '--bare', remote]);
      await execFile('git', ['init', '-b', 'main', origin]);
      await execFile('git', ['config', 'user.email', 'test@example.invalid'], { cwd: origin });
      await execFile('git', ['config', 'user.name', 'Test'], { cwd: origin });
      await writeFile(join(origin, 'README.md'), '# demo\n');
      await execFile('git', ['add', 'README.md'], { cwd: origin });
      await execFile('git', ['commit', '-m', 'base'], { cwd: origin });
      await execFile('git', ['remote', 'add', 'origin', remote], { cwd: origin });
      await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: origin });
      await execFile('git', ['checkout', '-b', 'spec/demo'], { cwd: origin });
      await mkdir(join(origin, '.docs', 'composer-runs'), { recursive: true });
      await mkdir(join(origin, '.docs', 'intake'), { recursive: true });
      await writeFile(join(origin, '.docs', 'composer-runs', 'demo.json'), JSON.stringify(record));
      await writeFile(join(origin, '.docs', 'intake', 'demo.md'), '# Intake\n\nSource-Ref: acme/demo#17\nOwner: A\n');
      await execFile('git', ['add', '.docs'], { cwd: origin });
      await execFile('git', ['commit', '-m', 'remote composer run'], { cwd: origin });
      await execFile('git', ['push', '-u', 'origin', 'spec/demo'], { cwd: origin });
      await execFile('git', ['clone', remote, client]);
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'demo',
            path: client,
            remote: 'https://github.com/acme/demo.git',
            status: 'registered',
            registeredAt: '2026-11-19T00:00:00.000Z',
          },
        ]),
      );
      // Match the rejecting production runner: reconciliation must explicitly
      // probe the absent local ref instead of relying on a nonzero result.
      const git = async (args: string[], options?: { cwd?: string }) => {
        const result = await execFile('git', args, { cwd: options?.cwd ?? client });
        return { exitCode: 0, stdout: result.stdout };
      };
      const code = await dispatchEngineer(
        { kind: 'resume', target: 'spec/demo', project: 'demo', provider: 'codex' },
        {
          registryPath,
          engineerDir,
          git,
          gh: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
          spawnHost: spawned,
          providerInstalled: async () => true,
          chooseComposerBoundary: async () => ({ choice: 'switch' }),
          isAttachedTerminal: () => false,
          env: {},
          print: () => {},
          printErr: () => {},
          resolveResumeOwner: async () => ({ resolved: true, id: 'A' }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );

      expect(code).toBe(0);
      expect(spawned).toHaveBeenCalledOnce();
      expect(
        await execFile('git', ['show-ref', '--verify', '--quiet', 'refs/heads/spec/demo'], { cwd: client }),
      ).toBeDefined();
      await expect(
        createLedger(join(engineerDir, 'ledger.json')).get('github-issues', 'acme/demo#17'),
      ).resolves.toMatchObject({
        status: 'deciding',
        branch: 'spec/demo',
      });
      const events = (await readFile(join(client, '.pipeline', 'composer-events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events.filter((event) => event.type === 'composer_run_resumed')).toHaveLength(1);

      // Land strips the run record.  A second fresh-machine resume must attach
      // that remote-only branch and give the host the delivery step instead of
      // failing while reading absent remote state during reconciliation.
      await execFile('git', ['checkout', 'main'], { cwd: origin });
      await execFile('git', ['checkout', '-b', 'spec/landed'], { cwd: origin });
      await execFile('git', ['commit', '--allow-empty', '-m', 'landed spec'], { cwd: origin });
      await execFile('git', ['push', '-u', 'origin', 'spec/landed'], { cwd: origin });
      spawned.mockClear();
      const deliveryCode = await dispatchEngineer(
        { kind: 'resume', target: 'spec/landed', project: 'demo', provider: 'codex' },
        {
          registryPath,
          engineerDir,
          git,
          gh: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
          spawnHost: spawned,
          providerInstalled: async () => true,
          isAttachedTerminal: () => false,
          env: {},
          print: () => {},
          printErr: () => {},
          resolveResumeOwner: async () => ({ resolved: true, id: 'A' }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(deliveryCode).toBe(0);
      expect(spawned).toHaveBeenCalledOnce();
      expect(spawned.mock.calls[0][1].join(' ')).toContain('--step delivery');

      // An already-registered, clean worktree may be behind after another
      // machine checkpoints.  Reconciliation must fast-forward it before
      // ensureWorktree reuses that path.
      await execFile('git', ['checkout', 'spec/demo'], { cwd: origin });
      await writeFile(join(origin, '.docs', 'remote-update.md'), 'new remote checkpoint\n');
      await execFile('git', ['add', '.docs/remote-update.md'], { cwd: origin });
      await execFile('git', ['commit', '-m', 'advance remote run'], { cwd: origin });
      await execFile('git', ['push', 'origin', 'spec/demo'], { cwd: origin });
      spawned.mockClear();
      const behindCode = await dispatchEngineer(
        { kind: 'resume', target: 'spec/demo', project: 'demo', provider: 'codex' },
        {
          registryPath,
          engineerDir,
          git,
          gh: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
          spawnHost: spawned,
          providerInstalled: async () => true,
          chooseComposerBoundary: async () => ({ choice: 'switch' }),
          isAttachedTerminal: () => false,
          env: {},
          print: () => {},
          printErr: () => {},
          resolveResumeOwner: async () => ({ resolved: true, id: 'A' }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(behindCode).toBe(0);
      const worktree = join(client, '.worktrees', 'engineer-demo');
      expect((await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim()).toBe(
        (await execFile('git', ['rev-parse', 'origin/spec/demo'], { cwd: client })).stdout.trim(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Covers: Task 15 launches one Codex Composer resume host at the attached worktree and refuses nested hosts before launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-resume-launch-'));
    const registryPath = join(root, 'registry.json');
    const spawned = vi.fn(async (_executable: string, _argv: string[], _cwd: string, _env: NodeJS.ProcessEnv) => 0);
    const errors: string[] = [];
    try {
      await execFile('git', ['init', '-b', 'main'], { cwd: root });
      await execFile('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
      await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
      await writeFile(join(root, 'README.md'), '# demo\n');
      await execFile('git', ['add', 'README.md'], { cwd: root });
      await execFile('git', ['commit', '-m', 'init'], { cwd: root });
      await execFile('git', ['checkout', '-b', 'spec/demo'], { cwd: root });
      await mkdir(join(root, '.docs', 'composer-runs'), { recursive: true });
      // This fixture owns launch wiring, not digest verification; use an
      // accepted step with no artifact bytes to keep it independent of a
      // synthetic digest.
      await writeFile(
        join(root, '.docs', 'composer-runs', 'demo.json'),
        JSON.stringify({
          ...record,
          steps: { ...record.steps, explore: { ...record.steps.explore!, artifacts: [] } },
        }),
      );
      await execFile('git', ['add', '.docs'], { cwd: root });
      await execFile('git', ['commit', '-m', 'run'], { cwd: root });
      await execFile('git', ['checkout', 'main'], { cwd: root });
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'demo',
            path: root,
            status: 'registered',
            registeredAt: '2026-11-08T00:00:00.000Z',
          },
        ]),
      );
      const localGit = async (args: string[], options?: { cwd?: string }) => {
        const result = await execFile('git', args, { cwd: options?.cwd ?? root });
        return { exitCode: 0, stdout: result.stdout };
      };
      const code = await dispatchEngineer(
        { kind: 'resume', target: 'spec/demo', provider: 'codex', project: 'demo' },
        {
          registryPath,
          spawnHost: spawned,
          print: () => {},
          printErr: (line) => errors.push(line),
          env: {},
          resolveResumeOwner: async () => ({ resolved: true, id: 'A' }),
          git: localGit,
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(code).toBe(0);
      expect(spawned).toHaveBeenCalledOnce();
      expect(spawned.mock.calls[0][1]).toEqual(
        expect.arrayContaining([
          expect.stringContaining('$composer --resume'),
          expect.stringContaining('/.worktrees/engineer-demo'),
          expect.stringContaining('--step architecture_diagram'),
        ]),
      );
      const nestedSpawn = vi.fn(async () => 0);
      const nested = await dispatchEngineer(
        { kind: 'resume', target: 'spec/demo', provider: 'codex', project: 'demo' },
        {
          registryPath,
          spawnHost: nestedSpawn,
          print: () => {},
          printErr: (line) => errors.push(line),
          env: { CODEX_THREAD_ID: 'already-here' },
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(nested).toBe(1);
      expect(nestedSpawn).not.toHaveBeenCalled();
      expect(errors.join('\n')).toMatch(/already inside a Codex session/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
