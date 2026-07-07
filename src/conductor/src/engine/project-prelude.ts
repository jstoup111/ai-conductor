// Project-level prelude: runs once at the start of every conduct-ts invocation
// before the per-feature loop. Handles bootstrap + assess — both are
// project-scoped concerns (not per-feature) and have their own trigger rules.
//
// Trigger summary:
//   bootstrap → marker missing, or harness version bumped to a release with
//               a migration since the last bootstrap
//   assess    → project has an existing codebase AND no prior assessment, OR
//               existing assessment is stale (>90 days / >500 commits — both
//               configurable under config.assess.stale_after_*)

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import type { HarnessConfig } from '../types/config.js';
import type { LLMProvider } from '../execution/llm-provider.js';

const exec = promisify(execCb);

export const DEFAULT_ASSESS_STALE_DAYS = 90;
export const DEFAULT_ASSESS_STALE_COMMITS = 500;

export const BOOTSTRAP_MARKER_PATH = '.ai-conductor/bootstrapped.yml';
export const ASSESS_MARKER_PATH = '.ai-conductor/assessed.yml';
export const TECHNICAL_ASSESSMENT_GLOB = '.docs/decisions/technical-assessment-';

export type BootstrapReason = 'never_run' | 'migration';
export type AssessReason = 'never_run' | 'stale_time' | 'stale_commits' | 'forced';
export type AssessSkip = 'no_codebase' | 'recent' | 'not_confirmed';

export interface InvokeSkillResult {
  success: boolean;
  rateLimited?: boolean;
}

export interface PreludeResult {
  bootstrapExecuted: boolean;
  bootstrapReason?: BootstrapReason;
  assessExecuted: boolean;
  assessReason?: AssessReason;
  assessSkipped?: AssessSkip;
  bootstrapSuccess?: boolean;
  assessSuccess?: boolean;
}

export interface PreludeOptions {
  /** Current harness VERSION — used to detect migration-triggering bumps. */
  harnessVersion: string;
  /**
   * Predicate: given (lastBootstrappedVersion, currentVersion), does a
   * migration exist that requires re-bootstrapping? Default: any minor/major
   * bump triggers re-bootstrap; patch bumps don't.
   */
  hasMigration?: (from: string, to: string) => boolean;
  /**
   * If true, bypass the "already assessed" and staleness checks and re-run
   * assess. Used for `conduct-ts assess --force`.
   */
  forceAssess?: boolean;
  /**
   * Interactive prompt for stale-assessment confirmation. When omitted, stale
   * assessments are skipped (nudge-only behavior in auto mode).
   */
  onAssessStalePrompt?: (reason: { days: number; commits: number }) => Promise<boolean>;
}

interface BootstrapMarker {
  harness_version: string;
  bootstrapped_at: string;
}

interface AssessMarker {
  assessed_at: string;
  last_commit_sha?: string;
}

export async function runProjectPrelude(
  projectRoot: string,
  provider: LLMProvider,
  sessionId: string,
  config: HarnessConfig,
  options: PreludeOptions,
): Promise<PreludeResult> {
  const result: PreludeResult = {
    bootstrapExecuted: false,
    assessExecuted: false,
  };

  // --- Bootstrap -----------------------------------------------------------
  const bootstrapMarker = await readBootstrapMarker(projectRoot);
  const hasMigration = options.hasMigration ?? defaultHasMigration;
  let bootstrapReason: BootstrapReason | undefined;
  if (!bootstrapMarker) {
    bootstrapReason = 'never_run';
  } else if (hasMigration(bootstrapMarker.harness_version, options.harnessVersion)) {
    bootstrapReason = 'migration';
  }

  if (bootstrapReason) {
    result.bootstrapExecuted = true;
    result.bootstrapReason = bootstrapReason;
    const skillResult = await invokeSkill(provider, sessionId, '/bootstrap',
      'Run the bootstrap skill for this project. It is safe to re-run: detect ' +
      'current state, refresh artifacts, apply any harness migrations.');
    result.bootstrapSuccess = skillResult.success;
    if (skillResult.success) {
      await writeBootstrapMarker(projectRoot, options.harnessVersion);
    }
  }

  // --- Assess --------------------------------------------------------------
  const assessResult = await resolveAssessDecision(projectRoot, config, options);
  if (assessResult.decision === 'skip') {
    result.assessSkipped = assessResult.reason;
  } else {
    result.assessExecuted = true;
    result.assessReason = assessResult.reason;
    const skillResult = await invokeSkill(provider, sessionId, '/assess',
      'Run the assess skill. Produce or refresh technical-assessment docs and ' +
      'architecture decision records based on current project state.');
    result.assessSuccess = skillResult.success;
    if (skillResult.success) {
      const sha = await currentCommitSha(projectRoot);
      await writeAssessMarker(projectRoot, sha);
    }
  }

  return result;
}

