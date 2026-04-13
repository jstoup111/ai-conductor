/**
 * Slugify a feature description into a URL-safe directory/branch name.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/-$/g, '')
    .slice(0, 50);
}
