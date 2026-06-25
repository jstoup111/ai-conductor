import { access, readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { StepName } from '../types/index.js';
import { slugify } from './worktree.js';

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
  // Acceptance/system specs land in stack-specific places. Cover the common
  // conventions so the completion check doesn't false-fail on a non-Rails
  // project (e.g. a Node app whose tests are `app.test.js` at the root). The
  // patterns avoid recursing node_modules (root globs are non-recursive; the
  // `**` ones are scoped to test dirs).
  acceptance_specs: [
    'spec/acceptance/**/*',
    'spec/requests/**/*',
    'spec/system/**/*',
    'test/acceptance/**/*',
    'test/**/*',
    'tests/**/*',
    '__tests__/**/*',
    '*.test.js',
    '*.test.ts',
    '*.spec.js',
    '*.spec.ts',
  ],
  build: ['.pipeline/task-status.json'],
  manual_test: ['.docs/manual-test-results.md'],
  retro: ['.docs/retros/*.md'],
  finish: [],
};

/**
 * True if `path` exists AND its mtime is at or after `sessionStartedAt`.
 * SHIP-phase completion predicates use this to reject artifacts left over
 * from a previous conductor session — without it, a `.docs/manual-test-
 * results.md` from a prior feature, or a stale `.pipeline/finish-choice`,
 * would silently satisfy the gate.
 *
 * When `sessionStartedAt` is undefined (legacy state without the stamp,
 * or callers that opt out), returns true on file presence — fail open
 * rather than break in-flight features on upgrade.
 */
export async function fileIsFreshSinceSession(
  path: string,
  sessionStartedAt: number | undefined,
): Promise<boolean> {
  try {
    const s = await stat(path);
    if (sessionStartedAt === undefined) return true;
    return s.mtimeMs >= sessionStartedAt;
  } catch {
    return false;
  }
}

export const HALT_MARKER = '.pipeline/halt-user-input-required';

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

/** Context threaded through completion predicates. Optional fields fail open. */
export interface CompletionContext {
  /** Epoch ms; predicates reject artifacts older than this when set. */
  sessionStartedAt?: number;
  /** Used by the retro predicate to prefer slug-matched filenames. */
  featureDesc?: string;
}

export const CUSTOM_COMPLETION_PREDICATES: Partial<
  Record<StepName, (dir: string, ctx: CompletionContext) => Promise<CompletionResult>>
