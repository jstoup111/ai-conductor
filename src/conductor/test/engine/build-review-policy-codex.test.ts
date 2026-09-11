import { describe, expect, it, vi } from 'vitest';
import {
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
    })).resolves.toEqual([
      {
        semanticName: 'project-policy',
        source: 'project',
        installationOrigin: '/candidate/.codex/skills/project-policy/SKILL.md',
        canonicalSkillPath: '/candidate/.codex/skills/project-policy/SKILL.md',
        packageRoot: '/candidate/.codex/skills/project-policy',
        declaredDependencies: ['git'],
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
        packageRoot: '/prepared-home/plugins/org-review/skills/plugin-policy',
        declaredDependencies: [],
        availability: 'available',
      },
    ]);

    expect(open).toHaveBeenCalledWith({ cwd: '/candidate', home: '/prepared-home' });
    expect(request).toHaveBeenNthCalledWith(1, 'skills/list', {
      cwds: ['/candidate'],
      forceReload: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, 'plugin/read', { pluginName: 'org-review' });
    expect(request.mock.calls.map(([method]) => method)).toEqual(['skills/list', 'plugin/read']);
    expect(close).toHaveBeenCalledOnce();
  });
});
