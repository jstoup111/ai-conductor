import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { StepName } from '../types/index.js';

/**
 * Artifact glob patterns per step. Each pattern is `<dir>/*.md`, `<dir>/**\/*.md`,
 * or a literal filename. Empty list = step produces no file artifacts; verification
 * is skipped.
 *
 * Single source of truth used by:
 *   - Post-step verification gate (stepHasArtifacts)
 *   - Artifact review prompt (findArtifactFiles)
 *   - Dashboard rendering (getArtifactStatus)
 */
export const STEP_ARTIFACT_GLOBS: Record<StepName, string[]> = {
  bootstrap: [],
  memory: [],
  assess: ['.docs/decisions/technical-assessment-*.md'],
  brainstorm: ['.docs/specs/*.md'],
  complexity: [],
  stories: ['.docs/stories/**/*.md'],
  conflict_check: ['.docs/conflicts/*.md'],
  plan: ['.docs/plans/*.md'],
  architecture_diagram: ['.docs/architecture/*.md'],
  architecture_review: [
    '.docs/decisions/architecture-review-*.md',
    '.docs/decisions/adr-*.md',
  ],
  worktree: [],
  acceptance_specs: ['spec/acceptance/**/*', 'test/acceptance/**/*'],
  build: ['.pipeline/task-status.json'],
  manual_test: [],
  retro: ['.docs/retros/*.md'],
  finish: [],
};

/**
 * Returns the absolute paths of files matching a step's artifact globs, rooted at `dir`.
 * Supports literal filenames, `dir/*.ext`, `dir/**\/*.ext`, and `dir/**\/*`.
 */
export async function findArtifactFiles(
  dir: string,
  step: StepName,
): Promise<string[]> {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return [];

  const files: string[] = [];
  for (const pattern of patterns) {
    files.push(...(await matchGlob(dir, pattern)));
  }
  return files;
}

/**
 * True if the step has at least one artifact on disk. True for steps that
 * produce no artifacts (nothing to verify).
 */
export async function stepHasArtifacts(
  dir: string,
  step: StepName,
): Promise<boolean> {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return true;
  const files = await findArtifactFiles(dir, step);
  return files.length > 0;
}

export interface CompletionResult {
  done: boolean;
  /** Human-readable description of what's missing; injected into retry prompt. */
  reason?: string;
}

/**
 * Custom per-step completion predicates that go beyond glob presence.
 *
 * Mirrors the bash conductor's behavior for the `build` step, which reads
 * `.pipeline/task-status.json` and requires every task's status to be
 * `completed` (lines 775–811, 1765–1784 of bin/conduct).
 */
export const FINISH_CHOICE_MARKER = '.pipeline/finish-choice';
export const FINISH_CHOICE_VALUES = ['pr', 'merge-local', 'keep', 'discard'] as const;
export type FinishChoice = (typeof FINISH_CHOICE_VALUES)[number];

export const CUSTOM_COMPLETION_PREDICATES: Partial<
  Record<StepName, (dir: string) => Promise<CompletionResult>>
