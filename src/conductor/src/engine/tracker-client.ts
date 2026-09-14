/**
 * Canonical tracker-client seam — the single module through which all real
 * `gh` CLI invocations for tracker/PR operations must flow.
 *
 * Design constraints:
 *   - `assertRealExecAllowed` is the one guard; every production runner
 *     factory (in this module or elsewhere) must call it before spawning.
 *   - `GhRunner` is the canonical injectable shape — other modules re-export
 *     it rather than defining their own copy.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrMergeState } from './pr-labels.js';
import type {
  GithubOperationName,
  GithubOperationRequest,
  GithubOperationRefusalReason,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
  GithubIntakeWriteOperationRequest,
  GithubSharedWriteOperationRequest,
} from './github-operations.js';
import { executeGithubOperation } from './github-operations.js';
import { hasExplicitGithubOperationApproval } from './github-operation-approval.js';
import { authorizeGithubMutation } from './owner-gate/mutation-policy.js';
import type {
  GithubMutationAuthorizationDependencies,
} from './owner-gate/mutation-policy.js';
import type { MutationProvenanceRequest } from './owner-gate/mutation-provenance.js';

const execFileP = promisify(execFileCb);
const GH_STDOUT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Injectable runner for `gh` CLI commands.
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string; timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string }>;

/**
 * Evidence needed to authorize one or more feature-resource mutations. The
 * policy resolves it afresh for every request; this object is context, not a
 * reusable authorization capability.
 */
export interface GithubMutationExecutionContext {
  readonly provenance: MutationProvenanceRequest;
  readonly dependencies: GithubMutationAuthorizationDependencies;
}

/** Fresh, independently authorized pre-spec intake write context. */
export interface GithubIntakeMutationExecutionContext {
  authorize(
    request: GithubIntakeWriteOperationRequest,
    cwd: string,
  ): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal>;
}

/** Opaque interactive approval for exactly one shared repository mutation. */
export interface GithubSharedMutationExecutionContext {
  /** Structural lookalikes are rejected at the guarded execution boundary. */
  readonly approval: unknown;
}

/** Factory inputs for the sole guarded adapter from typed operations to `gh`. */
export interface GuardedGithubOperationRunnerOptions {
  readonly cwd: string;
  /** Absent context refuses every mutation while retaining discovery reads. */
  readonly mutation?: GithubMutationExecutionContext;
  /** Absent context refuses every existing pre-spec intake mutation. */
  readonly intake?: GithubIntakeMutationExecutionContext;
  /** Absent or mismatched approval refuses every shared-resource mutation. */
  readonly shared?: GithubSharedMutationExecutionContext;
}

/** Ownership context used by the GitHub TrackerClient's structured requests. */
export interface GithubTrackerClientOptions {
  /** Absent context refuses issue mutations while preserving tracker reads. */
  readonly mutation?: GithubMutationExecutionContext;
  /** Independent current-assignment or exact-approval authority for intake writes. */
  readonly intake?: GithubIntakeMutationExecutionContext;
  /** Canonical repository for operations whose legacy call shape omits one. */
  readonly repository?: string;
}

function issueNumber(request: GithubOperationRequest): string {
  if (request.target.kind !== 'issue' && request.target.kind !== 'pull-request') {
    throw new Error(`GitHub operation '${request.operation}' requires an issue-like target.`);
  }
  return String(request.target.number);
}

function payloadField(request: GithubOperationRequest, field: 'body' | 'label' | 'title' | 'head' | 'base'): string {
  const payload = request.payload;
  const value = payload && (payload as unknown as Record<string, unknown>)[field];
  if (typeof value !== 'string') {
    throw new Error(`GitHub operation '${request.operation}' is missing its registered '${field}' payload.`);
  }
  return value;
}

/**
 * Translate only the closed operation registry to argv. This is deliberately
 * private: callers submit typed operations, never mutable arbitrary argv.
 */
