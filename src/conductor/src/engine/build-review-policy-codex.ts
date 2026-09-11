import type { InstalledReviewSkill } from './build-review-policy.js';
import { dirname } from 'node:path';
import {
  ReviewPolicyCatalogError,
  type ReviewPolicyCatalogFailureCode,
} from './build-review-policy-resolver.js';

export interface CodexPreparedCatalogEnvironment {
  readonly cwd: string;
  readonly home: string;
  /** The owning candidate cancels discovery and its app-server session. */
  readonly signal?: AbortSignal;
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
  readonly version?: 1;
  readonly data: readonly {
    readonly cwd: string;
    readonly skills: readonly CodexSkillMetadata[];
    readonly errors: readonly unknown[];
    readonly complete?: boolean;
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

function catalogError(
  code: ReviewPolicyCatalogFailureCode,
  message: string,
): ReviewPolicyCatalogError {
  return new ReviewPolicyCatalogError('codex', code, message);
}

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw catalogError('cancelled', 'Codex policy catalog discovery was cancelled');
}

function failureCode(error: unknown, signal: AbortSignal | undefined): ReviewPolicyCatalogFailureCode {
  if (error instanceof ReviewPolicyCatalogError) return error.code;
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return 'cancelled';
  if (error instanceof Error && /timeout/i.test(error.name)) return 'timeout';
  if (typeof error === 'object' && error !== null && typeof (error as { exitCode?: unknown }).exitCode === 'number') {
    return 'error';
  }
  return 'unreadable';
}

function asCatalogError(error: unknown, signal: AbortSignal | undefined): ReviewPolicyCatalogError {
  if (error instanceof ReviewPolicyCatalogError) return error;
  return catalogError(failureCode(error, signal), `Unable to load Codex policy catalog: ${String(error)}`);
}

function requireCodexCatalogResponse(
  response: CodexSkillsListResponse,
  cwd: string,
): CodexSkillsListResponse['data'][number] {
  if (!response || typeof response !== 'object' || !Array.isArray(response.data)) {
    throw catalogError('malformed', 'Malformed Codex skills/list response');
  }
  if (response.version !== undefined && response.version !== 1) {
    throw catalogError('unsupported', `Unsupported Codex skills/list response version ${String(response.version)}`);
  }
  const entry = response.data.find((candidate) => candidate?.cwd === cwd);
  if (!entry) throw catalogError('partial', `Codex skills/list response omitted requested cwd ${cwd}`);
  if (!Array.isArray(entry.skills) || !Array.isArray(entry.errors)) {
    throw catalogError('malformed', 'Malformed Codex skills/list catalog entry');
  }
  if (entry.complete === false) throw catalogError('partial', 'Codex skills/list response was partial');
  if (entry.errors.length > 0) throw catalogError('error', 'Codex skills/list response reported catalog errors');
  return entry;
}

function requireCodexSkill(skill: CodexSkillMetadata): void {
  if (!skill || typeof skill.name !== 'string' || typeof skill.path !== 'string'
    || !['user', 'repo', 'system', 'admin'].includes(skill.scope)
    || typeof skill.enabled !== 'boolean'
    || (skill.pluginId !== null && typeof skill.pluginId !== 'string')
    || (skill.dependencies !== undefined && (!skill.dependencies
      || !Array.isArray(skill.dependencies.tools)
      || skill.dependencies.tools.some((tool) => !tool || typeof tool.value !== 'string')))) {
    throw catalogError('malformed', 'Malformed Codex skill metadata');
  }
}

function requireCodexPlugin(
  plugin: CodexPluginReadResponse,
  pluginId: string,
): CodexPluginDescriptor {
  const summary = plugin?.plugin?.summary;
  if (!summary || typeof summary.id !== 'string' || typeof summary.installed !== 'boolean'
    || typeof summary.enabled !== 'boolean'
    || !['AVAILABLE', 'DISABLED_BY_ADMIN'].includes(summary.availability)
    || (summary.localVersion !== null && typeof summary.localVersion !== 'string')
    || !summary.source || typeof summary.source !== 'object'
    || !['local', 'remote'].includes(summary.source.type)
    || (summary.source.type === 'local' && typeof summary.source.path !== 'string')) {
    throw catalogError('malformed', `Malformed Codex plugin/read response for ${pluginId}`);
  }
  return summary;
}

/**
 * Read only the skills already visible to Codex in one prepared candidate.
 * Incomplete metadata is a policy-loading failure, never confirmed absence.
 */
export async function listCodexInstalledReviewSkills(
  transport: CodexAppServerTransport,
  environment: CodexPreparedCatalogEnvironment,
): Promise<readonly InstalledReviewSkill[]> {
  abortIfNeeded(environment.signal);
  let session: CodexAppServerSession | undefined;
  let terminalError: ReviewPolicyCatalogError | undefined;
  try {
    session = await transport.open(environment);
    abortIfNeeded(environment.signal);
    const response = await session.request('skills/list', {
      cwds: [environment.cwd],
      forceReload: true,
    });
    abortIfNeeded(environment.signal);
    const entry = requireCodexCatalogResponse(response, environment.cwd);
    entry.skills.forEach(requireCodexSkill);

    const pluginIds = [...new Set(entry.skills
      .map((skill) => skill.pluginId)
      .filter((pluginId): pluginId is string => pluginId !== null))]
      .sort((left, right) => left.localeCompare(right));
    const plugins = new Map<string, CodexPluginDescriptor>();
    for (const pluginId of pluginIds) {
      const plugin = await session.request('plugin/read', { pluginName: pluginId });
      abortIfNeeded(environment.signal);
      plugins.set(pluginId, requireCodexPlugin(plugin, pluginId));
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
  } catch (error) {
    terminalError = asCatalogError(error, environment.signal);
    throw terminalError;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        if (!terminalError) throw asCatalogError(error, environment.signal);
      }
    }
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
