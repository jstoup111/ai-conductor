import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

// Simple logger interface for fail-closed operations
interface EvidenceRangeLogger {
  anomalies: string[];
  warnings: string[];
}

function createEvidenceRangeLogger(): EvidenceRangeLogger {
  return {
    anomalies: [],
    warnings: [],
  };
}

/**
 * Auto-heal records `.pipeline/task-status.json` drift against the branch's
 * git log BEFORE the build-step completion gate re-invokes Claude. When a
 * prior pipeline run crashed mid-batch, commits can exist on disk for tasks
 * the status file still marks "pending". Fix A (buildRetryHint) tells Claude
 * to reconcile; Fix C caps recovery retries. This is Fix B — the engine
 * itself reconciles before the retry runs, so the gate passes with no Claude
 * involvement when the evidence is unambiguous.
 *
 * Evidence bar (both conditions must hold for a commit to heal a task):
 *  1. Commit subject contains `T<id>`, `#<id>` (word-boundary on the id),
 *     OR a case-insensitive substring of `task.name`. Short names (<12 chars)
 *     get word-boundary matching so `user` doesn't match `userController`.
 *  2. Commit's diff touches at least one file the plan attributes to this
 *     task. If the plan has no files for the task, the commit-message check
 *     is upgraded to require BOTH `T<id>` AND `task.name` — no file-path
 *     signal means we need a stricter message signal.
 *
 * Anything weaker is skipped — the conductor falls through to the existing
 * (Fix A) retry hint so Claude or the user can decide.
 */

export interface HealedTask {
  taskId: string;
  commit: string;
  subject: string;
  matchedFiles: string[];
}

export interface SkippedTask {
  taskId: string;
  reason: string;
}

export interface AutoHealResult {
  healed: HealedTask[];
  skipped: SkippedTask[];
}

interface TaskRecord {
  id: string;
  name?: string;
  status?: string;
  rawEntry: Record<string, unknown>;
}

interface ParsedStatus {
  parsed: Record<string, unknown>;
  tasks: TaskRecord[];
  planRef?: string;
  statusPath: string;
}

export async function attemptAutoHeal(projectRoot: string): Promise<AutoHealResult> {
  const result: AutoHealResult = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    const pendingTasks = status.tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) return result;

    const commits = await listCommits(projectRoot);
    if (commits.length === 0) {
      for (const t of pendingTasks) {
        result.skipped.push({ taskId: t.id, reason: 'no git commits available' });
      }
      await writeAuditFile(projectRoot, result);
      return result;
    }

    const planPaths = await readPlanPaths(projectRoot, status.planRef);

    for (const task of pendingTasks) {
      const match = await findMatchingCommit(projectRoot, task, commits, planPaths);
      if (!match) {
        result.skipped.push({ taskId: task.id, reason: 'no unambiguous commit match' });
        continue;
      }
      task.rawEntry.status = 'completed';
      if ('commit' in task.rawEntry || !('commit' in task.rawEntry)) {
        task.rawEntry.commit = match.commit.slice(0, 7);
      }
      result.healed.push({
        taskId: task.id,
        commit: match.commit.slice(0, 7),
        subject: match.subject,
        matchedFiles: match.matchedFiles,
      });
    }

    if (result.healed.length > 0) {
      await writeTaskStatus(status);
    }
    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}

async function readTaskStatus(projectRoot: string): Promise<ParsedStatus | null> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const tasks = extractTaskRecords(root);
  if (tasks.length === 0) return null;
  const planRef = typeof root.plan_ref === 'string' ? root.plan_ref : undefined;
  return { parsed: root, tasks, planRef, statusPath };
}

function extractTaskRecords(root: Record<string, unknown>): TaskRecord[] {
  const container = 'tasks' in root ? root.tasks : root;
  if (Array.isArray(container)) {
    return container
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }))
      .filter((t) => t.id !== '');
  }
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    return Object.entries(container as Record<string, unknown>)
      .filter((e): e is [string, Record<string, unknown>] => typeof e[1] === 'object' && e[1] !== null)
      .map(([id, entry]) => ({
        id,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }));
  }
  return [];
}

async function writeTaskStatus(status: ParsedStatus): Promise<void> {
  const serialized = JSON.stringify(status.parsed, null, 2) + '\n';
  await writeFile(status.statusPath, serialized);
}

interface CommitInfo {
  sha: string;
  subject: string;
}

export interface CommitWithTrailers {
  sha: string;
  subject: string;
  trailers: Record<string, string[]>;
}

export interface EvidenceRangeResult {
  commits: CommitWithTrailers[];
  anomalies: string[];
  warnings: string[];
}

