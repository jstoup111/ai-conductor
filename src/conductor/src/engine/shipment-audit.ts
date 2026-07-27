import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
  const auditHead = (await git(options, ['rev-parse', 'HEAD'])).trim();
  const currentPaths = new Set((await git(options, [
    'ls-tree', '-r', '--name-only', auditHead, '--', '.docs/plans', '.docs/specs',
  ])).split('\n').filter(Boolean));
  const planPaths = paths.filter((path) => path.startsWith('.docs/plans/') && path.endsWith('.md'));
  const plans = new Map(planPaths.map((path) => [path, { path, slug: stem(path) }]));
  const sources: AuditSource[] = planPaths.map((path) => ({
    path,
    kind: 'plan',
    plan: plans.get(path),
    relatedSourcePaths: [],
    ...(!currentPaths.has(path) ? { reason: 'historical plan is not present at the audit head' } : {}),
  }));
  const sourcesByPlanPath = new Map(sources.flatMap((source) => source.plan ? [[source.plan.path, source]] : []));

  for (const path of paths.filter((candidate) => candidate.startsWith('.docs/specs/') && candidate.endsWith('.md'))) {
    if (!currentPaths.has(path)) {
      sources.push({
        path,
        kind: 'spec',
        reason: 'historical product spec is not present at the audit head',
      });
      continue;
    }
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
    const canonicalPlan = plans.get(referencedPlans[0])!;
    sourcesByPlanPath.get(canonicalPlan.path)?.relatedSourcePaths?.push(path);
    sources.push({
      path,
      kind: 'spec',
      plan: canonicalPlan,
      relatedSourcePaths: [canonicalPlan.path],
    });
  }
  return sources;
}

async function referencedPlanPaths(options: ShipmentAuditOptions, path: string): Promise<string[]> {
  const content = await latestCommittedFile(options, path);
  if (content === null) return [];
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
    const content = await latestCommittedFile(options, planPath);
    if (content === null) continue;
    if (extractSpecPaths(content).includes(specPath)) matches.push(planPath);
  }
  return matches;
}

/**
 * `git log -- <path>` can lead with a deletion or rename commit, whose tree
 * necessarily lacks the path. Historical provenance needs the latest blob,
 * not merely the latest path-changing commit.
 */
async function latestCommittedFile(options: ShipmentAuditOptions, path: string): Promise<string | null> {
  const commits = (await git(options, ['log', '--format=%H', '--', path]))
    .split('\n')
    .filter(Boolean);
  for (const commit of commits) {
    const content = await committedFile(options, commit, path);
    if (content !== null) return content.toString('utf8');
  }
  return null;
}

async function enumerateMergedPullRequests(options: ShipmentAuditOptions): Promise<MergedPullRequest[]> {
  const repository = await repositoryName(options);
  const [owner, name] = repository.split('/');
  if (!owner || !name || repository.split('/').length !== 2) {
    throw new Error('repository name is malformed for merged PR enumeration');
  }
  const pullRequests: MergedPullRequest[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < MAX_GRAPHQL_PAGES; pageNumber += 1) {
    const page = await graphqlPage(
      options,
      MERGED_PULL_REQUESTS_QUERY,
      graphqlVariables(owner, name, undefined, cursor),
      'merged PR enumeration',
    );
    const connection = pullRequestConnection(page, 'merged PR enumeration');
    for (const node of requiredArray(connection.nodes, 'merged PR enumeration nodes')) {
      const pullRequest = mergedPullRequestFromNode(node);
      pullRequest.changedPaths.push(...await remainingChangedPaths(
        options,
        owner,
        name,
        pullRequest.number,
        pullRequest.filesPageInfo,
      ));
      pullRequests.push({
        number: pullRequest.number,
        url: pullRequest.url,
        body: pullRequest.body,
        changedPaths: pullRequest.changedPaths,
        headSha: pullRequest.headSha,
        mergedAt: pullRequest.mergedAt,
      });
    }
    const pagination = pageInfo(connection.pageInfo, 'merged PR pagination');
    if (!pagination.hasNextPage) break;
    cursor = nextCursor(pagination, seenCursors, 'merged PR enumeration');
    if (pageNumber === MAX_GRAPHQL_PAGES - 1) {
      throw new Error(`merged PR enumeration exceeded ${MAX_GRAPHQL_PAGES} GraphQL pages`);
    }
  }
  const numbers = new Set(pullRequests.map((pullRequest) => pullRequest.number));
  if (numbers.size !== pullRequests.length) throw new Error('merged PR enumeration returned duplicate pull requests');
  return pullRequests;
}

