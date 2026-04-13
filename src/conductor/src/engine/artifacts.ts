import { access, readdir } from 'fs/promises';
import { join } from 'path';
import type { StepName } from '../types/index.js';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirHasFiles(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function checkBrainstorm(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/brainstorm.md'));
}

export async function checkStories(dir: string): Promise<boolean> {
  return dirHasFiles(join(dir, '.docs/stories'));
}

export async function checkConflictCheck(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/conflict-check.md'));
}

export async function checkPlan(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/plan.md'));
}

export async function checkBuild(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/task-status.json'));
}

export async function checkAcceptanceSpecs(dir: string): Promise<boolean> {
  // Check common spec/test directories for acceptance tests
  const candidates = [
    join(dir, 'spec/acceptance'),
    join(dir, 'test/acceptance'),
  ];
  for (const candidate of candidates) {
    if (await dirHasFiles(candidate)) return true;
  }
  return false;
}

export async function checkArchitectureDiagram(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/architecture.md'));
}

export async function checkArchitectureReview(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/architecture-review.md'));
}

export async function checkRetro(dir: string): Promise<boolean> {
  return fileExists(join(dir, '.docs/retro.md'));
}

// Steps that produce no file artifacts — always pass
const alwaysTrue = async (_dir: string): Promise<boolean> => true;

const checkerMap: Record<StepName, (dir: string) => Promise<boolean>> = {
  worktree: alwaysTrue,
  memory: alwaysTrue,
  brainstorm: checkBrainstorm,
  complexity: alwaysTrue,
  stories: checkStories,
  conflict_check: checkConflictCheck,
  plan: checkPlan,
  architecture_diagram: checkArchitectureDiagram,
  architecture_review: checkArchitectureReview,
  acceptance_specs: checkAcceptanceSpecs,
  build: checkBuild,
  manual_test: alwaysTrue,
  retro: checkRetro,
  finish: alwaysTrue,
};

export function getArtifactChecker(
  step: StepName,
): (dir: string) => Promise<boolean> {
  return checkerMap[step];
}
