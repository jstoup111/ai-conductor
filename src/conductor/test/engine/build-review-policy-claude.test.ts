// Covers: task:5
import { describe, expect, it } from 'vitest';

import {
  discoverClaudeReviewPolicies,
  type ClaudeReviewPolicyFilesystem,
} from '../../src/engine/build-review-policy-claude.js';

function fakeFilesystem(): ClaudeReviewPolicyFilesystem {
  const directories: Record<string, readonly string[]> = {
    '/prepared/project/.claude/skills': ['project-review'],
    '/prepared/user/skills': ['global-review'],
    '/prepared/plugins/quality/review-skills': ['quality-review'],
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
  };
  const canonical: Record<string, string> = {
    '/prepared/project/.claude/skills/project-review': '/canonical/project-review',
    '/prepared/user/skills/global-review': '/canonical/global-review',
    '/prepared/plugins/quality': '/canonical/plugin-quality',
    '/prepared/plugins/quality/review-skills/quality-review': '/canonical/plugin-quality/review-skills/quality-review',
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
});