> = {
  // The finish step has no file artifact; verify it produced one of the
  // outcomes the skill is supposed to choose between: a PR (state.pr_url
  // is set) or an explicit non-PR exit recorded in
  // `.pipeline/finish-choice`. Without this, print-mode finish (no user
  // attached) silently completes by listing options without acting.
  finish: async (dir: string): Promise<CompletionResult> => {
    try {
      const raw = await readFile(join(dir, '.pipeline/conduct-state.json'), 'utf-8');
      const state = JSON.parse(raw) as { pr_url?: string };
      if (state.pr_url) return { done: true };
    } catch {
      // No state file readable — fall through to the marker check.
    }
    try {
      const choice = (await readFile(join(dir, FINISH_CHOICE_MARKER), 'utf-8')).trim();
      if ((FINISH_CHOICE_VALUES as readonly string[]).includes(choice)) {
        return { done: true };
      }
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} contains unrecognized value "${choice}" — expected one of ${FINISH_CHOICE_VALUES.join(', ')}`,
      };
    } catch {
      return {
        done: false,
        reason: `finish produced no pr_url and no ${FINISH_CHOICE_MARKER} marker (skill must record the chosen outcome)`,
      };
    }
  },

  build: async (dir: string): Promise<CompletionResult> => {
    const statusPath = join(dir, '.pipeline/task-status.json');
    let raw: string;
    try {
      raw = await readFile(statusPath, 'utf-8');
    } catch {
      return {
        done: false,
        reason: 'missing .pipeline/task-status.json — the pipeline skill must create it',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { done: false, reason: 'invalid JSON in .pipeline/task-status.json' };
    }
    const tasks = extractTasks(parsed);
    if (tasks.length === 0) {
      return { done: false, reason: 'no tasks in task-status.json' };
    }
    const incomplete = tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
    if (incomplete.length > 0) {
      const names = incomplete.slice(0, 3).map((t) => t.id ?? '?').join(', ');
      const more = incomplete.length > 3 ? ` (+${incomplete.length - 3} more)` : '';
      return {
        done: false,
        reason: `${incomplete.length}/${tasks.length} tasks not completed: ${names}${more}`,
      };
    }
    return { done: true };
  },
};

interface TaskEntry {
  id?: string;
  status?: string;
}

function extractTasks(parsed: unknown): TaskEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  // Shape 1: { tasks: [...] } or { tasks: {id: {status}, ...} }
  const container = 'tasks' in (parsed as Record<string, unknown>)
    ? (parsed as Record<string, unknown>).tasks
    : parsed;
  if (Array.isArray(container)) {
    return container
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => ({ id: t.id as string | undefined, status: t.status as string | undefined }));
  }
  if (container && typeof container === 'object') {
    return Object.entries(container).map(([id, v]) => ({
      id,
      status:
        v && typeof v === 'object' && 'status' in v
          ? ((v as Record<string, unknown>).status as string | undefined)
          : undefined,
    }));
  }
  return [];
}

/**
 * Decide whether a step is fully complete. Runs the custom predicate (if any),
 * otherwise falls back to artifact-glob presence. Steps with no declared
 * artifacts and no predicate are always considered complete.
 */
export async function checkStepCompletion(
  dir: string,
  step: StepName,
): Promise<CompletionResult> {
  const predicate = CUSTOM_COMPLETION_PREDICATES[step];
  if (predicate) return predicate(dir);

  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return { done: true };

  const files = await findArtifactFiles(dir, step);
  if (files.length > 0) return { done: true };
  return {
    done: false,
    reason: `no files matching ${patterns.join(' or ')}`,
  };
}

/**
 * For dashboard rendering: one record per pattern with the files matched and
 * a ✓/✗ flag. Returns [] for steps that produce no artifacts.
 */
export interface ArtifactPatternStatus {
  pattern: string;
  files: string[]; // relative to `dir`
  satisfied: boolean;
}

export async function getArtifactStatus(
  dir: string,
  step: StepName,
): Promise<ArtifactPatternStatus[]> {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return [];

  const out: ArtifactPatternStatus[] = [];
  for (const pattern of patterns) {
    const matched = await matchGlob(dir, pattern);
    const rel = matched.map((f) => relative(dir, f));
    out.push({
      pattern,
      files: rel,
      satisfied: rel.length > 0,
    });
  }
  return out;
}

// --- Glob matcher (inlined — avoids extra dependency for a narrow use case) ---

async function matchGlob(root: string, pattern: string): Promise<string[]> {
  const parts = pattern.split('/');
  const files: string[] = [];

  const doubleStarIdx = parts.indexOf('**');
  if (doubleStarIdx >= 0) {
    // dir/**/rest — walk recursively under dir, filter by last-segment pattern
    const baseParts = parts.slice(0, doubleStarIdx);
    const tailParts = parts.slice(doubleStarIdx + 1);
    const baseDir = join(root, ...baseParts);
    const tail = tailParts[tailParts.length - 1] ?? '*';
    const matcher = compileSegmentMatcher(tail);
    files.push(...(await walkDir(baseDir, matcher)));
    return files;
  }

  if (parts[parts.length - 1].includes('*')) {
    // dir/*.ext — list one directory
    const dirParts = parts.slice(0, -1);
    const filePattern = parts[parts.length - 1];
    const matcher = compileSegmentMatcher(filePattern);
    const dir = join(root, ...dirParts);
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (matcher(entry)) files.push(join(dir, entry));
      }
    } catch {
      /* dir missing — no matches */
    }
    return files;
  }

  // Literal path (e.g., `.pipeline/task-status.json`)
  const { access } = await import('fs/promises');
  const full = join(root, pattern);
  try {
    await access(full);
    files.push(full);
  } catch {
    /* not present */
  }
  return files;
}

function compileSegmentMatcher(pattern: string): (name: string) => boolean {
  if (pattern === '*') return () => true;
  // Support `foo-*.md`, `*.md`, `foo*bar.md`
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return (name: string): boolean => re.test(name);
}

async function walkDir(
  dir: string,
  match: (name: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkDir(full, match)));
    } else if (match(entry.name)) {
      found.push(full);
    }
  }
  return found;
}
