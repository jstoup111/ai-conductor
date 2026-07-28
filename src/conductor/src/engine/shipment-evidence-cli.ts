import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  classifyShipmentAssociation,
  type ShipmentAssociationResult,
} from './shipment-association.js';
import {
  evaluateShipmentEvidence,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceInput,
} from './shipment-evidence.js';
import {
  planShipmentReconciliation,
  publishShipmentRepair,
  SHIPMENT_REPAIR_STATUS_CONTEXT,
  type ShipmentRepairPublicationResult,
  type ShipmentRepairPublisher,
} from './shipment-reconciliation.js';
import {
  DEFAULT_SHIPMENT_AUDIT_REPORT,
  runShipmentAudit,
} from './shipment-audit.js';
import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { specHash } from './shipped-record.js';

export type ShipmentEvidenceCommand =
  | { kind: 'check'; pr: string; eventPath?: string }
  | { kind: 'reconcile'; pr: string; shipped: string }
  | { kind: 'audit'; reportPath: string }
  | { kind: 'guide' };

export const SHIPMENT_EVIDENCE_USAGE =
  'conduct shipment-evidence --pr <implementation-pr-url> [--event <pull-request-event.json>] | reconcile --pr <implementation-pr-url> --shipped <YYYY-MM-DD> | audit [--report <path>]';

export interface ShipmentEvidenceRunners {
  runGh?: GhRunner;
  runGit?: GitRunner;
  listPlanStems?: (cwd: string) => Promise<string[]>;
  readEventMetadata?: (eventPath: string, cwd: string, runGit: GitRunner) => Promise<PullRequestEvidenceMetadata>;
  evaluateEvidence?: (
    input: ShipmentEvidenceInput,
    dependencies: ShipmentEvidenceDependencies,
  ) => ReturnType<typeof evaluateShipmentEvidence>;
  report?: (message: string) => void;
  reportError?: (message: string) => void;
}

export interface PullRequestEvidenceMetadata {
  url: string;
  body: string;
  changedPaths: string[];
  headRefOid: string;
}

export function detectShipmentEvidenceCommand(argv: string[]): ShipmentEvidenceCommand | null {
  if (argv[2] !== 'shipment-evidence') return null;
  if (argv[3] === 'audit') {
    const reportIndex = argv.indexOf('--report', 4);
    const reportPath = reportIndex === -1 ? DEFAULT_SHIPMENT_AUDIT_REPORT : argv[reportIndex + 1];
    return reportPath && !reportPath.startsWith('--') ? { kind: 'audit', reportPath } : { kind: 'guide' };
  }
  const reconcile = argv[3] === 'reconcile';
  const argsStart = reconcile ? 4 : 3;
  const prIndex = argv.indexOf('--pr', argsStart);
  const pr = prIndex === -1 ? undefined : argv[prIndex + 1];
  if (!pr || pr.startsWith('--')) return { kind: 'guide' };
  if (!reconcile) {
    const eventIndex = argv.indexOf('--event', argsStart);
    const eventPath = eventIndex === -1 ? undefined : argv[eventIndex + 1];
    return eventPath && eventPath.startsWith('--')
      ? { kind: 'guide' }
      : { kind: 'check', pr, eventPath };
  }
  const shippedIndex = argv.indexOf('--shipped', argsStart);
  const shipped = shippedIndex === -1 ? undefined : argv[shippedIndex + 1];
  return shipped && /^\d{4}-\d{2}-\d{2}/.test(shipped)
    ? { kind: 'reconcile', pr, shipped: shipped.slice(0, 'YYYY-MM-DD'.length) }
    : { kind: 'guide' };
}

/**
 * Report shipment evidence for every pull request. Only an exact implementation
 * association reaches the strict evaluator; all other PR classes are an
 * explicit successful not-applicable result.
 */