async function remainingChangedPaths(
  options: ShipmentAuditOptions,
  owner: string,
  name: string,
  number: number,
  firstPageInfo: GraphqlPageInfo,
): Promise<string[]> {
  if (!firstPageInfo.hasNextPage) return [];
  if (firstPageInfo.endCursor === null) {
    throw new Error(`changed-file enumeration for #${number} is incomplete`);
  }
  const changedPaths: string[] = [];
  let cursor: string | null = firstPageInfo.endCursor;
  const seenCursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < MAX_GRAPHQL_PAGES; pageNumber += 1) {
    const context = `changed-file enumeration for #${number}`;
    const page = await graphqlPage(
      options,
      PULL_REQUEST_FILES_QUERY,
      graphqlVariables(owner, name, number, cursor),
      context,
    );
    const connection = pullRequestFilesConnection(page, number);
    changedPaths.push(...requiredArray(connection.nodes, `${context} nodes`)
      .map((node) => requiredString(object(node, `${context} node`).path, `changed-file path for #${number}`)));
    const pagination = pageInfo(connection.pageInfo, `changed-file pagination for #${number}`);
    if (!pagination.hasNextPage) return changedPaths;
    cursor = nextCursor(pagination, seenCursors, context);
    if (pageNumber === MAX_GRAPHQL_PAGES - 1) {
      throw new Error(`${context} exceeded ${MAX_GRAPHQL_PAGES} GraphQL pages`);
    }
  }
  throw new Error(`changed-file enumeration for #${number} pagination is incomplete`);
}

interface GraphqlPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface MergedPullRequestNode {
  number: number;
  url: string;
  body: string;
  headSha: string;
  mergedAt: string;
  changedPaths: string[];
  filesPageInfo: GraphqlPageInfo;
}

const MERGED_PULL_REQUESTS_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 10, after: $endCursor) {
      nodes {
        number
        url
        body
        mergedAt
        headRefOid
        files(first: 100) {
          nodes { path }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const PULL_REQUEST_FILES_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $endCursor) {
        nodes { path }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const MAX_GRAPHQL_PAGES = 10_000;
const GRAPHQL_TRANSPORT_ATTEMPTS = 3;
const GRAPHQL_TRANSPORT_BACKOFF_MS = [250, 500] as const;

function graphqlVariables(
  owner: string,
  name: string,
  number: number | undefined,
  endCursor: string | null,
): Array<[name: string, value: string, typed?: boolean]> {
  const variables: Array<[name: string, value: string, typed?: boolean]> = [
    ['owner', owner],
    ['name', name],
  ];
  if (number !== undefined) variables.push(['number', String(number), true]);
  if (endCursor !== null) variables.push(['endCursor', endCursor]);
  return variables;
}

async function graphqlPage(
  options: ShipmentAuditOptions,
  query: string,
  variables: Array<[name: string, value: string, typed?: boolean]>,
  context: string,
): Promise<unknown> {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    ...variables.flatMap(([name, value, typed]) => [typed ? '-F' : '-f', `${name}=${value}`]),
  ];
  let lastTransportError: unknown;
  for (let attempt = 1; attempt <= GRAPHQL_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const { stdout } = await options.runGh(args, { cwd: options.cwd });
      return parseGraphqlPage(stdout, context);
    } catch (error) {
      if (!isTransientGithubTransportError(error)) throw error;
      lastTransportError = error;
      if (attempt === GRAPHQL_TRANSPORT_ATTEMPTS) break;
      await delay(GRAPHQL_TRANSPORT_BACKOFF_MS[attempt - 1]);
    }
  }
  throw new Error(
    `${context} GraphQL transport retry exhausted after ${GRAPHQL_TRANSPORT_ATTEMPTS} attempts: ${errorMessage(lastTransportError)}`,
  );
}

function isTransientGithubTransportError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return [
    'unexpected eof',
    'error connecting to api.github.com',
    'could not resolve host',
    'getaddrinfo',
    'eai_again',
    'enotfound',
    'econnreset',
    'connection reset',
    'socket hang up',
    'etimedout',
    'connection timed out',
    'timeout',
    'network is unreachable',
  ].some((fragment) => message.includes(fragment));
}

