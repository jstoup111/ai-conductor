import { PluginManifest, PluginManifestError, VALID_PLUGIN_KINDS } from '../types/plugin.js';

/**
 * Validates a manifest object and ensures all required fields are present.
 * Required fields: kind, name, entrypoint
 *
 * @param raw The manifest object to validate
 * @returns The validated PluginManifest with proper types
 * @throws PluginManifestError if any required field is missing or invalid
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

  if (!('entrypoint' in manifest)) {
    throw new PluginManifestError('Manifest must have required field: entrypoint');
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

  return manifest as PluginManifest;
}
