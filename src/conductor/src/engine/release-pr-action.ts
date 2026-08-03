import { renderReleaseCandidateAudit, type ReleaseAuditCandidate } from './release-renderer.js';

/**
 * The release-maintenance boundary deliberately accepts only injected Git and
 * GitHub adapters.  Workflow authentication is configured outside this module;
 * this action never reads an ambient token or shells out through a personal CLI.
 */
export interface ReleasePrConfig {
  branch: string;
  base: string;
  appLogin: string;
}

export interface ReleasePrGit {
  readBranchFiles(branch: string): Promise<Record<string, string> | undefined>;
  pushGeneratedBranch(input: {
    branch: string;
    base: string;
    /** The main commit this render was derived from; adapters must reject a changed base. */
    expectedBaseHead?: string;
    files: Record<string, string>;
    message: string;
  }): Promise<void>;
  /** Read the current base head immediately before a guarded generated-branch push. */
  readMainHead?(branch: string): Promise<string>;
  /** Read the generated branch head used to bind required release readiness. */
  readBranchHead?(branch: string): Promise<string>;
}

export interface ReleasePrGithub {
  findOpenReleasePullRequest(): Promise<ReleasePullRequest | undefined>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number }>;
  updatePullRequest(input: { number: number; title: string; body: string }): Promise<void>;
  /** Publish candidate completeness against the exact release PR head. */
  publishReleaseReadiness?(input: {
    pullRequestNumber: number;
    head: string;
    conclusion: 'success';
    summary: string;
  }): Promise<void>;
}

/** The complete remote identity required before this action may mutate its branch. */
export interface ReleasePullRequest {
  number: number;
  author: string;
  head: string;
  base: string;
}

export interface ReleasePrActionInput {
  git: ReleasePrGit;
  github: ReleasePrGithub;
  config: ReleasePrConfig;
  generatedFiles: Record<string, string>;
  title: string;
  body: string;
  /** The base commit from which the caller collected candidates and rendered generatedFiles. */
  expectedMainHead?: string;
  /** Number of times a stale render may be regenerated before the action fails closed. */
  maxStaleRetries?: number;
  /**
   * Recollect and rerender at a newly observed main head. This is injected so the
   * action keeps no local recovery ledger and never chooses stale content itself.
   */
  rerenderForCurrentMain?: (mainHead: string) => Promise<ReleasePrRender>;
  /** When present, render exhaustive evidence and publish a head-bound readiness result. */
  audit?: readonly ReleaseAuditCandidate[];
}

export interface ReleasePrRender {
  expectedMainHead: string;
  generatedFiles: Record<string, string>;
  title: string;
  body: string;
}

export type ReleasePrActionResult = {
  action: 'created' | 'updated';
  pullRequestNumber: number;
  branchUpdated: boolean;
};

/** Create the designated release PR or update its generated release surfaces. */
export async function runReleasePrAction(input: ReleasePrActionInput): Promise<ReleasePrActionResult> {
  assertAppIdentity(input.config.appLogin);
  assertAuditDependencies(input);
  const existingPullRequest = await input.github.findOpenReleasePullRequest();
  if (existingPullRequest !== undefined) {
    assertOwnedPullRequest(existingPullRequest, input.config);
  }

  let render: ReleasePrRender = {
    expectedMainHead: input.expectedMainHead ?? '',
    generatedFiles: input.generatedFiles,
    title: input.title,
    body: renderBodyWithAudit(input.body, input.audit),
  };
  let staleRetries = 0;
  let branchUpdated: boolean;

  while (true) {
    const existingFiles = await input.git.readBranchFiles(input.config.branch);
    assertNoForeignBranchFiles(existingFiles, render.generatedFiles);
    branchUpdated = !sameGeneratedFiles(existingFiles, render.generatedFiles);
    if (!branchUpdated) break;

    const expectedMainHead = render.expectedMainHead;
    if (expectedMainHead !== '') {
      const mainHead = await readRequiredMainHead(input.git, input.config.base);
      if (mainHead !== expectedMainHead) {
        if (staleRetries >= (input.maxStaleRetries ?? 1) || input.rerenderForCurrentMain === undefined) {
          throw new Error(`Stale release render: main advanced from ${expectedMainHead} to ${mainHead}`);
        }
        staleRetries += 1;
        render = withAudit(input.audit, await input.rerenderForCurrentMain(mainHead));
        continue;
      }
    }

    await input.git.pushGeneratedBranch({
      branch: input.config.branch,
      base: input.config.base,
      ...(expectedMainHead === '' ? {} : { expectedBaseHead: expectedMainHead }),
      files: render.generatedFiles,
      message: `chore(release): prepare ${releaseVersion(render.generatedFiles.VERSION)}`,
    });
    break;
  }

  let result: ReleasePrActionResult;
  if (existingPullRequest === undefined) {
    const created = await input.github.createPullRequest({
      head: input.config.branch,
      base: input.config.base,
      title: render.title,
      body: render.body,
    });
    result = { action: 'created', pullRequestNumber: created.number, branchUpdated };
  } else {
    await input.github.updatePullRequest({
      number: existingPullRequest.number,
      title: render.title,
      body: render.body,
    });
    result = { action: 'updated', pullRequestNumber: existingPullRequest.number, branchUpdated };
  }

  if (input.audit !== undefined) {
    const head = await input.git.readBranchHead!(input.config.branch);
    await input.github.publishReleaseReadiness!({
      pullRequestNumber: result.pullRequestNumber,
      head,
      conclusion: 'success',
      summary: `All ${input.audit.length} release candidates are accounted for.`,
    });
  }
  return result;
}

