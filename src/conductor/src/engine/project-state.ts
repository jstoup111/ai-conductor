import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BootstrapMode } from '../types/index.js';

/**
 * Project-scoped state shared across features. Lives at
 * `<projectRoot>/.pipeline/project-state.json`. Anything that should persist
 * across feature boundaries (bootstrap mode, future project-wide flags) goes
 * here — NOT in the per-feature `conduct-state.json`.
 *
 * Keep this surface small. If a key only matters during one feature's
 * lifecycle, it belongs in the feature state file.
 */
export interface ProjectState {
  bootstrap_mode?: BootstrapMode;
}

/**
 * Read project-state.json. Returns an empty object if the file is missing
 * or unreadable — this layer is intentionally forgiving so a fresh project
 * (no project-state.json yet) and a corrupted file both fall back to
 * defaults instead of breaking the per-feature loop.
 */
export async function readProjectState(path: string): Promise<ProjectState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ProjectState;
  } catch {
    return {};
  }
}

export async function writeProjectState(path: string, state: ProjectState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/**
 * Merge a partial update into the on-disk project state.
 */
export async function patchProjectState(
  path: string,
  patch: Partial<ProjectState>,
): Promise<ProjectState> {
  const current = await readProjectState(path);
  const next = { ...current, ...patch };
  await writeProjectState(path, next);
  return next;
}