function parseGraphqlPage(stdout: string, context: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${context} returned malformed GraphQL JSON: ${errorMessage(error)}`);
  }
  object(parsed, context);
  return parsed;
}

function pullRequestConnection(page: unknown, context: string): Record<string, unknown> {
  const repository = object(object(object(page, context).data, `${context} data`).repository, `${context} repository`);
  return object(repository.pullRequests, `${context} connection`);
}

function pullRequestFilesConnection(page: unknown, number: number): Record<string, unknown> {
  const context = `changed-file enumeration for #${number}`;
  const repository = object(object(object(page, context).data, `${context} data`).repository, `${context} repository`);
  return object(object(repository.pullRequest, `${context} pull request`).files, `${context} connection`);
}

function mergedPullRequestFromNode(node: unknown): MergedPullRequestNode {
  const value = object(node, 'merged PR node');
  const files = object(value.files, `merged PR files for #${String(value.number)}`);
  return {
    number: requiredNumber(value.number, 'merged PR number'),
    url: requiredString(value.url, 'merged PR URL'),
    body: typeof value.body === 'string' ? value.body : '',
    headSha: requiredString(value.headRefOid, 'merged PR head SHA'),
    mergedAt: requiredString(value.mergedAt, 'merged PR merge timestamp'),
    changedPaths: requiredArray(files.nodes, 'merged PR changed-file nodes').map((file) =>
      requiredString(object(file, 'merged PR changed-file node').path, 'merged PR changed-file path')),
    filesPageInfo: pageInfo(files.pageInfo, 'merged PR changed-file pagination'),
  };
}

function nextCursor(pageInfo: GraphqlPageInfo, seenCursors: Set<string>, context: string): string {
  if (!pageInfo.hasNextPage || pageInfo.endCursor === null) {
    throw new Error(`${context} pagination is incomplete`);
  }
  if (seenCursors.has(pageInfo.endCursor)) {
    throw new Error(`${context} pagination cursor repeated`);
  }
  seenCursors.add(pageInfo.endCursor);
  return pageInfo.endCursor;
}

function pageInfo(value: unknown, context: string): GraphqlPageInfo {
  const parsed = object(value, context);
  if (typeof parsed.hasNextPage !== 'boolean' || (parsed.endCursor !== null && typeof parsed.endCursor !== 'string')) {
    throw new Error(`${context} is malformed`);
  }
  if (parsed.hasNextPage && parsed.endCursor === null) throw new Error(`${context} is incomplete`);
  return { hasNextPage: parsed.hasNextPage, endCursor: parsed.endCursor };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} is malformed`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} is malformed`);
  return value;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} is malformed`);
  return value;
}

function requiredNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${context} is malformed`);
  return value;
}

async function auditSource(
  options: ShipmentAuditOptions,
  source: AuditSource,
  planStems: string[],
  mergedPullRequests: MergedPullRequest[],
): Promise<ShipmentAuditRow> {
  if (!source.plan || source.reason) {
    return {
      sourcePath: source.path,
      sourceKind: source.kind,
      classification: 'unresolved',
      ...(source.plan ? { plan: source.plan } : {}),
      ...(source.relatedSourcePaths?.length ? { relatedSourcePaths: source.relatedSourcePaths } : {}),
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
    let proposal: { path: string; content: string };
    try {
      proposal = await expectedProposal(options, source.plan, implementationPr);
    } catch (error) {
      return {
        ...row(source, 'unresolved', `implementation head cannot prove record proposal: ${errorMessage(error)}`),
        implementationPr: pr,
        verdict,
      };
    }
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