/**
 * Get evidence range for a task, anchored to a plan SHA.
 * Fails closed: if origin/main doesn't exist, returns zero commits.
 * If anchor is unreachable, falls back to merge-base.
 * All failures are logged but never thrown.
 *
 * @param projectRoot - Root of the git repository
 * @param anchor - Plan anchor SHA (required); commits before this are excluded
 * @returns EvidenceRangeResult with commits, anomalies, and warnings
 */
export async function getEvidenceRange(
  projectRoot: string,
  anchor: string,
): Promise<EvidenceRangeResult> {
  const logger = createEvidenceRangeLogger();
  const result: EvidenceRangeResult = {
    commits: [],
    anomalies: logger.anomalies,
    warnings: logger.warnings,
  };

  try {
    // Check if origin/main exists
    const refCheck = await execa('git', ['rev-parse', '--verify', 'origin/main'], {
      cwd: projectRoot,
      reject: false,
    });

    if (refCheck.exitCode !== 0) {
      const msg = 'Evidence range: origin/main does not exist; returning zero commits (fail-closed)';
      logger.anomalies.push(msg);
      console.error(msg);
      return result;
    }

    // Try to get merge-base for fallback
    const mergeBase = await execa('git', ['merge-base', '--fork-point', 'origin/main', 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });

    let lowerBound: string | null = null;

    // First, verify that anchor is reachable
    const anchorCheck = await execa('git', ['rev-parse', '--verify', `${anchor}^{commit}`], {
      cwd: projectRoot,
      reject: false,
    });

    if (anchorCheck.exitCode === 0) {
      // Anchor is reachable, use it as lower bound
      lowerBound = anchor;
    } else {
      // Anchor is unreachable, fall back to merge-base
      const warningMsg = `Evidence range: anchor ${anchor.slice(0, 7)} is unreachable; falling back to merge-base`;
      logger.warnings.push(warningMsg);
      console.warn(warningMsg);

      if (mergeBase.exitCode === 0 && mergeBase.stdout.trim()) {
        lowerBound = mergeBase.stdout.trim();
      }
    }

    // Build the range
    let range: string;
    if (lowerBound) {
      range = `${lowerBound}..HEAD`;
    } else {
      // No valid lower bound, use HEAD with limit
      range = 'HEAD';
    }

    // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
    const args =
      range === 'HEAD'
        ? ['log', '-n', '100', '--format=%H%x09%s%x00%(trailers)%x1e', 'HEAD']
        : ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

    const log = await execa('git', args, { cwd: projectRoot, reject: false });
    if (log.exitCode === 0 && typeof log.stdout === 'string') {
      result.commits = log.stdout
        .split('\x1e') // Split by record separator
        .map((record) => record.trim())
        .filter((record) => record.length > 0)
        .map((record) => {
          const nullIndex = record.indexOf('\x00');
          if (nullIndex < 0) return null;

          const metaPart = record.slice(0, nullIndex);
          const trailersPart = record.slice(nullIndex + 1);

          const tabIndex = metaPart.indexOf('\t');
          if (tabIndex < 0) return null;

          const sha = metaPart.slice(0, tabIndex);
          const subject = metaPart.slice(tabIndex + 1);

          const trailers = parseTrailers(trailersPart);

          return { sha, subject, trailers };
        })
        .filter((item): item is CommitWithTrailers => item !== null);
    }
  } catch (err) {
    // Catch any unexpected errors and log them
    const errMsg = `Evidence range: unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    logger.anomalies.push(errMsg);
    console.error(errMsg);
  }

  return result;
}

async function listCommits(projectRoot: string): Promise<CommitInfo[]> {
  const mergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
    cwd: projectRoot,
    reject: false,
  });

  let range: string;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = 'HEAD';
  }

  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s', 'HEAD']
      : ['log', '--format=%H%x09%s', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab < 0) return { sha: line, subject: '' };
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

export async function listCommitsWithTrailers(
  projectRoot: string,
  anchor?: string,
): Promise<CommitWithTrailers[]> {
  // If anchor is provided, use the evidence range (fail-closed)
  if (anchor) {
    const range = await getEvidenceRange(projectRoot, anchor);
    return range.commits;
  }

  // Legacy path: no anchor provided, use simple merge-base logic
  const mergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
    cwd: projectRoot,
    reject: false,
  });

  let range: string;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = 'HEAD';
  }

  // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s%x00%(trailers)%x1e', 'HEAD']
      : ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\x1e') // Split by record separator
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const nullIndex = record.indexOf('\x00');
      if (nullIndex < 0) return null;

      const metaPart = record.slice(0, nullIndex);
      const trailersPart = record.slice(nullIndex + 1);

      const tabIndex = metaPart.indexOf('\t');
      if (tabIndex < 0) return null;

      const sha = metaPart.slice(0, tabIndex);
      const subject = metaPart.slice(tabIndex + 1);

      const trailers = parseTrailers(trailersPart);

      return { sha, subject, trailers };
    })
    .filter((item): item is CommitWithTrailers => item !== null);
}

export interface DeriveCompletionResult {
  [taskId: string]: {
    completed: boolean;
    evidencedBy?: string;
    auditEntry?: string;
  };
}

/**
 * Derive task completion from git trailers.
 * Trailer-first: checks for Task: <id> trailers in commit bodies.
 * Path corroboration: if task has paths, commit must touch at least one.
 * Sidecar writes: evidence stamps stored in task-evidence.json on completion.
 *
 * @param projectRoot - Root of the git repository
 * @param planPath - Path to the plan markdown file
 * @param anchor - Plan anchor SHA for evidence range
 * @param commits - CommitWithTrailers array (from listCommitsWithTrailers)
 * @param evidence - TaskEvidence instance for sidecar writes
 * @returns Map of task ID → {completed, evidencedBy?, auditEntry?}
 */
export async function deriveCompletion(
  projectRoot: string,
  planPath: string,
  anchor: string,
  commits: CommitWithTrailers[],
  evidence: any, // TaskEvidence type from task-evidence.ts
): Promise<DeriveCompletionResult> {
  const result: DeriveCompletionResult = {};

  // Parse the plan to extract tasks and their file paths
  let planText: string;
  try {
    planText = await readFile(planPath, 'utf-8');
  } catch {
    return result;
  }

  const planTasks = parsePlanTasks(planText);
  const planPaths = parsePlanTaskPaths(planText);

  for (const [taskId, task] of planTasks) {
    result[taskId] = { completed: false };

    // Look for a commit with Task: <taskId> trailer
    const matchingCommit = commits.find((c) => {
      const taskTrailers = c.trailers['Task'] || [];
      return taskTrailers.includes(taskId);
    });

    if (!matchingCommit) {
      continue;
    }

    // Found a commit with the Task: trailer
    const taskPaths = planPaths.get(taskId);
    const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

    if (!hasPlanFiles) {
      // Task has no specific paths; trailer alone is enough
      result[taskId].completed = true;
      result[taskId].evidencedBy = matchingCommit.sha;
      evidence.evidenceStamps.set(taskId, { sha: matchingCommit.sha, form: 'trailer' });
      continue;
    }

    // Task has paths; verify commit touches at least one
    const filesInCommit = await filesForCommit(projectRoot, matchingCommit.sha);
    const overlap = filesInCommit.filter((f) => taskPaths!.has(f.replace(/^\.\//, '')));

    if (overlap.length === 0) {
      // Path mismatch: log audit entry
      result[taskId].auditEntry = `Task ${taskId}: trailer found but no path overlap. Commit ${matchingCommit.sha.slice(0, 7)} touched [${filesInCommit.slice(0, 3).join(', ')}...] but expected paths like [${Array.from(taskPaths).slice(0, 3).join(', ')}...]`;
      console.warn(
        `[autoheal] Path corroboration failed for task ${taskId}: trailer ${matchingCommit.sha.slice(0, 7)} has no overlap with plan paths`,
      );
      continue;
    }

    // Path overlap confirmed; mark completed
    result[taskId].completed = true;
    result[taskId].evidencedBy = matchingCommit.sha;
    evidence.evidenceStamps.set(taskId, { sha: matchingCommit.sha, form: 'trailer' });
  }

  // Write evidence to sidecar
  await evidence.write();

  return result;
}

function parseTrailers(trailerText: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (!trailerText || trailerText.trim().length === 0) {
    return result;
  }

  const lines = trailerText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Key: value" format (with space after colon)
    // Keys must be alphanumeric, hyphens allowed
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];

    // Only capture Task and Evidence trailers
    if (key !== 'Task' && key !== 'Evidence') continue;

    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }

  return result;
}

async function filesForCommit(projectRoot: string, sha: string): Promise<string[]> {
  const out = await execa('git', ['diff-tree', '--name-only', '-r', sha], {
    cwd: projectRoot,
    reject: false,
  });
  if (out.exitCode !== 0 || typeof out.stdout !== 'string') return [];
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPlanPaths(
  projectRoot: string,
  planRef: string | undefined,
): Promise<Map<string, Set<string>>> {
  const empty = new Map<string, Set<string>>();
  if (!planRef) return empty;
  const planPath = resolvePlanPath(projectRoot, planRef);
  let text: string;
  try {
    text = await readFile(planPath, 'utf-8');
  } catch {
    return empty;
  }
  return parsePlanTaskPaths(text);
}

function resolvePlanPath(projectRoot: string, planRef: string): string {
  const trimmed = planRef.trim();
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (withExt.startsWith('/')) return withExt;
  if (withExt.startsWith('.docs/') || withExt.startsWith('./')) {
    return join(projectRoot, withExt);
  }
  return join(projectRoot, '.docs/plans', withExt);
}

const PATH_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|sh|rb|py|go|rs|html|css|scss|vue|toml)$/i;
const BACKTICK_TOKEN = /`([^`\s]+)`/g;

export interface PlanTask {
  name: string;
  paths: string[];
}

export function parsePlanTasks(text: string): Map<string, PlanTask> {
  const result = new Map<string, PlanTask>();
  const lines = text.split('\n');
  let currentTaskId: string | null = null;

  // Match: ### Task N: Title or ## Task N: Title, etc.
  // Requires colon and title after the task id
  const taskHeaderWithTitle = /^#{1,6}\s+Task\s+(\d+):\s*(.+)$/;

  for (const line of lines) {
    const headerMatch = line.match(taskHeaderWithTitle);
    if (headerMatch) {
      const id = headerMatch[1];
      const name = headerMatch[2].trim();
      currentTaskId = id;
      result.set(id, { name, paths: [] });
      continue;
    }

    if (!currentTaskId) continue;

    // Extract paths from backtick-delimited tokens
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      const task = result.get(currentTaskId);
      if (task && !task.paths.includes(normalized)) {
        task.paths.push(normalized);
      }
    }
  }

  return result;
}

export function parsePlanTaskPaths(text: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const lines = text.split('\n');
  let currentTaskIds: string[] = [];

  const taskHeader = /^#{1,6}\s+Task\s+([\d.,\s-]+?)(?::|\s|$)/i;

  for (const line of lines) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      currentTaskIds = expandTaskIds(headerMatch[1]);
      for (const id of currentTaskIds) {
        if (!result.has(id)) result.set(id, new Set());
      }
      continue;
    }
    if (currentTaskIds.length === 0) continue;
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      for (const id of currentTaskIds) {
        result.get(id)!.add(normalized);
      }
    }
  }

  return result;
}

