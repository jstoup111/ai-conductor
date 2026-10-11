import {
  parsePriorityLabels,
  parseSizeLabel,
  type PriorityBand,
} from './backlog-priority.js';
import { parseWorkRef, splitOwnerRepo } from './engineer/source-ref.js';
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
 * GitHub's existing REST transport and failure semantics exactly.
 */
export function createOrderingSource(deps: OrderingSourceDeps): OrderingSource {
  const cwd = deps.cwd ?? '.';
  const unavailableReferences = new Set<string>();

  async function reportUnavailableJira(ref: string): Promise<void> {
    if (unavailableReferences.has(ref)) return;

    unavailableReferences.add(ref);
    await deps.events?.emit({
      type: 'tracker_backend_unavailable',
      project: ref,
      backend: 'jira',
      reason: 'no-adapter',
    });
  }

  return {
    async readFacts(refs: string[]): Promise<Map<string, FactsOutcome>> {
      const result = new Map<string, FactsOutcome>();

      for (const ref of refs) {
        const parsed = parseWorkRef(ref);
        if (!parsed) {
          // Unparseable refs retain the existing not-found behavior, without a gh call.
          result.set(ref, 'not-found');
          continue;
        }

        switch (parsed.kind) {
          case 'jira':
            await reportUnavailableJira(ref);
            result.set(ref, 'unavailable');
            continue;
          case 'github':
            break;
        }

        try {
          const ownerRepo = splitOwnerRepo(parsed.repo);
          if (!ownerRepo) {
            // A malformed GitHub repository slug is not found, without a gh call.
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

    async readBlockers(sourceRef: string): Promise<BlockersOutcome> {
      const parsed = parseWorkRef(sourceRef);
      if (!parsed) {
        return { indeterminate: `unparseable sourceRef: ${sourceRef}` };
      }

      switch (parsed.kind) {
        case 'jira':
          await reportUnavailableJira(sourceRef);
          return 'unavailable';
        case 'github':
          break;
      }

      const { repo, number } = parsed;

      let stdout: string;
      try {
        stdout = await runTrackerRepositoryRead(deps.run, cwd, 'issue.read', `${repo}`, { kind: 'issue', number: Number(number) }, ['api', `repos/${repo}/issues/${number}/dependencies/blocked_by`]);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return { indeterminate: detail };
      }

      let blockedBy: unknown;
      try {
        blockedBy = JSON.parse(stdout);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return { indeterminate: `unparseable blocked_by response: ${detail}` };
      }

      if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
        return [];
      }

      const openBlockers: string[] = [];
      for (const item of blockedBy) {
        const entry = item as { number?: unknown; repository_url?: unknown; state?: unknown };
        if (entry.state === 'closed') continue;

        const repositoryUrl = typeof entry.repository_url === 'string' ? entry.repository_url : '';
        const match = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
        const repo = match ? match[1] : repositoryUrl;
        const number = String(entry.number ?? '');

        openBlockers.push(`${repo}#${number}`);
      }

      return openBlockers;
    },
  };
}
