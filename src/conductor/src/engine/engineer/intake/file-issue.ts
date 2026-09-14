// engineer/intake/file-issue.ts — deterministic-completeness issue filer.
//
// `bin/intake-file` delegates to `fileIntakeIssue` here: create the GitHub
// issue, resolve size/priority (prompt ▸ infer ▸ default), apply the
// `priority:`/`size:` labels, and record a `--depends-on` link (or an
// explicit "no dependencies" acknowledgement) — all as ONE atomic filing
// operation. A label-apply failure after a successful issue create is a
// warning, never a filing failure (exit 0).
//
// Reuses the existing REST idiom (`restAddLabelArgs`, `pr-labels.ts`) and the
// `owner/repo#N` ref parser (`parseSourceRef`, `issue-ref.ts`) rather than
// inventing new ones — see Task 4 of .docs/plans/intake-only-enforcement.md.

import { parseSizeLabel, parsePriorityLabels } from '../../backlog-priority.js';
import { parseSourceRef } from '../issue-ref.js';
import { sanitizeIntakeText, type Redaction } from './sanitize.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../tracker-client.js';
import {
  executeGithubIssueCreationTransaction,
  resolveGithubIssueCreationAuthority,
  type GithubIssueCreationAuthority,
} from '../../github-creation-context.js';
import type {
  GithubFeatureWriteOperationRequest,
  GithubIssueTarget,
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../github-operations.js';

export interface FileIntakeIssueOpts {
  title: string;
  body: string;
  size?: 'S' | 'M' | 'L';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: string[];
  interactive?: boolean;
  repo?: string;
}

export interface FileIntakeIssueDeps {
  prompt?: (question: string) => Promise<string>;
  /** One creation authority and terminal operation seam for this filing. */
  creation: {
    readonly authority: GithubIssueCreationAuthority;
    readonly operations: GithubOperationRunner;
  };
}

export interface FileIntakeIssueResult {
  ok: boolean;
  /** Empty when GitHub did not identify one canonical newly created issue. */
  issueUrl: string;
  size: 'S' | 'M' | 'L';
  priority: 'critical' | 'high' | 'medium' | 'low';
  sizeSource: 'given' | 'prompted' | 'inferred' | 'default';
  prioritySource: 'given' | 'prompted' | 'inferred' | 'default';
  dependsOnDecision: 'none' | 'linked';
  linked: string[];
  badRefs: string[];
  warnings: string[];
  /** Per-operation outcomes for a created issue whose follow-up metadata was partial. */
  metadataFailures: Array<{ operation: string; error: string }>;
  /**
   * What the pre-publication scrub replaced in the title/body. Empty on a clean
   * filing. Reported to the operator so a redaction is never silent — the issue
   * is already public by then, and a clipped piece of evidence has to be
   * noticed to be restored.
   */
  redactions: Redaction[];
}

const SIZE_WORDS: Record<'S' | 'M' | 'L', RegExp> = {
  L: /\b(large|big|major|significant)\b/i,
  M: /\b(medium|moderate)\b/i,
  S: /\b(small|tiny|trivial|minor|quick)\b/i,
};

const PRIORITY_WORDS: Record<'critical' | 'high' | 'medium' | 'low', RegExp> = {
  critical: /\b(critical|urgent|outage|down|blocker|blocking)\b/i,
  high: /\b(high[- ]priority|important|asap)\b/i,
  medium: /\b(medium[- ]priority)\b/i,
  low: /\b(low[- ]priority|minor|whenever|no rush)\b/i,
};

function inferSize(body: string): 'S' | 'M' | 'L' | undefined {
  for (const size of ['L', 'M', 'S'] as const) {
    if (SIZE_WORDS[size].test(body)) return size;
  }
  return undefined;
}

function inferPriority(body: string): 'critical' | 'high' | 'medium' | 'low' | undefined {
  for (const p of ['critical', 'high', 'medium', 'low'] as const) {
    if (PRIORITY_WORDS[p].test(body)) return p;
  }
  return undefined;
}

type ValidDependency = { readonly source: string; readonly repo: string; readonly number: number };

function isRunnerRefusal(
  response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal,
): response is GithubOperationRunnerRefusal {
  return 'kind' in response && response.kind === 'refused';
}

function metadataFailureError(response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal): string | undefined {
  if (isRunnerRefusal(response)) return `GitHub operation refused: ${response.reason}`;
  if (response.metadataFailures?.length) return response.metadataFailures.map((failure) => failure.error).join('; ');
  return undefined;
}

function canonicalIssue(target: unknown, repository: string): GithubIssueTarget | undefined {
  if (!target || typeof target !== 'object') return undefined;
  const value = target as Partial<GithubIssueTarget>;
  if (value.kind !== 'issue' || value.repository !== repository
    || !Number.isSafeInteger(value.number) || (value.number ?? 0) < 1) return undefined;
  return { repository, kind: 'issue', number: value.number! };
}

function creationUrl(target: GithubIssueTarget): string {
  return `https://github.com/${target.repository}/issues/${target.number}`;
}

function canonicalRepository(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(value)) return undefined;
  return value.toLowerCase();
}

