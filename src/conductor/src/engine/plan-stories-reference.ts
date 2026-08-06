import { posix, win32 } from 'node:path';

const STORIES_LINE = /^\s*\*\*Stories:\*\*\s*(.*?)\s*$/im;
const MARKDOWN_LINK = /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)$/;
const LEADING_MARKDOWN_LINK = /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/;

function normalizeStoriesReference(reference: string): string {
  const inlineCode = reference.match(/^`([^`]*)`/);
  if (inlineCode) return inlineCode[1].trim();

  const markdown = reference.match(LEADING_MARKDOWN_LINK);
  if (markdown) return markdown[1];

  return reference.trim().split(/\s+/, 1)[0] ?? '';
}

/**
 * Resolve the stories artifact named by a plan to a repo-relative POSIX path.
 *
 * Plans may use a plain path, an inline-code path, or a Markdown link. Relative
 * link targets are resolved from the plan file; `.docs/...` references remain
 * repository-relative. A plan without a Stories line uses the daemon's legacy
 * same-stem fallback. Malformed or out-of-repository references fail closed.
 */
export function resolvePlanStoriesPath(
  planRepoPath: string,
  planContent: string,
): string | null {
  const match = planContent.match(STORIES_LINE);
  if (!match) {
    return `.docs/stories/${posix.basename(planRepoPath, '.md')}.md`;
  }

  let reference = normalizeStoriesReference(match[1]);

  const markdown = reference.match(MARKDOWN_LINK);
  if (markdown) reference = markdown[1];
  if (!reference || /^\[[^\]]+\]\(/.test(reference)) return null;

  if (posix.isAbsolute(reference) || win32.isAbsolute(reference)) return null;
  reference = reference.replaceAll('\\', '/');

  let repoPath: string;
  if (reference.startsWith('.docs/')) {
    repoPath = reference;
  } else {
    repoPath = posix.join(posix.dirname(planRepoPath), reference);
  }

  const normalized = posix.normalize(repoPath);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    posix.isAbsolute(normalized) ||
    !normalized.endsWith('.md')
  ) {
    return null;
  }
  return normalized;
}
