// Covers: task:15
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectTranscriptsCommand, dispatchTranscripts } from '../../src/engine/transcripts-cli.js';

const slug = 'retained-transcripts';
let repo: string | undefined;

async function capture(
  name: string,
  provider: 'claude' | 'codex' | 'pi',
  lines: readonly string[],
  capturedAt: string,
  step = 'build',
  owner?: { kind: 'configured-group-member'; parentGroup: 'explore'; member: string },
): Promise<string> {
  if (!repo) throw new Error('repo not initialized');
  const relative = `.pipeline/transcripts/${step}/${name}`;
  const root = join(repo, '.worktrees', slug, relative);
  const session = provider === 'claude'
    ? join(root, 'projects', 'project', 'session.jsonl')
    : join(root, 'sessions', '2026', '10', '14', 'session.jsonl');
  await mkdir(join(session, '..'), { recursive: true });
  await writeFile(session, lines.join('\n'));
  const events = [
    { type: 'provider_transcripts_captured', ts: capturedAt, ...(owner === undefined ? {} : { owner }), step, runId: name, attempt: 1, member: `${provider}-member`, provider, path: relative, files: 1, bytes: 1, interrupted: provider === 'pi', skipped: 0, omittedLines: 0 },
    { type: 'provider_transcripts_retained', ts: capturedAt, path: relative },
  ];
  await mkdir(join(repo, '.worktrees', slug, '.pipeline'), { recursive: true });
  await writeFile(join(repo, '.worktrees', slug, '.pipeline', 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, { flag: 'a' });
  return relative;
}

async function run(args: string[]): Promise<{ code: number; output: string[] }> {
  return runForSlug(slug, args);
}

async function runForSlug(featureSlug: string, args: string[] = []): Promise<{ code: number; output: string[] }> {
  if (!repo) throw new Error('repo not initialized');
  const command = detectTranscriptsCommand(['node', 'ai-conductor', 'transcripts', featureSlug, ...args]);
  if (!command) throw new Error('valid transcripts command was not detected');
  const output: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((value: string) => { output.push(value); });
  const error = vi.spyOn(console, 'error').mockImplementation((value: string) => { output.push(value); });
  try {
    return { code: await dispatchTranscripts(command, repo), output };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

async function snapshot(root: string): Promise<Record<string, { content: string; mtimeMs: number }>> {
  const result: Record<string, { content: string; mtimeMs: number }> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const details = await stat(path);
        result[path.slice(root.length)] = { content: await readFile(path, 'utf8'), mtimeMs: details.mtimeMs };
      }
    }
  }
  await visit(root);
  return result;
}

afterEach(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
  repo = undefined;
  vi.restoreAllMocks();
});