/**
 * Terminal adapter for the short-lived intake-creation transaction.
 *
 * This is intentionally narrower than TrackerClient: it accepts only the
 * creation transaction's three registered operations. The caller cannot pass
 * raw argv, and `fileIntakeIssue` reaches it only after the creation context
 * has bound the actor, repository, and returned issue identity.
 */
export function createIntakeFilingOperations(
  gh: GhRunner,
  cwd: string,
  authority: GithubIssueCreationAuthority,
): GithubOperationRunner {
  // Resolve before a feature authority is consumed by the transaction.  The
  // transaction independently resolves and binds it again before the first
  // mutation, so this is a terminal guard's expected identity, not authority.
  const binding = resolveGithubIssueCreationAuthority(authority);
  let closed = false;
  let creationRequested = false;
  let created: GithubIssueTarget | undefined;

  const guarded = createGuardedGithubOperationRunner(gh, {
    cwd,
    creation: {
      async authorize(request) {
        const resolved = await binding;
        if (closed || !resolved) return { kind: 'refused', reason: 'explicit-authorization-required' };
        if (request.operation === 'issue.create') {
          if (creationRequested
            || request.target.kind !== 'repository'
            || request.target.repository !== resolved.repository
            || request.context.actor !== resolved.actor) {
            return { kind: 'refused', reason: 'explicit-authorization-required' };
          }
          creationRequested = true;
          return {} as GithubOperationRunnerResponse;
        }
        if (!created
          || request.target.kind !== 'issue'
          || request.target.repository !== created.repository
          || request.target.number !== created.number
          || request.context.actor !== resolved.actor
          || (request.operation !== 'issue.label.add' && request.operation !== 'issue.dependency.add')) {
          return { kind: 'refused', reason: 'explicit-authorization-required' };
        }
        return {} as GithubOperationRunnerResponse;
      },
      complete(request, response) {
        if (request.operation !== 'issue.create' || request.target.kind !== 'repository') return {};
        const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)\/?\s*$/.exec(response.stdout);
        if (!match || canonicalRepository(match[1]) !== request.target.repository.toLowerCase()) return {};
        created = { repository: request.target.repository, kind: 'issue', number: Number(match[2]) };
        return { created };
      },
    },
  });

  return {
    async run(request) {
      if (request.operation !== 'issue.dependency.add') return guarded.run(request);
      const dependency = request.payload && 'dependency' in request.payload ? request.payload.dependency : undefined;
      if (!dependency || dependency.kind !== 'issue') return { kind: 'refused', reason: 'invalid-payload' };

      // This is discovery only. It identifies the foreign issue's database id
      // for GitHub's dependency API; it never grants a write to that issue.
      const { stdout } = await gh(['api', `repos/${dependency.repository}/issues/${dependency.number}`], { cwd });
      const id = (JSON.parse(stdout) as { id?: unknown }).id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
        return { kind: 'refused', reason: 'invalid-target' };
      }
      return guarded.run({
        ...request,
        payload: { dependency, dependencyDatabaseId: id },
      });
    },
    closeCreationScope() {
      closed = true;
    },
  } as GithubOperationRunner;
}

