/**
 * Wiring-probe module — Layer 1 of the wiring-reachability gate.
 *
 * Extracts newly-added exported symbols (with their defining file) from a
 * feature's git diff. This is the foundation used by later layers to verify
 * that new exports are actually wired into the system (declared-site
 * verification, orphan backstop, etc. — not implemented here).
 *
 * Base-commit derivation reuses the anchor -> fork-point -> merge-base
 * fallback ladder used elsewhere in this repo for evidence-range derivation
 * (see getEvidenceRange in autoheal.ts), adapted to the injected-GitRunner
 * convention (see headPushedToUpstream in push-evidence.ts) so it is
 * testable without a real git process.
 */

import type { GitRunner } from './pr-labels.js';

export interface NewExport {
  file: string;
  symbol: string;
}

const DEFAULT_ORIGIN_REF = 'origin/main';

/**
 * Derives the base commit for the evidence diff via the fallback ladder:
 *   1. If `anchor` is non-empty and reachable (`rev-parse --verify
 *      <anchor>^{commit}` succeeds), use it directly.
 *   2. Otherwise, try `merge-base --fork-point origin/main HEAD`.
 *   3. Otherwise, fall back to plain `merge-base origin/main HEAD`.
 *   4. If all of the above fail, return null (caller fails closed).
 */
async function deriveBase(runGit: GitRunner, anchor: string, cwd: string): Promise<string | null> {
  if (anchor.trim() !== '') {
    try {
      await runGit(['rev-parse', '--verify', `${anchor}^{commit}`], { cwd });
      return anchor;
    } catch {
      // anchor unreachable — fall through to the merge-base ladder
    }
  }

  try {
    const forkPoint = await runGit(['merge-base', '--fork-point', DEFAULT_ORIGIN_REF, 'HEAD'], { cwd });
    const trimmed = forkPoint.stdout.trim();
    if (trimmed !== '') return trimmed;
  } catch {
    // fall through to plain merge-base
  }

  try {
    const mergeBase = await runGit(['merge-base', DEFAULT_ORIGIN_REF, 'HEAD'], { cwd });
    const trimmed = mergeBase.stdout.trim();
    if (trimmed !== '') return trimmed;
  } catch {
    // fall through to fail-closed
  }

  return null;
}

const ADDED_FUNCTION_RE = /^export\s+(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)/;
const ADDED_CONST_LET_VAR_RE = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const ADDED_CLASS_RE = /^export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/;
const ADDED_REEXPORT_RE = /^export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/;

function symbolsFromAddedLine(line: string): string[] {
  const fnMatch = line.match(ADDED_FUNCTION_RE);
  if (fnMatch) return [fnMatch[1]];

  const varMatch = line.match(ADDED_CONST_LET_VAR_RE);
  if (varMatch) return [varMatch[1]];

  const classMatch = line.match(ADDED_CLASS_RE);
  if (classMatch) return [classMatch[1]];

  const reexportMatch = line.match(ADDED_REEXPORT_RE);
  if (reexportMatch) {
    return reexportMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        // handle `foo as bar` — the locally-exported name is `bar`
        const asMatch = part.match(/^\S+\s+as\s+(\S+)$/);
        return asMatch ? asMatch[1] : part;
      });
  }

  return [];
}

/**
 * Parses a unified `git diff` text and returns every newly-added exported
 * symbol along with the file that defines it.
 */
function parseDiffForNewExports(diffText: string): NewExport[] {
  const results: NewExport[] = [];
  let currentFile: string | null = null;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('+++ ')) {
      const path = rawLine.slice(4).trim();
      if (path === '/dev/null') {
        currentFile = null;
      } else {
        currentFile = path.startsWith('b/') ? path.slice(2) : path;
      }
      continue;
    }

    if (rawLine.startsWith('+++') || rawLine.startsWith('---') || rawLine.startsWith('diff --git')) {
      continue;
    }

    if (!rawLine.startsWith('+') || rawLine.startsWith('++')) {
      continue;
    }

    if (currentFile === null) continue;

    const content = rawLine.slice(1).trim();
    const symbols = symbolsFromAddedLine(content);
    for (const symbol of symbols) {
      results.push({ file: currentFile, symbol });
    }
  }

  return results;
}

/**
 * Extracts newly-added exported symbols (with their defining file) from the
 * diff between a derived base commit and HEAD.
 *
 * `anchor` is fed into the base-derivation ladder (see `deriveBase`); pass
 * an empty string to skip straight to the fork-point/merge-base fallback.
 */
export async function extractNewExports(
  runGit: GitRunner,
  anchor: string,
  cwd = '.',
): Promise<NewExport[]> {
  const base = await deriveBase(runGit, anchor, cwd);
  if (base === null) return [];

  const diffResult = await runGit(['diff', `${base}...HEAD`], { cwd });
  return parseDiffForNewExports(diffResult.stdout);
}
