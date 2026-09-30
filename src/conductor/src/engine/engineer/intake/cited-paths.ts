import { intersectFiles } from '../../overlap-scan.js';

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LINE_SUFFIX = /(?::\d+(?:-\d+)?|#L\d+)$/i;
const FILE_EXTENSION = /(?:^|\/)[^/\s]+\.[^/\s.]+$/;

function normalizeToken(token: string): string {
  return token
    .replace(/^[`"']+|[`"'),.;:!?]+$/g, '')
    .replace(/^\.\//, '')
    .replace(LINE_SUFFIX, '');
}

/**
 * Extract repo-relative paths cited in one intake-text source.
 */
export function extractCitedPaths(text: string, knownPaths?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const citedPaths: string[] = [];

  for (const rawToken of text.split(/\s+/)) {
    const path = normalizeToken(rawToken);
    if (
      path === '' ||
      URL_SCHEME.test(path) ||
      (!path.includes('/') && !FILE_EXTENSION.test(path)) ||
      (knownPaths !== undefined && intersectFiles([path], [...knownPaths]).length === 0) ||
      seen.has(path)
    ) {
      continue;
    }

    seen.add(path);
    citedPaths.push(path);
  }

  return citedPaths;
}
