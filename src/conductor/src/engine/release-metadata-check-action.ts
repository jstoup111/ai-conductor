import { parseReleaseDisposition, type ReleaseDisposition } from './release-metadata.js';

/** Prefix of the labels this action owns; it owns every label carrying it. */
export const SEMVER_LABEL_PREFIX = 'semver:';

export interface ReleaseMetadataCheckActionInput {
  // Structurally typed against the real Octokit, which carries far more than
  // the one endpoint pair used here — the index signature keeps a caller (or a
  // fixture) free to pass the rest of it.
  github: {
    rest?: {
      [namespace: string]: unknown;
      issues?: {
        addLabels?(params: {
          owner: string;
          repo: string;
          issue_number: number;
          labels: string[];
        }): Promise<unknown>;
        removeLabel?(params: {
          owner: string;
          repo: string;
          issue_number: number;
          name: string;
        }): Promise<unknown>;
      };
    };
  };
  context: {
    repo?: { owner: string; repo: string };
    payload: {
      pull_request: {
        number?: number;
        body?: string | null;
        labels?: Array<{ name?: string }>;
      };
    };
  };
  core: {
    setOutput(name: string, value: string): void;
    info?(message: string): void;
  };
}

/**
 * The one semver label a disposition earns, or null when it earns none.
 *
 * `no-note` covers specification-only, documentation-only, and non-notable
 * work, which never moves VERSION — so it carries no band rather than a
 * fourth "none" band that would read as a release decision it did not make.
 */
export function semverLabelFor(disposition: ReleaseDisposition): string | null {
  return disposition.disposition === 'note' ? `${SEMVER_LABEL_PREFIX}${disposition.semver}` : null;
}

/**
 * Reconcile the PR's current labels against the one the disposition earns.
 *
 * Application is a REPLACE, not an add: editing a PR body from `minor` to
 * `patch` must retract the stale band, or the PR shows two contradictory
 * bands and the operator cannot read the merge order off the list.
 */
export function semverLabelPlan(
  disposition: ReleaseDisposition,
  current: readonly string[],
): { add: string | null; remove: string[] } {
  const desired = semverLabelFor(disposition);
  const owned = current.filter((name) => name.startsWith(SEMVER_LABEL_PREFIX));
  return {
    add: desired !== null && !owned.includes(desired) ? desired : null,
    remove: owned.filter((name) => name !== desired),
  };
}

/**
 * Validate and normalize release metadata from the pull-request webhook payload,
 * then stamp the PR with the semver band the disposition declares.
 *
 * Parsing runs FIRST and is allowed to throw: an invalid disposition must fail
 * the check and leave labels untouched, so no PR is ever banded on metadata
 * that the release renderer would reject. Label application is best-effort —
 * a labels failure (auth, rate limit, network) never fails the required check.
 */
export async function runReleaseMetadataCheckAction(
  input: ReleaseMetadataCheckActionInput,
): Promise<void> {
  const pr = input.context.payload.pull_request;
  const disposition = parseReleaseDisposition(pr.body ?? '');
  input.core.setOutput('release-disposition', JSON.stringify(disposition));

  const issues = input.github.rest?.issues;
  const repo = input.context.repo;
  if (!issues || !repo || typeof pr.number !== 'number') return;

  const current = (pr.labels ?? [])
    .map((label) => label?.name)
    .filter((name): name is string => typeof name === 'string');
  const plan = semverLabelPlan(disposition, current);

  for (const name of plan.remove) {
    try {
      await issues.removeLabel?.({ ...repo, issue_number: pr.number, name });
    } catch (error) {
      input.core.info?.(`semver label: could not remove ${name}: ${String(error)}`);
    }
  }
  if (plan.add !== null) {
    try {
      await issues.addLabels?.({ ...repo, issue_number: pr.number, labels: [plan.add] });
    } catch (error) {
      input.core.info?.(`semver label: could not add ${plan.add}: ${String(error)}`);
    }
  }
}
