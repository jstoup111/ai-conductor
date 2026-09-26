import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { findArtifactFiles, adrApprovalStatus, extractAuthoritativeStoryCriteria, parseAdrDecisions } from './artifacts.js';
import { resolveAsBuiltPolicy, type AsBuiltPolicy } from './as-built-policy.js';
import type { ComplexityTier } from '../types/index.js';
import { splitRow, isSeparatorRow } from './coherence-parse.js';
import { readPendingAsBuiltRemediationFindings } from './kickback-ledger.js';
import { parsePlanTaskBodies, parsePlanTaskDoneWhen } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { makeGitRunner, originDefaultBranch, resolveBase, type GitRunner } from './rebase.js';

/** Incremented only when the deterministic projection contract changes. */
export const AS_BUILT_PROJECTION_VERSION = 1;

/** Explicit UTF-8 byte limits for the engine-rendered as-built input projection. */
export const AS_BUILT_PROJECTION_LIMITS = {
  perFileHunksBytes: 256 * 1024,
  totalDiffBytes: 512 * 1024,
  planTasksBytes: 256 * 1024,
  storyCriteriaBytes: 256 * 1024,
  governingAdrDecisionsBytes: 256 * 1024,
} as const;

export interface AsBuiltProjectionLimits {
  readonly perFileHunksBytes: number;
  readonly totalDiffBytes: number;
  readonly planTasksBytes: number;
  readonly storyCriteriaBytes: number;
  readonly governingAdrDecisionsBytes: number;
}

export interface AsBuiltProjection {
  readonly version: typeof AS_BUILT_PROJECTION_VERSION;
  readonly diff: {
    readonly changedFiles: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
    readonly hunks: readonly string[];
    readonly omittedFiles: readonly { readonly path: string; readonly digest: string }[];
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
  | { readonly ok: false; readonly fault: { readonly dimension: string; readonly detail?: string; readonly actual?: number; readonly limit?: number } };

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
  const lines = section.split('\n');
  const declaration = new RegExp(`^\\s*(?:\\*{0,2}${id}\\.\\s+|#{0,6}\\s*\\*{0,2}D${id}(?!\\.)\\b)`);
  const nextDeclaration = /^\s*(?:\*{0,2}\d+\.\s+|#{0,6}\s*\*{0,2}D\d+(?!\.)\b)/;
  const anyAmendment = /^\s*(?:[-*]\s*)?\*{0,2}D\d+\.\d+\b/;
  const start = lines.findIndex((line) => declaration.test(line));
  if (start === -1) return `Decision ${id}`;

  const decisionLines: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index !== start && (nextDeclaration.test(lines[index]!) || anyAmendment.test(lines[index]!))) break;
    decisionLines.push(lines[index]!);
  }

