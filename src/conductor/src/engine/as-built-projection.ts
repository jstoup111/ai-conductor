import { readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { findArtifactFiles, adrApprovalStatus, extractAuthoritativeStoryCriteria, parseAdrDecisions } from './artifacts.js';
import { resolveAsBuiltPolicy, type AsBuiltPolicy } from './as-built-policy.js';
import { splitRow, isSeparatorRow } from './coherence-parse.js';
import { readPendingAsBuiltRemediationFindings } from './kickback-ledger.js';
import { parsePlanTaskBodies, parsePlanTaskDoneWhen } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { makeGitRunner, originDefaultBranch, resolveBase, type GitRunner } from './rebase.js';

/** Incremented only when the deterministic projection contract changes. */
export const AS_BUILT_PROJECTION_VERSION = 1;

export interface AsBuiltProjectionLimits {}

export interface AsBuiltProjection {
  readonly version: typeof AS_BUILT_PROJECTION_VERSION;
  readonly diff: {
    readonly changedFiles: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
    readonly hunks: readonly string[];
  };
  readonly tasks: readonly { readonly id: string; readonly doneWhen: readonly string[] }[];
  readonly storyCriteria: readonly string[];
  readonly policy: AsBuiltPolicy;
  readonly diagrams: readonly string[];
  readonly governingAdrs: readonly {
    readonly stem: string;
    readonly decisions: readonly { readonly id: string; readonly text: string }[];
  }[];
  readonly priorFindings: readonly {
    readonly finding: string;
    readonly class: 'REMEDIABLE';
    readonly governingClause: string;
    readonly summary: string;
  }[];
}

export type AsBuiltProjectionResult =
  | { readonly ok: true; readonly projection: AsBuiltProjection }
  | { readonly ok: false; readonly fault: { readonly dimension: string; readonly detail: string; readonly actual?: number; readonly limit?: number } };

function repoPath(worktree: string, path: string): string {
  return relative(worktree, path).replaceAll('\\', '/');
}

function planCitedAdrStems(plan: string): Set<string> {
  const stems = new Set<string>();
  const heading = /^##\s+Architecture Obligation Coverage\s*$/im.exec(plan);
  if (!heading || heading.index === undefined) return stems;
  const section = plan.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? '';
  let sawHeader = false;
  let sawSeparator = false;
  for (const line of section.split('\n')) {
    const cells = splitRow(line);
    if (cells === null) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (!sawSeparator) {
      if (isSeparatorRow(cells)) sawSeparator = true;
      continue;
    }
    for (const match of cells[0]?.matchAll(/\b(adr-[a-z0-9][a-z0-9-]*)#D\d+\b/gi) ?? []) stems.add(match[1]);
  }
  return stems;
}

function decisionText(content: string, id: string): string {
  const section = content.split(/^##\s+Decision\s*$/im)[1]?.split(/^##\s+/m, 1)[0] ?? '';
  const line = section.split('\n').find((candidate) =>
    new RegExp(`^\\s*(?:\\*{0,2}${id}\\.\\s+|#{0,6}\\s*\\*{0,2}D${id}\\b)`).test(candidate),
  );
  return (line ?? `Decision ${id}`).replace(/^\s*(?:\*{0,2}\d+\.\s+|#{0,6}\s*\*{0,2}D\d+\s*[—:-]?\s*)/, '')
    .replace(/\*\*/g, '').trim();
}

function parseNumstat(text: string): AsBuiltProjection['diff']['changedFiles'] {
  return text.split('\n').filter(Boolean).map((line) => {
    const [added, deleted, path] = line.split('\t');
    return {
      path,
      additions: Number.parseInt(added, 10) || 0,
      deletions: Number.parseInt(deleted, 10) || 0,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

/** Match the rebase gate's local fallback before asking it to resolve a base ref. */
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

/** Build the engine-owned, bounded inputs for one as-built reviewer dispatch. */
export async function buildAsBuiltProjection(
  worktree: string,
  _limits?: AsBuiltProjectionLimits,
): Promise<AsBuiltProjectionResult> {
  const pending = await readPendingAsBuiltRemediationFindings(worktree);
  if (pending.kind === 'unreadable') {
    return { ok: false, fault: { dimension: 'pending-findings', detail: pending.reason } };
  }

  const planPaths = (await findArtifactFiles(worktree, 'plan')).sort();
  if (planPaths.length !== 1) {
    return { ok: false, fault: { dimension: 'plan', detail: `expected one plan artifact; found ${planPaths.length}` } };
  }
  const planPath = planPaths[0];
  const plan = await readFile(planPath, 'utf-8');
  const git = makeGitRunner(worktree);
  const base = await resolveBase(git, await discoverLocalBase(git));
  const [baseShaResult, headShaResult] = await Promise.all([git(['rev-parse', base.ref]), git(['rev-parse', 'HEAD'])]);
  if (baseShaResult.exitCode !== 0 || headShaResult.exitCode !== 0) {
    return { ok: false, fault: { dimension: 'diff', detail: 'could not resolve projection revisions' } };
  }
  const mergeBase = await git(['merge-base', baseShaResult.stdout.trim(), headShaResult.stdout.trim()]);
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) {
    return { ok: false, fault: { dimension: 'diff', detail: 'could not resolve projection merge base' } };
  }
  const range = `${mergeBase.stdout.trim()}..${headShaResult.stdout.trim()}`;
  const [numstat, hunks, changedAdrPaths] = await Promise.all([
    git(['diff', '--numstat', range]),
    git(['diff', range]),
    git(['diff', '--name-only', range, '--', '.docs/decisions']),
  ]);
  if (numstat.exitCode !== 0 || hunks.exitCode !== 0 || changedAdrPaths.exitCode !== 0) {
    return { ok: false, fault: { dimension: 'diff', detail: 'could not read projection diff' } };
  }

  const storiesRepoPath = resolvePlanStoriesPath(repoPath(worktree, planPath), plan);
  let storyCriteria: string[] = [];
  if (storiesRepoPath) {
    try {
      storyCriteria = extractAuthoritativeStoryCriteria(await readFile(join(worktree, storiesRepoPath), 'utf-8'));
    } catch {
      storyCriteria = [];
    }
  }

  const citedStems = planCitedAdrStems(plan);
  for (const path of changedAdrPaths.stdout.split('\n').filter(Boolean)) {
    const stem = basename(path, '.md');
    if (stem.startsWith('adr-')) citedStems.add(stem);
  }
  const adrPaths = await findArtifactFiles(worktree, 'architecture_review');
  const governingAdrs: AsBuiltProjection['governingAdrs'][number][] = [];
  for (const path of adrPaths.sort()) {
    const stem = basename(path, '.md');
    if (!citedStems.has(stem)) continue;
    const content = await readFile(path, 'utf-8');
    const approval = adrApprovalStatus(content);
    if (!approval.approved || !/^approved$/i.test(approval.found ?? '')) continue;
    const parsed = parseAdrDecisions(content);
    const ids = parsed.kind === 'decisions' ? [...parsed.ids].sort((a, b) => Number(a) - Number(b)) : [];
    governingAdrs.push({ stem, decisions: ids.map((id) => ({ id, text: decisionText(content, id) })) });
  }
  governingAdrs.sort((left, right) => left.stem.localeCompare(right.stem));

  const taskBodies = parsePlanTaskBodies(plan);
  const doneWhen = parsePlanTaskDoneWhen(plan);
  const policy = await resolveAsBuiltPolicy({ projectRoot: worktree, tier: 'M' });
  const diagrams = (await findArtifactFiles(worktree, 'architecture_diagram')).map((path) => repoPath(worktree, path)).sort();

  return {
    ok: true,
    projection: {
      version: AS_BUILT_PROJECTION_VERSION,
      diff: { changedFiles: parseNumstat(numstat.stdout), hunks: hunks.stdout.split('\n').filter(Boolean) },
      tasks: [...taskBodies.keys()].sort((a, b) => Number(a) - Number(b)).map((id) => ({ id, doneWhen: doneWhen.get(id) ?? [] })),
      storyCriteria,
      policy,
      diagrams,
      governingAdrs,
      priorFindings: pending.findings.map(({ finding, class: findingClass, governingClause, summary }) => ({
        finding, class: findingClass, governingClause, summary,
      })),
    },
  };
}

/** Render one stable, human-readable block for injection into the reviewer prompt. */
export function renderAsBuiltProjection(projection: AsBuiltProjection): string {
  const lines = [
    `AS-BUILT INPUT PROJECTION v${projection.version}`,
    '',
    'CHANGED FILES:',
    ...projection.diff.changedFiles.map((file) => `- ${file.path}: +${file.additions} -${file.deletions}`),
    '', 'DIFF HUNKS:', ...projection.diff.hunks,
    '', 'PLAN TASKS:',
    ...projection.tasks.flatMap((task) => [`- Task ${task.id}`, ...task.doneWhen.map((item) => `  - ${item}`)]),
    '', 'SEALED STORY CRITERIA:', ...projection.storyCriteria.map((criterion) => `- ${criterion}`),
    '', 'AS-BUILT CHECK POLICY:',
    ...Object.entries(projection.policy).map(([check, policy]) => `- ${check}: ${policy.enabled ? 'on' : 'off'} — ${policy.reason}`),
    '', 'APPROVED DIAGRAM PATHS:', ...projection.diagrams.map((path) => `- ${path}`),
    '', 'GOVERNING ADRS:',
    ...(projection.governingAdrs.length === 0
      ? ['No ADR is pre-selected; APPROVED ADRs may be read on demand.']
      : projection.governingAdrs.flatMap((adr) => [`- ${adr.stem}`, ...adr.decisions.map((decision) => `  - D${decision.id}: ${decision.text}`)])),
    '', 'PRIOR FINDINGS:',
    ...projection.priorFindings.map((finding) => `- ${finding.finding} | ${finding.class} | ${finding.governingClause} | ${finding.summary}`),
  ];
  return `${lines.join('\n')}\n`;
}
