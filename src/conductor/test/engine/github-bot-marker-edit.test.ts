// Covers: task:11
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = vi.hoisted(() => ({ calls: [] as Array<{ args: string[]; options: Record<string, unknown> }> }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((_file, args: string[], options: Record<string, unknown>, callback) => {
    boundary.calls.push({ args, options });
    const update = args[0] === 'api' && args.includes('--method') && args.includes('PATCH');
    const read = args[0] === 'pr' && args[1] === 'view';
    queueMicrotask(() => callback(update ? Object.assign(new Error('HTTP 403: Resource not accessible by personal access token'), { stderr: 'HTTP 403: Resource not accessible by personal access token' }) : null,
      { stdout: read ? JSON.stringify({ comments: [{ body: '<!-- marker -->', url: 'https://github.com/acme/repo/pull/1#issuecomment-9' }] }) : '', stderr: '' }));
    return {};
  }) };
});

import { upsertComment } from '../../src/engine/pr-labels.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';

const originalHome = process.env.HOME;
describe('configured bot marker edit fallback', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-marker-edit-'));
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    await writeFile(join(root, 'token'), 'bot-token\n');
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${join(root, 'token')}\n`);
    process.env.HOME = join(root, 'home'); delete process.env.AI_CONDUCTOR_NO_REAL_EXEC; boundary.calls.length = 0; vi.mocked(execFileCb).mockClear();
  });
  afterEach(async () => { if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome; await rm(root, { recursive: true, force: true }); });

  it('retries a refused marker edit once as operator and never creates a second comment', async () => {
    const logs: string[] = [];
    const gh = makeProductionGh();
    const guarded = createGuardedGithubOperationRunner(gh, {
      cwd: root,
      mutation: {
        provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'feature/topic', featureMarker: '.docs/intake/topic.md', publication: 'initial' },
        dependencies: {
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'pr-labels' }),
          provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: pr-labels\n' }] },
        },
      },
      events: { emit: async () => {} },
    });
    const runner = Object.assign(gh, { run: guarded.run });
    await upsertComment(runner, root, 'https://github.com/acme/repo/pull/1', '<!-- marker -->', 'new body', (line) => logs.push(line));
    const updates = boundary.calls.filter((call) => call.args[0] === 'api' && call.args.includes('PATCH'));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.options.env).toEqual(expect.objectContaining({ GH_TOKEN: 'bot-token' }));
    expect(updates[1]?.options.env).toBeUndefined();
    expect(boundary.calls.some((call) => call.args[0] === 'pr' && call.args[1] === 'comment')).toBe(false);
    expect(logs.join('\n')).toContain('leaving existing comment as-is');
  });
});
