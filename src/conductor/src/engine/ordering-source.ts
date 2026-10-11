import {
  parsePriorityLabels,
  parseSizeLabel,
  type PriorityBand,
} from './backlog-priority.js';
import { parseSourceRef } from './engineer/issue-ref.js';
import { splitOwnerRepo } from './engineer/source-ref.js';
import type { IntakeEventEmitter } from './intake-backend-composite.js';
import {
  runTrackerRepositoryRead,
  type GhRunner,
} from './tracker-client.js';

/** Priority and size facts normalized for backlog ordering. */
export type OrderingFacts = {
  priority: Exclude<PriorityBand, 'no-issue' | 'unlabeled'> | undefined;
  size: 'S' | 'M' | 'L' | undefined;
};

/** The result of reading ordering facts for one reference. */
export type FactsOutcome = OrderingFacts | 'not-found' | 'unavailable';

/** The result of reading open blocker references for one reference. */
export type BlockersOutcome = string[] | { indeterminate: string } | 'not-found' | 'unavailable';

/** Backend-neutral source of priority, size, and dependency facts. */
export interface OrderingSource {
  readFacts(refs: string[]): Promise<Map<string, FactsOutcome>>;
  readBlockers(ref: string): Promise<BlockersOutcome>;
}

export interface OrderingSourceDeps {
  run: GhRunner;
  cwd?: string;
  /** Reserved for unavailable-backend reporting when non-GitHub dispatch lands. */
  events?: IntakeEventEmitter;
}

/**
 * Construct the ordering source. GitHub fact reads retain the existing
 * ghIssueLabelReader transport and failure semantics exactly.
 */
export function createOrderingSource(deps: OrderingSourceDeps): OrderingSource {
  const cwd = deps.cwd ?? '.';

  return {
    async readFacts(refs: string[]): Promise<Map<string, FactsOutcome>> {
      const result = new Map<string, FactsOutcome>();

      for (const ref of refs) {
        try {
          const parsed = parseSourceRef(ref);
          const ownerRepo = parsed ? splitOwnerRepo(parsed.repo) : null;
          if (!parsed || !ownerRepo) {
            // Unparseable ref (including Jira-shaped refs) — treat as not found,
            // without making a gh call.
            result.set(ref, 'not-found');
            continue;
          }

          const { owner, repo } = ownerRepo;
          const { number } = parsed;
          // gh api accepts exactly ONE endpoint argument — path must be a single token
          const stdout = await runTrackerRepositoryRead(deps.run, cwd, 'issue.read', `${owner}/${repo}`, { kind: 'issue', number: Number(number) }, ['api', `repos/${owner}/${repo}/issues/${number}`]);
          const data = JSON.parse(stdout) as { labels?: Array<{ name: string }> | null };
          const labels = (data.labels ?? []).map((label) => label.name ?? '').filter(Boolean);
          result.set(ref, {
            priority: parsePriorityLabels(labels),
            size: parseSizeLabel(labels),
          });
        } catch (error) {
          // Check if error is a 404
          const is404 = (error as any)?.status === 404 ||
            (error instanceof Error && error.message.includes('404'));

          if (is404) {
            result.set(ref, 'not-found');
          } else {
            // Non-404 error — re-throw as outage
            throw error;
          }
        }
      }

      return result;
    },

    async readBlockers(): Promise<BlockersOutcome> {
      return 'not-found';
    },
  };
}
