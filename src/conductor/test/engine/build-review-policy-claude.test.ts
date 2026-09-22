// Covers: task:5
import { describe, expect, it } from 'vitest';

import {
  discoverClaudeReviewPolicies,
  type ClaudeReviewPolicyFilesystem,
} from '../../src/engine/build-review-policy-claude.js';
import { resolveInstalledReviewPolicy } from '../../src/engine/build-review-policy-resolver.js';

function fakeFilesystem(): ClaudeReviewPolicyFilesystem {
  const directories: Record<string, readonly string[]> = {
    '/prepared/project/.claude/skills': ['project-review'],
    '/prepared/user/skills': ['global-review'],
    '/prepared/plugins/quality/review-skills': ['quality-review'],
    '/prepared/plugins/disabled/review-skills': ['disabled-review'],
  };
  const files: Record<string, string> = {
    '/prepared/project/.claude/skills/project-review/SKILL.md': '---\nrequires: [project-context]\n---\n',
    '/prepared/user/skills/global-review/SKILL.md': '---\n---\n',
    '/prepared/plugins/quality/.claude-plugin/plugin.json': JSON.stringify({
      name: 'quality-plugin',
      version: '1.2.3',
      skills: ['./review-skills'],
      commands: ['./commands'],
    }),
    '/prepared/plugins/quality/review-skills/quality-review/SKILL.md': '---\nrequires: [diff-context]\n---\n',
    '/prepared/plugins/disabled/.claude-plugin/plugin.json': JSON.stringify({ skills: ['./review-skills'] }),
    '/prepared/plugins/disabled/review-skills/disabled-review/SKILL.md': '---\n---\n',
  };
  const canonical: Record<string, string> = {
    '/prepared/project/.claude/skills/project-review': '/canonical/project-review',
    '/prepared/user/skills/global-review': '/canonical/global-review',
    '/prepared/plugins/quality': '/canonical/plugin-quality',
    '/prepared/plugins/quality/review-skills': '/canonical/plugin-quality/review-skills',
    '/prepared/plugins/quality/review-skills/quality-review': '/canonical/plugin-quality/review-skills/quality-review',
    '/prepared/plugins/disabled': '/canonical/plugin-disabled',
    '/prepared/plugins/disabled/review-skills': '/canonical/plugin-disabled/review-skills',
    '/prepared/plugins/disabled/review-skills/disabled-review': '/canonical/plugin-disabled/review-skills/disabled-review',
  };

  return {
    async readdir(path) {
      if (!(path in directories)) throw new Error(`ENOENT: ${path}`);
      return directories[path]!;
    },
    async readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path]!;
    },
    async realpath(path) {
      if (!(path in canonical)) throw new Error(`ENOENT: ${path}`);
      return canonical[path]!;
    },
  };
}

