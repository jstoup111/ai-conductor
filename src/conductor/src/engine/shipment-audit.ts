import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { classifyShipmentAssociation } from './shipment-association.js';
import {
  evaluateShipmentEvidence,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceInput,
  type ShipmentEvidenceResult,
} from './shipment-evidence.js';
import type { GhRunner, GitRunner } from './pr-labels.js';
import { renderShippedRecord, specHash } from './shipped-record.js';

export const DEFAULT_SHIPMENT_AUDIT_REPORT =
  '.docs/audits/2026-07-25-durable-shipped-record-backfill.json';

export type ShipmentAuditClassification =
  | 'aligned'
  | 'backfilled'
  | 'unresolved'
  | 'absent'
  | 'ambiguous'
  | 'contradictory';

export interface ShipmentAuditReport {
  complete: boolean;
  startedAt: string;
  completedAt?: string;
  error?: string;
  rows: ShipmentAuditRow[];
  counts: Record<ShipmentAuditClassification, number>;
}

export interface ShipmentAuditRow {
  sourcePath: string;
  sourceKind: 'plan' | 'spec';
  relatedSourcePaths?: string[];
  classification: ShipmentAuditClassification;
  plan?: { path: string; slug: string };
  implementationPr?: {
    number: number;
    url: string;
    mergedAt: string;
    headSha: string;
  };
  verdict?: ShipmentEvidenceResult;
  proposal?: { path: string; content: string };
  reason: string;
}

export interface ShipmentAuditOptions {
  cwd: string;
  reportPath?: string;
  runGh: GhRunner;
  runGit: GitRunner;
  evaluateEvidence?: (
    input: ShipmentEvidenceInput,
    dependencies: ShipmentEvidenceDependencies,
  ) => ReturnType<typeof evaluateShipmentEvidence>;
  now?: () => Date;
}

interface AuditSource {
  path: string;
  kind: 'plan' | 'spec';
  plan?: { path: string; slug: string };
  relatedSourcePaths?: string[];
  reason?: string;
}

interface MergedPullRequest {
  number: number;
  url: string;
  body: string;
  changedPaths: string[];
  headSha: string;
  mergedAt: string;
}

/**
 * Audits only committed repository and merged-PR evidence. It persists an
 * incomplete report before scanning and never writes a shipped record; the
 * Task 17 operator review is the only place proposals become repository data.
 */
export async function runShipmentAudit(options: ShipmentAuditOptions): Promise<ShipmentAuditReport> {
  const now = options.now ?? (() => new Date());
  const reportPath = options.reportPath ?? DEFAULT_SHIPMENT_AUDIT_REPORT;
  let report: ShipmentAuditReport = {
    complete: false,
    startedAt: now().toISOString(),
    rows: [],
    counts: emptyCounts(),
  };

  try {
    await persistShipmentAuditReport(options.cwd, reportPath, report);
  } catch (error) {
    throw new Error(`shipment audit report persistence failed: ${errorMessage(error)}`);
  }

  try {
    const sources = await enumerateCommittedSources(options);
    const mergedPullRequests = await enumerateMergedPullRequests(options);
    const planStems = sources
      .flatMap((source) => source.plan ? [source.plan.slug] : []);
    const rows: ShipmentAuditRow[] = [];
    for (const source of sources) {
      rows.push(await auditSource(options, source, planStems, mergedPullRequests));
    }
    report = {
      complete: true,
      startedAt: report.startedAt,
      completedAt: now().toISOString(),
      rows,
      counts: countRows(rows),
    };
    await persistShipmentAuditReport(options.cwd, reportPath, report);
    return report;
  } catch (error) {
    report = {
      ...report,
      complete: false,
      error: errorMessage(error),
      counts: countRows(report.rows),
    };
    try {
      await persistShipmentAuditReport(options.cwd, reportPath, report);
    } catch (persistenceError) {
      throw new Error(
        `shipment audit failed: ${errorMessage(error)}; incomplete report persistence failed: ${errorMessage(persistenceError)}`,
      );
    }
    throw error;
  }
}

