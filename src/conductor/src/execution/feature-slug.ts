/** Canonical grammar for daemon feature directory and branch slugs. */
export function isFeatureSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
}
