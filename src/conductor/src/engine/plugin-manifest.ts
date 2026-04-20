import { PluginManifest, PluginManifestError } from '../types/plugin.js';

/**
 * Validates a manifest object and ensures all required fields are present.
 * Required fields: kind, name, entrypoint
 *
 * @param raw The manifest object to validate
 * @returns The validated PluginManifest with proper types
 * @throws PluginManifestError if any required field is missing
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

  return manifest as PluginManifest;
}
