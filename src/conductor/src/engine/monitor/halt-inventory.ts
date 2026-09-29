import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { scanInheritedState } from '../daemon-dashboard.js';
import { HALT_MARKER, readHaltClass, type HaltDisposition } from '../halt-marker.js';
import { isOperatorParked } from '../park-marker.js';

export interface ProjectHalt {
  project: string;
  slug: string;
  reason: string;
  haltClass: HaltDisposition;
}

export interface HaltInventoryDeps {
  isOperatorParked: (projectRoot: string, slug: string) => Promise<boolean>;
}

function firstHaltLine(contents: string): string {
  for (const line of contents.split('\n')) {
    const reason = line.trim();
    if (reason) return reason;
  }
  return 'unstated';
}

function readFailureReason(error: unknown): string {
  return `HALT marker unreadable: ${error instanceof Error ? error.message : String(error)}`;
}

async function hasReadableCompletionMarker(worktreePath: string): Promise<boolean> {
  try {
    await readFile(join(worktreePath, '.pipeline/DONE'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function unreadableHaltSlugs(worktreeBase: string, knownSlugs: Set<string>): Promise<string[]> {
  try {
    const entries = await readdir(worktreeBase, { withFileTypes: true });
    const unreadable: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || knownSlugs.has(entry.name)) continue;
      const worktreePath = join(worktreeBase, entry.name);
      const markerPath = join(worktreePath, HALT_MARKER);
      try {
        await stat(markerPath);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
          && !await hasReadableCompletionMarker(worktreePath)
        ) unreadable.push(entry.name);
        continue;
      }
      try {
        await readFile(markerPath, 'utf-8');
      } catch {
        if (!await hasReadableCompletionMarker(worktreePath)) unreadable.push(entry.name);
      }
    }
    return unreadable;
  } catch {
    return [];
  }
}

/**
 * Enumerate the live halted worktrees for one project.
 *
 * Membership remains owned by the inherited-state scan, including its
 * completion-marker and per-worktree-error handling. Halt classification is
 * deliberately read beside each live entry because it is not part of the
 * dashboard's halted-entry shape.
 */
export async function enumerateProjectHalts(
  projectRoot: string,
  deps: HaltInventoryDeps = { isOperatorParked },
): Promise<ProjectHalt[]> {
  const worktreeBase = join(projectRoot, '.worktrees');
  const state = await scanInheritedState({
    worktreeBase,
    processedDir: join(projectRoot, '.daemon', 'processed'),
    discover: async () => [],
  });

  const knownSlugs = new Set(state.halted.map(({ slug }) => slug));
  const halted = (await Promise.all(state.halted.map(async ({ slug }) => {
    const worktreePath = join(worktreeBase, slug);
    if (await deps.isOperatorParked(projectRoot, slug)) return null;
    try {
      return {
        project: projectRoot,
        slug,
        reason: firstHaltLine(await readFile(join(worktreePath, HALT_MARKER), 'utf-8')),
        haltClass: await readHaltClass(worktreePath),
      };
    } catch (error) {
      return {
        project: projectRoot,
        slug,
        reason: readFailureReason(error),
        haltClass: await readHaltClass(worktreePath),
      };
    }
  }))).filter((halt): halt is ProjectHalt => halt !== null);

  const unreadable = await unreadableHaltSlugs(worktreeBase, knownSlugs);
  const unreadableEntries = (await Promise.all(unreadable.map(async (slug) => {
    const worktreePath = join(worktreeBase, slug);
    if (await deps.isOperatorParked(projectRoot, slug)) return null;
    let reason = 'HALT marker unreadable';
    try {
      await readFile(join(worktreePath, HALT_MARKER), 'utf-8');
    } catch (error) {
      reason = readFailureReason(error);
    }
    return {
      project: projectRoot,
      slug,
      reason,
      haltClass: await readHaltClass(worktreePath),
    };
  }))).filter((halt): halt is ProjectHalt => halt !== null);

  return [...halted, ...unreadableEntries];
}
