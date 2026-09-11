import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { execa } from 'execa';

import type { InstalledReviewSkill } from './build-review-policy.js';

/** The prepared candidate context in which Claude discovery is allowed to run. */
export interface ClaudeReviewPolicyCandidate {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly projectSkillRoots: readonly string[];
  readonly userSkillRoots: readonly string[];
}

export interface ClaudeMetadataCommandOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface ClaudeMetadataCommandResult {
  readonly stdout: string;
}

/** Injectable boundary for Claude's read-only plugin inventory command. */
export type ClaudeMetadataCommand = (
  command: string,
  args: readonly string[],
  options: ClaudeMetadataCommandOptions,
) => Promise<ClaudeMetadataCommandResult>;

/** Minimal filesystem surface used by the catalog adapter. */
export interface ClaudeReviewPolicyFilesystem {
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
}

export interface DiscoverClaudeReviewPoliciesOptions {
  readonly candidate: ClaudeReviewPolicyCandidate;
  readonly command?: ClaudeMetadataCommand;
  readonly filesystem?: ClaudeReviewPolicyFilesystem;
}

export class ClaudeReviewPolicyCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeReviewPolicyCatalogError';
  }
}

const realFilesystem: ClaudeReviewPolicyFilesystem = { readdir, readFile, realpath };

const realCommand: ClaudeMetadataCommand = async (command, args, options) => {
  const result = await execa(command, args, { cwd: options.cwd, env: options.env });
  return { stdout: result.stdout };
};

interface ClaudePluginInventoryEntry {
  readonly id: string;
  readonly installPath?: string;
  readonly enabled: boolean;
  readonly scope: string;
  readonly version?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as readonly string[]
    : undefined;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && /(?:ENOENT|not found)/i.test(error.message);
}

async function optionalDirectoryEntries(
  filesystem: ClaudeReviewPolicyFilesystem,
  path: string,
): Promise<readonly string[]> {
  try {
    return await filesystem.readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw new ClaudeReviewPolicyCatalogError(`Unable to read Claude skill root ${path}: ${String(error)}`);
  }
}

function parseSkillMetadata(skillText: string, skillPath: string): {
  readonly semanticName?: string;
  readonly declaredDependencies: readonly string[];
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillText);
  if (!match) return { declaredDependencies: [] };

  let metadata: Record<string, unknown> | undefined;
  try {
    metadata = object(loadYaml(match[1]!));
  } catch (error) {
    throw new ClaudeReviewPolicyCatalogError(`Invalid SKILL.md frontmatter at ${skillPath}: ${String(error)}`);
  }

  if (!metadata) return { declaredDependencies: [] };
  const name = metadata.name;
  const requires = metadata.requires;
  if (name !== undefined && typeof name !== 'string') {
    throw new ClaudeReviewPolicyCatalogError(`Invalid skill name in ${skillPath}`);
  }
  if (requires !== undefined && !strings(requires)) {
    throw new ClaudeReviewPolicyCatalogError(`Invalid skill dependencies in ${skillPath}`);
  }
  return {
    ...(typeof name === 'string' ? { semanticName: name } : {}),
    declaredDependencies: strings(requires) ?? [],
  };
}

async function installedSkillsInDirectory(
  filesystem: ClaudeReviewPolicyFilesystem,
  directory: string,
  source: 'project' | 'global' | 'plugin',
  plugin?: { readonly id: string; readonly version?: string; readonly packageRoot: string },
): Promise<readonly InstalledReviewSkill[]> {
  const policies: InstalledReviewSkill[] = [];
  const direct = await installedSkillAtDirectory(filesystem, directory, source, plugin);
  if (direct) policies.push(direct);
  const entries = await optionalDirectoryEntries(filesystem, directory);
  for (const entry of entries) {
    const skill = await installedSkillAtDirectory(filesystem, join(directory, entry), source, plugin);
    if (skill) policies.push(skill);
  }
  return policies;
}