function ghArgsFor(request: GithubOperationRequest): string[] {
  const { repository } = request.target;
  switch (request.operation) {
    case 'issue.read':
      return ['issue', 'view', issueNumber(request), '-R', repository];
    case 'pull-request.read':
      return ['pr', 'view', issueNumber(request), '-R', repository];
    case 'repository.read':
      return ['api', `repos/${repository}`];
    case 'issue.comment.create':
    case 'intake.issue.comment.create':
      return ['issue', 'comment', issueNumber(request), '-R', repository, '--body', payloadField(request, 'body')];
    case 'issue.edit':
      return ['issue', 'edit', issueNumber(request), '--body', payloadField(request, 'body'), '-R', repository];
    case 'issue.close':
    case 'intake.issue.close':
      return ['issue', 'close', issueNumber(request), '-R', repository];
    case 'issue.label.add':
    case 'intake.issue.label.add':
    case 'pull-request.label.add':
      return ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber(request)}/labels`, '-f', `labels[]=${payloadField(request, 'label')}`];
    case 'issue.label.remove':
    case 'intake.issue.label.remove':
    case 'pull-request.label.remove':
      return ['api', '--method', 'DELETE', `repos/${repository}/issues/${issueNumber(request)}/labels/${encodeURIComponent(payloadField(request, 'label'))}`];
    case 'issue.dependency.add': {
      const dependency = request.payload && 'dependency' in request.payload ? request.payload.dependency : undefined;
      if (!dependency || dependency.kind !== 'issue') throw new Error('Registered dependency payload is missing its issue target.');
      return ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber(request)}/dependencies/blocked_by`, '-f', `issue_number=${dependency.number}`];
    }
    case 'issue.dependency.remove': {
      const dependency = request.payload && 'dependency' in request.payload ? request.payload.dependency : undefined;
      if (!dependency || dependency.kind !== 'issue') throw new Error('Registered dependency payload is missing its issue target.');
      return ['api', '--method', 'DELETE', `repos/${repository}/issues/${issueNumber(request)}/dependencies/blocked_by/${dependency.number}`];
    }
    case 'pull-request.comment.create':
      return ['pr', 'comment', issueNumber(request), '-R', repository, '--body', payloadField(request, 'body')];
    case 'pull-request.comment.update': {
      const payload = request.payload;
      if (!payload || !('commentId' in payload) || typeof payload.commentId !== 'string') {
        throw new Error("Registered comment update is missing its 'commentId' payload.");
      }
      return ['api', '--method', 'PATCH', `repos/${repository}/issues/comments/${payload.commentId}`, '-f', `body=${payloadField(request, 'body')}`];
    }
    case 'pull-request.edit': {
      const args = ['pr', 'edit', issueNumber(request), '-R', repository];
      if (request.payload && 'title' in request.payload && typeof request.payload.title === 'string') args.push('--title', request.payload.title);
      if (request.payload && 'body' in request.payload && typeof request.payload.body === 'string') args.push('--body', request.payload.body);
      return args;
    }
    case 'pull-request.ready':
      return ['pr', 'ready', issueNumber(request), '-R', repository];
    case 'pull-request.draft':
      return ['pr', 'ready', issueNumber(request), '-R', repository, '--undo'];
    case 'issue.create':
      return ['issue', 'create', '-R', repository, '--title', payloadField(request, 'title'), '--body', payloadField(request, 'body')];
    case 'pull-request.create':
      return [
        'pr', 'create', '-R', repository,
        '--title', payloadField(request, 'title'),
        '--body', payloadField(request, 'body'),
        '--head', payloadField(request, 'head'),
        '--base', payloadField(request, 'base'),
        ...(request.payload && 'draft' in request.payload && request.payload.draft === true ? ['--draft'] : []),
      ];
    case 'label-definition.create':
    case 'label-definition.update': {
      if (request.target.kind !== 'label-definition') throw new Error('Registered label operation has an invalid target.');
      const args = ['label', request.operation === 'label-definition.create' ? 'create' : 'edit', request.target.name, '-R', repository];
      if (request.payload && 'color' in request.payload && typeof request.payload.color === 'string') args.push('--color', request.payload.color);
      if (request.payload && 'description' in request.payload && typeof request.payload.description === 'string') args.push('--description', request.payload.description);
      return args;
    }
    case 'remote-ref.push':
    case 'remote-ref.delete':
      throw new Error(`GitHub operation '${request.operation}' requires the remote-Git adapter, not gh.`);
  }
}

