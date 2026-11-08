// Covers: S2.2, S13.2, S13.5, task:3, task:12, task:15
// Covers: FR-2, FR-3, FR-12, FR-29
// Cross-session proof: checkpoint real files, resume through the public CLI on
// another provider, then checkpoint again. Component tests cannot establish that
// the writer, reader and host launch agree about the same persisted run.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../src/engine/engineer-cli.js';

const SLUG = 'provider-handoff';
const NOTES = {
  decisions: ['retain human acceptance'],
  openQuestions: ['diagram detail?'],
};
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('Composer checkpoint → another provider → checkpoint', () => {
  let root: string;
  let project: string;
  let worktree: string;
  let registryPath: string;
  let notesPath: string;
  let recordPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'composer-provider-handoff-'));
    project = join(root, 'project');
    worktree = join(project, '.worktrees', `engineer-${SLUG}`);
    registryPath = join(root, 'registry.json');
    notesPath = join(root, 'notes.txt');
    recordPath = join(worktree, '.docs', 'composer-runs', `${SLUG}.json`);
    await mkdir(project);
    await execa('git', ['init', '-b', 'main', project]);
    await execa('git', ['config', 'user.name', 'Composer test'], { cwd: project });
    await execa('git', ['config', 'user.email', 'composer@example.test'], { cwd: project });
    await writeFile(join(project, '.gitignore'), '.worktrees/\n.pipeline/\n');
    await execa('git', ['add', '.gitignore'], { cwd: project });
    await execa('git', ['commit', '-m', 'fixture base'], { cwd: project });
    await execa('git', ['worktree', 'add', '-b', `spec/${SLUG}`, worktree], { cwd: project });
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1, name: 'project', path: project,
      status: 'registered', registeredAt: '2026-11-08T00:00:00.000Z',
    }]));
    await writeFile(notesPath, JSON.stringify(NOTES));
    // Provider executable selection reads these overrides from process.env.
    vi.stubEnv('CLAUDE_EXECUTABLE', 'claude');
    vi.stubEnv('CODEX_EXECUTABLE', 'codex');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    { from: 'claude', to: 'codex', invocation: '$composer' },
    { from: 'codex', to: 'claude', invocation: '/composer' },
  ])('resumes $from progress on $to, keeping accepted work and the unaccepted draft distinct', async ({ from, to, invocation }) => {
    const print = vi.fn();
    const printErr = vi.fn();
    const spawnHost = vi.fn<NonNullable<DispatchEngineerOpts['spawnHost']>>(async () => 0);
    // This no-remote flow must never reach GitHub. Real Git is confined to the
    // fixture; remote operations are refused before reaching a process.
    const gh = vi.fn(async () => { throw new Error('unexpected GitHub call in local-only run'); });
    const git: NonNullable<DispatchEngineerOpts['git']> = async (args, options) => {
      const cwd = resolve(options.cwd);
      if (cwd !== project && cwd !== worktree) throw new Error(`Git escaped fixture: ${cwd}`);
      if (args.some((arg) => ['push', 'fetch', 'pull', 'clone'].includes(arg))) {
        throw new Error(`unexpected remote Git: ${args.join(' ')}`);
      }
      const result = await execa('git', args, { cwd, reject: false, input: options.input });
      return { stdout: result.stdout, exitCode: result.exitCode };
    };
    const options = (provider: string): DispatchEngineerOpts => ({
      registryPath, engineerDir: join(root, 'engineer'),
      skillNameRoot: null, print, printErr, git, gh, spawnHost,
      env: { AI_CONDUCTOR_AUTHORING_PROVIDER: provider },
      resolveCheckpointOwner: async () => ({ resolved: true, id: 'operator-a' }),
      resolveResumeOwner: async () => ({ resolved: true, id: 'operator-a' }),
      intakeResolveActor: async () => ({ resolved: true, id: 'operator-a' }),
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      loadLaunchConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      isAttachedTerminal: () => true,
      brainLoopAlive: () => false, prePoll: async () => 0, confirmAnother: () => false,
    });
    const command = async (args: string[], provider: string): Promise<number> => {
      const dispatch = detectEngineerCommand(['node', 'ai-conductor', 'compose', ...args]);
      if (!dispatch) throw new Error('compose entry point was not recognized');
      return dispatchEngineer(dispatch, options(provider));
    };
    const checkpoint = (step: string, state: '--accept' | '--draft', provider: string): Promise<number> =>
      command(['checkpoint', '--worktree', worktree, '--step', step, state, '--notes-file', notesPath], provider);
    const artifact = async (family: string, text: string): Promise<void> => {
      await mkdir(join(worktree, '.docs', family), { recursive: true });
      await writeFile(join(worktree, '.docs', family, `${SLUG}.md`), text);
    };
    const committedRecord = async (): Promise<string> =>
      (await execa('git', ['show', `HEAD:.docs/composer-runs/${SLUG}.json`], { cwd: worktree })).stdout;

    const exploration = 'Track: product\nApproach: checkpoint then resume.\n';
    await artifact('track', exploration);
    expect(await checkpoint('explore', '--accept', from), printErr.mock.calls.flat().join('\n')).toBe(0);
    expect(existsSync(recordPath), 'compose checkpoint must persist its run record before a different provider can resume').toBe(true);
    expect(spawnHost, 'checkpoint is a deterministic command, not a new host session').not.toHaveBeenCalled();
    expect(await committedRecord()).toContain(sha256(exploration));

    const prd = '**Status:** Approved\n# PRD: Provider handoff\n';
    await artifact('specs', prd);
    expect(await checkpoint('prd', '--accept', from)).toBe(0);
    const prdCheckpoint = await committedRecord();
    expect(prdCheckpoint).toContain(sha256(exploration));
    expect(prdCheckpoint).toContain(sha256(prd));
    expect(prdCheckpoint).toContain(from);
    const diagram = '# Architecture draft awaiting operator acceptance\n';
    await artifact('architecture', diagram);
    expect(await checkpoint('architecture_diagram', '--draft', from), printErr.mock.calls.flat().join('\n')).toBe(0);
    const beforeResume = await readFile(recordPath, 'utf8');
    expect(await committedRecord()).toBe(beforeResume.trimEnd());

    expect(await command(['resume', `spec/${SLUG}`, '--project', 'project', '--provider', to], to)).toBe(0);
    expect(spawnHost).toHaveBeenCalledTimes(1);
    const [executable, argv, cwd, env] = spawnHost.mock.calls[0];
    expect(executable).toBe(to);
    expect(cwd).toBe(worktree);
    expect(env.AI_CONDUCTOR_AUTHORING_PROVIDER).toBe(to);
    expect(argv.join(' ')).toContain(invocation);
    expect(argv.join(' ')).toMatch(/resume/i);
    expect(argv.join(' ')).toContain(worktree);
    const resumeContext = [argv.join(' '), ...print.mock.calls.flat()].join('\n');
    expect(resumeContext).toContain('architecture_diagram');
    expect(resumeContext).toMatch(/draft|unaccepted/i);
    expect(await readFile(join(worktree, '.docs', 'architecture', `${SLUG}.md`), 'utf8')).toBe(diagram);

    // Acceptance remains an explicit action in the new session. The saved draft
    // must not acquire an accepting provider merely because it was resumed.
    const resumedRecord = await readFile(recordPath, 'utf8');
    expect(resumedRecord).toContain(sha256(exploration));
    expect(resumedRecord).toContain(sha256(prd));
    expect(resumedRecord).toContain('draft');
    expect(resumedRecord).not.toContain(sha256(diagram));
    expect(await checkpoint('architecture_diagram', '--accept', to), printErr.mock.calls.flat().join('\n')).toBe(0);
    const afterAcceptance = await committedRecord();
    expect(afterAcceptance).toContain(sha256(exploration));
    expect(afterAcceptance).toContain(sha256(prd));
    expect(afterAcceptance).toContain(sha256(diagram));
    expect(afterAcceptance).toContain(NOTES.decisions[0]);
    expect(afterAcceptance).toContain(NOTES.openQuestions[0]);
    expect(afterAcceptance).toContain(from);
    expect(afterAcceptance).toContain(to);
    expect(gh).not.toHaveBeenCalled();
    expect(printErr.mock.calls.flat().join('\n')).not.toMatch(/could not launch|unaccepted-draft/i);
  });
});
