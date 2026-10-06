import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export type ChildId = number & { readonly __brand: 'ChildId' };

export const MAX_CHILD_ID = 9;

export const CHILD_REGION_STEPS = ['acceptance_specs', 'build', 'test_suite', 'build_review'] as const;

const CHILD_ID_DIGITS = /^\d+$/;

export function parseChildId(raw: string | number): ChildId | undefined {
  let value: number;
  if (typeof raw === 'string') {
    if (!CHILD_ID_DIGITS.test(raw)) return undefined;
    value = Number(raw);
  } else {
    if (!Number.isInteger(raw)) return undefined;
    value = raw;
  }
  if (value < 1 || value > MAX_CHILD_ID) return undefined;
  return value as ChildId;
}

export function isRegionStep(step: string): boolean {
  return (CHILD_REGION_STEPS as readonly string[]).includes(step);
}

export function pipelinePathFor(root: string, relative: string, child?: ChildId): string {
  if (child === undefined) {
    return join(root, '.pipeline', relative);
  }
  return join(root, '.pipeline', 'children', String(child), relative);
}

export async function childStateExists(root: string, child: ChildId): Promise<boolean> {
  const childPath = join(root, '.pipeline', 'children', String(child));
  try {
    const info = await stat(childPath);
    return info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function listExistingChildren(root: string): Promise<ChildId[]> {
  const childrenDir = join(root, '.pipeline', 'children');
  let entries;
  try {
    entries = await readdir(childrenDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const children = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseChildId(entry.name))
    .filter((id): id is ChildId => id !== undefined);
  children.sort((a, b) => a - b);
  return children;
}