async function enumerateCommittedSources(options: ShipmentAuditOptions): Promise<AuditSource[]> {
  const output = await git(options, [
    'log', '--all', '--pretty=format:', '--name-only', '--', '.docs/plans', '.docs/specs',
  ]);
  const paths = [...new Set(output.split('\n').filter(Boolean))].sort();
  const planPaths = paths.filter((path) => path.startsWith('.docs/plans/') && path.endsWith('.md'));
  const plans = new Map(planPaths.map((path) => [path, { path, slug: stem(path) }]));
  const sources: AuditSource[] = planPaths.map((path) => ({
    path,
    kind: 'plan',
    plan: plans.get(path),
    relatedSourcePaths: [],
  }));
  const sourcesByPlanPath = new Map(sources.flatMap((source) => source.plan ? [[source.plan.path, source]] : []));

  for (const path of paths.filter((candidate) => candidate.startsWith('.docs/specs/') && candidate.endsWith('.md'))) {
    const referencedPlans = [...new Set([
      ...await referencedPlanPaths(options, path),
      ...await plansReferencingSpec(options, planPaths, path),
    ])];
    if (referencedPlans.length !== 1 || !plans.has(referencedPlans[0])) {
      sources.push({
        path,
        kind: 'spec',
        reason: referencedPlans.length === 0
          ? 'product spec has no provable canonical plan'
          : 'product spec has ambiguous or unavailable canonical plan',
      });
      continue;
    }
    sourcesByPlanPath.get(referencedPlans[0])?.relatedSourcePaths?.push(path);
  }
  return sources;
}