> = {
  // Build is "done" only when (a) no halt marker is present and (b) every
  // task in .pipeline/task-status.json is completed or skipped. The halt-
  // marker check exists because a pipeline session that exits at the user's
  // explicit request (e.g. "exit to harness, continue later") may leave
  // task-status.json showing all-complete from prior tasks while the
  // user-requested blocker is still open. The pipeline skill writes
  // .pipeline/halt-user-input-required in that case (skills/pipeline/SKILL.md
  // §"User-requested exit during a run"); the conductor's stall handler
  // clears it before re-checking, so a marker that survives to gate-check
  // means a true halt that bypassed the stall handler.
  build: async (dir: string): Promise<CompletionResult> => {
    try {
      await access(join(dir, HALT_MARKER));
      return {
        done: false,
        reason: `${HALT_MARKER} is present — pipeline halted; conductor will open a recovery REPL`,
      };
    } catch {
      // No marker — proceed.
    }

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

  // Manual-test passes only when .docs/manual-test-results.md exists, has
  // no FAIL rows, and was written this session. Previously the step had no
  // gate at all (STEP_ARTIFACT_GLOBS['manual_test'] = []) — any clean REPL
  // exit marked it done with zero proof of work.
  manual_test: async (dir, ctx): Promise<CompletionResult> => {
    const file = join(dir, '.docs/manual-test-results.md');
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      return {
        done: false,
        reason: '.docs/manual-test-results.md is missing — the manual-test skill must record per-story PASS/FAIL results before exiting',
      };
    }
    if (/\|\s*FAIL/i.test(content)) {
      return {
        done: false,
        reason: '.docs/manual-test-results.md contains FAIL rows — fix the bugs and re-run manual-test',
      };
    }
    if (!(await fileIsFreshSinceSession(file, ctx.sessionStartedAt))) {
      return {
        done: false,
        reason: '.docs/manual-test-results.md exists but is stale (mtime predates this conductor session); manual-test must re-run for the current feature',
      };
    }
    return { done: true };
  },

  // Retro passes when a fresh retro file exists for THIS feature. Filename
  // should contain the slug per skills/retro/SKILL.md ("Save to
  // .docs/retros/YYYY-MM-DD-<feature-name>.md"). Falls back to "any retro
  // fresh in this session" when no feature_desc is available.
  retro: async (dir, ctx): Promise<CompletionResult> => {
    const allFiles = await findArtifactFiles(dir, 'retro');
    if (allFiles.length === 0) {
      return {
        done: false,
        reason: 'no .docs/retros/*.md present (retro skill must save a report)',
      };
    }
    const slug = ctx.featureDesc ? slugify(ctx.featureDesc) : null;
    if (slug) {
      const matched = allFiles.filter(
        (f) => f.endsWith(`-${slug}.md`) || f.endsWith(`/${slug}.md`),
      );
      if (matched.length > 0) {
        for (const f of matched) {
          if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
        }
        return {
          done: false,
          reason: `slug-matched retro exists but is stale (mtime predates this session) — retro must re-run`,
        };
      }
      // No slug match — accept any retro file fresh in this session as a
      // fallback (covers very long feature_desc, slug truncation, etc.).
      for (const f of allFiles) {
        if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
      }
      return {
        done: false,
        reason: `no retro found for current feature (expected .docs/retros/*-${slug}.md OR a retro file with mtime >= session start)`,
      };
    }
    for (const f of allFiles) {
      if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
    }
    return {
      done: false,
      reason: 'retro files exist but none are fresh for this session',
    };
  },

  // Finish passes only when a fresh .pipeline/finish-choice marker is
  // present (mtime >= sessionStartedAt). The conductor sweeps stale markers
  // at session start (Conductor.run), so any marker observed here was
  // written by the finish skill in this run. For choice='pr', also require
  // state.pr_url to be set. The previous "pr_url alone passes" path was
  // dropped because pr_url from a prior feature in the same worktree could
  // satisfy the gate spuriously.
  finish: async (dir, ctx): Promise<CompletionResult> => {
    const choicePath = join(dir, FINISH_CHOICE_MARKER);
    let choice: string;
    try {
      choice = (await readFile(choicePath, 'utf-8')).trim();
    } catch {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is missing — the finish skill must record the chosen outcome (pr | merge-local | keep | discard)`,
      };
    }
    if (!(FINISH_CHOICE_VALUES as readonly string[]).includes(choice)) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} contains unrecognized value "${choice}" — expected one of ${FINISH_CHOICE_VALUES.join(', ')}`,
      };
    }
    if (!(await fileIsFreshSinceSession(choicePath, ctx.sessionStartedAt))) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is stale (mtime predates this session) — finish must re-run`,
      };
    }
    if (choice === 'pr') {
      try {
        const raw = await readFile(join(dir, '.pipeline/conduct-state.json'), 'utf-8');
        const state = JSON.parse(raw) as { pr_url?: string };
        if (!state.pr_url) {
          return {
            done: false,
            reason: `${FINISH_CHOICE_MARKER}="pr" but no pr_url in state — the PR URL must be recorded`,
          };
        }
      } catch {
        return {
          done: false,
          reason: 'cannot read state to confirm pr_url for finish-choice="pr"',
        };
      }
    }
    return { done: true };
  },
};

/**
 * Richer gate predicates for kickback-target steps, kept SEPARATE from
 * CUSTOM_COMPLETION_PREDICATES so the existing linear conductor's completion
 * gate is unchanged. Consumed only by the gate-verdict layer (gate-verdicts.ts);
 * the loop (Phase 3) decides when to enforce them.
 */
export const GATE_ONLY_PREDICATES: Partial<
  Record<StepName, (dir: string, ctx: CompletionContext) => Promise<CompletionResult>>
> = {
  // Stories pass when every story has a Happy Path AND a Negative Path(s)
  // section (each with ≥1 Given/When/Then bullet) and no DRAFT status.
  // Structural check against the repo convention (### Happy Path / ###
  // Negative Paths headings, **Status:** marker). See gate-audit-2026-06-23.md.
  stories: async (dir): Promise<CompletionResult> => {
    const files = await findArtifactFiles(dir, 'stories');
    if (files.length === 0) {
      return { done: false, reason: 'no .docs/stories/**/*.md present' };
    }
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const rel = relative(dir, file);
      if (/^\s*\*\*Status:\*\*\s*DRAFT\b/im.test(content)) {
        return {
          done: false,
          reason: `${rel}: story is DRAFT — must be accepted before planning`,
        };
      }
      for (const block of splitStoryBlocks(content)) {
        const label = `${rel}${block.id ? ` (Story ${block.id})` : ''}`;
        const hasHappy = hasPathSection(block.text, 'happy');
        const hasNegative = hasPathSection(block.text, 'negative');
        if (!hasHappy || !hasNegative) {
          const missing =
            !hasHappy && !hasNegative
              ? 'happy and negative paths'
              : !hasHappy
                ? 'a happy path'
                : 'a negative path';
          return {
            done: false,
            reason: `${label}: missing ${missing} (each story needs a Happy Path and a Negative Path(s) section with ≥1 Given/When/Then bullet)`,
          };
        }
      }
    }
    return { done: true };
  },

  // Plan passes when every story's happy path AND negative path is covered by
  // ≥1 task. Coverage is read from task `**Story:** <id> (happy|negative path)`
  // lines and the `## Coverage Check` table. Falls back to story-level coverage
  // when a plan has no path-type markers for a story. See gate-audit-2026-06-23.md.
  plan: async (dir): Promise<CompletionResult> => {
    const planFiles = await findArtifactFiles(dir, 'plan');
    if (planFiles.length === 0) {
      return { done: false, reason: 'no .docs/plans/*.md present' };
    }
    const storyFiles = await findArtifactFiles(dir, 'stories');
    if (storyFiles.length === 0) {
      return { done: false, reason: 'no .docs/stories to check plan coverage against' };
    }

    // Required coverage units: (storyId, pathType) for each path a story declares.
    const required: { id: string; type: 'happy' | 'negative' }[] = [];
    for (const sf of storyFiles) {
      const content = await readFile(sf, 'utf-8');
      for (const block of splitStoryBlocks(content)) {
        const id = block.id ?? storyIdFromFilename(sf);
        if (!id) continue;
        if (hasPathSection(block.text, 'happy')) required.push({ id, type: 'happy' });
        if (hasPathSection(block.text, 'negative')) required.push({ id, type: 'negative' });
      }
    }
    // Stories exist but yield no parseable IDs/paths — plan presence suffices.
    if (required.length === 0) return { done: true };

    let planText = '';
    for (const pf of planFiles) planText += '\n' + (await readFile(pf, 'utf-8'));
    const covered = collectPlanCoverage(planText);

    const gaps: string[] = [];
    for (const r of required) {
      if (covered.has(`${r.id}|${r.type}`)) continue;
      // Fallback: if the plan declares no path-type for this story at all,
      // accept a story-level reference as covering both paths.
      const hasPathType =
        covered.has(`${r.id}|happy`) || covered.has(`${r.id}|negative`);
      if (!hasPathType && covered.has(`${r.id}|*`)) continue;
      gaps.push(`${r.id} ${r.type}`);
    }
    if (gaps.length > 0) {
      const shown = gaps.slice(0, 5).join(', ');
      const more = gaps.length > 5 ? ` (+${gaps.length - 5} more)` : '';
      return {
        done: false,
        reason: `plan does not cover: ${shown}${more} — add task(s) referencing these story paths`,
      };
    }
    // The plan must declare a task dependency tree so `build` (pipeline) can
    // order the work topologically. See skills/plan/SKILL.md (Task Dependency
    // Graph) + skills/pipeline/SKILL.md which consumes it.
    if (!planHasDependencyTree(planText)) {
      return {
        done: false,
        reason:
          'plan has no task dependency tree — add a "## Task Dependency Graph" section or per-task "**Dependencies:**" lines',
      };
    }
    return { done: true };
  },
};

