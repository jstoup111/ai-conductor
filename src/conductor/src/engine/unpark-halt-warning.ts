import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  HALT_CLASS_MARKER,
  HALT_MARKER,
  PLAN_GAP_HALT_CLASS,
  PROTECTED_ARTIFACT_HALT_CLASS,
} from './halt-marker.js';
import { KICKBACK_CAP_HALT_CLASS, OVER_SCOPE_HALT_CLASS } from './halt-classification.js';

const REMOVE_BOTH_CLASSES = new Set(['mechanical', 'legacy', 'unclassified']);

/**
 * Describe the recovery required for a worktree's live HALT without changing it.
 */
export async function describeLiveHalt(worktreePath: string): Promise<string[] | null> {
  const haltPath = join(worktreePath, HALT_MARKER);

  try {
    await stat(haltPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const haltClassPath = join(worktreePath, HALT_CLASS_MARKER);
  let haltClass: string;
  try {
    const rawHaltClass = await readFile(haltClassPath, 'utf8');
    haltClass = rawHaltClass.trim() || '(empty)';
  } catch (error) {
    haltClass = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unclassified' : 'unreadable';
  }

  const slug = basename(worktreePath);
  const warning = `'${slug}' still has a live HALT (class: ${haltClass}) — it will not resume until the HALT is cleared.`;
  const recovery = recoveryLine({ worktreePath, slug, haltPath, haltClassPath, haltClass });

  return [warning, recovery];
}

function recoveryLine({
  worktreePath,
  slug,
  haltPath,
  haltClassPath,
  haltClass,
}: {
  worktreePath: string;
  slug: string;
  haltPath: string;
  haltClassPath: string;
  haltClass: string;
}): string {
  if (REMOVE_BOTH_CLASSES.has(haltClass)) {
    return `To resume: rm ${haltPath} ${haltClassPath}`;
  }

  if (haltClass === OVER_SCOPE_HALT_CLASS) {
    return `To resume: record each decision in ${haltPath}, then mv ${haltPath} ${worktreePath}/.pipeline/HALT.cleared; rm -f ${haltClassPath}`;
  }

  if (haltClass === KICKBACK_CAP_HALT_CLASS) {
    return `To resume: ai-conductor kickback-budget inspect --feature ${slug}, then raise or reset the budget; the daemon clears the HALT.`;
  }

  // Keep these constants coupled to their special resolve-first classes.
  if (haltClass === PLAN_GAP_HALT_CLASS || haltClass === PROTECTED_ARTIFACT_HALT_CLASS) {
    return `To resume: resolve the cause recorded in ${haltPath} before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md`;
  }

  return `To resume: resolve the cause recorded in ${haltPath} before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md`;
}