async function referencedPlanPaths(options: ShipmentAuditOptions, path: string): Promise<string[]> {
  const commit = (await git(options, ['log', '-1', '--format=%H', '--', path])).trim();
  if (!commit) return [];
  const content = await git(options, ['show', `${commit}:${path}`]);
  return [...new Set([...content.matchAll(/\.docs\/plans\/([^/\s`]+\.md)(?![A-Za-z0-9_.-])/g)]
    .map((match) => `.docs/plans/${match[1]}`))];
}

async function plansReferencingSpec(
  options: ShipmentAuditOptions,
  planPaths: string[],
  specPath: string,
): Promise<string[]> {
  const matches: string[] = [];
  for (const planPath of planPaths) {
    const commit = (await git(options, ['log', '-1', '--format=%H', '--', planPath])).trim();
    if (!commit) continue;
    const content = await git(options, ['show', `${commit}:${planPath}`]);
    if (extractSpecPaths(content).includes(specPath)) matches.push(planPath);
  }
  return matches;
}

async function enumerateMergedPullRequests(options: ShipmentAuditOptions): Promise<MergedPullRequest[]> {
  const repository = await repositoryName(options);
  const { stdout } = await options.runGh(
    ['api', '--paginate', '--slurp', `repos/${repository}/pulls?state=closed&per_page=100`],
    { cwd: options.cwd },
  );
  const pages = JSON.parse(stdout) as Array<Array<{ number?: unknown; merged_at?: unknown }>>;
  const numbers = pages.flat()
    .filter((pull) => typeof pull.number === 'number' && typeof pull.merged_at === 'string')
    .map((pull) => pull.number as number);
  const pullRequests: MergedPullRequest[] = [];
  for (const number of numbers) {
    const { stdout: metadata } = await options.runGh(
      ['pr', 'view', String(number), '--json', 'number,url,body,headRefOid,mergedAt'],
      { cwd: options.cwd },
    );
    const parsed = JSON.parse(metadata) as {
      number?: unknown;
      url?: unknown;
      body?: unknown;
      headRefOid?: unknown;
      mergedAt?: unknown;
    };
    if (
      typeof parsed.number !== 'number'
      || typeof parsed.url !== 'string'
      || typeof parsed.headRefOid !== 'string'
      || typeof parsed.mergedAt !== 'string'
    ) {
      throw new Error(`merged PR metadata is incomplete for #${number}`);
    }
    pullRequests.push({
      number: parsed.number,
      url: parsed.url,
      body: typeof parsed.body === 'string' ? parsed.body : '',
      changedPaths: await paginatedChangedPaths(options, repository, parsed.number),
      headSha: parsed.headRefOid,
      mergedAt: parsed.mergedAt,
    });
  }
  return pullRequests;
}

async function paginatedChangedPaths(
  options: ShipmentAuditOptions,
  repository: string,
  number: number,
): Promise<string[]> {
  const { stdout } = await options.runGh(
    ['api', '--paginate', '--slurp', `repos/${repository}/pulls/${number}/files?per_page=100`],
    { cwd: options.cwd },
  );
  const pages = JSON.parse(stdout) as Array<Array<{ filename?: unknown }>>;
  return pages.flatMap((page) => page.flatMap((file) =>
    typeof file.filename === 'string' ? [file.filename] : [],
  ));
}

async function auditSource(
  options: ShipmentAuditOptions,
  source: AuditSource,
  planStems: string[],
  mergedPullRequests: MergedPullRequest[],
): Promise<ShipmentAuditRow> {
  if (!source.plan) {
    return {
      sourcePath: source.path,
      sourceKind: source.kind,
      classification: 'unresolved',
      reason: source.reason ?? 'canonical plan is unavailable',
    };
  }

  const referencedByAmbiguousPr = mergedPullRequests.some((pullRequest) => {
    const stems = extractPlanStems(pullRequest.body).filter((candidate) => planStems.includes(candidate));
    return stems.includes(source.plan!.slug) && new Set(stems).size > 1;
  });
  if (referencedByAmbiguousPr) {
    return row(source, 'ambiguous', 'merged PR metadata references multiple canonical plans');
  }

  const candidates = mergedPullRequests.filter((pullRequest) => {
    const association = classifyShipmentAssociation({
      planStems,
      pr: {
        metadataPlanStems: extractPlanStems(pullRequest.body),
        changedPaths: pullRequest.changedPaths,
      },
    });
    return association.kind === 'implementation' && association.slug === source.plan!.slug;
  });

  if (candidates.length === 0) return row(source, 'absent', 'no exact associated merged implementation PR');
  if (candidates.length > 1) return row(source, 'ambiguous', 'multiple exact associated merged implementation PRs');

  const implementationPr = candidates[0];
  await ensureCommitAvailable(options, implementationPr.headSha);
  const pr = {
    number: implementationPr.number,
    url: implementationPr.url,
    mergedAt: implementationPr.mergedAt,
    headSha: implementationPr.headSha,
  };
  const historicalVerdict = await evaluateHistoricalRecord(options, source.plan, implementationPr);
  if (historicalVerdict?.kind === 'valid') {
    return { ...row(source, 'aligned', 'valid durable record is committed after implementation merge'), implementationPr: pr, verdict: historicalVerdict };
  }
  if (historicalVerdict?.kind === 'refusal') {
    if (isContradictoryEvidence(historicalVerdict.code)) {
      return { ...row(source, 'contradictory', `extant evidence conflicts: ${historicalVerdict.code}`), implementationPr: pr, verdict: historicalVerdict };
    }
    return { ...row(source, 'unresolved', historicalVerdict.code), implementationPr: pr, verdict: historicalVerdict };
  }

  const evaluateEvidence = options.evaluateEvidence ?? evaluateShipmentEvidence;
  const verdict = await evaluateEvidence(
    {
      repoDir: options.cwd,
      slug: source.plan.slug,
      implementationPr: implementationPr.url,
      candidateCommit: implementationPr.headSha,
    },
    {
      gitRunner: async (args) => strictGit(options, args),
      githubRunner: async () => ({ url: implementationPr.url, headRefOid: implementationPr.headSha }),
    },
  );
  if (verdict.kind === 'valid') return { ...row(source, 'aligned', 'strict evidence is valid'), implementationPr: pr, verdict };
  if (verdict.kind === 'refusal' && verdict.code === 'shipped-record-missing') {
    const proposal = await expectedProposal(options, source.plan, implementationPr);
    return {
      ...row(source, 'backfilled', 'proven missing shipped record; proposal only'),
      implementationPr: pr,
      verdict,
      proposal,
    };
  }
  if (verdict.kind === 'refusal' && isContradictoryEvidence(verdict.code)) {
    return { ...row(source, 'contradictory', `extant evidence conflicts: ${verdict.code}`), implementationPr: pr, verdict };
  }
  return {
    ...row(source, 'unresolved', verdict.kind === 'refusal' ? verdict.code : verdict.reason),
    implementationPr: pr,
    verdict,
  };
}

async function expectedProposal(
  options: ShipmentAuditOptions,
  plan: { path: string; slug: string },
  pullRequest: MergedPullRequest,
): Promise<{ path: string; content: string }> {
  const planBytes = await committedFile(options, pullRequest.headSha, plan.path);
  if (planBytes === null) throw new Error(`implementation head is missing ${plan.path}`);
  const planContent = planBytes.toString('utf8');
  const referencedStories = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im)?.[1];
  let stories = referencedStories && !isAbsolute(referencedStories)
    ? await committedFile(options, pullRequest.headSha, referencedStories)
    : null;
  if (stories === null) {
    stories = await committedFile(options, pullRequest.headSha, `.docs/stories/${plan.slug}.md`);
  }
  const hash = specHash(planBytes, stories).digest;
  const path = `.docs/shipped/${plan.slug}.md`;
  return {
    path,
    content: renderShippedRecord({
      slug: plan.slug,
      specHash: hash,
      pr: pullRequest.url,
      shipped: pullRequest.mergedAt.slice(0, 'YYYY-MM-DD'.length),
    }),
  };
}

/**
 * The completion verifier requires a record to be on the implementation PR
 * head. Historical repairs deliberately land later, so this audit keeps the
 * verifier's parser/identity/hash contract but reads the record at committed
 * audit HEAD and the attested plan/stories at the immutable implementation
 * head. A valid later record is therefore durable alignment, not a duplicate
 * proposal.
 */
async function evaluateHistoricalRecord(
  options: ShipmentAuditOptions,
  plan: { path: string; slug: string },
  pullRequest: MergedPullRequest,
): Promise<ShipmentEvidenceResult | undefined> {
  const auditHead = (await git(options, ['rev-parse', 'HEAD'])).trim();
  const recordPath = `.docs/shipped/${plan.slug}.md`;
  if (await committedFile(options, auditHead, recordPath) === null) return undefined;
  const evaluateEvidence = options.evaluateEvidence ?? evaluateShipmentEvidence;
  return evaluateEvidence(
    {
      repoDir: options.cwd,
      slug: plan.slug,
      implementationPr: pullRequest.url,
      candidateCommit: auditHead,
    },
    {
      readFile: async (path) => path === recordPath
        ? committedFile(options, auditHead, path)
        : committedFile(options, pullRequest.headSha, path),
      gitRunner: async (args) => strictGit(options, args),
      githubRunner: async () => ({ url: pullRequest.url, headRefOid: auditHead }),
    },
  );
}

async function committedFile(
  options: ShipmentAuditOptions,
  commit: string,
  path: string,
): Promise<Buffer | null> {
  const paths = (await git(options, ['ls-tree', '-r', '--name-only', commit, '--', path]))
    .split('\n')
    .filter(Boolean);
  if (!paths.includes(path)) return null;
  return Buffer.from(await git(options, ['show', `${commit}:${path}`]), 'utf8');
}

async function ensureCommitAvailable(options: ShipmentAuditOptions, commit: string): Promise<void> {
  try {
    await git(options, ['rev-parse', '--verify', `${commit}^{commit}`]);
  } catch {
    await git(options, ['fetch', 'origin', commit]);
  }
}

async function strictGit(options: ShipmentAuditOptions, args: string[]): Promise<string> {
  if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
    try {
      await git(options, args);
      return 'true';
    } catch {
      return 'false';
    }
  }
  return git(options, args);
}

function isContradictoryEvidence(code: Extract<ShipmentEvidenceResult, { kind: 'refusal' }>['code']): boolean {
  return [
    'shipped-record-malformed',
    'shipped-record-incomplete',
    'shipped-record-slug-mismatch',
    'shipped-record-pr-mismatch',
    'shipped-record-hash-mismatch',
    'shipped-record-not-in-candidate',
    'shipment-candidate-not-on-implementation-head',
    'shipment-candidate-stale',
    'shipment-implementation-pr-mismatch',
    'shipment-implementation-head-missing',
  ].includes(code);
}

function row(source: AuditSource, classification: ShipmentAuditClassification, reason: string): ShipmentAuditRow {
  return {
    sourcePath: source.path,
    sourceKind: source.kind,
    classification,
    ...(source.plan ? { plan: source.plan } : {}),
    ...(source.relatedSourcePaths?.length ? { relatedSourcePaths: source.relatedSourcePaths } : {}),
    reason,
  };
}

function emptyCounts(): Record<ShipmentAuditClassification, number> {
  return {
    aligned: 0,
    backfilled: 0,
    unresolved: 0,
    absent: 0,
    ambiguous: 0,
    contradictory: 0,
  };
}

function countRows(rows: ShipmentAuditRow[]): Record<ShipmentAuditClassification, number> {
  const counts = emptyCounts();
  for (const item of rows) counts[item.classification] += 1;
  return counts;
}

async function repositoryName(options: ShipmentAuditOptions): Promise<string> {
  const { stdout } = await options.runGh(['repo', 'view', '--json', 'nameWithOwner'], { cwd: options.cwd });
  const value = JSON.parse(stdout) as { nameWithOwner?: unknown };
  if (typeof value.nameWithOwner !== 'string' || !value.nameWithOwner) {
    throw new Error('repository name is unavailable for merged PR enumeration');
  }
  return value.nameWithOwner;
}

async function persistShipmentAuditReport(
  cwd: string,
  reportPath: string,
  report: ShipmentAuditReport,
): Promise<void> {
  const auditDirectory = resolve(cwd, '.docs', 'audits');
  const path = resolve(cwd, reportPath);
  const pathWithinAuditDirectory = relative(auditDirectory, path);
  if (
    pathWithinAuditDirectory === ''
    || pathWithinAuditDirectory === '..'
    || pathWithinAuditDirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`shipment audit report path must remain under ${auditDirectory}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function git(options: ShipmentAuditOptions, args: string[]): Promise<string> {
  return (await options.runGit(args, { cwd: options.cwd })).stdout;
}

function extractPlanStems(metadata: string): string[] {
  return [...metadata.matchAll(/\.docs\/plans\/([^/\s`]+)\.md(?![A-Za-z0-9_.-])/g)].map((match) => match[1]);
}

function extractSpecPaths(metadata: string): string[] {
  return [...metadata.matchAll(/\.docs\/specs\/([^/\s`]+\.md)(?![A-Za-z0-9_.-])/g)]
    .map((match) => `.docs/specs/${match[1]}`);
}

function stem(path: string): string {
  return path.slice('.docs/plans/'.length, -'.md'.length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
