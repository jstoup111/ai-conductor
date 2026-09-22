import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createCodexAppServerTransport,
  listCodexInstalledReviewSkills,
  type CodexAppServerTransport,
} from '../../src/engine/build-review-policy-codex.js';

describe('listCodexInstalledReviewSkills', () => {
  it('uses the prepared app-server catalog and maps enabled local project, global, and plugin skills', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'skills/list') {
        return {
          data: [{
            cwd: '/candidate',
            errors: [],
            skills: [
              {
                name: 'project-policy',
                path: '/candidate/.codex/skills/project-policy/SKILL.md',
                scope: 'repo',
                enabled: true,
                pluginId: null,
                dependencies: { tools: [{ value: 'git' }] },
              },
              {
                name: 'global-policy',
                path: '/prepared-home/skills/global-policy/SKILL.md',
                scope: 'user',
                enabled: true,
                pluginId: null,
              },
              {
                name: 'plugin-policy',
                path: '/prepared-home/plugins/org-review/skills/plugin-policy/SKILL.md',
                scope: 'user',
                enabled: true,
                pluginId: 'org-review',
              },
              {
                name: 'disabled-policy',
                path: '/candidate/.codex/skills/disabled-policy/SKILL.md',
                scope: 'repo',
                enabled: false,
                pluginId: null,
              },
            ],
          }],
        };
      }
      return {
        plugin: {
          summary: {
            id: 'org-review',
            installed: true,
            enabled: true,
            availability: 'AVAILABLE',
            localVersion: '1.2.3',
            source: { type: 'local', path: '/prepared-home/plugins/org-review' },
          },
        },
      };
    });
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ request, close }));
    const transport: CodexAppServerTransport = { open };

    await expect(listCodexInstalledReviewSkills(transport, {
      cwd: '/candidate',
      home: '/prepared-home',
      env: {},
    })).resolves.toEqual([
      {
        semanticName: 'project-policy',
        source: 'project',
        installationOrigin: '/candidate/.codex/skills/project-policy/SKILL.md',
        canonicalSkillPath: '/candidate/.codex/skills/project-policy/SKILL.md',
        packageRoot: '/candidate/.codex/skills/project-policy',
        requiredTools: ['git'],
        declaredDependencies: [],
        availability: 'available',
      },
      {
        semanticName: 'global-policy',
        source: 'global',
        installationOrigin: '/prepared-home/skills/global-policy/SKILL.md',
        canonicalSkillPath: '/prepared-home/skills/global-policy/SKILL.md',
        packageRoot: '/prepared-home/skills/global-policy',
        declaredDependencies: [],
        availability: 'available',
      },
      {
        semanticName: 'plugin-policy',
        source: 'plugin',
        plugin: { id: 'org-review', version: '1.2.3' },
        installationOrigin: '/prepared-home/plugins/org-review/skills/plugin-policy/SKILL.md',
        canonicalSkillPath: '/prepared-home/plugins/org-review/skills/plugin-policy/SKILL.md',
        packageRoot: '/prepared-home/plugins/org-review',
        declaredDependencies: [],
        availability: 'available',
      },
      {
        semanticName: 'disabled-policy',
        source: 'project',
        installationOrigin: '/candidate/.codex/skills/disabled-policy/SKILL.md',
        canonicalSkillPath: '/candidate/.codex/skills/disabled-policy/SKILL.md',
        packageRoot: '/candidate/.codex/skills/disabled-policy',
        declaredDependencies: [],
        availability: 'disabled',
      },
    ]);

    expect(open).toHaveBeenCalledWith({ cwd: '/candidate', home: '/prepared-home', env: {} });
    expect(request).toHaveBeenNthCalledWith(1, 'skills/list', {
      cwds: ['/candidate'],
      forceReload: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, 'plugin/read', { pluginName: 'org-review' });
    expect(request.mock.calls.map(([method]) => method)).toEqual(['skills/list', 'plugin/read']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains disabled and remote plugin selections as unavailable descriptors without making them eligible', async () => {
    const request = vi.fn(async (method: string, params?: { pluginName?: string }) => {
      if (method === 'skills/list') return { data: [{ cwd: '/candidate', errors: [], skills: [
        { name: 'disabled-policy', path: '/candidate/.codex/skills/disabled-policy/SKILL.md', scope: 'repo', enabled: false, pluginId: null },
        { name: 'disabled-plugin-policy', path: '/prepared-home/plugins/disabled/skills/policy/SKILL.md', scope: 'user', enabled: true, pluginId: 'disabled' },
        { name: 'remote-plugin-policy', path: '/catalog/remote/skills/policy/SKILL.md', scope: 'user', enabled: true, pluginId: 'remote' },
      ] }] };
      return { plugin: { summary: params?.pluginName === 'disabled'
        ? { id: 'disabled', installed: true, enabled: false, availability: 'DISABLED_BY_ADMIN', localVersion: '1.0.0', source: { type: 'local', path: '/prepared-home/plugins/disabled' } }
        : { id: 'remote', installed: false, enabled: true, availability: 'AVAILABLE', localVersion: null, source: { type: 'remote' } },
      } };
    });
    const transport: CodexAppServerTransport = { open: vi.fn(async () => ({ request, close: async () => {} })) };

    await expect(listCodexInstalledReviewSkills(transport, { cwd: '/candidate', home: '/prepared-home', env: {} })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticName: 'disabled-policy', availability: 'disabled' }),
      expect.objectContaining({ semanticName: 'disabled-plugin-policy', plugin: { id: 'disabled', version: '1.0.0' }, availability: 'disabled' }),
      expect.objectContaining({ semanticName: 'remote-plugin-policy', plugin: { id: 'remote' }, availability: 'marketplace-only' }),
    ]));
  });

  it('spawns the app server with the candidate prepared environment and executable only', async () => {
    const stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
    const stdout = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });
    let spawnOptions: { readonly cwd: string; readonly env: NodeJS.ProcessEnv } | undefined;
    const launch = vi.fn((_executable: string, _args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }) => {
      spawnOptions = options;
      return child as never;
    });
    const transport = createCodexAppServerTransport('codex', launch as never);
    const preparedEnv = { CODEX_HOME: '/prepared/home', PREPARED_ONLY: 'yes' };
    const savedAmbient = process.env.AMBIENT_ONLY;
    process.env.AMBIENT_ONLY = 'must-not-leak';

    try {
      const session = await transport.open({ cwd: '/candidate', home: '/prepared/home', env: preparedEnv, executable: '/private/codex' });
      expect(launch).toHaveBeenCalledWith('/private/codex', ['app-server'], expect.objectContaining({ cwd: '/candidate', env: preparedEnv }));
      expect(spawnOptions?.env).not.toHaveProperty('AMBIENT_ONLY');
      await session.close();
    } finally {
      if (savedAmbient === undefined) delete process.env.AMBIENT_ONLY; else process.env.AMBIENT_ONLY = savedAmbient;
    }
  });
});