export async function dispatchShipmentEvidence(
  cmd: ShipmentEvidenceCommand,
  cwd: string,
  runners: ShipmentEvidenceRunners = {},
): Promise<number> {
  const report = runners.report ?? console.log;
  const reportError = runners.reportError ?? console.error;
  if (cmd.kind === 'guide') {
    reportError(SHIPMENT_EVIDENCE_USAGE);
    return 1;
  }

  try {
    const runGh = runners.runGh ?? makeProductionGh();
    const runGit = runners.runGit ?? makeProductionGit();
    if (cmd.kind === 'audit') {
      const audit = await runShipmentAudit({
        cwd,
        reportPath: cmd.reportPath,
        runGh,
        runGit,
        evaluateEvidence: runners.evaluateEvidence ?? evaluateShipmentEvidence,
      });
      report(`shipped-record audit: complete (${audit.rows.length} candidates)`);
      return 0;
    }
    const metadata = cmd.kind === 'check' && cmd.eventPath
      ? await (runners.readEventMetadata ?? readPullRequestEventMetadata)(cmd.eventPath, cwd, runGit)
      : await readPullRequestEvidenceMetadata(runGh, cwd, cmd.pr);
    if (metadata.url !== cmd.pr) {
      throw new Error(`implementation PR binding mismatch: expected ${cmd.pr}, got ${metadata.url || 'empty'}`);
    }

    const planStems = await (runners.listPlanStems ?? listPlanStems)(cwd);
    const association = classifyShipmentAssociation({
      planStems,
      pr: {
        metadataPlanStems: extractPlanStems(metadata.body),
        changedPaths: metadata.changedPaths,
      },
    });
    if (association.kind === 'not-applicable') {
      report(`shipped-record: not applicable (${association.classification})`);
      return 0;
    }

    const candidateCommit = (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    if (cmd.kind === 'reconcile') {
      const result = await publishRecordOnlyRepair({
        cwd,
        implementationPr: cmd.pr,
        slug: association.slug,
        shipped: cmd.shipped,
        candidateCommit,
        association,
        runGh,
        runGit,
        evaluateEvidence: runners.evaluateEvidence ?? evaluateShipmentEvidence,
      });
      report(`shipped-record: ${result.kind}`);
      return result.kind === 'unresolved' ? 1 : 0;
    }

    const evidence = await (runners.evaluateEvidence ?? evaluateShipmentEvidence)(
      {
        repoDir: cwd,
        slug: association.slug,
        implementationPr: cmd.pr,
        candidateCommit,
      },
      {
        gitRunner: evidenceGitRunner(runGit, cwd),
        githubRunner: async (implementationPr) => {
          if (implementationPr !== cmd.pr) {
            throw new Error(`implementation PR binding mismatch: expected ${cmd.pr}, got ${implementationPr}`);
          }
          return { url: metadata.url, headRefOid: metadata.headRefOid };
        },
      },
    );
    if (evidence.kind === 'valid') {
      report(`shipped-record: valid ${evidence.recordPath}`);
      return 0;
    }
    if (evidence.kind === 'not-applicable') {
      reportError(`shipped-record: ${evidence.reason}`);
      return 1;
    }

    reportError(`shipped-record: ${evidence.code}`);
    return 1;
  } catch (error) {
    reportError(`shipped-record: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * The one record-only repair publication path. Both the `shipment-evidence
 * reconcile` CLI verb and the reusable `requestRecordRepair` adapter below run
 * exactly these steps, so the ST-916 guarantees (deterministic repair branch,
 * canonical evidence at the repair head, human-reviewed PR, no auto-merge)
 * cannot drift apart between the two callers.
 */
async function publishRecordOnlyRepair(input: {
  cwd: string;
  implementationPr: string;
  slug: string;
  shipped: string;
  candidateCommit: string;
  association: ShipmentAssociationResult;
  runGh: GhRunner;
  runGit: GitRunner;
  evaluateEvidence: NonNullable<ShipmentEvidenceRunners['evaluateEvidence']>;
  repo?: string;
}): Promise<ShipmentRepairPublicationResult> {
  const expectedRecord = await expectedReconciledRecord(input.cwd, input.slug, input.shipped);
  const evidence = await evaluateAtCandidateHead(
    input.implementationPr,
    input.cwd,
    input.slug,
    input.candidateCommit,
    input.runGit,
    input.evaluateEvidence,
  );
  const plan = planShipmentReconciliation({
    implementationPr: {
      number: implementationPrNumber(input.implementationPr),
      url: input.implementationPr,
    },
    association: input.association,
    evidence,
    expectedRecord,
  });
  return publishShipmentRepair(plan, makeProductionRepairPublisher({
    cwd: input.cwd,
    implementationPr: input.implementationPr,
    slug: input.slug,
    runGh: input.runGh,
    runGit: input.runGit,
    evaluateEvidence: input.evaluateEvidence,
    repo: input.repo,
  }));
}

export interface RecordRepairRequest {
  slug: string;
  prUrl: string;
}

export interface RecordRepairRequesterOptions {
  /** Repository root the repair runs against (the daemon's project root). */
  cwd: string;
  runGh?: GhRunner;
  runGit?: GitRunner;
  listPlanStems?: (cwd: string) => Promise<string[]>;
  evaluateEvidence?: NonNullable<ShipmentEvidenceRunners['evaluateEvidence']>;
  log?: (message: string) => void;
}

/**
 * Build the reusable production `requestRecordRepair` adapter that parked-feature
 * reconciliation hands an ancestry-proven-merged slug whose `.docs/shipped/<slug>.md`
 * never landed (adr-2026-07-27 Decision 4).
 *
 * It never invents identity: the slug must classify as the implementation
 * association of the supplied merged PR, and the `shipped` date is read from the
 * PR's own `mergedAt`. It never throws — record repair is a best-effort hand-off
 * from a best-effort daemon sweep, and any failure must leave the park deferred
 * (not crash the sweep, not authorise cleanup).
 */
export function makeRecordRepairRequester(
  options: RecordRepairRequesterOptions,
): (request: RecordRepairRequest) => Promise<void> {
  return async ({ slug, prUrl }) => {
    const log = options.log ?? (() => {});
    try {
      const runGh = options.runGh ?? makeProductionGh();
      const runGit = options.runGit ?? makeProductionGit();
      const evaluateEvidence = options.evaluateEvidence ?? evaluateShipmentEvidence;
      const metadata = await readPullRequestEvidenceMetadata(runGh, options.cwd, prUrl);
      if (metadata.url !== prUrl) {
        log(`[shipped-record-repair] ${slug}: implementation PR binding mismatch for ${prUrl}`);
        return;
      }
      const planStems = await (options.listPlanStems ?? listPlanStems)(options.cwd);
      const association = classifyShipmentAssociation({
        planStems,
        pr: {
          metadataPlanStems: extractPlanStems(metadata.body),
          changedPaths: metadata.changedPaths,
        },
      });
      if (association.kind !== 'implementation') {
        log(`[shipped-record-repair] ${slug}: ${prUrl} is ${association.classification}; no repair requested`);
        return;
      }
      if (association.slug !== slug) {
        log(`[shipped-record-repair] ${slug}: ${prUrl} associates with ${association.slug}; no repair requested`);
        return;
      }
      const shipped = await readMergedDate(runGh, options.cwd, prUrl);
      if (!shipped) {
        log(`[shipped-record-repair] ${slug}: ${prUrl} has no merge date; no repair requested`);
        return;
      }
      const candidateCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: options.cwd })).stdout.trim();
      const result = await publishRecordOnlyRepair({
        cwd: options.cwd,
        implementationPr: prUrl,
        slug,
        shipped,
        candidateCommit,
        association,
        runGh,
        runGit,
        evaluateEvidence,
        repo: await resolveRepairRepository(runGh, options.cwd),
      });
      log(
        result.kind === 'repair-published'
          ? `[shipped-record-repair] ${slug}: repair PR ${result.pullRequestUrl} (${result.status}) — human review required`
          : `[shipped-record-repair] ${slug}: ${result.kind}${result.kind === 'unresolved' ? ` (${result.reason})` : ''}`,
      );
    } catch (error) {
      log(`[shipped-record-repair] ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

/** The shipped date is the PR's own merge timestamp — never today's clock. */
async function readMergedDate(
  runGh: GhRunner,
  cwd: string,
  pullRequestUrl: string,
): Promise<string | null> {
  const { stdout } = await runGh(['pr', 'view', pullRequestUrl, '--json', 'mergedAt'], { cwd });
  const mergedAt = (JSON.parse(stdout) as { mergedAt?: unknown }).mergedAt;
  return typeof mergedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(mergedAt)
    ? mergedAt.slice(0, 'YYYY-MM-DD'.length)
    : null;
}

/**
 * `GITHUB_REPOSITORY` is set inside Actions but not in a long-running daemon,
 * so fall back to the checkout's own `gh` repository identity.
 */
async function resolveRepairRepository(
  runGh: GhRunner,
  cwd: string,
): Promise<string | undefined> {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const { stdout } = await runGh(['repo', 'view', '--json', 'nameWithOwner'], { cwd });
  const nameWithOwner = (JSON.parse(stdout) as { nameWithOwner?: unknown }).nameWithOwner;
  return typeof nameWithOwner === 'string' && nameWithOwner ? nameWithOwner : undefined;
}

async function expectedReconciledRecord(
  cwd: string,
  slug: string,
  shipped: string,
): Promise<{ specHash: string; shipped: string }> {
  const plan = await readFile(join(cwd, '.docs', 'plans', `${slug}.md`));
  const planContent = plan.toString('utf8');
  const reference = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im)?.[1];
  let stories: Buffer | null = null;
  for (const path of [reference, `.docs/stories/${slug}.md`].filter((value): value is string => Boolean(value))) {
    try {
      stories = await readFile(join(cwd, path));
      break;
    } catch {
      // The shared canonical-hash convention permits a plan without stories.
    }
  }
  return { specHash: specHash(plan, stories).digest, shipped };
}

function implementationPrNumber(pr: string): number {
  const value = /\/pull\/(\d+)(?:$|[/?#])/.exec(pr)?.[1];
  if (!value) throw new Error(`implementation PR URL is not canonical: ${pr}`);
  return Number(value);
}

async function evaluateAtCandidateHead(
  implementationPr: string,
  cwd: string,
  slug: string,
  candidateCommit: string,
  runGit: GitRunner,
  evaluateEvidence: NonNullable<ShipmentEvidenceRunners['evaluateEvidence']>,
) {
  return evaluateEvidence(
    { repoDir: cwd, slug, implementationPr, candidateCommit },
    {
      gitRunner: evidenceGitRunner(runGit, cwd),
      githubRunner: async () => ({ url: implementationPr, headRefOid: candidateCommit }),
    },
  );
}

function makeProductionRepairPublisher(input: {
  cwd: string;
  implementationPr: string;
  slug: string;
  runGh: GhRunner;
  runGit: GitRunner;
  evaluateEvidence: NonNullable<ShipmentEvidenceRunners['evaluateEvidence']>;
  /** Explicit `owner/name`; defaults to the Actions-provided environment. */
  repo?: string;
}): ShipmentRepairPublisher {
  const repo = input.repo ?? process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required for repair publication');

  return {
    ensureRepairBranch: async ({ branch, base }) => {
      const remoteBranch = `refs/heads/${branch}`;
      const exists = await input.runGh(
        ['api', `repos/${repo}/git/ref/heads/${branch}`],
        { cwd: input.cwd },
      ).then(() => true, () => false);
      await input.runGit(['fetch', 'origin', exists ? remoteBranch : base], { cwd: input.cwd });
      const startPoint = exists ? `origin/${branch}` : `origin/${base}`;
      await input.runGit(['switch', '--force-create', branch, startPoint], { cwd: input.cwd });
    },
    commitRecordOnly: async ({ branch, writes }) => {
      const [write] = writes;
      await mkdir(join(input.cwd, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(input.cwd, write.path), write.content);
      await input.runGit(['add', '--', write.path], { cwd: input.cwd });
      const changed = (await input.runGit(['diff', '--cached', '--name-only'], { cwd: input.cwd })).stdout
        .split('\n')
        .filter(Boolean);
      if (changed.length > 0 && (changed.length !== 1 || changed[0] !== write.path)) {
        throw new Error(`repair commit is not record-only: ${changed.join(', ')}`);
      }
      if (changed.length > 0) {
        await input.runGit(['commit', '-m', `docs: repair shipped record for ${branch}`], { cwd: input.cwd });
        await input.runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: input.cwd });
      }
      return { headSha: (await input.runGit(['rev-parse', 'HEAD'], { cwd: input.cwd })).stdout.trim() };
    },
    findOrCreateRepairPullRequest: async ({ branch, base, identity }) => {
      const existing = await input.runGh(
        ['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'url', '--limit', '1'],
        { cwd: input.cwd },
      );
      const existingUrl = (JSON.parse(existing.stdout) as Array<{ url?: unknown }>)[0]?.url;
      if (typeof existingUrl === 'string') {
        return readRepairPullRequestHead(input.runGh, input.cwd, existingUrl);
      }
      const created = await input.runGh(
        [
          'pr', 'create', '--base', base, '--head', branch,
          '--title', `Repair durable shipment record for ${identity}`,
          '--body', `Record-only repair for implementation PR ${input.implementationPr}. Human review and merge required.`,
        ],
        { cwd: input.cwd },
      );
      return readRepairPullRequestHead(input.runGh, input.cwd, created.stdout.trim());
    },
    verifyRepairHead: async ({ headSha }) => evaluateAtCandidateHead(
      input.implementationPr,
      input.cwd,
      input.slug,
      headSha,
      input.runGit,
      input.evaluateEvidence,
    ),
    postStatus: async ({ sha, context, state, description }) => {
      await input.runGh(
        [
          'api', '--method', 'POST', `repos/${repo}/statuses/${sha}`,
          '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description}`,
        ],
        { cwd: input.cwd },
      );
    },
  };
}

async function readRepairPullRequestHead(
  runGh: GhRunner,
  cwd: string,
  pullRequestUrl: string,
): Promise<{ url: string; headSha: string }> {
  const { stdout } = await runGh(
    ['pr', 'view', pullRequestUrl, '--json', 'url,headRefOid'],
    { cwd },
  );
  const value = JSON.parse(stdout) as { url?: unknown; headRefOid?: unknown };
  if (value.url !== pullRequestUrl || typeof value.headRefOid !== 'string' || !value.headRefOid) {
    throw new Error(`repair PR head is unavailable or mismatched: ${pullRequestUrl}`);
  }
  return { url: value.url, headSha: value.headRefOid };
}

async function readPullRequestEvidenceMetadata(
  runGh: GhRunner,
  cwd: string,
  pr: string,
): Promise<PullRequestEvidenceMetadata> {
  const { stdout } = await runGh(
    ['pr', 'view', pr, '--json', 'url,body,files,headRefOid'],
    { cwd },
  );
  const value = JSON.parse(stdout) as {
    url?: unknown;
    body?: unknown;
    files?: unknown;
    headRefOid?: unknown;
  };
  return {
    url: typeof value.url === 'string' ? value.url : '',
    body: typeof value.body === 'string' ? value.body : '',
    changedPaths: Array.isArray(value.files)
      ? value.files.flatMap((file) => {
        const path = (file as { path?: unknown }).path;
        return typeof path === 'string' ? [path] : [];
      })
      : [],
    headRefOid: typeof value.headRefOid === 'string' ? value.headRefOid : '',
  };
}

/**
 * The pull_request workflow already checks out the immutable event head. Read
 * its signed event payload plus the local commit graph rather than depending
 * on `gh pr view` (which is unavailable in restricted CI credentials).
 */
async function readPullRequestEventMetadata(
  eventPath: string,
  cwd: string,
  runGit: GitRunner,
): Promise<PullRequestEvidenceMetadata> {
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
    pull_request?: {
      html_url?: unknown;
      body?: unknown;
      base?: { sha?: unknown };
      head?: { sha?: unknown };
    };
  };
  const pullRequest = event.pull_request;
  const url = typeof pullRequest?.html_url === 'string' ? pullRequest.html_url : '';
  const baseSha = typeof pullRequest?.base?.sha === 'string' ? pullRequest.base.sha : '';
  const headRefOid = typeof pullRequest?.head?.sha === 'string' ? pullRequest.head.sha : '';
  if (!url || !baseSha || !headRefOid) {
    throw new Error(`pull-request event lacks URL or commit identity: ${eventPath}`);
  }
  const changedPaths = (await runGit(['diff', '--name-only', `${baseSha}...${headRefOid}`], { cwd })).stdout
    .split('\n')
    .filter(Boolean);
  return {
    url,
    body: typeof pullRequest?.body === 'string' ? pullRequest.body : '',
    changedPaths,
    headRefOid,
  };
}

function evidenceGitRunner(runGit: GitRunner, cwd: string) {
  return async (args: string[]): Promise<string> => {
    try {
      const result = await runGit(args, { cwd });
      return isMergeBaseAncestor(args) ? 'true' : result.stdout;
    } catch (error) {
      if (isMergeBaseAncestor(args) && exitCode(error) === 1) return 'false';
      throw error;
    }
  };
}

function isMergeBaseAncestor(args: string[]): boolean {
  return args[0] === 'merge-base' && args[1] === '--is-ancestor';
}

function exitCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code
    : undefined;
}

async function listPlanStems(cwd: string): Promise<string[]> {
  const entries = await readdir(join(cwd, '.docs', 'plans'));
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -'.md'.length));
}

function extractPlanStems(metadata: string): string[] {
  return [...metadata.matchAll(/\.docs\/plans\/([^/\s`]+)\.md/g)].map((match) => match[1]);
}