export async function fileIntakeIssue(
  opts: FileIntakeIssueOpts,
  deps: FileIntakeIssueDeps,
): Promise<FileIntakeIssueResult> {
  const warnings: string[] = [];

  // ── Resolve size ──────────────────────────────────────────────────────────
  let size = opts.size;
  let sizeSource: FileIntakeIssueResult['sizeSource'] = 'given';
  if (!size) {
    if (opts.interactive && deps.prompt) {
      const answer = await deps.prompt('What size is this? (S/M/L)');
      const parsed = parseSizeLabel([`size: ${answer.trim()}`]);
      size = parsed ?? 'M';
      sizeSource = 'prompted';
    } else {
      const inferred = inferSize(opts.body);
      if (inferred) {
        size = inferred;
        sizeSource = 'inferred';
      } else {
        size = 'M';
        sizeSource = 'default';
      }
    }
  }

  // ── Resolve priority ─────────────────────────────────────────────────────
  let priority = opts.priority;
  let prioritySource: FileIntakeIssueResult['prioritySource'] = 'given';
  if (!priority) {
    if (opts.interactive && deps.prompt) {
      const answer = await deps.prompt('What priority is this? (critical/high/medium/low)');
      const parsed = parsePriorityLabels([`priority: ${answer.trim()}`]);
      priority = parsed ?? 'medium';
      prioritySource = 'prompted';
    } else {
      const inferred = inferPriority(opts.body);
      if (inferred) {
        priority = inferred;
        prioritySource = 'inferred';
      } else {
        priority = 'medium';
        prioritySource = 'default';
      }
    }
  }

  // ── Sanitize before publication ──────────────────────────────────────────
  // Filing publishes this text to a tracker that may be public and is in any
  // case off the operator's machine, so the scrub runs HERE — at the single
  // choke point every caller passes through — rather than as a rule the filer
  // is asked to remember. Size/priority inference above deliberately reads the
  // ORIGINAL body: a redaction must never change how the issue is labelled.
  const cleanTitle = sanitizeIntakeText(opts.title);
  const cleanBody = sanitizeIntakeText(opts.body);
  const redactions = [...cleanTitle.redactions, ...cleanBody.redactions];

  const result: FileIntakeIssueResult = {
    ok: false,
    issueUrl: '',
    size,
    priority,
    sizeSource,
    prioritySource,
    dependsOnDecision: 'none',
    linked: [],
    badRefs: [],
    warnings,
    metadataFailures: [],
    redactions,
  };

  const dependsOn = opts.dependsOn ?? [];
  const validDependencies: ValidDependency[] = [];
  if (dependsOn.length === 0) {
    result.dependsOnDecision = 'none';
  } else {
    result.dependsOnDecision = 'linked';
    for (const dependency of dependsOn) {
      const parsed = parseSourceRef(dependency);
      if (!parsed) {
        result.badRefs.push(dependency);
        warnings.push(`--depends-on ref "${dependency}" is not a valid owner/repo#N reference`);
        continue;
      }
      const number = Number(parsed.number);
      if (!Number.isSafeInteger(number) || number < 1) {
        result.badRefs.push(dependency);
        warnings.push(`--depends-on ref "${dependency}" is not a valid owner/repo#N reference`);
        continue;
      }
      validDependencies.push({ source: dependency, repo: parsed.repo, number });
    }
  }

  // The wrapper does not expose a reusable post-create grant: it may submit
  // metadata only while executeGithubIssueCreationTransaction is still
  // handling this exact creation response, and every metadata target is
  // rebuilt from that response.
  const authority = await resolveGithubIssueCreationAuthority(deps.creation.authority);
  if (!authority) {
    warnings.push('issue creation refused: unresolved-actor');
    return result;
  }

  const repository = opts.repo ?? authority.repository;
  const linked = new Set<string>();
  let transaction;
  try {
    transaction = await executeGithubIssueCreationTransaction({
      authority: deps.creation.authority,
      creation: {
        operation: 'issue.create',
        access: 'create',
        target: { repository, kind: 'repository' },
        context: { actor: authority.actor },
        payload: { title: cleanTitle.text, body: cleanBody.text },
      },
    }, {
      run: async (request) => {
      if (request.operation !== 'issue.create') return { kind: 'refused', reason: 'unsupported-operation' };
      const response = await deps.creation.operations.run(request);
        if (isRunnerRefusal(response)) return response;
        const created = canonicalIssue(response.created, repository);
        if (!created) return response;

        const metadata: Array<{ request: GithubFeatureWriteOperationRequest; dependency?: ValidDependency }> = [
          {
            request: {
              operation: 'issue.label.add', access: 'feature-write', target: created,
              context: { actor: authority.actor }, payload: { label: `priority: ${priority}` },
            },
          },
          {
            request: {
              operation: 'issue.label.add', access: 'feature-write', target: created,
              context: { actor: authority.actor }, payload: { label: `size: ${size}` },
            },
          },
          ...validDependencies.map((dependency) => ({
            request: {
              operation: 'issue.dependency.add' as const, access: 'feature-write' as const, target: created,
              context: { actor: authority.actor },
              // The dependency is payload data only.  Its repository is never
              // a mutation target and a read of it grants no authority.
              payload: { dependency: { repository: dependency.repo, kind: 'issue' as const, number: dependency.number } },
            },
            dependency,
          })),
        ];
        const metadataFailures = [...(response.metadataFailures ?? [])];
        for (const entry of metadata) {
          try {
            const metadataResponse = await deps.creation.operations.run(entry.request);
            const error = metadataFailureError(metadataResponse);
            if (error) {
              metadataFailures.push({
                operation: entry.request.operation,
                error: entry.dependency
                  ? `depends-on link failed for "${entry.dependency.source}": ${error}`
                  : error,
              });
            } else if (entry.dependency) {
              linked.add(entry.dependency.source);
            }
          } catch (error) {
            metadataFailures.push({
              operation: entry.request.operation,
              error: entry.dependency
                ? `depends-on link failed for "${entry.dependency.source}": ${error instanceof Error ? error.message : String(error)}`
                : error instanceof Error ? error.message : String(error),
            });
          }
        }
          return { created, ...(metadataFailures.length > 0 ? { metadataFailures } : {}) };
      },
    });
  } finally {
    (deps.creation.operations as GithubOperationRunner & { closeCreationScope?: () => void }).closeCreationScope?.();
  }

  if (transaction.kind === 'executed' || (transaction.kind === 'partial' && transaction.created)) {
    const created = transaction.created!;
    result.ok = true;
    result.issueUrl = creationUrl(created);
    result.linked.push(...linked);
    for (const failure of transaction.kind === 'partial' ? transaction.metadataFailures : []) {
      result.metadataFailures.push({ operation: failure.operation, error: failure.error });
      warnings.push(failure.operation === 'issue.dependency.add'
        ? failure.error
        : `label-apply failed: ${failure.error}`);
    }
    return result;
  }
  if (transaction.kind === 'partial') {
    result.metadataFailures.push(...transaction.metadataFailures);
    warnings.push(...transaction.metadataFailures.map((failure) => failure.error));
  } else if (transaction.kind === 'refused') {
    warnings.push(`issue creation refused: ${transaction.reason}`);
  } else {
    warnings.push(`issue creation failed: ${transaction.error}`);
  }
  return result;
}