  // Additive decision amendments conventionally follow the numbered decisions,
  // so retain the amendments for this decision even when they appear after a
  // later base declaration. They are authoritative decision text, not prose.
  const amendment = new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}D${id}\\.\\d+\\b`);
  for (const line of lines) {
    if (amendment.test(line) && !decisionLines.includes(line)) decisionLines.push(line);
  }

  decisionLines[0] = decisionLines[0]!
    .replace(/^\s*(?:\*{0,2}\d+\.\s+|#{0,6}\s*\*{0,2}D\d+\s*[—:-]?\s*)/, '');
  return decisionLines.join('\n').replace(/\*\*/g, '').trim();
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

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function projectionSectionBytes(lines: readonly string[]): number {
  return utf8Bytes(lines.join('\n'));
}

function projectionLimitFault(dimension: string, actual: number, limit: number): AsBuiltProjectionResult {
  return { ok: false, fault: { dimension, actual, limit } };
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

function splitDiffByFile(text: string):
  | { readonly ok: true; readonly files: readonly { readonly path: string; readonly content: string }[] }
  | { readonly ok: false; readonly detail: string } {
  const chunks = text.split(/(?=^diff --git )/m).filter(Boolean);
  const files: { path: string; content: string }[] = [];
  for (const content of chunks) {
    const path = diffPathFromHeader(content);
    if (path === undefined) return { ok: false, detail: 'could not parse a changed-file path from a diff header' };
    files.push({ path, content });
  }
  return { ok: true, files };
}

function projectDiff(
  diffText: string,
  limits: AsBuiltProjectionLimits,
):
  | { readonly ok: true; readonly diff: Pick<AsBuiltProjection['diff'], 'hunks' | 'omittedFiles'> }
  | { readonly ok: false; readonly detail: string } {
  const files = splitDiffByFile(diffText);
  if (!files.ok) return files;
  let includedBytes = 0;
  const hunks: string[] = [];
  const omittedFiles: { path: string; digest: string }[] = [];
  for (const file of files.files) {
    const bytes = utf8Bytes(file.content);
    if (bytes > limits.perFileHunksBytes || includedBytes + bytes > limits.totalDiffBytes) {
      omittedFiles.push({
        path: file.path,
        digest: `sha256:${createHash('sha256').update(file.content).digest('hex')}`,
      });
      continue;
    }
    includedBytes += bytes;
    hunks.push(...file.content.split('\n').filter(Boolean));
  }
  return { ok: true, diff: { hunks, omittedFiles } };
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
  limitOverrides?: Partial<AsBuiltProjectionLimits>,
  policyInput?: { readonly tier?: ComplexityTier; readonly config?: Parameters<typeof resolveAsBuiltPolicy>[0]['config'] },
): Promise<AsBuiltProjectionResult> {
  const limits: AsBuiltProjectionLimits = { ...AS_BUILT_PROJECTION_LIMITS, ...limitOverrides };
  const pending = await readPendingAsBuiltRemediationFindings(worktree);
  if (pending.kind === 'unreadable') {
    return { ok: false, fault: { dimension: 'pending-findings', detail: pending.reason } };
  }

  const planPaths = (await findArtifactFiles(worktree, 'plan')).sort();
  if (planPaths.length !== 1) {
    return { ok: false, fault: { dimension: 'plan', detail: `expected one plan artifact; found ${planPaths.length}` } };
  }
  const planPath = planPaths[0];
  let plan: string;
  try {
    plan = await readFile(planPath, 'utf-8');
  } catch (error) {
    return {
      ok: false,
      fault: {
        dimension: 'plan',
        detail: `${repoPath(worktree, planPath)} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
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
  if (!storiesRepoPath) {
    return { ok: false, fault: { dimension: 'story-criteria', detail: 'active plan does not resolve a sealed stories artifact' } };
  }
  let storyCriteria: string[];
  try {
    storyCriteria = extractAuthoritativeStoryCriteria(await readFile(join(worktree, storiesRepoPath), 'utf-8'));
  } catch (error) {
    return {
      ok: false,
      fault: {
        dimension: 'story-criteria',
        detail: `${storiesRepoPath} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  if (storyCriteria.length === 0) {
    return {
      ok: false,
      fault: {
        dimension: 'story-criteria',
        detail: `${storiesRepoPath} contains no sealed story criteria`,
      },
    };
  }

  const citedStems = planCitedAdrStems(plan);
  for (const path of changedAdrPaths.stdout.split('\n').filter(Boolean)) {
    const stem = basename(path, '.md');
    if (stem.startsWith('adr-')) citedStems.add(stem);
  }
  const adrPaths = new Map(
    (await findArtifactFiles(worktree, 'architecture_review')).map((path) => [basename(path, '.md'), path]),
  );
  const governingAdrs: AsBuiltProjection['governingAdrs'][number][] = [];
  for (const stem of [...citedStems].sort()) {
    const path = adrPaths.get(stem);
    if (path === undefined) {
      return {
        ok: false,
        fault: {
          dimension: 'governing-adr-decisions',
          detail: `${stem} cannot be projected: ADR file is missing`,
        },
      };
    }
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (error) {
      return {
        ok: false,
        fault: {
          dimension: 'governing-adr-decisions',
          detail: `${stem} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
    const approval = adrApprovalStatus(content);
    if (!approval.approved || !/^approved$/i.test(approval.found ?? '')) continue;
    const parsed = parseAdrDecisions(content);
    if (parsed.kind !== 'decisions') {
      return {
        ok: false,
        fault: {
          dimension: 'governing-adr-decisions',
          detail: `${stem} cannot be projected: parseAdrDecisions diagnostic (${parsed.reason}): ${parsed.detail}`,
        },
      };
    }
    const ids = [...parsed.ids].sort((a, b) => Number(a) - Number(b));
    governingAdrs.push({ stem, decisions: ids.map((id) => ({ id, text: decisionText(content, id) })) });
  }
  governingAdrs.sort((left, right) => left.stem.localeCompare(right.stem));

  const taskBodies = parsePlanTaskBodies(plan);
  const doneWhen = parsePlanTaskDoneWhen(plan);
  const taskIds = [...taskBodies.keys()].sort((a, b) => Number(a) - Number(b));
  for (const id of taskIds) {
    if (!doneWhen.has(id)) {
      return {
        ok: false,
        fault: {
          dimension: 'plan-tasks',
          detail: `Task ${id} has no Done when criteria`,
        },
      };
    }
  }
  const tasks = taskIds.map((id) => ({ id, doneWhen: doneWhen.get(id)! }));
  const planTasksBytes = projectionSectionBytes(tasks.flatMap((task) => [`Task ${task.id}`, ...task.doneWhen]));
  if (planTasksBytes > limits.planTasksBytes) return projectionLimitFault('plan-tasks', planTasksBytes, limits.planTasksBytes);

  const storyCriteriaBytes = projectionSectionBytes(storyCriteria);
  if (storyCriteriaBytes > limits.storyCriteriaBytes) {
    return projectionLimitFault('story-criteria', storyCriteriaBytes, limits.storyCriteriaBytes);
  }

  const governingAdrDecisionsBytes = projectionSectionBytes(governingAdrs.flatMap((adr) => [
    adr.stem,
    ...adr.decisions.map((decision) => `D${decision.id}: ${decision.text}`),
  ]));
  if (governingAdrDecisionsBytes > limits.governingAdrDecisionsBytes) {
    return projectionLimitFault('governing-adr-decisions', governingAdrDecisionsBytes, limits.governingAdrDecisionsBytes);
  }

  const policy = await resolveAsBuiltPolicy({
    projectRoot: worktree,
    tier: policyInput?.tier,
    config: policyInput?.config,
  });
  const diagrams = (await findArtifactFiles(worktree, 'architecture_diagram')).map((path) => repoPath(worktree, path)).sort();
  const changedFiles = parseNumstat(numstat.stdout);
  const diff = projectDiff(hunks.stdout, limits);
  if (!diff.ok) return { ok: false, fault: { dimension: 'diff', detail: diff.detail } };

  return {
    ok: true,
    projection: {
      version: AS_BUILT_PROJECTION_VERSION,
      diff: { changedFiles, ...diff.diff },
      tasks,
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
    '', 'OMITTED FILES:',
    ...(projection.diff.omittedFiles.length === 0
      ? ['None.']
      : [...projection.diff.omittedFiles.map((file) => `- ${file.path} | ${file.digest}`), 'Omitted files may be read on demand.']),
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
