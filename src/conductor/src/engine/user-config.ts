// User-level harness config at ~/.ai-conductor/config.yml. Parallels
// project-level .ai-conductor/config.yml — same YAML schema, narrower scope
// (holds the `conductor` block for update channel/version and a default
// `markdown_viewer`). Project config deep-merges on top at load time.

import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import type { HarnessConfig } from '../types/config.js';

export const USER_CONFIG_DIR = '.ai-conductor';
export const USER_CONFIG_FILE = 'config.yml';
export const LEGACY_JSON_FILE = join('.claude', 'ai-conductor.config.json');

export function userConfigPath(home: string = homedir()): string {
  return join(home, USER_CONFIG_DIR, USER_CONFIG_FILE);
}

export function legacyJsonPath(home: string = homedir()): string {
  return join(home, LEGACY_JSON_FILE);
}

export interface UserConfigReadResult {
  config: HarnessConfig;
  existed: boolean;
  parseError?: string;
}

export async function readUserConfig(
  path: string = userConfigPath(),
): Promise<UserConfigReadResult> {
  if (!existsSync(path)) {
    return { config: {}, existed: false };
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    return {
      config: {},
      existed: true,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
  if (raw.trim() === '') {
    return { config: {}, existed: true };
  }
  try {
    const parsed = loadYaml(raw);
    if (parsed === null || parsed === undefined) {
      return { config: {}, existed: true };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        config: {},
        existed: true,
        parseError: 'Root of user config must be a YAML mapping',
      };
    }
    return { config: parsed as HarnessConfig, existed: true };
  } catch (e) {
    return {
      config: {},
      existed: true,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

// Atomic write: write to a temp sibling, rename over the target.
export async function writeUserConfig(
  config: HarnessConfig,
  path: string = userConfigPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const yaml = dumpYaml(config, { lineWidth: 100, sortKeys: false });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, yaml, 'utf-8');
  await rename(tmp, path);
}

// Translate legacy ~/.claude/ai-conductor.config.json (flat camelCase) into
// the new `conductor:` block shape. Returns null if the legacy file doesn't
// exist or can't be parsed (caller decides whether to warn).
export async function readLegacyJson(
  path: string = legacyJsonPath(),
): Promise<HarnessConfig['conductor'] | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const out: HarnessConfig['conductor'] = {};
    if (typeof json.updateChannel === 'string') {
      const ch = json.updateChannel;
      if (ch === 'tagged' || ch === 'main') out.update_channel = ch;
    }
    if (typeof json.autoCheck === 'boolean') out.auto_check = json.autoCheck;
    if (typeof json.currentVersion === 'string') out.current_version = json.currentVersion;
    if (typeof json.lastCheckedAt === 'string') out.last_checked_at = json.lastCheckedAt;
    return out;
  } catch {
    return null;
  }
}