function renderBodyWithAudit(body: string, audit: readonly ReleaseAuditCandidate[] | undefined): string {
  return audit === undefined ? body : `${body.trimEnd()}\n\n${renderReleaseCandidateAudit(audit)}`;
}

function withAudit(audit: readonly ReleaseAuditCandidate[] | undefined, render: ReleasePrRender): ReleasePrRender {
  return { ...render, body: renderBodyWithAudit(render.body, audit) };
}

function assertAuditDependencies(input: ReleasePrActionInput): void {
  if (input.audit === undefined) return;
  if (input.git.readBranchHead === undefined) {
    throw new Error('Release maintenance requires a release-head reader to publish readiness');
  }
  if (input.github.publishReleaseReadiness === undefined) {
    throw new Error('Release maintenance requires a readiness publisher when an audit is rendered');
  }
}

async function readRequiredMainHead(git: ReleasePrGit, base: string): Promise<string> {
  if (git.readMainHead === undefined) {
    throw new Error('Release maintenance cannot verify the expected main head without a Git main-head reader');
  }
  return git.readMainHead(base);
}

function assertAppIdentity(appLogin: string): void {
  if (appLogin.trim() === '') {
    throw new Error('Release maintenance requires a configured App identity');
  }
}

function assertOwnedPullRequest(pullRequest: ReleasePullRequest, config: ReleasePrConfig): void {
  if (pullRequest.author !== config.appLogin) {
    throw new Error(`Existing release PR owner does not match configured App identity: ${pullRequest.author}`);
  }
  if (pullRequest.base !== config.base) {
    throw new Error(`Existing release PR base does not match configured base: ${pullRequest.base}`);
  }
  if (pullRequest.head !== config.branch) {
    throw new Error(`Existing release PR head does not match configured branch: ${pullRequest.head}`);
  }
}

function assertNoForeignBranchFiles(
  current: Record<string, string> | undefined,
  generated: Record<string, string>,
): void {
  if (current === undefined) return;
  const foreignPaths = Object.keys(current).filter((path) => !(path in generated)).sort();
  if (foreignPaths.length > 0) {
    throw new Error(`Release branch contains foreign edits outside generated surfaces: ${foreignPaths.join(', ')}`);
  }
}

function sameGeneratedFiles(
  current: Record<string, string> | undefined,
  generated: Record<string, string>,
): boolean {
  if (current === undefined) return false;
  const currentPaths = Object.keys(current).sort();
  const generatedPaths = Object.keys(generated).sort();
  return currentPaths.length === generatedPaths.length
    && currentPaths.every((path, index) => path === generatedPaths[index] && current[path] === generated[path]);
}

function releaseVersion(versionFile: string | undefined): string {
  if (versionFile === undefined) return 'candidate';
  const version = versionFile.trim();
  return version === '' ? 'candidate' : version;
}