/**
 * Canonical guarded operation adapter. Reads go straight to the injected `gh`
 * transport; every registered mutation first obtains a fresh, exact decision
 * from `authorizeGithubMutation`. No raw argv reaches this public boundary.
 */
export function createGuardedGithubOperationRunner(
  transport: GhRunner,
  options: GuardedGithubOperationRunnerOptions,
): GithubOperationRunner {
  return {
    async run(request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> {
      if (request.access === 'intake-write') {
        if (!options.intake) return { kind: 'refused', reason: 'explicit-authorization-required' };
        const decision = await options.intake.authorize(request, options.cwd);
        if ('kind' in decision && decision.kind === 'refused') return decision;
      } else if (request.access === 'shared-write') {
        if (!options.shared || !hasExplicitGithubOperationApproval(options.shared.approval, request)) {
          return { kind: 'refused', reason: 'explicit-authorization-required' };
        }
      } else if (request.access !== 'read') {
        if (!options.mutation) return { kind: 'refused', reason: 'missing-provenance' };
        const decision = await authorizeGithubMutation({
          operation: request.operation,
          target: request.target,
          provenance: options.mutation.provenance,
        }, options.mutation.dependencies);
        if (decision.kind === 'refused') return decision;
      }
      await transport(ghArgsFor(request), { cwd: options.cwd });
      return {};
    },
  };
}

/** A `gh` command requested a JSON field that this installed CLI does not support. */
export class GhCapabilityError extends Error {
  readonly cli = 'gh';
  readonly field: string;

  constructor(field: string, cause: unknown) {
    super(`gh does not support JSON field "${field}"`, { cause });
    this.name = 'GhCapabilityError';
    this.field = field;
  }
}

function unsupportedJsonField(cause: unknown): string | undefined {
  const failure = cause as { code?: unknown; stderr?: unknown };
  if (typeof failure?.code !== 'number' || failure.code === 0 || typeof failure.stderr !== 'string') {
    return undefined;
  }

  return /^Unknown JSON field:\s*"([^"]+)"/m.exec(failure.stderr)?.[1];
}

/**
 * Test kill-switch. When `AI_CONDUCTOR_NO_REAL_EXEC` is set (the vitest global setup
 * sets it — see `test/setup.ts`), the production `gh`/`git` runners refuse to
 * shell out. This is a belt-and-suspenders guard: every test is supposed to inject
 * a fake runner, but if one ever reaches a real runner (e.g. a daemon-mode test
 * that forgets to stub escalation), this prevents it from mutating real GitHub —
 * the exact failure mode that once labeled + commented on a live PR.
 */
export function assertRealExecAllowed(bin: string): void {
  if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
    throw new Error(
      `tracker-client: real '${bin}' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC (test env). ` +
        `Inject a fake runner instead of using makeProduction${bin === 'gh' ? 'Gh' : 'Git'}().`,
    );
  }
}

/** Construct the real gh runner used in production. */
export function makeProductionGh(): GhRunner {
  return async (args: string[], opts: { cwd: string; timeout?: number; maxBuffer?: number }) => {
    assertRealExecAllowed('gh');
    try {
      const result = await execFileP('gh', args, {
        cwd: opts.cwd,
        maxBuffer: opts.maxBuffer ?? GH_STDOUT_MAX_BUFFER,
        timeout: opts.timeout,
      });
      return { stdout: String(result.stdout) };
    } catch (cause) {
      const field = unsupportedJsonField(cause);
      if (field) {
        throw new GhCapabilityError(field, cause);
      }
      throw cause;
    }
  };
}

