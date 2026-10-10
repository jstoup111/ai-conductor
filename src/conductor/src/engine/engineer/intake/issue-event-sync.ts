/**
 * Action-facing intake issue synchronization.
 *
 * Labels remain an issue-form concern, while dependency declarations are read
 * from every raw event body. Both paths use their established typed GitHub
 * operation seams; this module never constructs a mutation argv itself.
 */

import type { GithubOperationRunner } from '../../github-operations.js';
import type { GhRunner } from '../../tracker-client.js';
import { declaredEdges } from '../dependency-reconciler.js';
import {
  createDependencyLinks,
  type DependencyLinkResult,
} from '../issue-dep-migration.js';
import {
  isIssueFormSubmission,
  syncIssueLabels,
  type SyncIssueLabelsResult,
} from './label-sync.js';

export interface IssueEventSyncEvent {
  readonly issue: { readonly number: number; readonly body?: string | null };
  readonly repository: { readonly full_name: string };
  readonly sender?: { readonly login?: string | null };
}

export interface IssueEventSyncDeps {
  readonly gh: GhRunner;
  /** Guarded Action operation boundary for both label and dependency writes. */
  readonly operations: GithubOperationRunner;
  readonly actor: string;
  readonly cwd: string;
  readonly log?: (message: string) => void;
}

export interface IssueEventSyncFailure {
  readonly target: string;
  readonly reason: string;
}

export interface IssueEventSyncReport {
  readonly links: DependencyLinkResult[];
  readonly failures: IssueEventSyncFailure[];
  readonly labels?: SyncIssueLabelsResult;
}

function extractField(body: string, heading: string): string | undefined {
  const headingRegex = new RegExp(`^###\\s+${heading}\\s*$`, 'im');
  const match = headingRegex.exec(body);
  if (!match) return undefined;

  const rest = body.slice(match.index + match[0].length);
  const nextHeading = rest.search(/^###\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const value = section.split('\n').map((line) => line.trim()).find(Boolean);
  return value && value !== '_No response_' ? value : undefined;
}

function formFields(body: string): { priority?: string; size?: string } {
  return { priority: extractField(body, 'Priority'), size: extractField(body, 'Size') };
}

/**
 * Apply the Action's additive sync for one issue event.
 *
 * The form field is intentionally not passed to `syncIssueLabels`: declared
 * edges owns the single union of form and prose declarations, preventing the
 * two Action branches from independently attempting the same link.
 */
export async function applyIssueEventSync(
  event: IssueEventSyncEvent,
  deps: IssueEventSyncDeps,
): Promise<IssueEventSyncReport> {
  const body = event.issue.body ?? '';
  const ref = `${event.repository.full_name}#${event.issue.number}`;
  const log = deps.log ?? (() => {});
  let labels: SyncIssueLabelsResult | undefined;

  if (isIssueFormSubmission(body)) {
    labels = await syncIssueLabels(formFields(body), ref, {
      gh: deps.gh,
      labelOperations: deps.operations,
      actor: deps.actor,
      cwd: deps.cwd,
      log,
    });
  }

  const { edges } = declaredEdges({
    ref,
    body,
    formDependsOn: isIssueFormSubmission(body)
      ? [extractField(body, 'Depends on')].filter((value): value is string => value !== undefined)
      : [],
  });
  const links: DependencyLinkResult[] = [];
  const failures: IssueEventSyncFailure[] = [];

  for (const edge of edges) {
    try {
      links.push(...await createDependencyLinks([edge], {
        gh: deps.gh,
        operations: deps.operations,
        actor: deps.actor,
        cwd: deps.cwd,
        log,
      }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`[issue-event-sync] dependency link ${edge.target} failed: ${reason}`);
      failures.push({ target: edge.target, reason });
    }
  }

  return { links, failures, labels };
}