export async function invokeSkill(
  provider: LLMProvider,
  sessionId: string,
  prompt: string,
  systemPrompt: string,
): Promise<InvokeSkillResult> {
  const result = await provider.invoke({
    prompt,
    sessionId,
    resume: false,
    dangerouslySkipPermissions: true,
    systemPrompt,
  });
  return {
    success: result.success,
    rateLimited: result.rateLimited,
  };
}

// ---------------------------------------------------------------------------
// Version / migration detection
// ---------------------------------------------------------------------------

export function defaultHasMigration(fromVersion: string, toVersion: string): boolean {
  const [fa, fb] = parseSemver(fromVersion);
  const [ta, tb] = parseSemver(toVersion);
  if (ta > fa) return true;        // major bump
  if (ta === fa && tb > fb) return true; // minor bump
  return false;                     // patch or same
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '');
  const parts = clean.split('.').map((p) => parseInt(p, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

// ---------------------------------------------------------------------------
// Bootstrap marker
// ---------------------------------------------------------------------------

export async function readBootstrapMarker(
  projectRoot: string,
): Promise<BootstrapMarker | null> {
  const path = join(projectRoot, BOOTSTRAP_MARKER_PATH);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = loadYaml(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.harness_version !== 'string' || typeof o.bootstrapped_at !== 'string') {
      return null;
    }
    return { harness_version: o.harness_version, bootstrapped_at: o.bootstrapped_at };
  } catch {
    return null;
  }
}

export async function writeBootstrapMarker(
  projectRoot: string,
  harnessVersion: string,
): Promise<void> {
  const path = join(projectRoot, BOOTSTRAP_MARKER_PATH);
  await mkdir(dirname(path), { recursive: true });
  const marker: BootstrapMarker = {
    harness_version: harnessVersion,
    bootstrapped_at: new Date().toISOString(),
  };
  await writeFile(path, dumpYaml(marker, { sortKeys: false }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Assess marker + decision
// ---------------------------------------------------------------------------

export async function readAssessMarker(
  projectRoot: string,
): Promise<AssessMarker | null> {
  const path = join(projectRoot, ASSESS_MARKER_PATH);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = loadYaml(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.assessed_at !== 'string') return null;
    return {
      assessed_at: o.assessed_at,
      last_commit_sha: typeof o.last_commit_sha === 'string' ? o.last_commit_sha : undefined,
    };
  } catch {
    return null;
  }
}

export async function writeAssessMarker(
  projectRoot: string,
  sha: string | null,
): Promise<void> {
  const path = join(projectRoot, ASSESS_MARKER_PATH);
  await mkdir(dirname(path), { recursive: true });
  const marker: AssessMarker = {
    assessed_at: new Date().toISOString(),
    ...(sha ? { last_commit_sha: sha } : {}),
  };
  await writeFile(path, dumpYaml(marker, { sortKeys: false }), 'utf-8');
}

type AssessDecision =
  | { decision: 'run'; reason: AssessReason }
  | { decision: 'skip'; reason: AssessSkip };

async function resolveAssessDecision(
  projectRoot: string,
  config: HarnessConfig,
  options: PreludeOptions,
): Promise<AssessDecision> {
  if (options.forceAssess) {
    return { decision: 'run', reason: 'forced' };
  }

  const codebase = await detectCodebase(projectRoot);
  if (!codebase) return { decision: 'skip', reason: 'no_codebase' };

  const hasAssessmentDoc = await hasTechnicalAssessment(projectRoot);
  const marker = await readAssessMarker(projectRoot);

  if (!hasAssessmentDoc && !marker) {
    return { decision: 'run', reason: 'never_run' };
  }

  // Staleness check.
  const staleDays = config.assess?.stale_after_days ?? DEFAULT_ASSESS_STALE_DAYS;
  const staleCommits = config.assess?.stale_after_commits ?? DEFAULT_ASSESS_STALE_COMMITS;
  const assessedAtStr = marker?.assessed_at;
  const daysElapsed = assessedAtStr ? daysSince(assessedAtStr) : null;
  const commitsElapsed = marker?.last_commit_sha
    ? await commitsSince(projectRoot, marker.last_commit_sha)
    : null;

  const timeStale = daysElapsed !== null && daysElapsed > staleDays;
  const commitsStale = commitsElapsed !== null && commitsElapsed > staleCommits;

  if (timeStale || commitsStale) {
    if (options.onAssessStalePrompt) {
      const go = await options.onAssessStalePrompt({
        days: daysElapsed ?? 0,
        commits: commitsElapsed ?? 0,
      });
      if (go) {
        return {
          decision: 'run',
          reason: timeStale ? 'stale_time' : 'stale_commits',
        };
      }
      return { decision: 'skip', reason: 'not_confirmed' };
    }
    // No prompt hook (auto mode) — nudge-only: don't force re-run.
    return { decision: 'skip', reason: 'recent' };
  }

  return { decision: 'skip', reason: 'recent' };
}

// ---------------------------------------------------------------------------
// Codebase / git helpers
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = /\.(rb|py|ts|tsx|js|jsx|go|rs|ex|exs|java|kt|swift|cs|php|c|cpp|h|hpp)$/;
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.pipeline',
  '.worktrees',
  '.claude',
  '.ai-conductor',
  '.docs',
  '.harness',
  'dist',
  'build',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
]);

export async function detectCodebase(projectRoot: string): Promise<boolean> {
  // Fast git-tracked scan first; falls back to direct fs walk if not a git repo.
  try {
    const { stdout } = await exec('git ls-files', { cwd: projectRoot });
    for (const line of stdout.split('\n')) {
      if (CODE_EXTENSIONS.test(line)) return true;
    }
  } catch {
    /* not a git repo — fall through */
  }
  return walkForCode(projectRoot, 0);
}

async function walkForCode(dir: string, depth: number): Promise<boolean> {
  if (depth > 4) return false;
  let entries: import('fs').Dirent[];
  try {
    const { readdir } = await import('fs/promises');
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && CODE_EXTENSIONS.test(entry.name)) return true;
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      if (await walkForCode(join(dir, entry.name), depth + 1)) return true;
    }
  }
  return false;
}

export async function hasTechnicalAssessment(projectRoot: string): Promise<boolean> {
  const decisionsDir = join(projectRoot, '.docs', 'decisions');
  if (!existsSync(decisionsDir)) return false;
  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(decisionsDir);
    return files.some((f) => f.startsWith('technical-assessment-') && f.endsWith('.md'));
  } catch {
    return false;
  }
}

export async function currentCommitSha(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git rev-parse HEAD', { cwd: projectRoot });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function commitsSince(projectRoot: string, sha: string): Promise<number | null> {
  if (!sha) return null;
  try {
    const { stdout } = await exec(`git rev-list --count ${sha}..HEAD`, {
      cwd: projectRoot,
    });
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function daysSince(isoTimestamp: string): number | null {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return null;
  const ms = Date.now() - then;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
