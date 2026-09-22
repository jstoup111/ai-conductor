// Covers: task:21
import { describe, expect, it, vi } from 'vitest';

import { productionBuildReviewPolicyCatalog } from '../../src/engine/step-runners.js';
import { createCodexAppServerTransport } from '../../src/engine/build-review-policy-codex.js';

const entry = { id: 'portable', kind: 'custom' } as never;

describe('production installed-policy catalog under a self-host prepared candidate', () => {
  it('runs Claude discovery against the explicitly mapped original catalog home', async () => {
    const command = vi.fn(async () => ({ stdout: '[]', exitCode: 0 }));
    const listed: string[] = [];
    const catalog = productionBuildReviewPolicyCatalog('/project', {
      claudeCommand: command,
      claudeFilesystem: {
        readdir: async (path: string) => { listed.push(path); return []; },
        readFile: async () => { throw Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' }); },
      } as never,
    });
    await catalog({
      provider: 'claude', entry,
      preparedEnv: { CLAUDE_CONFIG_DIR: '/scratch/throwaway', PATH: '/bin' },
      originalCatalogHome: '/operator/.claude',
    });
    expect(command).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], expect.objectContaining({
      env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/operator/.claude', PATH: '/bin' }),
    }));
    expect(listed).toEqual(expect.arrayContaining(['/operator/.claude/skills']));
  });

  it('keeps the prepared home when preparation mapped no original root', async () => {
    const command = vi.fn(async (_file: string, _args: readonly string[], _options: { env: Record<string, string | undefined> }) => ({ stdout: '[]', exitCode: 0 }));
    const catalog = productionBuildReviewPolicyCatalog('/project', { claudeCommand: command, claudeFilesystem: { readdir: async () => [], readFile: async () => { throw Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' }); } } as never });
    await catalog({ provider: 'claude', entry, preparedEnv: { CLAUDE_CONFIG_DIR: '/prepared/home' } });
    expect(command.mock.calls[0]![2]!.env.CLAUDE_CONFIG_DIR).toBe('/prepared/home');
  });

  it('launches Codex discovery through the whole prepared invocation with the original catalog home', async () => {
    const launches: Array<{ executable: string; args: readonly string[]; home: string | undefined }> = [];
    const launch = ((executable: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
      launches.push({ executable, args, home: options.env.CODEX_HOME });
      throw new Error('stop at the mocked process boundary');
    }) as never;
    const catalog = productionBuildReviewPolicyCatalog('/project', { codexTransport: createCodexAppServerTransport('codex', launch) });
    const prepared = ['--dev-bind', '/', '/', '--', '/isolated/codex'];
    await expect(catalog({
      provider: 'codex', entry,
      preparedEnv: { CODEX_HOME: '/scratch/throwaway' }, preparedExecutable: 'bwrap', preparedArgs: prepared,
      originalCatalogHome: '/operator/.codex',
    })).rejects.toThrow();
    // The prepared pass runs first and keeps the containment wrap intact.
    expect(launches).toEqual([{ executable: 'bwrap', args: [...prepared, 'app-server'], home: '/scratch/throwaway' }]);
  });

  it('merges the mapped original Codex catalog behind the prepared one', async () => {
    const homes: Array<string | undefined> = [];
    const skill = (name: string, path: string) => ({ name, path, scope: 'user', enabled: true, pluginId: null });
    const codexTransport = { open: async (environment: { env: NodeJS.ProcessEnv; cwd: string }) => {
      homes.push(environment.env.CODEX_HOME);
      const original = environment.env.CODEX_HOME === '/operator/.codex';
      return {
        request: async () => ({ data: [{ cwd: environment.cwd, errors: [], skills: original
          ? [skill('shared', '/operator/.codex/skills/shared/SKILL.md'), skill('operator-only', '/operator/.codex/skills/operator-only/SKILL.md')]
          : [skill('shared', '/scratch/throwaway/skills/shared/SKILL.md')] }] }),
        close: async () => {},
      };
    } } as never;
    const catalog = productionBuildReviewPolicyCatalog('/project', { codexTransport });
    const skills = await catalog({ provider: 'codex', entry, preparedEnv: { CODEX_HOME: '/scratch/throwaway' }, originalCatalogHome: '/operator/.codex' });
    expect(homes).toEqual(['/scratch/throwaway', '/operator/.codex']);
    expect(skills.map((found) => found.canonicalSkillPath)).toEqual([
      '/scratch/throwaway/skills/shared/SKILL.md', '/operator/.codex/skills/operator-only/SKILL.md',
    ]);
  });
});
