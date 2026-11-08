// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';

const argv = (...args: string[]) => ['node', 'ai-conductor', 'compose', ...args];

describe('compose checkpoint CLI', () => {
  it('Covers: Task 3 parses --worktree, --step, exactly one state flag, and optional notes file', () => {
    expect(detectEngineerCommand(argv('checkpoint', '--worktree', '/w', '--step', 'explore', '--accept', '--notes-file', '/notes.json')))
      .toEqual({ kind: 'checkpoint', worktree: '/w', step: 'explore', state: 'accepted', notesFile: '/notes.json' });
    expect(detectEngineerCommand(argv('checkpoint', '--worktree', '/w', '--step', 'explore', '--accept', '--draft'))).toEqual({ kind: 'guide' });
  });

  it('Covers: Task 3 dispatches checkpoint through its injected boundary and reports local checkpoint success', async () => {
    const checkpoint = vi.fn(async () => ({ slug: 'demo', state: 'accepted' as const, committed: true, published: false }));
    const output: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'checkpoint', worktree: '/w', step: 'explore', state: 'accepted' },
      { checkpoint, print: (line) => output.push(line), probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }) },
    );
    expect(code).toBe(0);
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ worktree: '/w', step: 'explore', state: 'accepted' }));
    expect(output).toContain(JSON.stringify({ kind: 'checkpoint', slug: 'demo', state: 'accepted', committed: true, published: false }));
  });
});
