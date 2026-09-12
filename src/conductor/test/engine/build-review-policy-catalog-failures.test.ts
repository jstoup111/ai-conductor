// Covers: task:6
import { describe, expect, it, vi } from 'vitest';

import {
  listCodexInstalledReviewSkills,
  type CodexAppServerTransport,
} from '../../src/engine/build-review-policy-codex.js';
import {
  discoverClaudeReviewPolicies,
  type ClaudeReviewPolicyFilesystem,
} from '../../src/engine/build-review-policy-claude.js';
import {
  resolveInstalledReviewPolicyCatalog,
  ReviewPolicyCatalogError,
} from '../../src/engine/build-review-policy-resolver.js';

const candidate = {
  cwd: '/prepared/project',
  env: {},
  projectSkillRoots: ['/prepared/project/.claude/skills'],
  userSkillRoots: ['/prepared/user/skills'],
};

function emptyClaudeFilesystem(): ClaudeReviewPolicyFilesystem {
  return {
    async readdir() { return []; },
    async readFile() { throw new Error('ENOENT'); },
    async realpath(path) { return path; },
  };
}

describe('engine/build-review-policy catalog failures', () => {
  it('rejects a successful-but-partial Codex catalog, closes its session, and never exposes absence', async () => {
    const request = vi.fn(async () => ({
      data: [{
        cwd: '/prepared/project',
        skills: [],
        errors: [{ message: 'some skill roots could not be inspected' }],
      }],
    }));
    const close = vi.fn(async () => undefined);
    const transport: CodexAppServerTransport = {
      open: vi.fn(async () => ({ request, close })),
    };

    await expect(listCodexInstalledReviewSkills(transport, {
      cwd: '/prepared/project',
      home: '/prepared/home',
    })).rejects.toMatchObject({
      name: 'ReviewPolicyCatalogError',
      code: 'error',
      provider: 'codex',
    });

    expect(request).toHaveBeenCalledWith('skills/list', {
      cwds: ['/prepared/project'],
      forceReload: true,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ['error-bearing', JSON.stringify({ plugins: [], errors: [{ message: 'permission denied' }] }), 'error'],
    ['malformed', '{', 'malformed'],
    ['unsupported', JSON.stringify({ plugins: 'not-an-array' }), 'unsupported'],
  ] as const)('rejects Claude %s metadata without treating it as an empty catalog', async (
    _name,
    stdout,
    code,
  ) => {
    const command = vi.fn(async () => ({ stdout }));

    await expect(discoverClaudeReviewPolicies({
      candidate,
      command,
      filesystem: emptyClaudeFilesystem(),
    })).rejects.toMatchObject({
      name: 'ReviewPolicyCatalogError',
      code,
      provider: 'claude',
    });

    expect(command).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], {
      cwd: '/prepared/project',
      env: {},
    });
  });

  it.each([
    ['partial-success', async (controller: AbortController) => ({
      data: [{ cwd: '/prepared/project', skills: [], errors: [], complete: false }],
    }), undefined, 'partial'],
    ['malformed', async (controller: AbortController) => ({ data: 'not-an-array' }), undefined, 'malformed'],
    ['unsupported', async (controller: AbortController) => ({ version: 2, data: [] }), undefined, 'unsupported'],
    ['unreadable', async (controller: AbortController) => { throw new Error('EACCES: permission denied'); }, undefined, 'unreadable'],
    ['timeout', async (controller: AbortController) => { const error = new Error('deadline'); error.name = 'TimeoutError'; throw error; }, undefined, 'timeout'],
    ['cancelled', async (controller: AbortController) => { controller.abort(); return { data: [] }; }, undefined, 'cancelled'],
  ] as const)('closes the Codex session after %s catalog discovery failure', async (
    _name,
    response,
    _unused,
    code,
  ) => {
    const controller = new AbortController();
    const request = vi.fn(async () => response(controller));
    const close = vi.fn(async () => undefined);
    const transport: CodexAppServerTransport = {
      open: vi.fn(async () => ({ request, close })),
    };

    await expect(listCodexInstalledReviewSkills(transport, {
      cwd: '/prepared/project',
      home: '/prepared/home',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'ReviewPolicyCatalogError', provider: 'codex', code });

    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ['partial-success', async () => ({ stdout: JSON.stringify([]), complete: false, exitCode: 0 }), undefined, 'partial'],
    ['permission failure', async () => ({ stdout: JSON.stringify([]) }), {
      async readdir() { throw new Error('EACCES: permission denied'); },
      async readFile() { throw new Error('ENOENT'); },
      async realpath(path: string) { return path; },
    }, 'unreadable'],
    ['timeout', async () => { const error = new Error('deadline'); error.name = 'TimeoutError'; throw error; }, undefined, 'timeout'],
  ] as const)('classifies Claude %s without a real host command', async (
    _name,
    command,
    filesystem,
    code,
  ) => {
    const fakeCommand = vi.fn(command);
    await expect(discoverClaudeReviewPolicies({
      candidate,
      command: fakeCommand,
      filesystem: filesystem ?? emptyClaudeFilesystem(),
    })).rejects.toMatchObject({ name: 'ReviewPolicyCatalogError', provider: 'claude', code });
    expect(fakeCommand).toHaveBeenCalledOnce();
  });

  it('cancels Claude discovery through the injected candidate signal', async () => {
    const controller = new AbortController();
    const command = vi.fn(async (_command: string, _args: readonly string[], options: { signal?: AbortSignal }) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return { stdout: JSON.stringify([]) };
    });

    await expect(discoverClaudeReviewPolicies({
      candidate: { ...candidate, signal: controller.signal },
      command,
      filesystem: emptyClaudeFilesystem(),
    })).rejects.toMatchObject({ name: 'ReviewPolicyCatalogError', provider: 'claude', code: 'cancelled' });
  });

  it('keeps a catalog loading failure terminal instead of running a policy judge, cache, or unavailable-provider fallback', () => {
    const judge = vi.fn();
    const cache = vi.fn();
    const providerFallback = vi.fn();
    const resolution = resolveInstalledReviewPolicyCatalog(
      { skill: 'review-policy', source: 'project' },
      new ReviewPolicyCatalogError('codex', 'timeout', 'catalog deadline elapsed'),
    );

    if (resolution.kind === 'resolved') {
      cache();
      judge();
      providerFallback();
    }

    expect(resolution).toEqual({
      kind: 'failure',
      failure: {
        code: 'policy-load',
        provider: 'codex',
        reason: 'timeout',
        message: 'catalog deadline elapsed',
      },
    });
    expect(judge).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    expect(providerFallback).not.toHaveBeenCalled();
  });
});
