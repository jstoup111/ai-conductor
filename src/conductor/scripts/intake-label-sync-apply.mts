#!/usr/bin/env -S npx tsx
// Applies issue-form labels and every declared dependency edge from an intake
// issue event. The shared event sync owns source discrimination: labels are
// form-only, while dependency prose is additive for opened and edited events.
//
// Failure isolation: dependency-link failures are reported but do not fail the
// Action. A later edit or the drift sweep can reconcile a missed link.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeProductionGh } from '../src/engine/pr-labels.js';
import { createGuardedGithubOperationRunner } from '../src/engine/tracker-client.js';
import { createGithubIntakeAuthorization } from '../src/engine/engineer/intake/github-issues.js';
import {
  applyIssueEventSync,
  type IssueEventSyncEvent,
} from '../src/engine/engineer/intake/issue-event-sync.js';

/**
 * Apply one GitHub issue event using the Action's production adapters.
 *
 * This remains a thin entry point: parsing and best-effort link behavior live
 * in `applyIssueEventSync`, so the Action cannot diverge from other callers.
 */
export async function runIntakeLabelSyncApply(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const eventPath = env.GITHUB_EVENT_PATH;
  const token = env.GITHUB_TOKEN;
  const repoSlug = env.GITHUB_REPOSITORY;

  if (!eventPath || !token || !repoSlug) {
    console.error('[intake-label-sync] missing GITHUB_EVENT_PATH/GITHUB_TOKEN/GITHUB_REPOSITORY; skipping');
    return;
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as IssueEventSyncEvent;
  if (!event.issue || !event.repository?.full_name) {
    console.error('[intake-label-sync] event payload has no issue or repository; skipping');
    return;
  }

  const gh = makeProductionGh();
  const actor = typeof event.sender?.login === 'string' && event.sender.login.trim() !== ''
    ? event.sender.login.trim().toLowerCase()
    : 'github-actions';
  const cwd = process.cwd();
  const operations = createGuardedGithubOperationRunner(gh, {
    cwd,
    intake: createGithubIntakeAuthorization({ gh, cwd }),
  });
  const result = await applyIssueEventSync(event, {
    gh,
    operations,
    actor,
    cwd,
    log: (message) => console.error(message),
  });

  for (const failure of result.failures) {
    console.error(`[intake-label-sync] dependency link ${failure.target} failed: ${failure.reason}`);
  }

  console.log(
    `[intake-label-sync] linked: ${result.links.length}; failures: ${result.failures.length}` +
      (result.labels ? `; labels: ${result.labels.priorityLabel}, ${result.labels.sizeLabel}` : ''),
  );
}

async function main(): Promise<void> {
  await runIntakeLabelSyncApply();
}

const isEntrypoint = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isEntrypoint) {
  main().catch((error) => {
    // Never throw out of the entrypoint — an intake Action error must not fail CI.
    console.error('[intake-label-sync] unexpected error (non-fatal):', error);
  });
}
