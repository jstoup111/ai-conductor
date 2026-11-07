const CITED_PATH_LINE_SUFFIX = /(?::\d+(?:-\d+)?|#L\d+)$/i;
const CITED_PATH_FILE = /(?:^|\/)[^/\s]+\.[^/\s.]+$/;

/**
 * Extract repository paths from already-admitted work-order context. The host
 * selector decides whether a citation is an input or output; this preserves
 * every path-shaped citation without inferring that distinction.
 */
export function citedRepositoryPaths(text: string): string[] {
  const paths: string[] = [];
  const tokens = [
    ...[...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
    ...text.split(/\s+/),
  ];
  for (const rawToken of tokens) {
    const path = rawToken
      .replace(/^[`"'([<]+|[`"'),.;:!?\])>]+$/g, '')
      .replace(/^\.\//, '')
      .replace(CITED_PATH_LINE_SUFFIX, '');
    if (
      path === '' ||
      path.startsWith('/') ||
      path.startsWith('../') ||
      (!path.includes('/') && !CITED_PATH_FILE.test(path)) ||
      paths.includes(path)
    ) continue;
    paths.push(path);
  }
  return paths;
}