describe('engine/build-review-policy-claude', () => {
  it('uses the prepared Claude environment to map project, user, and enabled installed plugin skills', async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    const env = { CLAUDE_CONFIG_DIR: '/prepared/user', SAFE: '1' };

    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: '/prepared/project',
        env,
        projectSkillRoots: ['/prepared/project/.claude/skills'],
        userSkillRoots: ['/prepared/user/skills'],
      },
      command: async (command, args, options) => {
        calls.push({ command, args, ...options });
        return {
          stdout: JSON.stringify([
            { name: 'quality-plugin', enabled: true, installPath: '/prepared/plugins/quality', scope: 'user', version: '1.2.3' },
            { name: 'disabled-plugin', enabled: false, installPath: '/prepared/plugins/disabled', scope: 'user', version: '1.0.0' },
            { name: 'marketplace-only', enabled: true, scope: 'user', version: '1.0.0' },
          ]),
        };
      },
      filesystem: fakeFilesystem(),
    });

    expect(calls).toEqual([{
      command: 'claude',
      args: ['plugin', 'list', '--json'],
      cwd: '/prepared/project',
      env,
    }]);
    expect(policies).toEqual([
      {
        semanticName: 'project-review',
        source: 'project',
        installationOrigin: '/canonical/project-review',
        canonicalSkillPath: '/canonical/project-review/SKILL.md',
        packageRoot: '/canonical/project-review',
        declaredDependencies: ['project-context'],
        availability: 'available',
      },
      {
        semanticName: 'global-review',
        source: 'global',
        installationOrigin: '/canonical/global-review',
        canonicalSkillPath: '/canonical/global-review/SKILL.md',
        packageRoot: '/canonical/global-review',
        declaredDependencies: [],
        availability: 'available',
      },
      {
        semanticName: 'quality-review',
        source: 'plugin',
        plugin: { id: 'quality-plugin', version: '1.2.3' },
        installationOrigin: '/canonical/plugin-quality',
        canonicalSkillPath: '/canonical/plugin-quality/review-skills/quality-review/SKILL.md',
        packageRoot: '/canonical/plugin-quality',
        declaredDependencies: ['diff-context'],
        availability: 'available',
      },
      {
        semanticName: 'disabled-review',
        source: 'plugin',
        plugin: { id: 'disabled-plugin', version: '1.0.0' },
        installationOrigin: '/canonical/plugin-disabled',
        canonicalSkillPath: '/canonical/plugin-disabled/review-skills/disabled-review/SKILL.md',
        packageRoot: '/canonical/plugin-disabled',
        declaredDependencies: [],
        availability: 'disabled',
      },
      {
        semanticName: 'marketplace-only',
        source: 'plugin',
        plugin: { id: 'marketplace-only', version: '1.0.0' },
        installationOrigin: 'marketplace:marketplace-only',
        canonicalSkillPath: 'marketplace:marketplace-only/SKILL.md',
        packageRoot: 'marketplace:marketplace-only',
        declaredDependencies: [],
        availability: 'marketplace-only',
        pluginWide: true,
      },
    ]);
  });

  it('reads a manifest-declared skill directory without treating commands as skills', async () => {
    const filesystem: ClaudeReviewPolicyFilesystem = {
      async readdir(path) {
        if (path === '/prepared/project/.claude/skills' || path === '/prepared/user/skills') return [];
        throw new Error(`ENOENT: ${path}`);
      },
      async readFile(path) {
        if (path === '/prepared/plugins/direct/.claude-plugin/plugin.json') {
          return JSON.stringify({ name: 'direct-plugin', skills: ['./policy'], commands: ['./commands'] });
        }
        if (path === '/prepared/plugins/direct/policy/SKILL.md') return '---\nname: direct-review\n---\n';
        throw new Error(`ENOENT: ${path}`);
      },
      async realpath(path) {
        if (path === '/prepared/plugins/direct') return '/canonical/direct-plugin';
        if (path === '/prepared/plugins/direct/policy') return '/canonical/direct-plugin/policy';
        throw new Error(`ENOENT: ${path}`);
      },
    };

    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: '/prepared/project',
        env: {},
        projectSkillRoots: ['/prepared/project/.claude/skills'],
        userSkillRoots: ['/prepared/user/skills'],
      },
      command: async () => ({
        stdout: JSON.stringify([{ id: 'direct-plugin', enabled: true, installPath: '/prepared/plugins/direct', scope: 'project' }]),
      }),
      filesystem,
    });

    expect(policies).toEqual([{
      semanticName: 'direct-review',
      source: 'plugin',
      plugin: { id: 'direct-plugin' },
      installationOrigin: '/canonical/direct-plugin',
      canonicalSkillPath: '/canonical/direct-plugin/policy/SKILL.md',
      packageRoot: '/canonical/direct-plugin',
      declaredDependencies: [],
      availability: 'available',
    }]);
  });

  describe('plugin manifest skill entries that leave the installed package', () => {
    const discoverWith = async (skills: unknown, realpaths: Record<string, string> = {}) => {
      const touched: string[] = [];
      const filesystem: ClaudeReviewPolicyFilesystem = {
        async readdir(path) {
          touched.push(path);
          if (path === '/prepared/project/.claude/skills' || path === '/prepared/user/skills') return [];
          if (path === '/prepared/plugins/direct/linked') return ['inner'];
          throw new Error(`ENOENT: ${path}`);
        },
        async readFile(path) {
          touched.push(path);
          if (path === '/prepared/plugins/direct/.claude-plugin/plugin.json') return JSON.stringify({ skills });
          if (path.endsWith('/SKILL.md') && !path.startsWith('/prepared/project') && !path.startsWith('/prepared/user')) return '---\nname: leaked\n---\n';
          throw new Error(`ENOENT: ${path}`);
        },
        async realpath(path) {
          if (path === '/prepared/plugins/direct') return '/canonical/direct-plugin';
          if (path in realpaths) return realpaths[path]!;
          if (path.startsWith('/prepared/plugins/direct/')) return path.replace('/prepared/plugins/direct', '/canonical/direct-plugin');
          return path;
        },
      };
      const promise = discoverClaudeReviewPolicies({
        candidate: { cwd: '/prepared/project', env: {}, projectSkillRoots: ['/prepared/project/.claude/skills'], userSkillRoots: ['/prepared/user/skills'] },
        command: async () => ({ stdout: JSON.stringify([{ id: 'direct-plugin', enabled: true, installPath: '/prepared/plugins/direct', scope: 'project' }]) }),
        filesystem,
      });
      return { promise, touched };
    };
    const outside = (touched: readonly string[]) => touched.filter((path) => (
      !path.startsWith('/prepared/plugins/direct/') && !path.startsWith('/prepared/project/') && !path.startsWith('/prepared/user/')
    ));

    it.each([
      ['a parent traversal', ['./../../..']],
      ['a traversal hidden mid-path', ['./skills/../../other-plugin']],
      ['a traversal given as a bare string', './..'],
      ['an absolute entry', ['/etc']],
    ])('rejects %s as a malformed manifest without reading outside the package', async (_label, skills) => {
      const { promise, touched } = await discoverWith(skills);
      await expect(promise).rejects.toMatchObject({
        provider: 'claude', code: 'malformed',
        message: expect.stringContaining('/prepared/plugins/direct/.claude-plugin/plugin.json'),
      });
      expect(outside(touched)).toEqual([]);
    });

    it('rejects a skill directory that is a symlink out of the package', async () => {
      const { promise, touched } = await discoverWith(['./linked'], { '/prepared/plugins/direct/linked': '/home/operator/.ssh' });
      await expect(promise).rejects.toMatchObject({ provider: 'claude', code: 'malformed' });
      expect(touched).not.toContain('/prepared/plugins/direct/linked/SKILL.md');
      expect(touched).not.toContain('/prepared/plugins/direct/linked');
    });

    it('rejects a nested skill that is a symlink out of the package', async () => {
      const { promise, touched } = await discoverWith(['./linked'], { '/prepared/plugins/direct/linked/inner': '/home/operator/secret' });
      await expect(promise).rejects.toMatchObject({ provider: 'claude', code: 'malformed' });
      expect(touched).not.toContain('/prepared/plugins/direct/linked/inner/SKILL.md');
    });

    it('still discovers a normal ./skills style entry', async () => {
      const { promise } = await discoverWith(['./linked']);
      expect((await promise).map((policy) => policy.canonicalSkillPath)).toEqual([
        '/canonical/direct-plugin/linked/SKILL.md', '/canonical/direct-plugin/linked/inner/SKILL.md',
      ]);
    });
  });

  it('retains disabled and marketplace-only plugin selections as unavailable and never activates unrelated components', async () => {
    const filesystem = fakeFilesystem();
    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: '/prepared/project', env: {}, projectSkillRoots: ['/prepared/project/.claude/skills'], userSkillRoots: ['/prepared/user/skills'],
      },
      command: async () => ({ stdout: JSON.stringify([
        { id: 'quality-plugin', enabled: false, installPath: '/prepared/plugins/quality', scope: 'user', version: '1.2.3' },
        { id: 'marketplace-only', enabled: true, scope: 'user', version: '1.0.0' },
      ]) }),
      filesystem,
    });

    expect(policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticName: 'quality-review', plugin: { id: 'quality-plugin', version: '1.2.3' }, availability: 'disabled' }),
      expect.objectContaining({ semanticName: 'marketplace-only', plugin: { id: 'marketplace-only', version: '1.0.0' }, availability: 'marketplace-only' }),
    ]));
    expect(policies.filter((policy) => policy.source === 'plugin' && policy.availability === 'available')).toEqual([]);
  });

  it('resolves a plugin-qualified selection of a listing-only plugin to its typed unavailable diagnosis', async () => {
    const policies = await discoverClaudeReviewPolicies({
      candidate: { cwd: '/prepared/project', env: {}, projectSkillRoots: [], userSkillRoots: [] },
      command: async () => ({ stdout: JSON.stringify([
        { id: 'market-plugin', enabled: true, scope: 'user', version: '1.0.0' },
        { id: 'off-plugin', enabled: false, scope: 'user' },
      ]) }),
      filesystem: fakeFilesystem(),
    });

    expect(resolveInstalledReviewPolicy({ skill: 'market-plugin:deep-review' }, policies)).toEqual({
      kind: 'failure',
      failure: { code: 'marketplace-only', skill: 'market-plugin:deep-review' },
    });
    expect(resolveInstalledReviewPolicy({ skill: 'off-plugin:deep-review', source: 'plugin' }, policies)).toEqual({
      kind: 'failure',
      failure: { code: 'disabled', skill: 'off-plugin:deep-review', source: 'plugin' },
    });
    expect(resolveInstalledReviewPolicy({ skill: 'other-plugin:deep-review' }, policies)).toEqual({
      kind: 'failure',
      failure: { code: 'absent', skill: 'other-plugin:deep-review' },
    });
    expect(resolveInstalledReviewPolicy({ skill: 'deep-review' }, policies)).toEqual({
      kind: 'failure',
      failure: { code: 'absent', skill: 'deep-review' },
    });
  });
});