/**
 * True if the plan declares task dependencies — either a `## Task Dependency
 * Graph` section or per-task `**Dependencies:**` lines. Required so `build` can
 * order tasks topologically. Exported for daemon backlog eligibility.
 */
export function planHasDependencyTree(planText: string): boolean {
  return (
    /^##\s+task\s+dependency\s+graph/im.test(planText) ||
    /\*\*dependencies:\*\*/i.test(planText)
  );
}

// --- Story / plan structure parsing (shared by stories + plan predicates) ---

interface StoryBlock {
  id?: string;
  text: string;
}

/**
 * Split a stories file into per-story blocks on `## Story <id>:` headings.
 * Single-story files (no such heading) return one block spanning the file.
 */
function splitStoryBlocks(content: string): StoryBlock[] {
  const heading = /^##\s+Story\s+([A-Za-z0-9.\-]+)/i;
  const blocks: StoryBlock[] = [];
  let current: { id: string; lines: string[] } | null = null;
  for (const line of content.split('\n')) {
    const m = line.match(heading);
    if (m) {
      if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
      current = { id: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
  return blocks.length > 0 ? blocks : [{ text: content }];
}

/** True if the block has a Happy/Negative path section containing a G/W/T bullet. */
function hasPathSection(blockText: string, type: 'happy' | 'negative'): boolean {
  const body = sectionBody(
    blockText,
    type === 'happy' ? /happy\s*path/i : /negative\s*paths?/i,
  );
  if (body === null) return false;
  return /\bgiven\b/i.test(body) && /\bthen\b/i.test(body);
}

/**
 * Return the text under the first heading matching `headingRegex`, up to the
 * next heading of the same or higher level, or null if no such heading exists.
 */
function sectionBody(text: string, headingRegex: RegExp): string | null {
  let capturing = false;
  let level = 0;
  const body: string[] = [];
  for (const line of text.split('\n')) {
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      if (capturing && hm[1].length <= level) break;
      if (!capturing && headingRegex.test(hm[2])) {
        capturing = true;
        level = hm[1].length;
        continue;
      }
    }
    if (capturing) body.push(line);
  }
  return capturing ? body.join('\n') : null;
}

/** Extract a `ST-0NN` / `EP-0NN` id from a single-story filename, if present. */
function storyIdFromFilename(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const m = base.match(/\b(ST-\d+|EP-\d+)/i);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Coverage set keyed `${id}|happy` / `${id}|negative` / `${id}|*` (story-level).
 *
 * Plans are parsed per task block (split on `### ...` headings) so a task's
 * story reference and its path type are associated together. Two real-world
 * formats are both accepted:
 *   - id + path-type in the parens: `**Story:** 3.2-1 (happy path — foo)`
 *   - id with an optional `Story `/`Epic ` prefix word and the path type on a
 *     separate `**Type:** happy-path` / `**Type:** negative-path` line:
 *       `**Story:** Story 1 (FR-1, FR-2)` + `**Type:** happy-path`
 * A `## Coverage Check` table (`| 1 | happy | ... |`) is also honored.
 */
function collectPlanCoverage(planText: string): Set<string> {
  const set = new Set<string>();

  for (const block of splitOnHeadings(planText, /^###\s+/)) {
    // Story id(s) this task references. Strip an optional `Story `/`Epic `
    // prefix word so `**Story:** Story 1` and `**Story:** 1` both yield `1`.
    const ids = new Set<string>();
    const storyRef = /\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = storyRef.exec(block)) !== null) {
      const id = m[1];
      if (/^(n\/?a|prerequisite|none|all)$/i.test(id)) continue;
      ids.add(id);
    }
    if (ids.size === 0) continue;

    // Path type(s) this task covers: prefer an explicit `**Type:**` line, then
    // a happy/negative qualifier inside the Story parens, then a path keyword
    // anywhere in the block.
    const types = new Set<'happy' | 'negative'>();
    const typeLine = block.match(/\*\*Type:\*\*\s*([^\n]*)/i);
    if (typeLine) {
      if (/happy/i.test(typeLine[1])) types.add('happy');
      if (/negative/i.test(typeLine[1])) types.add('negative');
    }
    const parens = block.match(/\*\*Story:\*\*[^\n]*\(([^)]*)\)/i);
    if (parens) {
      if (/happy/i.test(parens[1])) types.add('happy');
      if (/negative/i.test(parens[1])) types.add('negative');
    }
    if (types.size === 0) {
      if (/\bhappy\s*path\b/i.test(block)) types.add('happy');
      if (/\bnegative\s*path\b/i.test(block)) types.add('negative');
    }

    for (const id of ids) {
      set.add(`${id}|*`);
      for (const t of types) set.add(`${id}|${t}`);
    }
  }

  // Coverage Check table rows: `| 1 | happy | ... |` or `| 1 happy | ... |`.
  const tableRow =
    /^\|\s*(?:story\s+)?([A-Za-z0-9.\-]+)\s*\|?\s*(happy|negative)\b/gim;
  let tm: RegExpExecArray | null;
  while ((tm = tableRow.exec(planText)) !== null) {
    set.add(`${tm[1]}|*`);
    set.add(`${tm[1]}|${tm[2].toLowerCase()}`);
  }
  return set;
}

/**
 * Split `text` into blocks, each beginning at a line matching `headingRe`.
 * Content before the first heading is discarded. Used to isolate plan task
 * blocks (`### Task N`) so per-task fields stay associated.
 */
function splitOnHeadings(text: string, headingRe: RegExp): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (headingRe.test(line)) {
      if (current) blocks.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join('\n'));
  return blocks;
}

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
 *
 * `ctx` is threaded into custom predicates that need to compare artifacts
 * against the current session (`sessionStartedAt`) or scope to the current
 * feature (`featureDesc`). When omitted, predicates fail open on freshness.
 */
export async function checkStepCompletion(
  dir: string,
  step: StepName,
  ctx: CompletionContext = {},
): Promise<CompletionResult> {
  const predicate = CUSTOM_COMPLETION_PREDICATES[step];
  if (predicate) return predicate(dir, ctx);

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