function expandTaskIds(raw: string): string[] {
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) ids.push(String(n));
    } else if (/^\d+$/.test(trimmed)) {
      ids.push(trimmed);
    }
  }
  return ids;
}

interface CommitMatch {
  commit: string;
  subject: string;
  matchedFiles: string[];
}

async function findMatchingCommit(
  projectRoot: string,
  task: TaskRecord,
  commits: CommitInfo[],
  planPaths: Map<string, Set<string>>,
): Promise<CommitMatch | null> {
  const taskPaths = planPaths.get(task.id);
  const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

  for (const commit of commits) {
    const { idMatch, nameMatch } = matchSubject(commit.subject, task);
    if (!idMatch && !nameMatch) continue;

    if (!hasPlanFiles) {
      if (!(idMatch && nameMatch)) continue;
      return { commit: commit.sha, subject: commit.subject, matchedFiles: [] };
    }

    const files = await filesForCommit(projectRoot, commit.sha);
    const overlap = files.filter((f) => taskPaths!.has(f.replace(/^\.\//, '')));
    if (overlap.length === 0) continue;
    return { commit: commit.sha, subject: commit.subject, matchedFiles: overlap };
  }

  return null;
}

function matchSubject(subject: string, task: TaskRecord): { idMatch: boolean; nameMatch: boolean } {
  const idRe = new RegExp(`(?:^|[^0-9A-Za-z])(?:T${escapeRegex(task.id)}|#${escapeRegex(task.id)})(?![0-9A-Za-z])`);
  const idMatch = idRe.test(subject);

  let nameMatch = false;
  if (task.name && task.name.trim().length > 0) {
    const name = task.name.trim();
    if (name.length < 12) {
      const wordRe = new RegExp(`(?:^|\\W)${escapeRegex(name)}(?:\\W|$)`, 'i');
      nameMatch = wordRe.test(subject);
    } else {
      nameMatch = subject.toLowerCase().includes(name.toLowerCase());
    }
  }
  return { idMatch, nameMatch };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeAuditFile(projectRoot: string, result: AutoHealResult): Promise<void> {
  const dir = join(projectRoot, '.pipeline', 'audit-trail');
  await mkdir(dir, { recursive: true }).catch(() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `autoheal-${stamp}.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n').catch(() => {});
}