describe('ai-conductor transcripts', () => {
  it('lists a retained configured group-member capture by its member step', async () => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const path = await capture('member-capture', 'codex', [], '2026-10-14T00:00:10.000Z', 'explore', {
      kind: 'configured-group-member', parentGroup: 'explore', member: 'custom-review',
    });

    expect(await run([])).toEqual({
      code: 0,
      output: [expect.stringContaining(`step=custom-review attempt=1 member=codex-member provider=codex interrupted=false path=${path}`)],
    });
  });

  it('lists retained captures newest first with their event-ledger identity', async () => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    // Persist the newest capture first to prove ordering follows ISO capture time, not line order.
    const codex = await capture('codex-capture', 'codex', [JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex final' }] } })], '2026-10-14T00:00:30.000Z');
    const claude = await capture('claude-capture', 'claude', [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Claude final' }] } })], '2026-10-14T00:00:10.000Z');
    const pi = await capture('pi-capture', 'pi', [JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi final' }] } })], '2026-10-14T00:00:20.000Z');

    const result = await run([]);

    expect(result).toEqual({
      code: 0,
      output: [
        expect.stringContaining(`step=build attempt=1 member=codex-member provider=codex interrupted=false path=${codex}`),
        expect.stringContaining(`step=build attempt=1 member=pi-member provider=pi interrupted=true path=${pi}`),
        expect.stringContaining(`step=build attempt=1 member=claude-member provider=claude interrupted=false path=${claude}`),
      ],
    });
  });

  it.each([
    ['claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Claude final' }] } })],
    ['codex', JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex final' }] } })],
    ['pi', JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi final' }] } })],
  ] as const)('prints the final %s assistant message and sanitizes it', async (provider, line) => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const path = await capture(`${provider}-capture`, provider, [line, '{malformed', 'token=abc123'], '2026-10-14T00:00:10.000Z');

    const result = await run(['--show', path]);

    expect(result).toEqual({ code: 0, output: [`${provider[0].toUpperCase()}${provider.slice(1)} final`] });
  });

  it('rejects ambiguous capture leaves and accepts a step-qualified capture', async () => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const build = await capture('shared-capture', 'codex', [JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Build final' }] } })], '2026-10-14T00:00:10.000Z');
    const review = await capture('shared-capture', 'claude', [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Review final' }] } })], '2026-10-14T00:00:20.000Z', 'build_review');

    expect(await run(['--show', 'shared-capture'])).toEqual({
      code: 1,
      output: [`ambiguous capture «shared-capture»: ${review}, ${build}`],
    });
    expect(await run(['--show', 'build/shared-capture'])).toEqual({ code: 0, output: ['Build final'] });
  });

  it('reports absent worktrees, empty retained lists, and unreadable assistant messages without writing', async () => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const unknown = detectTranscriptsCommand(['node', 'ai-conductor', 'transcripts', 'missing']);
    if (!unknown) throw new Error('unknown slug command was not detected');
    const absentOutput: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((value: string) => { absentOutput.push(value); });
    expect(await dispatchTranscripts(unknown, repo)).toBe(1);
    error.mockRestore();
    expect(absentOutput).toEqual(['no feature worktree for missing']);

    await mkdir(join(repo, '.worktrees', slug, '.pipeline'), { recursive: true });
    await writeFile(join(repo, '.worktrees', slug, '.pipeline', 'events.jsonl'), '');
    const worktree = join(repo, '.worktrees', slug);
    const before = await snapshot(worktree);
    expect(await run([])).toEqual({ code: 0, output: [`no retained transcripts for ${slug}`] });
    expect(await snapshot(worktree)).toEqual(before);
  });

  it.each(['..', '../other', 'a/b', '.'])('rejects path-escaping slug %s without reading its retained captures', async (invalidSlug) => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const escapedWorktree = invalidSlug === '../other'
      ? join(repo, 'other')
      : invalidSlug === 'a/b'
        ? join(repo, '.worktrees', 'a', 'b')
        : invalidSlug === '.'
          ? join(repo, '.worktrees')
          : repo;
    const escapedCapture = join(escapedWorktree, '.pipeline', 'transcripts', 'build', 'escaped', 'sessions', '2026', '10', '14', 'session.jsonl');
    await mkdir(join(escapedCapture, '..'), { recursive: true });
    await writeFile(escapedCapture, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'escaped capture' }] } }));
    await writeFile(
      join(escapedWorktree, '.pipeline', 'events.jsonl'),
      `${JSON.stringify({ type: 'provider_transcripts_captured', ts: '2026-10-14T00:00:10.000Z', step: 'build', runId: 'escaped', attempt: 1, member: 'codex-member', provider: 'codex', path: '.pipeline/transcripts/build/escaped', files: 1, bytes: 1, interrupted: false, skipped: 0, omittedLines: 0 })}\n${JSON.stringify({ type: 'provider_transcripts_retained', ts: '2026-10-14T00:00:10.000Z', path: '.pipeline/transcripts/build/escaped' })}\n`,
    );

    expect(await runForSlug(invalidSlug)).toEqual({
      code: 1,
      output: [`no feature worktree for ${invalidSlug}`],
    });
  });

  it('rejects empty and assistant-free captures while redacting a hand-placed token without writing', async () => {
    repo = await mkdtemp(join(tmpdir(), 'transcripts-cli-'));
    const empty = await capture('empty-capture', 'codex', [], '2026-10-14T00:00:10.000Z');
    const noAssistant = await capture('no-assistant-capture', 'pi', [JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'question' }] } })], '2026-10-14T00:00:20.000Z');
    const token = await capture('token-capture', 'claude', [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'token=abc123' }] } })], '2026-10-14T00:00:30.000Z');
    const worktree = join(repo, '.worktrees', slug);
    const before = await snapshot(worktree);

    expect(await run(['--show', empty])).toEqual({ code: 1, output: [`no assistant message in ${empty}`] });
    expect(await run(['--show', noAssistant])).toEqual({ code: 1, output: [`no assistant message in ${noAssistant}`] });
    expect(await run(['--show', token])).toEqual({ code: 0, output: ['token=[REDACTED]'] });
    expect(await snapshot(worktree)).toEqual(before);
  });
});