async function installedSkillAtDirectory(
  filesystem: ClaudeReviewPolicyFilesystem,
  skillDirectory: string,
  source: 'project' | 'global' | 'plugin',
  plugin?: { readonly id: string; readonly version?: string; readonly packageRoot: string },
): Promise<InstalledReviewSkill | undefined> {
  const skillPath = join(skillDirectory, 'SKILL.md');
  let skillText: string;
  try {
    skillText = await filesystem.readFile(skillPath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new ClaudeReviewPolicyCatalogError(`Unable to read Claude skill ${skillPath}: ${String(error)}`);
  }

  const canonicalSkillDirectory = await filesystem.realpath(skillDirectory);
  const metadata = parseSkillMetadata(skillText, skillPath);
  const packageRoot = plugin?.packageRoot ?? canonicalSkillDirectory;
  return {
    semanticName: metadata.semanticName ?? basename(skillDirectory),
    source,
    ...(plugin === undefined ? {} : { plugin: { id: plugin.id, ...(plugin.version === undefined ? {} : { version: plugin.version }) } }),
    installationOrigin: plugin?.packageRoot ?? canonicalSkillDirectory,
    canonicalSkillPath: join(canonicalSkillDirectory, 'SKILL.md'),
    packageRoot,
    declaredDependencies: metadata.declaredDependencies,
    availability: 'available',
  };
}

function parsePluginInventory(stdout: string): readonly ClaudePluginInventoryEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin inventory JSON: ${String(error)}`);
  }
  const entries = Array.isArray(value) ? value : object(value)?.plugins;
  if (!Array.isArray(entries)) throw new ClaudeReviewPolicyCatalogError('Unsupported Claude plugin inventory envelope');

  return entries.map((entry, index) => {
    const item = object(entry);
    const id = item?.id ?? item?.name;
    if (!item || typeof id !== 'string' || typeof item.enabled !== 'boolean' || typeof item.scope !== 'string') {
      throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin inventory entry at index ${index}`);
    }
    if (item.installPath !== undefined && typeof item.installPath !== 'string') {
      throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin installPath for ${id}`);
    }
    if (item.version !== undefined && typeof item.version !== 'string') {
      throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin version for ${id}`);
    }
    return {
      id,
      enabled: item.enabled,
      scope: item.scope,
      ...(typeof item.installPath === 'string' ? { installPath: item.installPath } : {}),
      ...(typeof item.version === 'string' ? { version: item.version } : {}),
    };
  });
}

function pluginSkillDirectories(manifestText: string, manifestPath: string): readonly string[] {
  let manifest: Record<string, unknown> | undefined;
  try {
    manifest = object(JSON.parse(manifestText));
  } catch (error) {
    throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin manifest ${manifestPath}: ${String(error)}`);
  }
  if (!manifest) throw new ClaudeReviewPolicyCatalogError(`Invalid Claude plugin manifest ${manifestPath}`);
  const skills = manifest.skills;
  const directories = skills === undefined ? ['./skills'] : typeof skills === 'string' ? [skills] : strings(skills);
  if (!directories || directories.some((path) => !path.startsWith('./'))) {
    throw new ClaudeReviewPolicyCatalogError(`Unsupported Claude plugin skill components in ${manifestPath}`);
  }
  return directories;
}

/**
 * Lists only locally installed policies in the prepared candidate's Claude
 * environment. Marketplace records and non-skill plugin components are never
 * treated as an installation or permission to activate a plugin.
 */
export async function discoverClaudeReviewPolicies(
  options: DiscoverClaudeReviewPoliciesOptions,
): Promise<readonly InstalledReviewSkill[]> {
  const filesystem = options.filesystem ?? realFilesystem;
  const command = options.command ?? realCommand;
  const { candidate } = options;
  const pluginInventory = parsePluginInventory((await command('claude', ['plugin', 'list', '--json'], {
    cwd: candidate.cwd,
    env: candidate.env,
  })).stdout);

  const standalone = await Promise.all([
    ...candidate.projectSkillRoots.map((root) => installedSkillsInDirectory(filesystem, root, 'project')),
    ...candidate.userSkillRoots.map((root) => installedSkillsInDirectory(filesystem, root, 'global')),
  ]);
  const policies = standalone.flat();

  for (const plugin of pluginInventory) {
    // An inventory item without an installed root is merely a marketplace
    // listing. It has no local material the review boundary may read.
    if (!plugin.enabled || !plugin.installPath) continue;
    const packageRoot = await filesystem.realpath(plugin.installPath);
    const manifestPath = join(plugin.installPath, '.claude-plugin', 'plugin.json');
    let manifestText: string;
    try {
      manifestText = await filesystem.readFile(manifestPath);
    } catch (error) {
      throw new ClaudeReviewPolicyCatalogError(`Unable to read Claude plugin manifest ${manifestPath}: ${String(error)}`);
    }
    const directories = pluginSkillDirectories(manifestText, manifestPath);
    for (const directory of directories) {
      policies.push(...await installedSkillsInDirectory(
        filesystem,
        join(plugin.installPath, directory),
        'plugin',
        { id: plugin.id, ...(plugin.version === undefined ? {} : { version: plugin.version }), packageRoot },
      ));
    }
  }
  return policies;
}
