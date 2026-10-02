import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';

import {
  buildArtifactResolutionContext,
  resolveFeaturePlanPath,
  resolveFeaturePrdPaths,
} from './artifacts.js';
import { AcceptedWideningDecisionStore, type AcceptedWideningDecision } from './accepted-widenings.js';
import { parseCoherenceArtifact, type CoherenceRow } from './coherence-parse.js';
import { parsePlanTaskBodies, parsePlanTaskDoneWhen, parsePlanTaskStoryIds } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { makeGitRunner, originDefaultBranch, resolveBase, type GitRunner } from './rebase.js';
import { listItems, sectionBody, splitStoryBlocks } from './story-criteria.js';

/** Incremented only when the engine-rendered PRD-audit input contract changes. */
export const PRD_AUDIT_PROJECTION_VERSION = 1;

const PRD_AUDIT_DIFF_EXCERPT_PER_FILE_BYTES = 256 * 1024;
const PRD_AUDIT_DIFF_EXCERPT_TOTAL_BYTES = 512 * 1024;

export interface PrdAuditProjection {
  readonly version: typeof PRD_AUDIT_PROJECTION_VERSION;
  readonly plan: { readonly intent: string };
  readonly criteria: readonly {
    readonly id: string;
    readonly storyId: string;
    readonly kind: 'happy' | 'negative';
    readonly text: string;
  }[];
  readonly tasks: readonly {
    readonly id: string;
    readonly storyIds: readonly string[];
    readonly doneWhen: readonly string[];
  }[];
  readonly prd:
    | { readonly kind: 'absent' }
    | {
        /** Every feature-matching PRD stays available to the reviewer. */
        readonly sources: readonly { readonly path: string; readonly requirements: readonly { readonly id: string; readonly text: string }[] }[];
        /** Compatibility view of the first deterministic source. */
        readonly path: string;
        readonly requirements: readonly { readonly id: string; readonly text: string }[];
      };
  readonly coherence: readonly CoherenceRow[] | { readonly kind: 'absent' };
  readonly changes: {
    readonly base: string;
    readonly head: string;
    readonly changedFiles: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
    readonly excerpts: readonly string[];
    readonly omittedFiles: readonly {
      readonly path: string;
      readonly digest: string;
      readonly locator: {
        readonly kind: 'git-diff';
        readonly range: string;
        readonly path: string;
      };
    }[];
  };
  readonly history:
    | { readonly kind: 'absent' }
    | { readonly decisions: readonly AcceptedWideningDecision[] };
}

export type PrdAuditProjectionResult =
  | { readonly ok: true; readonly projection: PrdAuditProjection }
  | { readonly ok: false; readonly fault: { readonly dimension: string; readonly detail?: string } };

function repoPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function planIntent(plan: string): string | undefined {
  const match = /^##\s+Technical Approach\s*$/im.exec(plan);
  if (!match || match.index === undefined) return undefined;
  const section = plan.slice(match.index + match[0].length).split(/^##\s+/m, 1)[0] ?? '';
  return section.split('\n').map((line) => line.trim()).find(Boolean);
}

function criteriaFromStories(stories: string): PrdAuditProjection['criteria'] {
  const criteria: PrdAuditProjection['criteria'][number][] = [];
  for (const block of splitStoryBlocks(stories)) {
    if (!block.id) continue;
    let ordinal = 0;
    for (const kind of ['happy', 'negative'] as const) {
      const body = sectionBody(block.text, kind === 'happy' ? /happy\s*path/i : /negative\s*paths?/i);
      if (body === null) continue;
      for (const text of listItems(body)) {
        if (!/\bgiven\b/i.test(text) || !/\bthen\b/i.test(text)) continue;
        ordinal += 1;
        criteria.push({ id: `S${block.id}.${ordinal}`, storyId: block.id, kind, text });
      }
    }
  }
  return criteria;
}

function prdRequirements(prd: string): { readonly id: string; readonly text: string }[] {
  const heading = /^##\s+Functional Requirements\s*$/im.exec(prd);
  if (!heading || heading.index === undefined) return [];
  const section = prd.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? '';
  const requirements: { id: string; text: string }[] = [];
  for (const line of section.split('\n')) {
    const match = line.match(/\b(FR-\d+[A-Za-z]?)(?:\*\*)?\s*:\s*(.+)$/i);
    if (!match) continue;
    const id = match[1].toUpperCase();
    const text = match[2].replace(/^\*\*|\*\*$/g, '').trim();
    if (text && !requirements.some((requirement) => requirement.id === id)) requirements.push({ id, text });
  }
  return requirements;
}

function parseNumstat(text: string): PrdAuditProjection['changes']['changedFiles'] {
  return text.split('\n').filter(Boolean).map((line) => {
    const [added, deleted, path] = line.split('\t');
    return { path, additions: Number.parseInt(added, 10) || 0, deletions: Number.parseInt(deleted, 10) || 0 };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function decodeGitQuotedPath(encoded: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index]!;
    if (character !== '\\') {
      bytes.push(...Buffer.from(character));
      continue;
    }
    const escaped = encoded[index + 1];
    if (escaped !== undefined && /[0-7]/.test(escaped) && /^[0-7]{3}$/.test(encoded.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    const escapedBytes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
    bytes.push(escaped === undefined ? 92 : escapedBytes[escaped] ?? escaped.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString('utf-8');
}

function diffPathFromHeader(content: string): string | undefined {
  const header = content.match(/^diff --git (.+)$/m)?.[1];
  if (header === undefined) return undefined;
  const quoted = header.match(/^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/);
  if (quoted) return decodeGitQuotedPath(quoted[2]!);
  return header.match(/^a\/.* b\/(.+)$/)?.[1];
}

function boundedDiffExcerpts(
  diffText: string,
  range: string,
): Pick<PrdAuditProjection['changes'], 'excerpts' | 'omittedFiles'> | undefined {
  const excerpts: string[] = [];
  const omittedFiles: PrdAuditProjection['changes']['omittedFiles'][number][] = [];
  const files: { path: string; content: string }[] = [];
  for (const content of diffText.split(/(?=^diff --git )/m).filter(Boolean)) {
    const path = diffPathFromHeader(content);
    if (path === undefined) return undefined;
    files.push({ path, content });
  }

  let includedBytes = 0;
  for (const { path, content } of files.sort((left, right) => left.path.localeCompare(right.path))) {
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > PRD_AUDIT_DIFF_EXCERPT_PER_FILE_BYTES || includedBytes + bytes > PRD_AUDIT_DIFF_EXCERPT_TOTAL_BYTES) {
      omittedFiles.push({
        path,
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        locator: { kind: 'git-diff', range, path },
      });
      continue;
    }
    includedBytes += bytes;
    excerpts.push(content);
  }
  return { excerpts, omittedFiles };
}

async function discoverLocalBase(git: GitRunner): Promise<string> {
  const fromOrigin = await originDefaultBranch(git);
  if (fromOrigin) return fromOrigin;
  const current = (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const branches = (await git(['branch', '--format=%(refname:short)'])).stdout
    .split('\n').map((line) => line.trim()).filter(Boolean);
  for (const candidate of ['main', 'master', 'trunk']) {
    if (branches.includes(candidate) && candidate !== current) return candidate;
  }
  return branches.find((branch) => branch !== current) ?? 'main';
}

async function scopedChanges(projectRoot: string): Promise<Extract<PrdAuditProjectionResult, { ok: true }>['projection']['changes'] | undefined> {
  const git = makeGitRunner(projectRoot);
  const base = await resolveBase(git, await discoverLocalBase(git));
  const [baseSha, headSha] = await Promise.all([git(['rev-parse', base.ref]), git(['rev-parse', 'HEAD'])]);
  if (baseSha.exitCode !== 0 || headSha.exitCode !== 0) return undefined;
  const mergeBase = await git(['merge-base', baseSha.stdout.trim(), headSha.stdout.trim()]);
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) return undefined;
  const range = `${mergeBase.stdout.trim()}..${headSha.stdout.trim()}`;
  const [changes, diff] = await Promise.all([git(['diff', '--numstat', range]), git(['diff', range])]);
  if (changes.exitCode !== 0 || diff.exitCode !== 0) return undefined;
  const excerpts = boundedDiffExcerpts(diff.stdout, range);
  if (excerpts === undefined) return undefined;
  return { base: mergeBase.stdout.trim(), head: headSha.stdout.trim(), changedFiles: parseNumstat(changes.stdout), ...excerpts };
}

type WideningHistoryResult =
  | { readonly kind: 'available'; readonly history: PrdAuditProjection['history'] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'foreign' };

async function wideningHistory(projectRoot: string, activeFeature: string): Promise<WideningHistoryResult> {
  const path = join(projectRoot, '.pipeline', 'accepted-widenings.json');
  let raw: { feature?: { repository?: unknown; feature?: unknown } };
  try {
    raw = JSON.parse(await readFile(path, 'utf-8')) as typeof raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'available', history: { kind: 'absent' } };
    return { kind: 'invalid' };
  }
  if (typeof raw.feature?.repository !== 'string') return { kind: 'invalid' };
  const read = await new AcceptedWideningDecisionStore(projectRoot, {
    version: 1,
    repository: raw.feature.repository,
    feature: activeFeature,
  }).read();
  if (read.kind === 'valid') return { kind: 'available', history: { decisions: read.state.decisions } };
  if (read.kind === 'absent') return { kind: 'available', history: { kind: 'absent' } };
  return read.kind === 'foreign-feature' ? { kind: 'foreign' } : { kind: 'invalid' };
}

/** Build the engine-owned source projection used by the managed PRD audit. */
export async function buildPrdAuditProjection(
  projectRoot: string,
  featureDesc?: string,
): Promise<PrdAuditProjectionResult> {
  const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (!planPath) return { ok: false, fault: { dimension: 'plan', detail: 'active plan is unavailable' } };

  let plan: string;
  try {
    plan = await readFile(isAbsolute(planPath) ? planPath : join(projectRoot, planPath), 'utf-8');
  } catch {
    return { ok: false, fault: { dimension: 'plan', detail: 'active plan is unreadable' } };
  }
  const intent = planIntent(plan);
  const storiesRepoPath = resolvePlanStoriesPath(repoPath(projectRoot, planPath), plan);
  if (!intent || !storiesRepoPath) return { ok: false, fault: { dimension: 'plan', detail: 'active plan has incomplete audit context' } };

  let stories: string;
  try {
    stories = await readFile(join(projectRoot, storiesRepoPath), 'utf-8');
  } catch {
    return { ok: false, fault: { dimension: 'stories', detail: 'sealed stories are unreadable' } };
  }
  const criteria = criteriaFromStories(stories);
  const taskBodies = parsePlanTaskBodies(plan);
  const doneWhen = parsePlanTaskDoneWhen(plan);
  const tasks = [...taskBodies].map(([id, body]) => ({ id, storyIds: parsePlanTaskStoryIds(body), doneWhen: doneWhen.get(id) ?? [] }));
  if (criteria.length === 0 || tasks.length === 0) return { ok: false, fault: { dimension: 'obligations', detail: 'active stories or plan contain no audit obligations' } };

  const coherencePath = join(projectRoot, '.docs', 'coherence', `${basename(planPath, '.md')}.md`);
  let coherence: PrdAuditProjection['coherence'] = { kind: 'absent' };
  try {
    const parsed = parseCoherenceArtifact(await readFile(coherencePath, 'utf-8'));
    if (!parsed.ok) return { ok: false, fault: { dimension: 'coherence', detail: parsed.reason } };
    coherence = parsed.rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, fault: { dimension: 'coherence', detail: 'active coherence is unreadable' } };
  }

  const context = await buildArtifactResolutionContext(projectRoot, { planPath, featureDesc });
  const prdPaths = await resolveFeaturePrdPaths(projectRoot, context);
  if (prdPaths.length === 0 && Array.isArray(coherence) && coherence.some((row) => row.rowClass === 'fr')) {
    return { ok: false, fault: { dimension: 'prd', detail: 'active PRD required by coherence is unavailable' } };
  }
  let prd: PrdAuditProjection['prd'] = { kind: 'absent' };
  if (prdPaths.length > 0) {
    try {
      const sources = await Promise.all(prdPaths.sort().map(async (prdPath) => ({
        path: repoPath(projectRoot, prdPath),
        requirements: prdRequirements(await readFile(prdPath, 'utf-8')),
      })));
      const first = sources[0]!;
      prd = { sources, path: first.path, requirements: first.requirements };
    } catch {
      return { ok: false, fault: { dimension: 'prd', detail: 'active PRD is unreadable' } };
    }
  }

  const [changes, history] = await Promise.all([scopedChanges(projectRoot), wideningHistory(projectRoot, basename(planPath, '.md'))]);
  if (!changes) return { ok: false, fault: { dimension: 'changes', detail: 'scoped git changes are unavailable' } };
  if (history.kind === 'foreign') return { ok: false, fault: { dimension: 'history', detail: 'widening history is foreign to the active feature' } };
  if (history.kind === 'invalid') return { ok: false, fault: { dimension: 'history', detail: 'widening history is invalid' } };

  return { ok: true, projection: { version: PRD_AUDIT_PROJECTION_VERSION, plan: { intent }, criteria, tasks, prd, coherence, changes, history: history.history } };
}