/** Minimal shape of an assigned issue as returned by `gh issue list ... --json`. */
interface AssignedIssue {
  number: number;
  title: string;
  body: string;
  labels: unknown;
}

/** Explicitly exceed the GitHub CLI's implicit 30-result issue-list default. */
export const DEFAULT_ASSIGNED_ISSUES_LIMIT = 1000;

/**
 * Canonical seam for tracker/PR read+write operations. GitHub is the only
 * implementation today; the interface is backend-agnostic so future trackers
 * can implement it without touching call sites.
 *
 */
export interface TrackerClient {
  /** Locate a previously-created intake issue whose body contains this exact hidden effect marker. */
  findIssueByEffectMarker?(
    marker: string,
    repo: string,
    cwd: string,
  ): Promise<string | null>;
  /** `gh api repos/<owner>/<repo>/issues/<number>` — returns label names. */
  getIssueLabels(repo: string, number: number, cwd: string): Promise<string[]>;
  /** `gh issue view <owner/repo#number> --json state` — raw stdout JSON. */
  viewIssue(slug: string, cwd: string): Promise<{ state: string }>;
  /** `gh issue view <owner/repo#number> --json state` — uppercased state string. */
  getIssueState(slug: string, cwd: string): Promise<string>;
  /** `gh api user --jq .login` — normalized viewer login. */
  viewerIdentity(cwd: string): Promise<string>;
  /** `gh api repos/<repo>/issues/<number>/dependencies/blocked_by` — raw JSON. */
  getBlockedBy(repo: string, number: number, cwd: string): Promise<unknown>;
  /** Add one blocking issue to this issue without mutating the referenced issue. */
  addIssueDependency?(
    repo: string,
    number: number,
    dependency: { repo: string; number: number },
    cwd: string,
  ): Promise<void>;
  /** Remove one blocking issue from this issue without mutating the referenced issue. */
  removeIssueDependency?(
    repo: string,
    number: number,
    dependency: { repo: string; number: number },
    cwd: string,
  ): Promise<void>;
  /** `gh issue list --assignee @me --state open --json ... -R <repo>` — assigned issues. */
  listAssignedIssues(repo: string, cwd: string, limit?: number): Promise<AssignedIssue[]>;
  /** `gh issue comment <number> -R <repo> --body <body>` — comment on an issue. */
  commentOnIssue(repo: string, number: number, body: string, cwd: string): Promise<void>;
  /** `gh issue create --title <title> --body <body> [--repo <repo>]` — returns the created issue URL. */
  createIssue(
    input: { title: string; body: string; repo?: string },
    cwd: string,
  ): Promise<string>;
  /** `gh api --method POST repos/<repo>/issues/<number>/labels -f labels[]=<label>` — add a label via REST. */
  addIssueLabel(repo: string, number: number, label: string, cwd: string): Promise<void>;
  /** `gh issue close <ref> -R <repo>` — close an issue in a specific repo. */
  closeIssue(repo: string, issueRef: string, cwd: string): Promise<void>;
  /** `gh issue view <ref> --json body -R <repo>` — issue body in a specific repo, or `null` on 404. */
  getIssueBody(repo: string, issueRef: string, cwd: string): Promise<string | null>;
  /** `gh issue edit <ref> --body <body> -R <repo>` — overwrite an issue's body in a specific repo. */
  upsertIssueBody(repo: string, issueRef: string, body: string, cwd: string): Promise<void>;
  /** `gh issue comment <ref> --body <body> -R <repo>` — comment on an issue in a specific repo. */
  upsertIssueComment(repo: string, issueRef: string, body: string, cwd: string): Promise<void>;
  /** `gh pr view <url> --json state,mergedAt` — PR state + merge timestamp for reopen checks. */
  viewPullRequest(url: string, cwd: string): Promise<{ state?: string; mergedAt?: string | null }>;
  /** `gh pr view <url> --json headRefName` — source branch for CI repair. */
  getPullRequestHeadRef(prUrl: string, cwd: string): Promise<string>;
  /** `gh run view <run> --repo <repo> --log-failed` — bounded failed-log enrichment. */
  viewWorkflowRunFailedLog(
    repo: string,
    runId: string,
    cwd: string,
    opts: { timeout: number; maxBuffer: number },
  ): Promise<string>;
  /** Read and classify the merge state/check rollup for a watched pull request. */
  readPullRequestMergeState(
    prUrl: string,
    cwd: string,
    log?: (message: string) => void,
  ): Promise<PrMergeState>;
  /** `gh label create <name> -R <repo>` — create a label (idempotent; caller swallows "already exists"). */
  createLabel(repo: string, name: string, cwd: string): Promise<void>;
  /** `gh api --method DELETE repos/<repo>/issues/<number>/labels/<name>` — remove a label via REST. */
  removeIssueLabel(repo: string, number: number, label: string, cwd: string): Promise<void>;
}

