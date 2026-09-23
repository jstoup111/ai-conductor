import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyShipmentAssociation,
  type ShipmentAssociationResult,
} from './shipment-association.js';
import { extractShipmentPlanDeclarations } from './shipment-plan-declaration.js';
import {
  evaluateShipmentEvidence,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceInput,
} from './shipment-evidence.js';
import {
  planShipmentReconciliation,
  publishShipmentRepair,
  SHIPMENT_REPAIR_STATUS_CONTEXT,
  shippedRecordContentDroppedBy,
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
import { runTrackerRead } from './tracker-client.js';
import { GhRunnerError } from './tracker-client.js';
import { specHash } from './shipped-record.js';
import { executeRemoteGit, resolveFeatureRemoteMutation } from './remote-git-operations.js';
import {
  createGuardedGithubOperationRunner,
  type GithubMutationExecutionContext,
} from './tracker-client.js';
import {
  executeGithubOperation,
  type GithubOperationRunner,
} from './github-operations.js';

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
        metadataPlanStems: cmd.kind === 'check'
          ? extractShipmentPlanDeclarations(metadata.body)
          : extractPlanStems(metadata.body),
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

    report(`shipped-record: plan .docs/plans/${association.slug}.md basis=explicit-plan-declaration`);
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
  /** Read the spec from this commit instead of the `cwd` working tree. */
  specCommit?: string;
}): Promise<ShipmentRepairPublicationResult> {
  const { specCommit } = input;
  const expectedRecord = await expectedReconciledRecord(
    specCommit
      ? (path) => readCommittedFile(input.runGit, input.cwd, specCommit, path)
        .then((content) => (content === null ? null : Buffer.from(content, 'utf8')))
      : (path) => readFile(join(input.cwd, path)).catch(() => null),
    input.slug,
    input.shipped,
  );
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
  const remoteMutation = plan.kind === 'repair'
    ? await resolveFeatureRemoteMutation({
      cwd: input.cwd,
      slug: input.slug,
      branch: `shipment-repair/${plan.identity}`,
      git: (args) => input.runGit(args, { cwd: input.cwd }),
      gh: input.runGh,
    })
    : undefined;
  return publishShipmentRepair(plan, makeProductionRepairPublisher({
    cwd: input.cwd,
    implementationPr: input.implementationPr,
    slug: input.slug,
    runGh: input.runGh,
    runGit: input.runGit,
    evaluateEvidence: input.evaluateEvidence,
    repo: input.repo,
    remoteMutation,
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
      // Judge only fetched git objects, never the root working tree: the sweep
      // can run seconds after a merge, before the root checkout fast-forwards,
      // and a record the merge already carries must never be "repaired".
      await runGit(['fetch', 'origin', 'main'], { cwd: options.cwd });
      const baseCommit = (await runGit(['rev-parse', '--verify', 'origin/main^{commit}'], { cwd: options.cwd }))
        .stdout.trim();
      const planStems = options.listPlanStems
        ? await options.listPlanStems(options.cwd)
        : await listPlanStemsAtCommit(runGit, options.cwd, baseCommit);
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
      const merge = await readMergeIdentity(runGh, options.cwd, prUrl);
      if (!merge) {
        log(`[shipped-record-repair] ${slug}: ${prUrl} has no merge date or merge commit; no repair requested`);
        return;
      }
      if (await shippedRecordInTree(runGit, options.cwd, merge.mergeCommit, slug)) {
        log(`[shipped-record-repair] ${slug}: ${prUrl} merge commit already carries the record; no repair requested`);
        return;
      }
      const result = await publishRecordOnlyRepair({
        cwd: options.cwd,
        implementationPr: prUrl,
        slug,
        shipped: merge.shipped,
        candidateCommit: baseCommit,
        association,
        runGh,
        runGit,
        evaluateEvidence,
        repo: await resolveRepairRepository(runGh, options.cwd),
        specCommit: baseCommit,
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

/**
 * The shipped date is the PR's own merge timestamp — never today's clock — and
 * the merge commit is the tree whose content the PR actually landed.
 */
async function readMergeIdentity(
  runGh: GhRunner,
  cwd: string,
  pullRequestUrl: string,
): Promise<{ shipped: string; mergeCommit: string } | null> {
  const stdout = await runTrackerRead(
    runGh, cwd, 'pull-request.read', repositoryForPullRequest(pullRequestUrl), { kind: 'repository' },
    ['pr', 'view', pullRequestUrl, '--json', 'mergedAt,mergeCommit'],
  );
  const value = JSON.parse(stdout) as { mergedAt?: unknown; mergeCommit?: { oid?: unknown } | null };
  const mergedAt = value.mergedAt;
  const mergeCommit = value.mergeCommit?.oid;
  return typeof mergedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(mergedAt)
    && typeof mergeCommit === 'string' && mergeCommit
    ? { shipped: mergedAt.slice(0, 'YYYY-MM-DD'.length), mergeCommit }
    : null;
}

/**
 * Whether `commit`'s tree carries a shipped record for `slug`, exact or under a
 * dated stem. A git failure propagates: no answer never authorizes a repair.
 */
async function shippedRecordInTree(
  runGit: GitRunner,
  cwd: string,
  commit: string,
  slug: string,
): Promise<boolean> {
  const { stdout } = await runGit(['ls-tree', '--name-only', commit, '--', '.docs/shipped/'], { cwd });
  return stdout
    .split('\n')
    .map((entry) => entry.trim().replace(/^\.docs\/shipped\//, ''))
    .some((entry) => entry === `${slug}.md` || entry.replace(/^\d{4}-\d{2}-\d{2}-(?=.)/, '') === `${slug}.md`);
}

/** A file's content at a commit, `null` when that tree does not carry it. */
async function readCommittedFile(
  runGit: GitRunner,
  cwd: string,
  commit: string,
  path: string,
): Promise<string | null> {
  const listed = (await runGit(['ls-tree', '--name-only', commit, '--', path], { cwd })).stdout.trim();
  if (!listed) return null;
  return (await runGit(['show', `${commit}:${path}`], { cwd })).stdout;
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
  const stdout = await runTrackerRead(
    runGh, cwd, 'repository.read', 'github/current-repository', { kind: 'repository' },
    ['repo', 'view', '--json', 'nameWithOwner'],
  );
  const nameWithOwner = (JSON.parse(stdout) as { nameWithOwner?: unknown }).nameWithOwner;
  return typeof nameWithOwner === 'string' && nameWithOwner ? nameWithOwner : undefined;
}

async function expectedReconciledRecord(
  readSpec: (path: string) => Promise<Buffer | null>,
  slug: string,
  shipped: string,
): Promise<{ specHash: string; shipped: string }> {
  const planPath = `.docs/plans/${slug}.md`;
  const plan = await readSpec(planPath);
  if (plan === null) throw new Error(`plan ${planPath} is unavailable`);
  const planContent = plan.toString('utf8');
  const reference = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im)?.[1];
  let stories: Buffer | null = null;
  for (const path of [reference, `.docs/stories/${slug}.md`].filter((value): value is string => Boolean(value))) {
    // The shared canonical-hash convention permits a plan without stories.
    stories = await readSpec(path);
    if (stories !== null) break;
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

export function makeProductionRepairPublisher(input: {
  cwd: string;
  implementationPr: string;
  slug: string;
  runGh: GhRunner;
  runGit: GitRunner;
  evaluateEvidence: NonNullable<ShipmentEvidenceRunners['evaluateEvidence']>;
  /** Explicit `owner/name`; defaults to the Actions-provided environment. */
  repo?: string;
  remoteGit?: typeof executeRemoteGit;
  remoteMutation?: GithubMutationExecutionContext;
  /** Guarded mutations; absence refuses rather than falling back to raw gh writes. */
  operations?: GithubOperationRunner;
}): ShipmentRepairPublisher {
  const repo = input.repo ?? process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required for repair publication');
  const operations = input.operations ?? createGuardedGithubOperationRunner(input.runGh, {
    cwd: input.cwd,
    // The remote-ref binding authorizes only the repair branch push. GitHub
    // operations below are repository resources, so preserve the same fresh
    // owner/provenance readers but let their canonical repository targets bind
    // through the normal policy instead of mismatching that ref.
    mutation: mutationForRepositoryOperations(input.remoteMutation),
  });

  // The fetched start point `ensureRepairBranch` resolved. The repair commit is
  // built from it in a throwaway worktree: `cwd` is the daemon's LIVE root
  // checkout, whose branch and files this publisher must never touch.
  let startPoint: string | undefined;
  return {
    ensureRepairBranch: async ({ branch, base }) => {
      const remoteBranch = `refs/heads/${branch}`;
      const exists = await runTrackerRead(
        input.runGh, input.cwd, 'repository.read', repo, { kind: 'repository' },
        ['api', `repos/${repo}/git/ref/heads/${branch}`],
      ).then(() => true, () => false);
      await input.runGit(['fetch', 'origin', exists ? remoteBranch : base], { cwd: input.cwd });
      startPoint = exists ? `origin/${branch}` : `origin/${base}`;
    },
    commitRecordOnly: async ({ branch, writes }) => {
      const [write] = writes;
      if (!startPoint) throw new Error(`repair branch ${branch} was not prepared`);
      const existing = await readCommittedFile(input.runGit, input.cwd, startPoint, write.path);
      const dropped = existing === null ? [] : shippedRecordContentDroppedBy(existing, write.content);
      if (dropped.length > 0) {
        throw new Error(`repair would drop ${dropped.join(', ')} from the existing ${write.path}; refusing`);
      }
      const worktree = await mkdtemp(join(tmpdir(), 'shipment-repair-'));
      try {
        await input.runGit(['worktree', 'add', '--detach', worktree, startPoint], { cwd: input.cwd });
        await mkdir(join(worktree, '.docs', 'shipped'), { recursive: true });
        await writeFile(join(worktree, write.path), write.content);
        await input.runGit(['add', '--', write.path], { cwd: worktree });
        const changed = (await input.runGit(['diff', '--cached', '--name-only'], { cwd: worktree })).stdout
          .split('\n')
          .filter(Boolean);
        if (changed.length > 0 && (changed.length !== 1 || changed[0] !== write.path)) {
          throw new Error(`repair commit is not record-only: ${changed.join(', ')}`);
        }
        if (changed.length > 0) {
          await input.runGit(['commit', '-m', `docs: repair shipped record for ${branch}`], { cwd: worktree });
          const pushed = await (input.remoteGit ?? executeRemoteGit)(
            ['push', 'origin', `HEAD:refs/heads/${branch}`],
            {
              cwd: worktree,
              config: (args) => input.runGit(args, { cwd: worktree }),
              runRemoteGit: input.runGit,
              mutation: input.remoteMutation,
            },
          );
          if (pushed.kind !== 'executed') throw new Error(remoteFailure(pushed));
        }
        return { headSha: (await input.runGit(['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim() };
      } finally {
        await input.runGit(['worktree', 'remove', '--force', worktree], { cwd: input.cwd }).catch(() => {});
        await rm(worktree, { recursive: true, force: true });
      }
    },
    findOrCreateRepairPullRequest: async ({ branch, base, identity }) => {
      const existing = await runTrackerRead(
        input.runGh, input.cwd, 'pull-request.read', repo, { kind: 'repository' },
        ['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'url', '--limit', '1'],
      );
      const existingUrl = (JSON.parse(existing) as Array<{ url?: unknown }>)[0]?.url;
      if (typeof existingUrl === 'string') {
        return readRepairPullRequestHead(input.runGh, input.cwd, existingUrl);
      }
      await requireRepairPublicationOperation(operations, {
        operation: 'pull-request.create',
        repository: repo,
        resource: { kind: 'repository' },
        context: { actor: 'shipment-repair', feature: input.slug },
        payload: {
          title: `Repair durable shipment record for ${identity}`,
          body: `Record-only repair for implementation PR ${input.implementationPr}. Human review and merge required.`,
          head: branch,
          base,
        },
      });
      const observed = await runTrackerRead(
        input.runGh, input.cwd, 'pull-request.read', repo, { kind: 'repository' },
        ['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'url', '--limit', '1'],
      );
      const observedUrl = (JSON.parse(observed) as Array<{ url?: unknown }>)[0]?.url;
      if (typeof observedUrl !== 'string') {
        throw new Error(`repair PR creation did not yield an open PR for ${branch}`);
      }
      return readRepairPullRequestHead(input.runGh, input.cwd, observedUrl);
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
      await requireRepairPublicationOperation(operations, {
        operation: 'commit.status.create',
        repository: repo,
        resource: { kind: 'repository' },
        context: { actor: 'shipment-repair', feature: input.slug },
        payload: { sha, state, context, description },
      });
    },
  };
}

function mutationForRepositoryOperations(
  mutation: GithubMutationExecutionContext | undefined,
): GithubMutationExecutionContext | undefined {
  if (!mutation) return mutation;
  return {
    provenance: {
      ...mutation.provenance,
      target: { repository: mutation.provenance.repository, kind: 'repository' },
    },
    dependencies: mutation.dependencies,
  };
}

async function requireRepairPublicationOperation(
  operations: GithubOperationRunner,
  request: Record<string, unknown>,
): Promise<void> {
  const result = await executeGithubOperation(request, operations);
  if (result.kind === 'refused') {
    throw new Error(`GitHub operation '${String(request.operation)}' refused: ${result.reason}`);
  }
  if (result.kind === 'failed') {
    throw new Error(`GitHub operation '${result.operation ?? String(request.operation)}' failed: ${result.error}`);
  }
}

function remoteFailure(result: Awaited<ReturnType<typeof executeRemoteGit>>): string {
  if (result.kind === 'failed') return result.error;
  if (result.kind === 'refused') return result.reason;
  return 'remote Git operation did not execute';
}

async function readRepairPullRequestHead(
  runGh: GhRunner,
  cwd: string,
  pullRequestUrl: string,
): Promise<{ url: string; headSha: string }> {
  const stdout = await runTrackerRead(
    runGh, cwd, 'pull-request.read', repositoryForPullRequest(pullRequestUrl), { kind: 'repository' },
    ['pr', 'view', pullRequestUrl, '--json', 'url,headRefOid'],
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
  let stdout: string;
  try {
    stdout = await runTrackerRead(
      runGh, cwd, 'pull-request.read', repositoryForPullRequest(pr), { kind: 'repository' },
      ['pr', 'view', pr, '--json', 'url,body,files,headRefOid'],
    );
  } catch (error) {
    // Preserve the caller's established error wording while the read itself
    // stays on the canonical guarded interface.
    if (error instanceof GhRunnerError && error.cause instanceof Error) throw error.cause;
    throw error;
  }
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

/** Read calls still carry a canonical repository target when their CLI handle is a PR URL. */
function repositoryForPullRequest(value: string): string {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+\/?$/.exec(value);
  return match ? `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}` : process.env.GITHUB_REPOSITORY ?? 'github/current-repository';
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

async function listPlanStemsAtCommit(runGit: GitRunner, cwd: string, commit: string): Promise<string[]> {
  const { stdout } = await runGit(['ls-tree', '--name-only', commit, '--', '.docs/plans/'], { cwd });
  return stdout
    .split('\n')
    .map((entry) => entry.trim().replace(/^\.docs\/plans\//, ''))
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -'.md'.length));
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
