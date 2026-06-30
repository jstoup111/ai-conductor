import { satisfies } from 'semver';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { PluginManifest, PluginManifestError, PluginVersionError, VALID_PLUGIN_KINDS } from '../types/plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The relative depth to VERSION differs between the source tree (src/engine/ → 4 levels up)
// and the bundle (dist/ → 3 levels up), so probe both.
function resolveHarnessVersion(): string {
  for (const rel of ['../../../VERSION', '../../../../VERSION']) {
    try {
      const v = readFileSync(join(__dirname, rel), 'utf-8').trim();
      if (/^\d+\.\d+\.\d+/.test(v)) return v;
    } catch { /* try next */ }
  }
  return '0.0.0';
}
const HARNESS_VERSION = resolveHarnessVersion();

/**
 * Validates a manifest object and ensures all required fields are present.
 * Required fields: kind, name, entrypoint
 *
 * @param raw The manifest object to validate
 * @returns The validated PluginManifest with proper types
 * @throws PluginManifestError if any required field is missing or invalid
 * @throws PluginVersionError if harness_version requirement is incompatible
 */
export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new PluginManifestError('Manifest must be an object');
  }

  const manifest = raw as Record<string, unknown>;

  // Task 3: Check required fields
  if (!('kind' in manifest)) {
    throw new PluginManifestError('Manifest must have required field: kind');
  }

  if (!('name' in manifest)) {
    throw new PluginManifestError('Manifest must have required field: name');
  }

  // `entrypoint` is required for all plugin kinds EXCEPT `memory_provider`
  // manifests that declare an `mcp` server instead (B1 — MCP-backed provider).
  const hasMcp = 'mcp' in manifest && manifest.mcp !== null && typeof manifest.mcp === 'object';
  const isMemoryProvider = manifest.kind === 'memory_provider';
  if (!hasMcp || !isMemoryProvider) {
    if (!('entrypoint' in manifest)) {
      throw new PluginManifestError('Manifest must have required field: entrypoint');
    }
  }

  // Task 4: Validate kind enum
  const kind = manifest.kind;
  if (!VALID_PLUGIN_KINDS.includes(kind as never)) {
    throw new PluginManifestError(
      `Invalid kind "${kind}". Valid kinds are: ${VALID_PLUGIN_KINDS.join(', ')}`
    );
  }

  // Task 4: Validate name format - must match [a-z0-9-]+
  const name = manifest.name;
  const namePattern = /^[a-z0-9-]+$/;
  if (typeof name !== 'string' || !namePattern.test(name)) {
    throw new PluginManifestError(
      `Invalid name "${name}". Name must match pattern [a-z0-9-]+`
    );
  }

  // Task 5: Check harness_version compatibility if specified
  if ('harness_version' in manifest && manifest.harness_version !== undefined) {
    const requiredRange = manifest.harness_version as string;
    if (!satisfies(HARNESS_VERSION, requiredRange)) {
      throw new PluginVersionError(
        `Plugin requires harness ${requiredRange}, but harness is ${HARNESS_VERSION}`,
        HARNESS_VERSION,
        requiredRange
      );
    }
  }

  return manifest as unknown as PluginManifest;
}

/**
 * Loads and validates a plugin manifest from a YAML file.
 *
 * @param filePath Path to the plugin.yml file
 * @returns The validated PluginManifest
 * @throws PluginManifestError if file does not exist, cannot be read, or contains invalid YAML
 * @throws PluginManifestError if manifest validation fails (via validateManifest)
 */
export function loadManifestFromFile(filePath: string): PluginManifest {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PluginManifestError(`Failed to read manifest file ${filePath}: ${message}`, filePath);
  }

  let raw: unknown;
  try {
    raw = load(content);
  } catch (err) {
    const yamlError = err instanceof Error ? err.message : String(err);
    throw new PluginManifestError(`Invalid YAML in ${filePath}: ${yamlError}`, filePath);
  }

  try {
    return validateManifest(raw);
  } catch (err) {
    if (err instanceof PluginManifestError) {
      throw new PluginManifestError(`${err.message} (from ${filePath})`, filePath);
    }
    throw err;
  }
}
