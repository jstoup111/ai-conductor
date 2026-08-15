import { posix, win32 } from 'node:path';

const PRD_LINE = /^\s*\*\*PRD:\*\*\s*(.*?)\s*$/im;
const MARKDOWN_LINK = /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)$/;
const LEADING_MARKDOWN_LINK = /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/;

function normalizePrdReference(reference: string): string {
  const inlineCode = reference.match(/^`([^`]*)`/);
  if (inlineCode) return inlineCode[1].trim();

  const markdown = reference.match(LEADING_MARKDOWN_LINK);
  if (markdown) return markdown[1];

  return reference.trim().split(/\s+/, 1)[0] ?? '';
}

/**
 * Resolve the approved-PRD artifact a plan explicitly names to a
 * `.docs/`-relative POSIX path, mirroring `resolvePlanStoriesPath`'s
 * reference grammar (plain path, inline-code path, or Markdown link).
 *
 * Unlike Stories, a PRD reference is optional and has no same-stem fallback:
 * most specs have no `**PRD:**` line at all (their PRD's filename already
 * matches the feature slug, which `resolveFeaturePrdPaths`' existing stem
 * ladder already covers). This line exists only for the case where a spec
 * legitimately amends an *older* PRD whose filename predates and differs
 * from the current feature's slug — returning `null` here leaves that
 * existing ladder as the sole resolution path, unchanged.
 */
export function resolvePlanPrdPath(
  planRepoPath: string,
  planContent: string,
): string | null {
  const match = planContent.match(PRD_LINE);
  if (!match) return null;

  let reference = normalizePrdReference(match[1]);

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
    !normalized.startsWith('.docs/specs/') ||
    !normalized.endsWith('.md')
  ) {
    return null;
  }
  return normalized;
}
