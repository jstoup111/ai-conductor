import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { BuildReviewDispositionStore } from './build-review-dispositions.js';
import { fileIntakeIssue } from './engineer/intake/file-issue.js';
import type { TrackerClient, GhRunner } from './tracker-client.js';
import type { ConductorEvent } from '../types/events.js';

/** Best-effort daemon reconciliation: failed filing stays visible and retryable. */
export async function reconcileBeyondRecords(input: {
  projectRoot: string;
  tracker: TrackerClient;
  gh: GhRunner;
  log: (message: string) => void;
  emit?: (event: Extract<ConductorEvent, { type: 'build_review_beyond_filed' }>) => Promise<void> | void;
}): Promise<void> {
  let slugs: string[];
  try { slugs = await readdir(join(input.projectRoot, '.worktrees')); } catch { return; }
  for (const slug of slugs) {
    const worktree = join(input.projectRoot, '.worktrees', slug);
    const store = new BuildReviewDispositionStore(worktree);
    const feature = { version: 'v1' as const, repository: input.projectRoot, feature: slug };
    try {
      const listed = await store.listBeyond(feature);
      if (!listed.ok) throw new Error(listed.message);
      for (const record of listed.records) {
        if (record.status === 'filed') continue;
        try {
        const sourceRef = `${slug}:${record.findingId}`;
        const issueUrl = record.issueUrl ?? (await fileIntakeIssue({
          title: `Build-review finding beyond plan criteria: ${record.summary}`,
          body: `Feature: ${slug}\nFinding: ${record.findingId}\nRubric: ${record.rubric}\n\n${record.summary}\n\nEvidence:\n${record.evidenceLocations.map((location) => `- ${location}`).join('\n')}`,
          interactive: false,
          sourceRef,
        }, { tracker: input.tracker, gh: input.gh, cwd: input.projectRoot })).issueUrl;
        if (!record.issueUrl) {
          const remembered = await store.rememberBeyondIssueUrl(feature, record.findingId, issueUrl);
          if (!remembered.ok) throw new Error(remembered.message);
        }
        const stamped = await store.markBeyondFiled(feature, record.findingId, issueUrl);
        if (!stamped.ok) throw new Error(stamped.message);
        await input.emit?.({ type: 'build_review_beyond_filed', feature: slug, lapId: 'reconciled', rubric: record.rubric, findingId: record.findingId, issueUrl });
        } catch (error) {
          input.log(`beyond reconciliation for ${slug}/${record.findingId} deferred: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      input.log(`beyond reconciliation for ${slug} deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