export interface EffectMarkerTrackerClient extends TrackerClient {
  findIssueByEffectMarker(marker: string, repo: string, cwd: string): Promise<string | null>;
}

/** Intake-only mutation methods avoid widening the backend-neutral core contract. */
export interface IntakeTrackerClient extends TrackerClient {
  commentOnIntakeIssue(repo: string, number: number, body: string, cwd: string): Promise<void>;
  addIntakeIssueLabel(repo: string, number: number, label: string, cwd: string): Promise<void>;
  closeIntakeIssue(repo: string, issueRef: string, cwd: string): Promise<void>;
  removeIntakeIssueLabel(repo: string, number: number, label: string, cwd: string): Promise<void>;
}

/** Error thrown when a `GhRunner` invocation rejects; carries argv/stderr/exit-code and, if
 * the failure is 404-shaped, a `status: 404` marker so callers (e.g. the engineer-forget
 * advisory-label-strip flow) can detect "issue not found" specifically. */
export class GhRunnerError extends Error {
  readonly argv: string[];
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly status?: number;

  constructor(argv: string[], cause: unknown) {
    const causeErr = cause as { message?: string; stderr?: unknown; code?: unknown };
    const stderr = typeof causeErr?.stderr === 'string' ? causeErr.stderr : undefined;
    const causeMessage = causeErr?.message ?? String(cause);
    const is404 = /\b404\b|not found/i.test(`${stderr ?? ''} ${causeMessage}`);

    super(
      `gh ${argv.join(' ')} failed: ${causeMessage}` + (stderr ? ` (stderr: ${stderr})` : ''),
    );
    this.name = 'GhRunnerError';
    this.argv = argv;
    this.stderr = stderr;
    this.exitCode = typeof causeErr?.code === 'number' ? causeErr.code : undefined;
    if (is404) {
      this.status = 404;
    }
  }
}

/** A guarded TrackerClient mutation was denied before the terminal transport. */
export class GithubTrackerOperationRefusalError extends Error {
  readonly operation: GithubOperationName;
  readonly reason: GithubOperationRefusalReason;

  constructor(operation: GithubOperationName, reason: GithubOperationRefusalReason) {
    super(`GitHub tracker operation '${operation}' was refused: ${reason}`);
    this.name = 'GithubTrackerOperationRefusalError';
    this.operation = operation;
    this.reason = reason;
  }
}

/** Error thrown when a parsing op receives stdout that is not valid JSON; names the
 * failing operation so callers get an actionable message instead of a raw JSON.parse error.
 * Module-private: nothing outside this file catches it by type — callers match on the
 * operation-named message — so it is intentionally not exported (no external wiring). */
class GhParseError extends Error {
  readonly operation: string;
  readonly stdout: string;
  readonly cause: unknown;

