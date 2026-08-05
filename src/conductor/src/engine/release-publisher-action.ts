/** Configuration identifying the only PR that may authorize publication. */
export interface ReleasePublisherConfig {
  branch: string;
  base: string;
  appLogin: string;
}

/** The push event observed by the publisher workflow. */
export interface ReleasePublisherEvent {
  branch: string;
  commit: string;
}

/** Provenance supplied by GitHub for the PR which produced a main commit. */
export interface MergedReleasePullRequest {
  number: number;
  author: string;
  head: string;
  /** Immutable generated-branch head that passed the release readiness check. */
  headCommit: string;
  base: string;
  mergeCommit: string;
}

export interface ReleasePublisherGit {
  readCommitFiles(commit: string): Promise<Record<string, string> | undefined>;
  /** Read an existing annotated tag so a retry cannot recreate or overwrite it. */
  readAnnotatedTag(tag: string): Promise<{ commit: string } | undefined>;
  createAnnotatedTag(input: { tag: string; commit: string; message: string }): Promise<void>;
}

export interface ReleasePublisherGithub {
  findMergedPullRequestByMergeCommit(commit: string): Promise<MergedReleasePullRequest | undefined>;
  readReleaseAudit(input: { pullRequestNumber: number }): Promise<{ head: string; complete: boolean } | undefined>;
  /** Read a previously-created release so completed publication is idempotent. */
  findReleaseByTag(tag: string): Promise<{ tag: string; title: string; body: string; target: string } | undefined>;
  createRelease(input: { tag: string; title: string; body: string; target: string }): Promise<void>;
}

export interface ReleasePublisherActionInput {
  git: ReleasePublisherGit;
  github: ReleasePublisherGithub;
  config: ReleasePublisherConfig;
  event: ReleasePublisherEvent;
}

export type ReleasePublisherActionResult =
  | { state: 'ignored' }
  | { state: 'rejected'; reason: string }
  | { state: 'published'; version: string };

export type ReleasePublicationClassification =
  | { state: 'ignored' }
  | { state: 'rejected'; reason: string }
  | {
    state: 'publishable';
    version: string;
    tag: string;
    body: string;
    existingTag: { commit: string } | undefined;
    existingRelease: { tag: string; title: string; body: string; target: string } | undefined;
  };

/**
 * Publish a tag only after GitHub proves that this exact main commit is the
 * approved, complete, bot-owned release PR.  This boundary intentionally
 * derives authority from event, PR, check, and committed artifacts; it keeps
 * no local publication ledger.
 */
export async function runReleasePublisherAction(
  input: ReleasePublisherActionInput,
): Promise<ReleasePublisherActionResult> {
  const classification = await classifyReleasePublication(input);
  if (classification.state !== 'publishable') return classification;

  const publicationAuthority = await publishRelease(input);
  if (publicationAuthority.state !== 'publishable') return publicationAuthority;

  return { state: 'published', version: publicationAuthority.version };
}

/**
 * Resolve whether an event is eligible for publication without creating a tag
 * or release.  The returned publishable state contains the read-only
 * publication plan consumed by the mutation boundary.
 */
export async function classifyReleasePublication(
  input: ReleasePublisherActionInput,
): Promise<ReleasePublicationClassification> {
  if (input.event.branch !== input.config.base) return { state: 'ignored' };

  const pullRequest = await input.github.findMergedPullRequestByMergeCommit(input.event.commit);
  if (!isDesignatedMergedReleasePullRequest(pullRequest, input.config, input.event.commit)) {
    return { state: 'ignored' };
  }

  const audit = await input.github.readReleaseAudit({ pullRequestNumber: pullRequest.number });
  if (audit === undefined || !audit.complete || audit.head !== pullRequest.headCommit) {
    return { state: 'rejected', reason: 'The designated release PR lacks complete, head-bound candidate audit evidence.' };
  }

  const files = await input.git.readCommitFiles(input.event.commit);
  const approved = files === undefined ? undefined : readApprovedRelease(files);
  if (approved === undefined) {
    return { state: 'rejected', reason: 'The designated release PR does not contain an approved VERSION and changelog section.' };
  }

  const tag = `v${approved.version}`;
  const existingTag = await input.git.readAnnotatedTag(tag);
  if (existingTag !== undefined && existingTag.commit !== input.event.commit) {
    return {
      state: 'rejected',
      reason: `The existing ${tag} tag points to ${existingTag.commit}, not approved commit ${input.event.commit}.`,
    };
  }

  const release = { tag, title: tag, body: approved.body, target: input.event.commit };
  const existingRelease = await input.github.findReleaseByTag(tag);
  if (existingRelease !== undefined && !sameRelease(existingRelease, release)) {
    return { state: 'rejected', reason: `The existing ${tag} GitHub Release does not match the approved release artifact.` };
  }

  return {
    state: 'publishable',
    version: approved.version,
    tag,
    body: approved.body,
    existingTag,
    existingRelease,
  };
}

async function publishRelease(
  input: ReleasePublisherActionInput,
): Promise<ReleasePublicationClassification> {
  const classification = await classifyReleasePublication(input);
  if (classification.state !== 'publishable') return classification;

  if (classification.existingTag === undefined) {
    await input.git.createAnnotatedTag({
      tag: classification.tag,
      commit: input.event.commit,
      message: `Release ${classification.tag}`,
    });
  }
  if (classification.existingRelease === undefined) {
    await input.github.createRelease({
      tag: classification.tag,
      title: classification.tag,
      body: classification.body,
      target: input.event.commit,
    });
  }
  return classification;
}

function sameRelease(
  actual: { tag: string; title: string; body: string; target: string },
  expected: { tag: string; title: string; body: string; target: string },
): boolean {
  return actual.tag === expected.tag
    && actual.title === expected.title
    && actual.body === expected.body
    && actual.target === expected.target;
}

function isDesignatedMergedReleasePullRequest(
  pullRequest: MergedReleasePullRequest | undefined,
  config: ReleasePublisherConfig,
  commit: string,
): pullRequest is MergedReleasePullRequest {
  return pullRequest !== undefined
    && pullRequest.author === config.appLogin
    && pullRequest.head === config.branch
    && pullRequest.base === config.base
    && pullRequest.mergeCommit === commit;
}

function readApprovedRelease(files: Record<string, string>): { version: string; body: string } | undefined {
  const version = files.VERSION?.trim();
  if (version === undefined || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return undefined;

  const changelog = files['CHANGELOG.md'];
  if (changelog === undefined) return undefined;
  const header = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\n`, 'm').exec(changelog);
  if (header === null || header.index === undefined) return undefined;
  const bodyStart = header.index + header[0].length;
  const nextSection = changelog.indexOf('\n## ', bodyStart);
  const body = changelog.slice(bodyStart, nextSection === -1 ? changelog.length : nextSection + 1)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
  if (body.trim() === '') return undefined;
  return { version, body };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
