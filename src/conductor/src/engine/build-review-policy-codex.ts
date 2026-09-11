import type { InstalledReviewSkill } from './build-review-policy.js';
import { dirname } from 'node:path';

export interface CodexPreparedCatalogEnvironment {
  readonly cwd: string;
  readonly home: string;
}

export interface CodexSkillMetadata {
  readonly name: string;
  readonly path: string;
  readonly scope: 'user' | 'repo' | 'system' | 'admin';
  readonly enabled: boolean;
  readonly pluginId: string | null;
  readonly dependencies?: { readonly tools: readonly { readonly value: string }[] };
}

export interface CodexSkillsListResponse {
  readonly data: readonly {
    readonly cwd: string;
    readonly skills: readonly CodexSkillMetadata[];
    readonly errors: readonly unknown[];
  }[];
}

export interface CodexPluginDescriptor {
  readonly id: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly availability: 'AVAILABLE' | 'DISABLED_BY_ADMIN';
  readonly localVersion: string | null;
  readonly source: { readonly type: 'local'; readonly path: string } | { readonly type: 'remote' };
}

export interface CodexPluginReadResponse {
  readonly plugin: { readonly summary: CodexPluginDescriptor };
}

export interface CodexAppServerSession {
  request(
    method: 'skills/list',
    params: { readonly cwds: readonly string[]; readonly forceReload: true },
  ): Promise<CodexSkillsListResponse>;
  request(
    method: 'plugin/read',
    params: { readonly pluginName: string },
  ): Promise<CodexPluginReadResponse>;
  close(): Promise<void>;
}

/** Injected process boundary for the local, metadata-only Codex app server. */
export interface CodexAppServerTransport {
  open(environment: CodexPreparedCatalogEnvironment): Promise<CodexAppServerSession>;
}

/**
 * Read only the skills already visible to Codex in one prepared candidate.
 * Later tasks add envelope-failure classification and caller integration.
 */
export async function listCodexInstalledReviewSkills(
  transport: CodexAppServerTransport,
  environment: CodexPreparedCatalogEnvironment,
): Promise<readonly InstalledReviewSkill[]> {
  const session = await transport.open(environment);
  try {
    const response = await session.request('skills/list', {
      cwds: [environment.cwd],
      forceReload: true,
    });
    const entry = response.data.find((candidate) => candidate.cwd === environment.cwd);
    if (!entry) return [];

    const pluginIds = [...new Set(entry.skills
      .map((skill) => skill.pluginId)
      .filter((pluginId): pluginId is string => pluginId !== null))]
      .sort((left, right) => left.localeCompare(right));
    const plugins = new Map<string, CodexPluginDescriptor>();
    for (const pluginId of pluginIds) {
      const plugin = await session.request('plugin/read', { pluginName: pluginId });
      plugins.set(pluginId, plugin.plugin.summary);
    }

    return entry.skills.flatMap((skill): InstalledReviewSkill[] => {
      if (!skill.enabled) return [];
      const plugin = skill.pluginId === null ? undefined : plugins.get(skill.pluginId);
      if (skill.pluginId !== null && !isEnabledLocalPlugin(plugin)) return [];

      const source = plugin === undefined ? sourceForScope(skill.scope) : 'plugin';
      if (source === undefined) return [];
      return [{
        semanticName: skill.name,
        source,
        ...(plugin === undefined
          ? {}
          : { plugin: { id: plugin.id, ...(plugin.localVersion === null ? {} : { version: plugin.localVersion }) } }),
        installationOrigin: skill.path,
        canonicalSkillPath: skill.path,
        packageRoot: dirname(skill.path),
        declaredDependencies: skill.dependencies?.tools.map((dependency) => dependency.value) ?? [],
        availability: 'available',
      }];
    });
  } finally {
    await session.close();
  }
}

function sourceForScope(scope: CodexSkillMetadata['scope']): InstalledReviewSkill['source'] | undefined {
  if (scope === 'repo') return 'project';
  if (scope === 'user') return 'global';
  return undefined;
}

function isEnabledLocalPlugin(
  plugin: CodexPluginDescriptor | undefined,
): plugin is CodexPluginDescriptor & { readonly source: { readonly type: 'local'; readonly path: string } } {
  return plugin?.installed === true
    && plugin.enabled === true
    && plugin.availability === 'AVAILABLE'
    && plugin.source.type === 'local';
}
