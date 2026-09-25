// Covers: task:10
// Entry-point wiring keeps both machine identity and bot credential on the
// same user-config HOME; the process boundary is mocked, never GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const boundary = vi.hoisted(() => ({ calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }> }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((file, args: string[], options: Record<string, unknown>, callback) => {
    boundary.calls.push({ file, args, options }); queueMicrotask(() => callback(null, { stdout: '', stderr: '' })); return {};
  }) };
});
import { dispatchGithubOperationCommand } from '../../src/engine/github-operations-cli.js';
import { readMachineOwnerConfig } from '../../src/engine/owner-gate/machine-identity.js';
import { readGithubBotCredential } from '../../src/engine/github-bot-credential.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';

const originalHome = process.env.HOME;
describe('GitHub bot CLI entry points', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-cli-entry-'));
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    await writeFile(join(root, 'token'), 'bot-entry-token\n');
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), `spec_owner: pr-labels\ngithub_bot:\n  token_file: ${join(root, 'token')}\n`);
    process.env.HOME = join(root, 'home'); delete process.env.AI_CONDUCTOR_NO_REAL_EXEC; boundary.calls.length = 0; vi.mocked(execFileCb).mockClear();
  });
  afterEach(async () => { if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome; await rm(root, { recursive: true, force: true }); });
  it('dispatchGithubOperationCommand writes issue comments through the bot child and shares the user config with owner resolution', async () => {
    await expect(readMachineOwnerConfig()).resolves.toEqual({ spec_owner: 'pr-labels' });
    await expect(readGithubBotCredential()).resolves.toEqual({ kind: 'configured', tokenFile: join(root, 'token') });
    const gh = makeProductionGh();
    const guarded = createGuardedGithubOperationRunner(gh, { cwd: root, mutation: {
      provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'feature/topic', featureMarker: '.docs/intake/topic.md', publication: 'initial' },
      dependencies: { resolveMachineOwner: async () => ({ resolved: true as const, id: 'pr-labels' }), provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: pr-labels\n' }] } },
    } });
    const runner = Object.assign(gh, { run: guarded.run });
    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: root, runner, git: vi.fn(async () => ({ stdout: 'feature/topic\n' })), write: vi.fn(), readRequest: async () => JSON.stringify({ operation: 'issue.comment.create', repository: 'acme/repo', resource: { kind: 'issue', number: 1 }, context: { actor: 'pr-labels' }, payload: { body: 'entry' } }),
    });
    expect(exit).toBe(0);
    expect(boundary.calls).toContainEqual(expect.objectContaining({ file: 'gh', args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'entry'], options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-entry-token' }) }) }));
  });
});