  constructor(operation: string, stdout: string, cause: unknown) {
    super(
      `${operation}: failed to parse gh output as JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'GhParseError';
    this.operation = operation;
    this.stdout = stdout;
    this.cause = cause;
  }
}

async function runOrThrow(
  runner: GhRunner,
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string }> {
  try {
    return await runner(args, opts);
  } catch (err) {
    throw new GhRunnerError(args, err);
  }
}

function parseJsonOrThrow<T>(operation: string, stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new GhParseError(operation, stdout, err);
  }
}

function issueNumberFromRef(issueRef: string): number | undefined {
  const match = /(?:^|[#/])([1-9]\d*)$/.exec(issueRef);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

function issueTargetFromSlug(slug: string): { readonly repository: string; readonly number: number } | undefined {
  const match = /^([^/\s]+\/[^/#\s]+)#([1-9]\d*)$/.exec(slug);
  if (!match) return undefined;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { repository: match[1], number } : undefined;
}

function pullRequestTargetFromUrl(url: string): { readonly repository: string; readonly number: number } | undefined {
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)$/.exec(url);
  if (!match) return undefined;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { repository: match[1], number } : undefined;
}

/**
 * Keep TrackerClient's backend-neutral methods while making each GitHub issue
 * mutation a closed guarded request. A refusal remains a typed error rather
 * than a raw transport fallback, preserving the interface's existing failure
 * semantics while allowing callers to distinguish a policy denial.
 */
async function runTrackerIssueOperation(
  runner: GhRunner,
  options: GithubTrackerClientOptions,
  cwd: string,
  operation: GithubOperationName,
  repository: string,
  resource: Record<string, unknown>,
  payload?: Record<string, unknown>,
): Promise<{ readonly stdout: string }> {
  let stdout = '';
  const transport: GhRunner = async (args, transportOptions) => {
    const result = await runner(args, transportOptions);
    stdout = result.stdout;
    return result;
  };
  const result = await executeGithubOperation({
    operation,
    repository,
    resource,
    context: { actor: 'tracker-client' },
    ...(payload === undefined ? {} : { payload }),
  }, createGuardedGithubOperationRunner(transport, {
    cwd,
    mutation: options.mutation,
    intake: options.intake,
  }));

  if (result.kind === 'refused') {
    throw new GithubTrackerOperationRefusalError(operation, result.reason);
  }
  if (result.kind === 'failed') {
    throw new Error(`GitHub tracker operation '${operation}' failed: ${result.error}`);
  }
  return { stdout };
}

/** Run a registered read through the same closed request decoder without authority. */
async function runTrackerRead(
  runner: GhRunner,
  cwd: string,
  operation: Extract<GithubOperationName, 'issue.read' | 'pull-request.read' | 'repository.read'>,
  repository: string,
  resource: Record<string, unknown>,
  args: string[],
): Promise<string> {
  let stdout = '';
  const result = await executeGithubOperation({
    operation,
    repository,
    resource,
    context: { actor: 'tracker-client' },
  }, {
    async run() {
      const response = await runOrThrow(runner, args, { cwd });
      stdout = response.stdout;
      return {};
    },
  });
  if (result.kind === 'refused') {
    throw new GithubTrackerOperationRefusalError(operation, result.reason);
  }
  if (result.kind === 'failed') {
    throw new Error(`GitHub tracker operation '${operation}' failed: ${result.error}`);
  }
  return stdout;
}

/** Construct a `TrackerClient` backed by the GitHub `gh` CLI via the given runner. */
export function createGithubTrackerClient(
  runner: GhRunner,
  options: GithubTrackerClientOptions = {},
): EffectMarkerTrackerClient & IntakeTrackerClient {
  return {
    async findIssueByEffectMarker(marker, repo, cwd) {
      const args = [
        'issue',
        'list',
        '--state',
        'all',
        '--search',
        `${JSON.stringify(marker)} in:body`,
        '--json',
        'url,body',
        '--limit',
        '2',
        '-R',
        repo,
      ];
      const stdout = await runTrackerRead(
        runner, cwd, 'repository.read', repo, { kind: 'repository' }, args,
      );
      const issues = parseJsonOrThrow<Array<{ url?: unknown; body?: unknown }>>(
        'findIssueByEffectMarker',
        stdout || '[]',
      );
      const matchingIssue = issues.find(
        (issue) => typeof issue.url === 'string' && typeof issue.body === 'string' && issue.body.includes(marker),
      );
      return typeof matchingIssue?.url === 'string' ? matchingIssue.url : null;
    },

    async getIssueLabels(repo, number, cwd) {
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'issue.read',
        repo,
        { kind: 'issue', number },
        ['api', `repos/${repo}/issues/${number}`],
      );
      const data = parseJsonOrThrow<{ labels?: Array<{ name: string }> | null }>(
        'getIssueLabels',
        stdout,
      );
      return (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    },

    async viewIssue(slug, cwd) {
      const target = issueTargetFromSlug(slug);
      if (!target) throw new GithubTrackerOperationRefusalError('issue.read', 'invalid-target');
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'issue.read',
        target.repository,
        { kind: 'issue', number: target.number },
        ['issue', 'view', slug, '--json', 'state'],
      );
      return parseJsonOrThrow<{ state: string }>('viewIssue', stdout);
    },

    async getIssueState(slug, cwd) {
      const { state } = await this.viewIssue(slug, cwd);
      return String(state ?? '').toUpperCase();
    },

    async viewerIdentity(cwd) {
      // This account-identity lookup has no repository resource to bind. It
      // remains a read-only machine-identity seam until the operation registry
      // admits an account target; it never carries mutation authority.
      if (!options.repository) {
        const { stdout } = await runOrThrow(runner, ['api', 'user', '--jq', '.login'], { cwd });
        return stdout.trim();
      }
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'repository.read',
        options.repository,
        { kind: 'repository' },
        ['api', 'user', '--jq', '.login'],
      );
      return stdout.trim();
    },

    async getBlockedBy(repo, number, cwd) {
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'issue.read',
        repo,
        { kind: 'issue', number },
        ['api', `repos/${repo}/issues/${number}/dependencies/blocked_by`],
      );
      return parseJsonOrThrow('getBlockedBy', stdout);
    },

    async addIssueDependency(repo, number, dependency, cwd) {
      await runTrackerIssueOperation(
        runner,
        options,
        cwd,
        'issue.dependency.add',
        repo,
        { kind: 'issue', number },
        { dependency: { repository: dependency.repo, resource: { kind: 'issue', number: dependency.number } } },
      );
    },

    async removeIssueDependency(repo, number, dependency, cwd) {
      await runTrackerIssueOperation(
        runner,
        options,
        cwd,
        'issue.dependency.remove',
        repo,
        { kind: 'issue', number },
        { dependency: { repository: dependency.repo, resource: { kind: 'issue', number: dependency.number } } },
      );
    },

    async listAssignedIssues(repo, cwd, limit = DEFAULT_ASSIGNED_ISSUES_LIMIT) {
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'repository.read',
        repo,
        { kind: 'repository' },
        [
          'issue',
          'list',
          '--assignee',
          '@me',
          '--state',
          'open',
          '--json',
          'number,title,body,labels',
          '--limit',
          String(limit),
          '-R',
          repo,
        ],
      );
      return parseJsonOrThrow<AssignedIssue[]>('listAssignedIssues', stdout || '[]');
    },

    async commentOnIssue(repo, number, body, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.comment.create', repo, { kind: 'issue', number }, { body },
      );
    },

    async commentOnIntakeIssue(repo, number, body, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'intake.issue.comment.create', repo, { kind: 'issue', number }, { body },
      );
    },

    async createIssue(input, cwd) {
      const repository = input.repo ?? options.repository;
      if (!repository) throw new GithubTrackerOperationRefusalError('issue.create', 'invalid-target');
      const result = await runTrackerIssueOperation(
        runner,
        options,
        cwd,
        'issue.create',
        repository,
        { kind: 'repository' },
        { title: input.title, body: input.body },
      );
      return result.stdout.trim();
    },

    async addIssueLabel(repo, number, label, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.label.add', repo, { kind: 'issue', number }, { label },
      );
    },

    async addIntakeIssueLabel(repo, number, label, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'intake.issue.label.add', repo, { kind: 'issue', number }, { label },
      );
    },

    async closeIssue(repo, issueRef, cwd) {
      const number = issueNumberFromRef(issueRef);
      if (number === undefined) throw new GithubTrackerOperationRefusalError('issue.close', 'invalid-target');
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.close', repo, { kind: 'issue', number },
      );
    },

    async closeIntakeIssue(repo, issueRef, cwd) {
      const number = issueNumberFromRef(issueRef);
      if (number === undefined) throw new GithubTrackerOperationRefusalError('intake.issue.close', 'invalid-target');
      await runTrackerIssueOperation(
        runner, options, cwd, 'intake.issue.close', repo, { kind: 'issue', number },
      );
    },

    async getIssueBody(repo, issueRef, cwd) {
      try {
        const number = issueNumberFromRef(issueRef);
        if (number === undefined) throw new GithubTrackerOperationRefusalError('issue.read', 'invalid-target');
        const stdout = await runTrackerRead(
          runner,
          cwd,
          'issue.read',
          repo,
          { kind: 'issue', number },
          ['issue', 'view', issueRef, '--json', 'body', '-R', repo],
        );
        const data = parseJsonOrThrow<{ body?: string }>('getIssueBody', stdout);
        return data.body ?? '';
      } catch (err) {
        if (err instanceof GhRunnerError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },

    async upsertIssueBody(repo, issueRef, body, cwd) {
      const number = issueNumberFromRef(issueRef);
      if (number === undefined) throw new GithubTrackerOperationRefusalError('issue.edit', 'invalid-target');
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.edit', repo, { kind: 'issue', number }, { body },
      );
    },

    async upsertIssueComment(repo, issueRef, body, cwd) {
      const number = issueNumberFromRef(issueRef);
      if (number === undefined) throw new GithubTrackerOperationRefusalError('issue.comment.create', 'invalid-target');
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.comment.create', repo, { kind: 'issue', number }, { body },
      );
    },

    async viewPullRequest(url, cwd) {
      const target = pullRequestTargetFromUrl(url);
      if (!target) throw new GithubTrackerOperationRefusalError('pull-request.read', 'invalid-target');
      const stdout = await runTrackerRead(
        runner,
        cwd,
        'pull-request.read',
        target.repository,
        { kind: 'pull-request', number: target.number },
        ['pr', 'view', url, '--json', 'state,mergedAt'],
      );
      return parseJsonOrThrow('viewPullRequest', stdout || '{}');
    },

    async getPullRequestHeadRef(prUrl, cwd) {
      const { stdout } = await runOrThrow(runner, ['pr', 'view', prUrl, '--json', 'headRefName'], { cwd });
      const data = parseJsonOrThrow<{ headRefName?: unknown }>('getPullRequestHeadRef', stdout || '{}');
      return typeof data.headRefName === 'string' ? data.headRefName.trim() : '';
    },

    async viewWorkflowRunFailedLog(repo, runId, cwd, opts) {
      const { stdout } = await runOrThrow(
        runner,
        ['run', 'view', runId, '--repo', repo, '--log-failed'],
        { cwd, ...opts },
      );
      return stdout;
    },

    async readPullRequestMergeState(prUrl, cwd, log) {
      // Keep parsing and sentinel classification single-sourced in pr-labels.
      // A dynamic import avoids making that legacy PR helper's tracker import
      // an eager runtime cycle.
      const { prMergeState } = await import('./pr-labels.js');
      return prMergeState(runner, cwd, prUrl, log);
    },

    async createLabel(repo, name, cwd) {
      await runOrThrow(runner, ['label', 'create', name, '-R', repo], { cwd });
    },

    async removeIssueLabel(repo, number, label, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'issue.label.remove', repo, { kind: 'issue', number }, { label },
      );
    },

    async removeIntakeIssueLabel(repo, number, label, cwd) {
      await runTrackerIssueOperation(
        runner, options, cwd, 'intake.issue.label.remove', repo, { kind: 'issue', number }, { label },
      );
    },
  };
}
