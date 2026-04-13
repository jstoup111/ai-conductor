/**
 * Slugify a feature description into a URL-safe directory/branch name.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-');
}
